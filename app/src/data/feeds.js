// ============ 行情数据层:A股/港股/美股/基金/Polymarket ============
// 在线:腾讯行情(script标签跨域,免CORS) + 天天基金 JSONP + Polymarket Gamma API
// 离线:localStorage 缓存 + 确定性模拟行情,保证全功能可用
import { mulberry32 } from '../engine/ml.js';

export const MARKETS = {
  CN: { name: 'A股', prefix: ['sh', 'sz'], tPlus1: true },
  HK: { name: '港股', prefix: ['hk'], tPlus1: false },
  US: { name: '美股', prefix: ['us'], tPlus1: false },
  FUND: { name: '基金', prefix: ['of'], tPlus1: false },
  PM: { name: 'Polymarket', prefix: ['pm'], tPlus1: false },
};

export function marketOf(symbol) {
  if (symbol.startsWith('pm:')) return 'PM';
  if (symbol.startsWith('of')) return 'FUND';
  if (symbol.startsWith('hk')) return 'HK';
  if (symbol.startsWith('us')) return 'US';
  return 'CN';
}

export const DEFAULT_WATCHLIST = [
  { symbol: 'sh600519', name: '贵州茅台' },
  { symbol: 'sz000858', name: '五粮液' },
  { symbol: 'sh601318', name: '中国平安' },
  { symbol: 'sz300750', name: '宁德时代' },
  { symbol: 'hk00700', name: '腾讯控股' },
  { symbol: 'hk09988', name: '阿里巴巴-W' },
  { symbol: 'usAAPL', name: '苹果' },
  { symbol: 'usNVDA', name: '英伟达' },
  { symbol: 'usTSLA', name: '特斯拉' },
  { symbol: 'of001186', name: '富国文体健康' },
];

const LS_PREFIX = 'qp.cache.';
function cacheSet(key, data) { try { localStorage.setItem(LS_PREFIX + key, JSON.stringify({ ts: Date.now(), data })); } catch { } }
function cacheGet(key, maxAgeMs = Infinity) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    return Date.now() - ts <= maxAgeMs ? data : null;
  } catch { return null; }
}

/** 通过 <script> 标签加载腾讯行情(绕过 CORS) */
function loadScriptVars(url, timeout = 6000) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url; s.charset = 'GBK';
    const timer = setTimeout(() => { s.remove(); reject(new Error('timeout')); }, timeout);
    s.onload = () => { clearTimeout(timer); s.remove(); resolve(); };
    s.onerror = () => { clearTimeout(timer); s.remove(); reject(new Error('load error')); };
    document.head.appendChild(s);
  });
}

/** 实时报价: 返回 {symbol, name, price, change, changePct, open, high, low, prevClose, volume, ts, live} */
export async function fetchQuotes(symbols) {
  const online = symbols.filter(s => !s.startsWith('pm:') && !s.startsWith('of'));
  const funds = symbols.filter(s => s.startsWith('of'));
  const out = {};

  if (online.length && typeof document !== 'undefined') {
    try {
      await loadScriptVars('https://qt.gtimg.cn/q=' + online.join(','));
      for (const sym of online) {
        const raw = globalThis['v_' + sym];
        if (!raw) continue;
        const f = String(raw).split('~');
        if (f.length < 35) continue;
        const q = {
          symbol: sym, name: f[1], price: +f[3], prevClose: +f[4], open: +f[5],
          volume: +f[6], high: +f[33], low: +f[34],
          change: +f[31], changePct: +f[32], ts: Date.now(), live: true,
        };
        if (q.price > 0) { out[sym] = q; cacheSet('q.' + sym, q); }
      }
    } catch { /* fall through to cache/sim */ }
  }
  for (const sym of funds) {
    try {
      const code = sym.slice(2);
      await loadScriptVars('https://fundgz.1234567.com.cn/js/' + code + '.js?rt=' + Date.now());
      const g = globalThis.__qp_fund;
      if (g && g.fundcode === code) {
        out[sym] = { symbol: sym, name: g.name, price: +g.gsz, prevClose: +g.dwjz, open: +g.dwjz, high: +g.gsz, low: +g.gsz, volume: 0, change: +g.gsz - +g.dwjz, changePct: +g.gszzl, ts: Date.now(), live: true };
        cacheSet('q.' + sym, out[sym]);
      }
    } catch { }
  }
  // 缓存/模拟兜底
  for (const sym of symbols) {
    if (out[sym] || sym.startsWith('pm:')) continue;
    const cached = cacheGet('q.' + sym);
    if (cached) { out[sym] = { ...cached, live: false }; continue; }
    const bars = await fetchKlines(sym, 5);
    const last = bars[bars.length - 1], prev = bars[bars.length - 2];
    out[sym] = {
      symbol: sym, name: DEFAULT_WATCHLIST.find(w => w.symbol === sym)?.name || sym,
      price: last.c, prevClose: prev.c, open: last.o, high: last.h, low: last.l, volume: last.v,
      change: last.c - prev.c, changePct: (last.c / prev.c - 1) * 100, ts: Date.now(), live: false,
    };
  }
  return out;
}
// 天天基金 JSONP 回调
globalThis.jsonpgz = (d) => { globalThis.__qp_fund = d; };

