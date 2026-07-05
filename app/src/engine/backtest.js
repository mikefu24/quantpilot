// ============ 回测引擎 ============
// 支持 A股规则(T+1、印花税)、美股/Polymarket(T+0)、手续费与滑点

/**
 * @typedef {Object} BtConfig
 * @property {number} [cash=100000] 初始资金
 * @property {number} [feeRate=0.00025] 佣金费率
 * @property {number} [taxRate=0.0005] 卖出印花税(A股)
 * @property {number} [slippage=0.001] 滑点
 * @property {boolean} [tPlus1=false] T+1 规则
 * @property {number} [maxPos=1] 最大仓位比例
 */

/**
 * 运行回测
 * @param {Array} bars OHLCV
 * @param {(bars:Array,i:number,state:Object)=>('BUY'|'SELL'|'HOLD'|number)} signalFn
 *        返回 BUY/SELL/HOLD 或目标仓位比例 0~1
 * @param {BtConfig} cfg
 */
export function runBacktest(bars, signalFn, cfg = {}) {
  const C = { cash: 100000, feeRate: 0.00025, taxRate: 0.0005, slippage: 0.001, tPlus1: false, maxPos: 1, ...cfg };
  let cash = C.cash, shares = 0, lockedShares = 0; // locked = T+1 当日买入不可卖
  const equity = [], trades = [];
  let lastBuyDay = -1;

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (C.tPlus1 && lastBuyDay !== i) lockedShares = 0;

    const sig = signalFn(bars, i, { cash, shares, equity: cash + shares * b.c });
    const px = b.c;

    let target = null;
    if (sig === 'BUY') target = C.maxPos;
    else if (sig === 'SELL') target = 0;
    else if (typeof sig === 'number' && !isNaN(sig)) target = Math.max(0, Math.min(C.maxPos, sig));

    if (target !== null) {
      const eq = cash + shares * px;
      const targetVal = eq * target;
      const curVal = shares * px;
      const diff = targetVal - curVal;

      if (diff > px) { // 买入
        const buyPx = px * (1 + C.slippage);
        let qty = Math.floor(diff / buyPx);
        if (C.tPlus1) qty = Math.floor(qty / 100) * 100; // A股整手
        const cost = qty * buyPx * (1 + C.feeRate);
        if (qty > 0 && cost <= cash) {
          cash -= cost; shares += qty;
          if (C.tPlus1) { lockedShares += qty; lastBuyDay = i; }
          trades.push({ i, t: b.t, side: 'BUY', px: buyPx, qty, value: qty * buyPx });
        }
      } else if (diff < -px) { // 卖出
        const sellable = C.tPlus1 ? shares - lockedShares : shares;
        let qty = Math.min(sellable, Math.floor(-diff / px));
        if (C.tPlus1 && target > 0) qty = Math.floor(qty / 100) * 100;
        if (qty > 0) {
          const sellPx = px * (1 - C.slippage);
          const proceeds = qty * sellPx * (1 - C.feeRate - (C.tPlus1 ? C.taxRate : 0));
          cash += proceeds; shares -= qty;
          trades.push({ i, t: b.t, side: 'SELL', px: sellPx, qty, value: qty * sellPx });
        }
      }
    }
    equity.push({ t: b.t, v: cash + shares * px });
  }
  return { ...metrics(equity, bars, C.cash), equity, trades, config: C };
}

/** 绩效指标 */
export function metrics(equity, bars, initCash) {
  const n = equity.length;
  if (n < 2) return { totalReturn: 0, annualReturn: 0, sharpe: 0, maxDrawdown: 0, winRate: 0, benchReturn: 0, calmar: 0, volatility: 0, alpha: 0 };
  const rets = [];
  for (let i = 1; i < n; i++) rets.push(equity[i].v / equity[i - 1].v - 1);
  const total = equity[n - 1].v / initCash - 1;
  const annual = Math.pow(1 + total, 250 / n) - 1;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length);
  const sharpe = sd === 0 ? 0 : (mean * 250 - 0.02) / (sd * Math.sqrt(250));
  let peak = -Infinity, mdd = 0;
  for (const e of equity) { peak = Math.max(peak, e.v); mdd = Math.max(mdd, 1 - e.v / peak); }
  const wins = rets.filter(r => r > 0).length;
  const bench = bars[n - 1].c / bars[0].c - 1;
  const benchAnnual = Math.pow(1 + bench, 250 / n) - 1;
  return {
    totalReturn: total, annualReturn: annual, sharpe,
    maxDrawdown: mdd, winRate: wins / rets.length,
    benchReturn: bench, calmar: mdd === 0 ? 0 : annual / mdd,
    volatility: sd * Math.sqrt(250), alpha: annual - benchAnnual,
  };
}
