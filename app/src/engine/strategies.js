// ============ 内置策略模型库 ============
import { ctx, FACTORS, factorSeries } from './factors.js';
import { donchian } from './indicators.js';

/**
 * 策略签名: { id, name, desc, params, make(params) => signalFn }
 * signalFn: (bars, i, state) => 'BUY' | 'SELL' | 'HOLD' | number(目标仓位)
 */
const S = [];
function def(id, name, group, desc, params, make) { S.push({ id, name, group, desc, params, make }); }

def('ma_cross', '双均线趋势', '趋势', '快线上穿慢线买入,下穿卖出。经典趋势跟随。',
  { fast: 5, slow: 20 },
  p => (b, i) => {
    const c = ctx(b);
    const f = p.fast <= 5 ? c.ma5 : p.fast <= 10 ? c.ma10 : c.ma20;
    const s = p.slow <= 20 ? c.ma20 : c.ma60;
    if (i < 1 || isNaN(s[i])) return 'HOLD';
    if (f[i - 1] <= s[i - 1] && f[i] > s[i]) return 'BUY';
    if (f[i - 1] >= s[i - 1] && f[i] < s[i]) return 'SELL';
    return 'HOLD';
  });

def('macd_trend', 'MACD 金叉死叉', '趋势', 'DIF 上穿 DEA 且零轴上方加强信号。',
  {},
  () => (b, i) => {
    const { dif, dea } = ctx(b).macd;
    if (i < 1 || isNaN(dea[i])) return 'HOLD';
    const now = dif[i] - dea[i], prev = dif[i - 1] - dea[i - 1];
    if (prev <= 0 && now > 0) return dif[i] > 0 ? 'BUY' : 0.5;
    if (prev >= 0 && now < 0) return 'SELL';
    return 'HOLD';
  });

def('rsi_revert', 'RSI 超买超卖反转', '反转', 'RSI<超卖线买入,>超买线卖出。震荡市有效。',
  { low: 30, high: 70 },
  p => (b, i) => {
    const r = ctx(b).rsi14[i];
    if (isNaN(r)) return 'HOLD';
    if (r < p.low) return 'BUY';
    if (r > p.high) return 'SELL';
    return 'HOLD';
  });

def('boll_break', '布林带突破', '突破', '收盘突破上轨追多,跌破中轨离场。',
  {},
  () => (b, i) => {
    const { mid, up } = ctx(b).boll;
    if (isNaN(up[i])) return 'HOLD';
    if (b[i].c > up[i]) return 'BUY';
    if (b[i].c < mid[i]) return 'SELL';
    return 'HOLD';
  });

def('turtle', '海龟交易法', '突破', '20日新高入场,10日新低离场,经典唐奇安通道。',
  { entry: 20, exit: 10 },
  p => {
    let dcE = null, dcX = null, src = null;
    return (b, i) => {
      if (src !== b) { dcE = donchian(b, p.entry); dcX = donchian(b, p.exit); src = b; }
      if (i < 1 || isNaN(dcE.up[i - 1])) return 'HOLD';
      if (b[i].c > dcE.up[i - 1]) return 'BUY';
      if (b[i].c < dcX.dn[i - 1]) return 'SELL';
      return 'HOLD';
    };
  });

def('grid', '网格交易', '震荡', '围绕基准价上下网格,跌买涨卖,吃震荡波动。',
  { step: 0.05, base: 0 },
  p => {
    let basePx = 0;
    return (b, i, st) => {
      if (i === 0) basePx = p.base || b[0].c;
      const dev = b[i].c / basePx - 1;
      const level = Math.round(-dev / p.step); // 跌得越多 level 越高
      const target = Math.max(0, Math.min(1, 0.5 + level * 0.25));
      return target;
    };
  });

def('momentum_rotate', '动量轮动', '动量', '20日动量为正持仓,转负清仓。趋势市利器。',
  { look: 20 },
  p => (b, i) => {
    if (i < p.look) return 'HOLD';
    const m = b[i].c / b[i - p.look].c - 1;
    return m > 0.02 ? 'BUY' : m < -0.02 ? 'SELL' : 'HOLD';
  });

def('kdj_swing', 'KDJ 波段', '摆动', 'J值超卖金叉买入,超买死叉卖出。',
  {},
  () => (b, i) => {
    const { k, d, j } = ctx(b).kdj;
    if (i < 1) return 'HOLD';
    const gold = k[i - 1] <= d[i - 1] && k[i] > d[i];
    const dead = k[i - 1] >= d[i - 1] && k[i] < d[i];
    if (gold && j[i] < 40) return 'BUY';
    if (dead && j[i] > 70) return 'SELL';
    return 'HOLD';
  });

def('multi_factor', '多因子加权评分', '多因子', '多个因子加权合成评分,高分持仓低分离场。可搭配因子挖掘结果。',
  { factors: 'mom_20d,ma_align,vol_ratio,rsi_rev', threshold: 0.15 },
  p => {
    const names = String(p.factors).split(',').map(s => s.trim()).filter(n => FACTORS[n]);
    const weights = p.weights || names.map(() => 1 / names.length);
    return (b, i) => {
      let score = 0, wsum = 0;
      names.forEach((n, k) => {
        const v = FACTORS[n].fn(b, i);
        if (!isNaN(v)) { score += Math.max(-1, Math.min(1, v * 5)) * weights[k]; wsum += Math.abs(weights[k]); }
      });
      if (wsum === 0) return 'HOLD';
      score /= wsum;
      if (score > p.threshold) return Math.min(1, 0.5 + score);
      if (score < -p.threshold) return 0;
      return 'HOLD';
    };
  });

def('event_driven', '事件驱动(新闻情绪)', '事件', '接入新闻/AI情绪分数(-1~1),配合动量过滤。对接 Polymarket 事件市场同源逻辑。',
  { sentiment: 0 },
  p => (b, i) => {
    if (i < 5) return 'HOLD';
    const mom = b[i].c / b[i - 5].c - 1;
    const s = p.sentiment ?? 0;
    if (s > 0.4 && mom > -0.02) return 'BUY';
    if (s < -0.4) return 'SELL';
    return 'HOLD';
  });

export const STRATEGIES = S;
export function getStrategy(id) { return S.find(s => s.id === id); }
