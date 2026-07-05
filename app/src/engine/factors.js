// ============ 因子库：30+ 内置量价因子 ============
// 因子签名: (bars, i) => number | NaN   （在第 i 根K线处的因子值，只用 <=i 的数据，无未来函数）
import { sma, ema, rsi, macd, boll, atr, obv, cci, stdev, closes, kdj, roc } from './indicators.js';

/** 因子上下文缓存：同一 bars 数组只计算一次指标 */
const ctxCache = new WeakMap();
export function ctx(bars) {
  let c = ctxCache.get(bars);
  if (!c) {
    const cl = closes(bars);
    c = {
      cl,
      ma5: sma(cl, 5), ma10: sma(cl, 10), ma20: sma(cl, 20), ma60: sma(cl, 60),
      ema12: ema(cl, 12), ema26: ema(cl, 26),
      rsi14: rsi(bars, 14), rsi6: rsi(bars, 6),
      macd: macd(bars), boll: boll(bars), atr14: atr(bars, 14),
      obv: obv(bars), cci20: cci(bars, 20), kdj: kdj(bars),
      vol20: sma(bars.map(b => b.v), 20),
      sd20: stdev(cl, 20),
    };
    ctxCache.set(bars, c);
  }
  return c;
}

const F = {};
function def(name, group, desc, fn) { F[name] = { name, group, desc, fn }; }

// —— 动量类 ——
def('mom_5d', '动量', '5日动量', (b, i) => i >= 5 ? b[i].c / b[i - 5].c - 1 : NaN);
def('mom_10d', '动量', '10日动量', (b, i) => i >= 10 ? b[i].c / b[i - 10].c - 1 : NaN);
def('mom_20d', '动量', '20日动量', (b, i) => i >= 20 ? b[i].c / b[i - 20].c - 1 : NaN);
def('mom_60d', '动量', '60日动量', (b, i) => i >= 60 ? b[i].c / b[i - 60].c - 1 : NaN);
def('mom_accel', '动量', '动量加速度(5日-20日)', (b, i) => i >= 20 ? (b[i].c / b[i - 5].c - 1) - (b[i].c / b[i - 20].c - 1) : NaN);
// —— 反转类 ——
def('rev_1d', '反转', '1日反转(负收益)', (b, i) => i >= 1 ? -(b[i].c / b[i - 1].c - 1) : NaN);
def('rev_3d', '反转', '3日反转', (b, i) => i >= 3 ? -(b[i].c / b[i - 3].c - 1) : NaN);
def('rsi_rev', '反转', 'RSI超卖反转(50-RSI14)', (b, i) => { const v = ctx(b).rsi14[i]; return isNaN(v) ? NaN : (50 - v) / 50; });
def('boll_pos', '反转', '布林带位置(-1~1)', (b, i) => { const { up, dn } = ctx(b).boll; return isNaN(up[i]) ? NaN : (2 * (b[i].c - dn[i]) / (up[i] - dn[i] + 1e-9) - 1) * -1; });
// —— 趋势类 ——
def('ma_align', '趋势', '均线多头排列强度', (b, i) => { const c = ctx(b); if (isNaN(c.ma60[i])) return NaN; let s = 0; if (c.ma5[i] > c.ma10[i]) s++; if (c.ma10[i] > c.ma20[i]) s++; if (c.ma20[i] > c.ma60[i]) s++; if (b[i].c > c.ma5[i]) s++; return s / 4; });
def('px_ma20', '趋势', '价格偏离MA20', (b, i) => { const m = ctx(b).ma20[i]; return isNaN(m) ? NaN : b[i].c / m - 1; });
def('px_ma60', '趋势', '价格偏离MA60', (b, i) => { const m = ctx(b).ma60[i]; return isNaN(m) ? NaN : b[i].c / m - 1; });
def('macd_hist', '趋势', 'MACD柱(归一化)', (b, i) => { const h = ctx(b).macd.hist[i]; return isNaN(h) ? NaN : h / (b[i].c * 0.01 + 1e-9); });
def('macd_cross', '趋势', 'MACD金叉死叉(±1)', (b, i) => { const { dif, dea } = ctx(b).macd; if (i < 1 || isNaN(dea[i])) return NaN; const now = dif[i] - dea[i], prev = dif[i - 1] - dea[i - 1]; return prev <= 0 && now > 0 ? 1 : prev >= 0 && now < 0 ? -1 : 0; });
def('trend_r2', '趋势', '20日趋势强度(线性回归斜率)', (b, i) => { if (i < 20) return NaN; let sx = 0, sy = 0, sxy = 0, sxx = 0; const n = 20; for (let j = 0; j < n; j++) { const y = Math.log(b[i - n + 1 + j].c); sx += j; sy += y; sxy += j * y; sxx += j * j; } const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx); return slope * 250; });
def('donch_break', '趋势', '20日新高突破', (b, i) => { if (i < 20) return NaN; let hi = -Infinity; for (let j = i - 20; j < i; j++) hi = Math.max(hi, b[j].h); return b[i].c > hi ? 1 : 0; });
// —— 波动率类 ——
def('volat_20d', '波动', '20日波动率(年化,低波偏好取负)', (b, i) => { const s = ctx(b).sd20[i]; return isNaN(s) ? NaN : -(s / b[i].c) * Math.sqrt(250); });
def('atr_ratio', '波动', 'ATR/价格', (b, i) => { const a = ctx(b).atr14[i]; return isNaN(a) ? NaN : -a / b[i].c; });
def('range_pos', '波动', '当日K线位置(收盘在高低区间)', (b, i) => (b[i].h === b[i].l) ? 0.5 : (b[i].c - b[i].l) / (b[i].h - b[i].l));
def('gap', '波动', '跳空幅度', (b, i) => i >= 1 ? b[i].o / b[i - 1].c - 1 : NaN);
// —— 量能类 ——
def('vol_ratio', '量能', '量比(当日/20日均量)', (b, i) => { const m = ctx(b).vol20[i]; return !m || isNaN(m) ? NaN : b[i].v / m - 1; });
def('vol_price_corr', '量能', '10日量价相关性', (b, i) => { if (i < 10) return NaN; let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0; const n = 10; for (let j = 0; j < n; j++) { const x = b[i - n + 1 + j].v, y = b[i - n + 1 + j].c; sx += x; sy += y; sxy += x * y; sxx += x * x; syy += y * y; } const d = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy)); return d === 0 ? 0 : (n * sxy - sx * sy) / d; });
def('obv_slope', '量能', 'OBV 10日斜率(归一)', (b, i) => { const o = ctx(b).obv; if (i < 10) return NaN; const base = Math.abs(o[i - 10]) + 1e-9; return (o[i] - o[i - 10]) / base; });
def('amt_surge', '量能', '放量突击(量比>2且收涨)', (b, i) => { const m = ctx(b).vol20[i]; if (!m || isNaN(m) || i < 1) return NaN; return (b[i].v / m > 2 && b[i].c > b[i - 1].c) ? 1 : 0; });
// —— 摆动类 ——
def('rsi6_val', '摆动', 'RSI6(归一化)', (b, i) => { const v = ctx(b).rsi6[i]; return isNaN(v) ? NaN : (v - 50) / 50; });
def('kdj_j', '摆动', 'KDJ-J值(归一化)', (b, i) => { const v = ctx(b).kdj.j[i]; return isNaN(v) ? NaN : (v - 50) / 50; });
def('kdj_cross', '摆动', 'KDJ金叉(±1)', (b, i) => { const { k, d } = ctx(b).kdj; if (i < 1) return NaN; const now = k[i] - d[i], prev = k[i - 1] - d[i - 1]; return prev <= 0 && now > 0 ? 1 : prev >= 0 && now < 0 ? -1 : 0; });
def('cci_val', '摆动', 'CCI(归一化)', (b, i) => { const v = ctx(b).cci20[i]; return isNaN(v) ? NaN : Math.max(-2, Math.min(2, v / 100)); });
// —— 形态类 ——
def('body_ratio', '形态', '实体占比(阳线为正)', (b, i) => { const r = b[i].h - b[i].l; return r === 0 ? 0 : (b[i].c - b[i].o) / r; });
def('upper_shadow', '形态', '上影线比例(压力,取负)', (b, i) => { const r = b[i].h - b[i].l; return r === 0 ? 0 : -(b[i].h - Math.max(b[i].o, b[i].c)) / r; });
def('lower_shadow', '形态', '下影线比例(支撑)', (b, i) => { const r = b[i].h - b[i].l; return r === 0 ? 0 : (Math.min(b[i].o, b[i].c) - b[i].l) / r; });
def('three_up', '形态', '三连阳', (b, i) => i >= 2 ? (b[i].c > b[i].o && b[i - 1].c > b[i - 1].o && b[i - 2].c > b[i - 2].o ? 1 : 0) : NaN);
def('engulf', '形态', '看涨吞没', (b, i) => i >= 1 ? (b[i - 1].c < b[i - 1].o && b[i].c > b[i].o && b[i].c > b[i - 1].o && b[i].o < b[i - 1].c ? 1 : 0) : NaN);
// —— 价位类 ——
def('dist_high52', '价位', '距52周高点', (b, i) => { const n = Math.min(i + 1, 250); let hi = -Infinity; for (let j = i - n + 1; j <= i; j++) hi = Math.max(hi, b[j].h); return b[i].c / hi - 1; });
def('dist_low52', '价位', '距52周低点', (b, i) => { const n = Math.min(i + 1, 250); let lo = Infinity; for (let j = i - n + 1; j <= i; j++) lo = Math.min(lo, b[j].l); return b[i].c / lo - 1; });

