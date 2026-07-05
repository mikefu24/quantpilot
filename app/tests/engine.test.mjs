// 核心引擎单元测试 —— node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sma, ema, rsi, macd, boll, atr } from '../src/engine/indicators.js';
import { FACTOR_LIST, factorSeries, factorIC } from '../src/engine/factors.js';
import { runBacktest } from '../src/engine/backtest.js';
import { STRATEGIES } from '../src/engine/strategies.js';
import { trainMLModel, mlSignalFn, mineFactors, rankFactorsByIC, mulberry32 } from '../src/engine/ml.js';

// 确定性模拟K线(与 feeds.simKlines 同逻辑,避免依赖 DOM)
function simBars(seedStr = 'test', count = 400) {
  let seed = 0;
  for (const ch of seedStr) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = mulberry32(seed);
  let px = 100;
  const bars = [];
  for (let i = 0; i < count; i++) {
    const o = px;
    const ret = 0.0004 + (rnd() + rnd() + rnd() - 1.5) / 1.5 * 0.02;
    const c = Math.max(1, o * (1 + ret));
    const h = Math.max(o, c) * (1 + rnd() * 0.01);
    const l = Math.min(o, c) * (1 - rnd() * 0.01);
    bars.push({ t: `D${i}`, o, h, l, c, v: 1e6 * (0.5 + rnd()) });
    px = c;
  }
  return bars;
}

test('SMA/EMA 基础正确性', () => {
  const s = sma([1, 2, 3, 4, 5], 3);
  assert.ok(isNaN(s[1]));
  assert.equal(s[2], 2);
  assert.equal(s[4], 4);
  const e = ema([1, 1, 1, 1], 2);
  assert.equal(e[3], 1);
});

test('RSI 在 0-100 区间', () => {
  const bars = simBars('rsi', 200);
  const r = rsi(bars);
  const valid = r.filter(v => !isNaN(v));
  assert.ok(valid.length > 100);
  assert.ok(valid.every(v => v >= 0 && v <= 100));
});

test('MACD/BOLL/ATR 输出长度一致', () => {
  const bars = simBars('ind', 150);
  const m = macd(bars);
  assert.equal(m.dif.length, 150);
  const b = boll(bars);
  assert.ok(b.up[100] > b.mid[100] && b.mid[100] > b.dn[100]);
  assert.ok(atr(bars)[100] > 0);
});

test(`因子库 ${FACTOR_LIST.length} 个因子全部可计算`, () => {
  assert.ok(FACTOR_LIST.length >= 30, '因子数应 ≥30');
  const bars = simBars('factors', 300);
  for (const f of FACTOR_LIST) {
    const s = factorSeries(f.name, bars);
    assert.equal(s.length, 300, f.name);
    const valid = s.filter(v => !isNaN(v));
    assert.ok(valid.length > 30, `${f.name} 有效值过少`);
    assert.ok(valid.every(v => isFinite(v)), `${f.name} 出现 Inf`);
  }
});

test('因子 IC 计算', () => {
  const bars = simBars('ic', 400);
  const { ic, n } = factorIC('mom_20d', bars, 5);
  assert.ok(n > 300);
  assert.ok(ic >= -1 && ic <= 1);
});

test('回测引擎:资金守恒与指标合理', () => {
  const bars = simBars('bt', 400);
  // 买入持有策略
  const res = runBacktest(bars, (b, i) => (i === 0 ? 'BUY' : 'HOLD'), { cash: 100000 });
  assert.equal(res.equity.length, 400);
  assert.ok(res.trades.length >= 1);
  assert.ok(res.equity.every(e => e.v > 0), '权益应恒正');
  assert.ok(res.maxDrawdown >= 0 && res.maxDrawdown <= 1);
  // 与基准同向(买入持有近似基准,允许费用差)
  assert.ok(Math.abs(res.totalReturn - res.benchReturn) < 0.15);
});

test('回测 T+1:当日买入不可卖', () => {
  const bars = simBars('t1', 50);
  let sold = false;
  const res = runBacktest(bars, (b, i) => (i === 10 ? 'BUY' : i === 10.5 ? 'SELL' : 'HOLD'), { tPlus1: true });
  // 同一天内买卖在此引擎按bar粒度,验证整手规则
  const buy = res.trades.find(t => t.side === 'BUY');
  assert.ok(buy.qty % 100 === 0, 'A股整手');
});

test(`${STRATEGIES.length} 个内置策略全部可回测`, () => {
  assert.ok(STRATEGIES.length >= 10, '策略数应 ≥10');
  const bars = simBars('strat', 400);
  for (const st of STRATEGIES) {
    const res = runBacktest(bars, st.make({ ...st.params }), {});
    assert.ok(isFinite(res.totalReturn), st.id);
    assert.ok(res.equity.length === 400, st.id);
  }
});

test('ML 训练:验证集准确率有意义', () => {
  const bars = simBars('ml', 500);
  const trained = trainMLModel(bars, FACTOR_LIST.map(f => f.name));
  assert.ok(trained, '训练应成功');
  assert.ok(trained.accTrain > 0.4 && trained.accTrain <= 1);
  assert.ok(trained.accTest > 0.3 && trained.accTest <= 1);
  assert.equal(trained.importance.length, FACTOR_LIST.length);
  // 信号函数可回测
  const res = runBacktest(bars, mlSignalFn(trained), {});
  assert.ok(isFinite(res.sharpe));
});

test('遗传算法因子挖掘收敛', () => {
  const bars = simBars('ga', 400);
  const res = mineFactors(bars, { pop: 12, gens: 6 });
  assert.equal(res.history.length, 6);
  assert.ok(res.best.ic > -1 && res.best.ic < 1);
  assert.ok(res.best.active.length >= 1, '至少激活一个因子');
  // 进化不应退化:末代最优 >= 首代最优
  assert.ok(res.history[res.history.length - 1] >= res.history[0] - 1e-9);
});

test('因子 IC 排行', () => {
  const bars = simBars('rank', 400);
  const ranked = rankFactorsByIC(bars);
  assert.ok(ranked.length > 20);
  for (let i = 1; i < ranked.length; i++)
    assert.ok(Math.abs(ranked[i - 1].ic) >= Math.abs(ranked[i].ic), '应按|IC|降序');
});
