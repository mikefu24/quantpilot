// 行情页:K线 + 技术指标 + 快速下单
import { esc, segmented, toast, sheet } from '../ui/components.js';
import { createKChart } from '../ui/kchart.js';
import { fetchQuotes, fetchKlines, DEFAULT_WATCHLIST, marketOf, MARKETS } from '../data/feeds.js';
import { ctx } from '../engine/factors.js';
import { placeOrder } from '../trade/brokers.js';
import { getSettings, saveSettings, fmt } from '../core/store.js';

export async function renderMarket(root, nav, params = {}) {
  const wl = getSettings().watchlist || DEFAULT_WATCHLIST;
  let symbol = params.symbol || wl[0].symbol;

  root.innerHTML = `
  <div class="page">
    <div class="page-title">行情</div>
    <div class="scroll-x" id="mk-tabs"></div>
    <div class="card" style="margin-top:12px">
      <div id="mk-head" style="margin-bottom:10px"></div>
      <div id="mk-seg"></div>
      <div class="kchart-wrap" id="mk-chart" style="margin-top:10px"></div>
    </div>
    <div class="card"><div class="card-title">技术指标快照</div><div id="mk-ind" class="grid3"></div></div>
    <div class="row" style="margin-top:14px">
      <button class="btn b-red" id="mk-buy">买入</button>
      <button class="btn b-green" id="mk-sell">卖出</button>
    </div>
    <div class="muted" style="margin-top:10px;text-align:center" id="mk-note"></div>
  </div>`;

  const chart = createKChart(root.querySelector('#mk-chart'), { height: 400 });
  const segBox = root.querySelector('#mk-seg');
  const seg = segmented(['近3月', '近半年', '近1年', '全部'], i => chart.setView([60, 120, 250, 9999][i]), 1);
  segBox.appendChild(seg);

  let bars = [], quote = null;

  function renderTabs() {
    root.querySelector('#mk-tabs').innerHTML = wl.map(w =>
      `<button class="btn b-ghost b-sm" data-s="${w.symbol}" style="${w.symbol === symbol ? 'background:rgba(10,132,255,.25);color:var(--blue)' : ''}">${esc(w.name)}</button>`
    ).join('') + `<button class="btn b-ghost b-sm" id="mk-add">＋ 添加</button>`;
  }
  renderTabs();

  root.querySelector('#mk-tabs').addEventListener('click', e => {
    if (e.target.id === 'mk-add') return addSymbol();
    const b = e.target.closest('[data-s]');
    if (b) { symbol = b.dataset.s; renderTabs(); load(); }
  });

  async function load() {
    bars = await fetchKlines(symbol, 500);
    const quotes = await fetchQuotes([symbol]);
    quote = quotes[symbol];
    if (!root.isConnected) return;
    chart.setBars(bars);
    chart.setView(120);
    const cls = fmt.cls(quote.changePct);
    const mkt = MARKETS[marketOf(symbol)];
    root.querySelector('#mk-head').innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-end">
        <div>
          <div style="font-size:20px;font-weight:800">${esc(quote.name)} <span class="badge">${mkt.name}</span> ${quote.live ? '<span class="badge b-green">实时</span>' : '<span class="badge">离线</span>'}</div>
          <div class="muted mono">${symbol}</div>
        </div>
        <div style="text-align:right">
          <div class="big-num ${cls}" style="font-size:26px">${fmt.num(quote.price)}</div>
          <div class="${cls}" style="font-family:var(--mono);font-size:13px">${fmt.num(quote.change)} (${fmt.pct(quote.changePct)})</div>
        </div>
      </div>`;

    const c = ctx(bars);
    const i = bars.length - 1;
    const ind = [
      ['MA5', c.ma5[i]], ['MA20', c.ma20[i]], ['MA60', c.ma60[i]],
      ['RSI14', c.rsi14[i]], ['MACD·DIF', c.macd.dif[i]], ['KDJ·J', c.kdj.j[i]],
      ['ATR14', c.atr14[i]], ['BOLL上轨', c.boll.up[i]], ['BOLL下轨', c.boll.dn[i]],
    ];
    root.querySelector('#mk-ind').innerHTML = ind.map(([n, v]) =>
      `<div class="kpi"><div class="v" style="font-size:16px">${fmt.num(v)}</div><div class="l">${n}</div></div>`).join('');
    root.querySelector('#mk-note').textContent = mkt.tPlus1 ? 'A股规则:T+1 · 整手100股 · 卖出含印花税' : 'T+0 市场';
  }

  function orderSheet(side) {
    if (!quote) return;
    const isCN = marketOf(symbol) === 'CN';
    const { close } = sheet(`
      <h3>${side === 'BUY' ? '🔴 买入' : '🟢 卖出'} ${esc(quote.name)}</h3>
      <div class="field"><label>价格(市价参考)</label><input id="od-px" type="number" step="0.01" value="${quote.price}"></div>
      <div class="field"><label>数量${isCN ? '(整手100)' : ''}</label><input id="od-qty" type="number" step="${isCN ? 100 : 1}" value="${isCN ? 100 : 10}"></div>
      <button class="btn ${side === 'BUY' ? 'b-red' : 'b-green'}" id="od-go">确认${side === 'BUY' ? '买入' : '卖出'}</button>
      <div class="muted" style="margin-top:10px;text-align:center">${getSettings().liveTrading ? '⚠️ 实盘模式已开启,将路由至券商适配器' : '当前为模拟盘,不会产生真实交易'}</div>
    `, {
      onOpen(box, closeFn) {
        box.querySelector('#od-go').addEventListener('click', async () => {
          const px = +box.querySelector('#od-px').value, qty = +box.querySelector('#od-qty').value;
          const res = await placeOrder({ symbol, name: quote.name, side, qty, price: px });
          toast(res.msg);
          if (res.ok) closeFn();
        });
      }
    });
  }
  root.querySelector('#mk-buy').addEventListener('click', () => orderSheet('BUY'));
  root.querySelector('#mk-sell').addEventListener('click', () => orderSheet('SELL'));

  function addSymbol() {
    sheet(`
      <h3>添加自选</h3>
      <div class="field"><label>代码(sh600519 / sz000001 / hk00700 / usAAPL / of001186)</label><input id="ad-sym" placeholder="usMSFT"></div>
      <div class="field"><label>名称</label><input id="ad-name" placeholder="微软"></div>
      <button class="btn" id="ad-go">添加</button>
    `, {
      onOpen(box, closeFn) {
        box.querySelector('#ad-go').addEventListener('click', () => {
          const s = box.querySelector('#ad-sym').value.trim(), n = box.querySelector('#ad-name').value.trim() || s;
          if (!s) return toast('请输入代码');
          const list = [...(getSettings().watchlist || DEFAULT_WATCHLIST), { symbol: s, name: n }];
          saveSettings({ watchlist: list });
          wl.length = 0; wl.push(...list);
          symbol = s; renderTabs(); load(); closeFn();
        });
      }
    });
  }

  await load();
  return () => chart.destroy();
}