export const FACTORS = F;
export const FACTOR_LIST = Object.values(F);
export const FACTOR_GROUPS = [...new Set(FACTOR_LIST.map(f => f.group))];

/** 计算单因子整条序列 */
export function factorSeries(name, bars) {
  const f = F[name];
  if (!f) throw new Error('未知因子: ' + name);
  return bars.map((_, i) => f.fn(bars, i));
}

/** 因子 IC 分析：因子值与未来 fwd 日收益的秩相关(Rank IC) */
export function factorIC(name, bars, fwd = 5) {
  const vals = factorSeries(name, bars);
  const pairs = [];
  for (let i = 0; i < bars.length - fwd; i++) {
    if (!isNaN(vals[i])) pairs.push([vals[i], bars[i + fwd].c / bars[i].c - 1]);
  }
  if (pairs.length < 30) return { ic: NaN, n: pairs.length };
  const rank = a => { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = new Array(a.length); idx.forEach(([, i], k) => r[i] = k); return r; };
  const rx = rank(pairs.map(p => p[0])), ry = rank(pairs.map(p => p[1]));
  const n = pairs.length, mx = (n - 1) / 2;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) { cov += (rx[i] - mx) * (ry[i] - mx); vx += (rx[i] - mx) ** 2; vy += (ry[i] - mx) ** 2; }
  return { ic: cov / Math.sqrt(vx * vy), n };
}
