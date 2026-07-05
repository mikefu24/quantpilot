// ============ 模拟交易引擎(纸面撮合) ============
// A股 T+1/整手/印花税规则;美股/港股/Polymarket T+0。状态持久化 localStorage。
import { marketOf, MARKETS } from '../data/feeds.js';

const LS_KEY = 'qp.paper.v1';

export class PaperBroker {
  constructor() {
    const saved = load();
    this.cash = saved?.cash ?? 1000000;
    this.initCash = saved?.initCash ?? 1000000;
    /** @type {Record<string,{symbol,name,qty,avgPx,todayQty}>} */
    this.positions = saved?.positions ?? {};
    this.orders = saved?.orders ?? [];
    this.day = saved?.day ?? today();
  }

  _rollDay() {
    const d = today();
    if (d !== this.day) {
      this.day = d;
      for (const p of Object.values(this.positions)) p.todayQty = 0; // T+1 解锁
      this._save();
    }
  }

  /** 下单(市价成交) @returns {{ok:boolean, msg:string, order?:Object}} */
  place({ symbol, name, side, qty, price }) {
    this._rollDay();
    const mkt = marketOf(symbol);
    const isCN = mkt === 'CN';
    if (!price || price <= 0) return { ok: false, msg: '无有效价格' };
    if (!qty || qty <= 0) return { ok: false, msg: '数量无效' };
    if (isCN && side === 'BUY' && qty % 100 !== 0) return { ok: false, msg: 'A股买入需整手(100股)' };

    const feeRate = 0.00025, taxRate = isCN ? 0.0005 : 0;
    const pos = this.positions[symbol];

    if (side === 'BUY') {
      const cost = qty * price * (1 + feeRate);
      if (cost > this.cash) return { ok: false, msg: `资金不足(需 ${fmt(cost)})` };
      this.cash -= cost;
      if (pos) {
        pos.avgPx = (pos.avgPx * pos.qty + price * qty) / (pos.qty + qty);
        pos.qty += qty;
        if (isCN) pos.todayQty = (pos.todayQty || 0) + qty;
      } else {
        this.positions[symbol] = { symbol, name, qty, avgPx: price, todayQty: isCN ? qty : 0 };
      }
    } else {
      if (!pos || pos.qty < qty) return { ok: false, msg: '持仓不足' };
      const sellable = isCN ? pos.qty - (pos.todayQty || 0) : pos.qty;
      if (qty > sellable) return { ok: false, msg: `T+1 限制,今日可卖 ${sellable} 股` };
      this.cash += qty * price * (1 - feeRate - taxRate);
      pos.qty -= qty;
      if (pos.qty === 0) delete this.positions[symbol];
    }
    const order = { id: 'O' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ts: Date.now(), symbol, name, side, qty, price, market: mkt, status: 'FILLED' };
    this.orders.unshift(order);
    if (this.orders.length > 500) this.orders.length = 500;
    this._save();
    return { ok: true, msg: `${side === 'BUY' ? '买入' : '卖出'}成交 ${name || symbol} ${qty} @ ${price}`, order };
  }

  /** 账户总览(需传入最新报价 map) */
  summary(quotes = {}) {
    let mktVal = 0, pnl = 0;
    const rows = Object.values(this.positions).map(p => {
      const px = quotes[p.symbol]?.price || p.avgPx;
      const val = px * p.qty, profit = (px - p.avgPx) * p.qty;
      mktVal += val; pnl += profit;
      return { ...p, price: px, value: val, pnl: profit, pnlPct: (px / p.avgPx - 1) * 100 };
    }).sort((a, b) => b.value - a.value);
    const equity = this.cash + mktVal;
    return { cash: this.cash, mktVal, equity, pnl, totalPnl: equity - this.initCash, totalPnlPct: (equity / this.initCash - 1) * 100, positions: rows };
  }

  reset(cash = 1000000) {
    this.cash = cash; this.initCash = cash; this.positions = {}; this.orders = []; this.day = today();
    this._save();
  }

  _save() { save({ cash: this.cash, initCash: this.initCash, positions: this.positions, orders: this.orders, day: this.day }); }
}

function today() { return new Date().toISOString().slice(0, 10); }
function fmt(x) { return x.toLocaleString('zh-CN', { maximumFractionDigits: 0 }); }
function load() { try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; } }
function save(d) { try { localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch { } }

export const paperBroker = new PaperBroker();
