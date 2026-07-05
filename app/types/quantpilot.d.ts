// QuantPilot 命名空间 API 类型声明 —— IDE 自动补全 / TypeScript 支持
// 在浏览器 DevTools 或你的 TS 项目中使用全局 `qp` 对象。

export interface Bar { t: string; o: number; h: number; l: number; c: number; v: number; }
export interface Quote {
  symbol: string; name: string; price: number; prevClose: number; open: number;
  high: number; low: number; volume: number; change: number; changePct: number;
  ts: number; live: boolean;
}
export interface PolyMarket {
  id: string; slug: string; question: string; yes: number | null;
  volume: number; liquidity: number; endDate: string; live: boolean;
}
export interface FactorDef { name: string; group: string; desc: string; fn: (bars: Bar[], i: number) => number; }
export interface StrategyDef {
  id: string; name: string; group: string; desc: string;
  params: Record<string, unknown>;
  make(params: Record<string, unknown>): SignalFn;
}
export type Signal = 'BUY' | 'SELL' | 'HOLD' | number;
export type SignalFn = (bars: Bar[], i: number, state?: object) => Signal;

export interface BacktestMetrics {
  totalReturn: number; annualReturn: number; sharpe: number; maxDrawdown: number;
  winRate: number; benchReturn: number; calmar: number; volatility: number; alpha: number;
}
export interface BacktestResult extends BacktestMetrics {
  equity: { t: string; v: number }[];
  trades: { i: number; t: string; side: 'BUY' | 'SELL'; px: number; qty: number; value: number }[];
  config: object;
}
export interface Order { symbol: string; name?: string; side: 'BUY' | 'SELL'; qty: number; price: number; }
export interface PlaceResult { ok: boolean; msg: string; order?: object; }

export interface TrainedModel {
  model: object; factorNames: string[]; accTrain: number; accTest: number;
  importance: { name: string; w: number; desc: string }[]; samples: number;
}
export interface MiningResult {
  best: { ic: number; active: { name: string; w: number; desc: string; group: string }[] };
  history: number[]; generations: number;
}
export interface AIReport {
  mode: string; symbol: string; name: string; price: number; avg: number;
  verdict: string; masters: object[]; advisor: object; tech: number;
  scen: { bull: number; base: number; bear: number }; plans: object[]; falsify: string[];
}

export interface QP {
  version: string;
  /** 行情:A股/港股/美股/基金/Polymarket */
  market: {
    quotes(symbols: string[]): Promise<Record<string, Quote>>;
    klines(symbol: string, count?: number): Promise<Bar[]>;
    polymarkets(limit?: number): Promise<PolyMarket[]>;
    sim(symbol: string, count?: number): Bar[];
    MARKETS: Record<string, { name: string; tPlus1: boolean }>;
    of(symbol: string): string;
    watchlist: { symbol: string; name: string }[];
  };
  /** 技术指标 */
  indicator: {
    sma(a: number[], n: number): number[];
    ema(a: number[], n: number): number[];
    macd(bars: Bar[]): { dif: number[]; dea: number[]; hist: number[] };
    rsi(bars: Bar[], n?: number): number[];
    kdj(bars: Bar[], n?: number): { k: number[]; d: number[]; j: number[] };
    boll(bars: Bar[], n?: number, k?: number): { mid: number[]; up: number[]; dn: number[] };
    atr(bars: Bar[], n?: number): number[];
    obv(bars: Bar[]): number[];
    cci(bars: Bar[], n?: number): number[];
    donchian(bars: Bar[], n?: number): { up: number[]; dn: number[] };
    roc(bars: Bar[], n?: number): number[];
    stdev(a: number[], n: number): number[];
  };
  /** 因子库 + 自动因子挖掘 */
  factor: {
    all: Record<string, FactorDef>;
    list: FactorDef[];
    series(name: string, bars: Bar[]): number[];
    ic(name: string, bars: Bar[], fwd?: number): { ic: number; n: number };
    rank(bars: Bar[], fwd?: number): (FactorDef & { ic: number; n: number })[];
    mine(bars: Bar[], opts?: { pop?: number; gens?: number; fwd?: number }): MiningResult;
  };
  /** 策略模型 */
  strategy: { all: StrategyDef[]; get(id: string): StrategyDef | undefined };
  /** 回测引擎 */
  backtest: {
    run(bars: Bar[], signal: SignalFn, cfg?: object): BacktestResult;
    metrics(equity: { t: string; v: number }[], bars: Bar[], initCash: number): BacktestMetrics;
  };
  /** 轻量机器学习 */
  ml: {
    train(bars: Bar[], factorNames: string[], fwd?: number): TrainedModel | null;
    signal(trained: TrainedModel, fwd?: number): SignalFn;
    LogisticModel: new (dim: number) => object;
  };
  /** 交易:模拟盘 + 券商适配器路由 */
  trade: {
    place(order: Order): Promise<PlaceResult>;
    paper: { cash: number; positions: object; orders: object[]; summary(q?: object): object; reset(cash?: number): void };
    brokers: { id: string; name: string; status: string }[];
    notify(title: string, text?: string): Promise<number>;
  };
  /** AI Berkshire 四大师投研 */
  ai: {
    analyze(symbol: string, name: string, bars: Bar[], quote?: Quote): AIReport;
    deep(symbol: string, name: string, bars: Bar[], quote?: Quote): Promise<{ mode: string; markdown: string }>;
  };
  settings: { get(): object; save(patch: object): object };
  bus: { on(evt: string, fn: Function): () => void; emit(evt: string, data?: unknown): void; log(msg: string, cls?: string): void };
}

declare global { var qp: QP; }
export {};
