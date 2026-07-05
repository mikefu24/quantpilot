// ============ qp.* 命名空间 API ============
// 面向开发者的友好 API:打开 DevTools 即可编程操作全部能力,IDE 自动补全见 types/quantpilot.d.ts
import { fetchQuotes, fetchKlines, fetchPolymarkets, simKlines, MARKETS, marketOf, DEFAULT_WATCHLIST } from './data/feeds.js';
import { INDICATORS } from './engine/indicators.js';
import { FACTORS, FACTOR_LIST, factorSeries, factorIC } from './engine/factors.js';
import { STRATEGIES, getStrategy } from './engine/strategies.js';
import { runBacktest, metrics } from './engine/backtest.js';
import { trainMLModel, mlSignalFn, mineFactors, rankFactorsByIC, LogisticModel } from './engine/ml.js';
import { paperBroker } from './trade/paper.js';
import { placeOrder, BROKERS } from './trade/brokers.js';
import { notify } from './trade/notify.js';
import { analyzeBuiltin, analyzeLLM } from './ai/berkshire.js';
import { getSettings, saveSettings, on, emit, log } from './core/store.js';

/** @type {import('../types/quantpilot').QP} */
export const qp = {
  version: '1.0.0',
  market: { quotes: fetchQuotes, klines: fetchKlines, polymarkets: fetchPolymarkets, sim: simKlines, MARKETS, of: marketOf, watchlist: DEFAULT_WATCHLIST },
  indicator: INDICATORS,
  factor: { all: FACTORS, list: FACTOR_LIST, series: factorSeries, ic: factorIC, rank: rankFactorsByIC, mine: mineFactors },
  strategy: { all: STRATEGIES, get: getStrategy },
  backtest: { run: runBacktest, metrics },
  ml: { train: trainMLModel, signal: mlSignalFn, LogisticModel },
  trade: { place: placeOrder, paper: paperBroker, brokers: BROKERS, notify },
  ai: { analyze: analyzeBuiltin, deep: analyzeLLM },
  settings: { get: getSettings, save: saveSettings },
  bus: { on, emit, log },
};

globalThis.qp = qp;
