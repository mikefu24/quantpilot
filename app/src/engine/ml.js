// ============ 轻量机器学习 + 自动化因子挖掘 ============
// 逻辑回归(SGD) / 岭回归 / 遗传算法因子组合挖掘 —— 纯 JS,浏览器内运行

import { FACTORS, FACTOR_LIST, factorSeries, factorIC } from './factors.js';

/** z-score 标准化 */
function zscore(col) {
  const valid = col.filter(v => !isNaN(v));
  const m = valid.reduce((a, b) => a + b, 0) / (valid.length || 1);
  const sd = Math.sqrt(valid.reduce((a, b) => a + (b - m) ** 2, 0) / (valid.length || 1)) || 1;
  return col.map(v => isNaN(v) ? 0 : (v - m) / sd);
}

/** 构建特征矩阵: bars × 因子 → {X, y, rows} y=未来fwd日涨跌 */
export function buildDataset(bars, factorNames, fwd = 5) {
  const cols = factorNames.map(n => zscore(factorSeries(n, bars)));
  const X = [], y = [], rows = [];
  for (let i = 60; i < bars.length - fwd; i++) {
    X.push(cols.map(c => c[i]));
    y.push(bars[i + fwd].c / bars[i].c - 1 > 0 ? 1 : 0);
    rows.push(i);
  }
  return { X, y, rows };
}

/** 逻辑回归(mini-batch SGD + L2) */
export class LogisticModel {
  constructor(dim, lr = 0.05, l2 = 0.001) { this.w = new Array(dim).fill(0); this.b = 0; this.lr = lr; this.l2 = l2; }
  predict1(x) { let z = this.b; for (let j = 0; j < x.length; j++) z += this.w[j] * x[j]; return 1 / (1 + Math.exp(-z)); }
  fit(X, y, epochs = 60) {
    const n = X.length;
    for (let e = 0; e < epochs; e++) {
      for (let i = 0; i < n; i++) {
        const p = this.predict1(X[i]), g = p - y[i];
        for (let j = 0; j < this.w.length; j++) this.w[j] -= this.lr * (g * X[i][j] + this.l2 * this.w[j]);
        this.b -= this.lr * g;
      }
    }
    return this;
  }
  accuracy(X, y) { let c = 0; for (let i = 0; i < X.length; i++) if ((this.predict1(X[i]) > 0.5 ? 1 : 0) === y[i]) c++; return c / (X.length || 1); }
}

/** 训练 ML 评分模型(walk-forward: 前70%训练,后30%验证) */
export function trainMLModel(bars, factorNames, fwd = 5) {
  const { X, y, rows } = buildDataset(bars, factorNames, fwd);
  if (X.length < 100) return null;
  const cut = Math.floor(X.length * 0.7);
  const model = new LogisticModel(factorNames.length).fit(X.slice(0, cut), y.slice(0, cut));
  const accTrain = model.accuracy(X.slice(0, cut), y.slice(0, cut));
  const accTest = model.accuracy(X.slice(cut), y.slice(cut));
  // 因子重要性 = |权重|
  const importance = factorNames.map((n, j) => ({ name: n, w: model.w[j], desc: FACTORS[n]?.desc || n }))
    .sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
  return { model, factorNames, accTrain, accTest, importance, samples: X.length, cut, rows };
}

/** 用训练好的模型生成信号函数(供回测引擎) */
export function mlSignalFn(trained, fwd = 5) {
  const { model, factorNames } = trained;
  const cache = new WeakMap();
  return (bars, i) => {
    let cols = cache.get(bars);
    if (!cols) { cols = factorNames.map(n => zscore(factorSeries(n, bars))); cache.set(bars, cols); }
    if (i < 60) return 'HOLD';
    const p = model.predict1(cols.map(c => c[i]));
    if (p > 0.58) return Math.min(1, (p - 0.5) * 4);
    if (p < 0.45) return 0;
    return 'HOLD';
  };
}

// ============ 遗传算法:自动化因子挖掘 ============
// 个体 = 因子子集 + 权重;适应度 = 组合因子的 Rank IC
function combinedIC(bars, genes, fwd) {
  const active = genes.filter(g => g.on);
  if (!active.length) return -1;
  const cols = active.map(g => zscore(factorSeries(g.name, bars)));
  const combo = bars.map((_, i) => active.reduce((s, g, k) => s + cols[k][i] * g.w, 0));
  // rank IC vs 未来收益
  const pairs = [];
  for (let i = 60; i < bars.length - fwd; i++) pairs.push([combo[i], bars[i + fwd].c / bars[i].c - 1]);
  if (pairs.length < 50) return -1;
  const rank = a => { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = new Array(a.length); idx.forEach(([, i], k) => r[i] = k); return r; };
  const rx = rank(pairs.map(p => p[0])), ry = rank(pairs.map(p => p[1]));
  const n = pairs.length, mx = (n - 1) / 2;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) { cov += (rx[i] - mx) * (ry[i] - mx); vx += (rx[i] - mx) ** 2; vy += (ry[i] - mx) ** 2; }
  const ic = cov / Math.sqrt(vx * vy || 1);
  return ic - active.length * 0.002; // 惩罚复杂度
}

/**
 * 遗传算法挖掘最优因子组合
 * @returns {{best:{genes:Array,ic:number}, history:number[], generations:number}}
 */
export function mineFactors(bars, { pop = 24, gens = 18, fwd = 5, onProgress } = {}) {
  const names = FACTOR_LIST.map(f => f.name);
  const rnd = mulberry32(42);
  const randGene = () => names.map(n => ({ name: n, on: rnd() < 0.18, w: rnd() * 2 - 1 }));
  let population = Array.from({ length: pop }, randGene);
  const history = [];
  let best = { genes: population[0], ic: -1 };

  for (let g = 0; g < gens; g++) {
    const scored = population.map(genes => ({ genes, ic: combinedIC(bars, genes, fwd) }))
      .sort((a, b) => b.ic - a.ic);
    if (scored[0].ic > best.ic) best = scored[0];
    history.push(scored[0].ic);
    onProgress?.(g + 1, gens, scored[0].ic);
    // 精英保留 + 交叉 + 变异
    const elite = scored.slice(0, Math.max(2, pop >> 2)).map(s => s.genes);
    const next = [...elite];
    while (next.length < pop) {
      const a = elite[Math.floor(rnd() * elite.length)], b = elite[Math.floor(rnd() * elite.length)];
      const child = a.map((g1, i) => {
        const src = rnd() < 0.5 ? g1 : b[i];
        const c = { ...src };
        if (rnd() < 0.12) c.on = !c.on;                 // 变异:开关
        if (rnd() < 0.2) c.w += (rnd() - 0.5) * 0.6;    // 变异:权重
        return c;
      });
      next.push(child);
    }
    population = next;
  }
  const activeFactors = best.genes.filter(g => g.on)
    .map(g => ({ ...g, desc: FACTORS[g.name]?.desc, group: FACTORS[g.name]?.group }));
  return { best: { ...best, active: activeFactors }, history, generations: gens };
}

/** 单因子 IC 排行 */
export function rankFactorsByIC(bars, fwd = 5) {
  return FACTOR_LIST.map(f => ({ ...f, ...factorIC(f.name, bars, fwd) }))
    .filter(r => !isNaN(r.ic))
    .sort((a, b) => Math.abs(b.ic) - Math.abs(a.ic));
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