/** 日K线: 在线(腾讯)→缓存→确定性模拟 */
export async function fetchKlines(symbol, count = 320) {
  const key = 'k.' + symbol;
  if (!symbol.startsWith('pm:') && !symbol.startsWith('of')) {
    try {
      const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,${Math.min(count, 640)},qfq`;
      const r = await fetch(url, { signal: AbortSignal.timeout(7000) });
      const j = await r.json();
      const d = j?.data?.[symbol];
      const arr = d?.qfqday || d?.day;
      if (arr && arr.length > 20) {
        const bars = arr.map(k => ({ t: k[0], o: +k[1], c: +k[2], h: +k[3], l: +k[4], v: +k[5] || 0 }));
        cacheSet(key, bars);
        return bars.slice(-count);
      }
    } catch { /* CORS 或离线,走兜底 */ }
  }
  const cached = cacheGet(key);
  if (cached && cached.length > 20) return cached.slice(-count);
  return simKlines(symbol, count);
}

/** 确定性模拟K线(离线演示/回测数据源) */
export function simKlines(symbol, count = 320) {
  let seed = 0;
  for (const ch of symbol) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = mulberry32(seed);
  let px = 20 + rnd() * 180;
  const bars = [];
  const today = new Date();
  const trend = (rnd() - 0.45) * 0.002;   // 长期漂移
  let regime = 0.015 + rnd() * 0.02;       // 波动 regime
  for (let i = 0; i < count; i++) {
    if (rnd() < 0.03) regime = 0.01 + rnd() * 0.03;
    const drift = trend + (rnd() < 0.5 ? 1 : -1) * (rnd() ** 2) * 0.004;
    const o = px;
    const ret = drift + (rnd() + rnd() + rnd() - 1.5) / 1.5 * regime;
    const c = Math.max(0.5, o * (1 + ret));
    const h = Math.max(o, c) * (1 + rnd() * regime * 0.6);
    const l = Math.min(o, c) * (1 - rnd() * regime * 0.6);
    const v = Math.round(1e6 * (0.5 + rnd() + Math.abs(ret) * 40));
    const d = new Date(today); d.setDate(d.getDate() - (count - i));
    bars.push({ t: d.toISOString().slice(0, 10), o: r2(o), c: r2(c), h: r2(h), l: r2(l), v });
    px = c;
  }
  return bars;
}
const r2 = x => Math.round(x * 100) / 100;

// ============ Polymarket ============
/** 热门事件市场 */
export async function fetchPolymarkets(limit = 12) {
  try {
    const r = await fetch(`https://gamma-api.polymarket.com/markets?closed=false&order=volumeNum&ascending=false&limit=${limit}`,
      { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    const list = (Array.isArray(j) ? j : []).map(m => {
      let yes = NaN;
      try { yes = +(JSON.parse(m.outcomePrices || '[]')[0]); } catch { }
      return {
        id: 'pm:' + (m.slug || m.id), slug: m.slug, question: m.question,
        yes: isNaN(yes) ? null : yes, volume: +m.volumeNum || +m.volume || 0,
        liquidity: +m.liquidityNum || 0, endDate: m.endDate, live: true,
      };
    }).filter(m => m.question);
    if (list.length) { cacheSet('pm.hot', list); return list; }
  } catch { }
  const cached = cacheGet('pm.hot');
  if (cached) return cached.map(m => ({ ...m, live: false }));
  // 离线演示数据
  const rnd = mulberry32(7);
  return [
    '2026年美联储是否降息至3%以下?', '2026世界杯冠军是巴西吗?', 'BTC 年底突破 15 万美元?',
    'AI 公司市值超苹果?', '2026 年台海发生军事冲突?', 'SpaceX 星舰年内成功登月轨道?',
  ].map((q, i) => ({ id: 'pm:demo-' + i, slug: 'demo-' + i, question: q, yes: Math.round(rnd() * 90 + 5) / 100, volume: Math.round(rnd() * 5e6), liquidity: Math.round(rnd() * 8e5), endDate: '2026-12-31', live: false }));
}
