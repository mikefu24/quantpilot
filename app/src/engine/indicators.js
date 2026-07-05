// ============ 技术指标库 (零依赖) ============
// 所有函数接收 OHLCV bar 数组: {t,o,h,l,c,v}

/** @param {number[]} arr @param {number} n */
export function sma(arr, n) {
  const out = new Array(arr.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= n) sum -= arr[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/** @param {number[]} arr @param {number} n */
export function ema(arr, n) {
  const out = new Array(arr.length).fill(NaN);
  const k = 2 / (n + 1);
  let prev = arr[0];
  for (let i = 0; i < arr.length; i++) {
    prev = i === 0 ? arr[0] : arr[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** 标准差 */
export function stdev(arr, n) {
  const out = new Array(arr.length).fill(NaN);
  for (let i = n - 1; i < arr.length; i++) {
    let m = 0;
    for (let j = i - n + 1; j <= i; j++) m += arr[j];
    m /= n;
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (arr[j] - m) ** 2;
    out[i] = Math.sqrt(s / n);
  }
  return out;
}

export function closes(bars) { return bars.map(b => b.c); }

/** MACD → {dif, dea, hist} */
export function macd(bars, fast = 12, slow = 26, sig = 9) {
  const c = closes(bars);
  const ef = ema(c, fast), es = ema(c, slow);
  const dif = c.map((_, i) => ef[i] - es[i]);
  const dea = ema(dif, sig);
  const hist = dif.map((d, i) => (d - dea[i]) * 2);
  return { dif, dea, hist };
}

/** RSI */
export function rsi(bars, n = 14) {
  const c = closes(bars);
  const out = new Array(c.length).fill(NaN);
  let up = 0, dn = 0;
  for (let i = 1; i < c.length; i++) {
    const ch = c[i] - c[i - 1];
    const u = Math.max(ch, 0), d = Math.max(-ch, 0);
    if (i <= n) { up += u / n; dn += d / n; }
    else { up = (up * (n - 1) + u) / n; dn = (dn * (n - 1) + d) / n; }
    if (i >= n) out[i] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
  }
  return out;
}

/** KDJ → {k,d,j} */
export function kdj(bars, n = 9) {
  const K = new Array(bars.length).fill(NaN), D = [...K], J = [...K];
  let k = 50, d = 50;
  for (let i = 0; i < bars.length; i++) {
    const s = Math.max(0, i - n + 1);
    let hi = -Infinity, lo = Infinity;
    for (let j = s; j <= i; j++) { hi = Math.max(hi, bars[j].h); lo = Math.min(lo, bars[j].l); }
    const rsv = hi === lo ? 50 : (bars[i].c - lo) / (hi - lo) * 100;
    k = k * 2 / 3 + rsv / 3;
    d = d * 2 / 3 + k / 3;
    K[i] = k; D[i] = d; J[i] = 3 * k - 2 * d;
  }
  return { k: K, d: D, j: J };
}

/** 布林带 → {mid, up, dn} */
export function boll(bars, n = 20, k = 2) {
  const c = closes(bars);
  const mid = sma(c, n), sd = stdev(c, n);
  return { mid, up: mid.map((m, i) => m + k * sd[i]), dn: mid.map((m, i) => m - k * sd[i]) };
}

/** ATR */
export function atr(bars, n = 14) {
  const tr = bars.map((b, i) => i === 0 ? b.h - b.l :
    Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c)));
  return ema(tr, n);
}

/** OBV 能量潮 */
export function obv(bars) {
  const out = new Array(bars.length).fill(0);
  for (let i = 1; i < bars.length; i++)
    out[i] = out[i - 1] + (bars[i].c > bars[i - 1].c ? bars[i].v : bars[i].c < bars[i - 1].c ? -bars[i].v : 0);
  return out;
}

/** CCI */
export function cci(bars, n = 20) {
  const tp = bars.map(b => (b.h + b.l + b.c) / 3);
  const m = sma(tp, n);
  const out = new Array(bars.length).fill(NaN);
  for (let i = n - 1; i < bars.length; i++) {
    let md = 0;
    for (let j = i - n + 1; j <= i; j++) md += Math.abs(tp[j] - m[i]);
    md /= n;
    out[i] = md === 0 ? 0 : (tp[i] - m[i]) / (0.015 * md);
  }
  return out;
}

/** 区间最高/最低（唐奇安通道） */
export function donchian(bars, n = 20) {
  const up = new Array(bars.length).fill(NaN), dn = [...up];
  for (let i = n - 1; i < bars.length; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - n + 1; j <= i; j++) { hi = Math.max(hi, bars[j].h); lo = Math.min(lo, bars[j].l); }
    up[i] = hi; dn[i] = lo;
  }
  return { up, dn };
}

/** N 日收益率 */
export function roc(bars, n = 10) {
  const c = closes(bars);
  return c.map((x, i) => i >= n ? (x / c[i - n] - 1) * 100 : NaN);
}

export const INDICATORS = { sma, ema, macd, rsi, kdj, boll, atr, obv, cci, donchian, roc, stdev };
