// 交易页:持仓 / 订单 / Polymarket
import { esc, segmented, toast, sheet } from '../ui/components.js';
import { paperBroker } from '../trade/paper.js';
import { placeOrder, BROKERS } from '../trade/brokers.js';
import { fetchQuotes, fetchPolymarkets } from '../data/feeds.js';
import { getSettings, fmt } from '../core/store.js';

export async function renderTrade(root) {
  root.innerHTML = `
  <div class="page">
    <div class="page-title">交易</div>
    <div id="tr-seg"></div>
    <div id="tr-body" style="margin-top:14px"></div>
  </div>`;
  const body = root.querySelector('#tr-body');
  const views = [renderPositions, renderOrders, renderPM];
  root.querySelector('#tr-seg').appendChild(segmented(['持仓', '订单记录', 'Polymarket'], i => views[i](body), 0));
  views[0](body);
  return () => { };
}

async function renderPositions(body) {
  body.innerHTML = '<div class="card muted">加载持仓…</div>';
  const symbols = Object.keys(paperBroker.positions);
  const quotes = symbols.length ? await fetchQuotes(symbols) : {};
  const s = paperBroker.summary(quotes);
  body.innerHTML = `
    <div class="card">
      <div class="card-title">账户 <span class="badge ${getSettings().liveTrading ? 'b-red' : 'b-blue'}">${getSettings().liveTrading ? '实盘路由' : '模拟盘'}</span></div>
      <div class="big-num">${fmt.cny(s.equity)}</div>
      <div class="row" style="margin-top:10px">
        <div class="kpi" style="flex:1"><div class="v ${s.totalPnl >= 0 ? 'pos' : 'neg'}">${fmt.pct(s.totalPnlPct)}</div><div class="l">总收益率</div></div>
        <div class="kpi" style="flex:1"><div class="v">${fmt.cny(s.cash)}</div><div class="l">可用</div></div>
        <div class="kpi" style="flex:1"><div class="v">${fmt.cny(s.mktVal)}</div><div class="l">市值</div></div>
      </div>
    </div>
    ${s.positions.length ? `<div class="card"><div class="card-title">持仓明细</div>
      <table class="tbl"><tr><th>标的</th><th>数量</th><th>成本</th><th>现价</th><th>盈亏</th><th></th></tr>
      ${s.positions.map(p => `<tr>
        <td>${esc(p.name || p.symbol)}<div class="muted mono">${p.symbol}</div></td>
        <td>${p.qty}</td><td>${fmt.num(p.avgPx)}</td><td>${fmt.num(p.price)}</td>
        <td class="${p.pnl >= 0 ? 'pos' : 'neg'}">${fmt.pct(p.pnlPct)}</td>
        <td><button class="btn b-ghost b-sm" data-close="${p.symbol}">平仓</button></td></tr>`).join('')}
      </table></div>` : '<div class="card muted" style="text-align:center">暂无持仓。到「行情」页或启动策略机器人开始交易。</div>'}
    <div class="card"><div class="card-title">券商通道状态</div>
      ${BROKERS.map(b => `<div class="list-item" style="padding:9px 0">
        <div class="li-main"><div class="li-title" style="font-size:14px">${b.name}</div></div>
        <span class="badge ${b.status === 'ready' ? 'b-green' : ''}">${b.status === 'ready' ? '就绪' : '未配置'}</span></div>`).join('')}
      <div class="muted" style="margin-top:8px">A股实盘需 Windows 侧桥接端(见仓库 bridge/ 目录),在设置中填入地址。</div>
    </div>
    <button class="btn b-ghost" id="tr-reset" style="margin-top:12px">重置模拟账户(¥1,000,000)</button>`;

  body.addEventListener('click', async e => {
    const sym = e.target.dataset?.close;
    if (sym) {
      const p = paperBroker.positions[sym];
      const sellable = p.qty - (p.todayQty || 0);
      if (sellable <= 0) return toast('T+1:今日买入部分明日可卖');
      const q = await fetchQuotes([sym]);
      const res = await placeOrder({ symbol: sym, name: p.name, side: 'SELL', qty: sellable, price: q[sym]?.price || p.avgPx });
      toast(res.msg);
      if (res.ok) renderPositions(body);
    }
    if (e.target.id === 'tr-reset') {
      paperBroker.reset();
      toast('已重置模拟账户');
      renderPositions(body);
    }
  }, { once: true });
}

function renderOrders(body) {
  const orders = paperBroker.orders;
  body.innerHTML = orders.length ? `<div class="card"><div class="card-title">最近 ${orders.length} 笔委托</div>
    <table class="tbl"><tr><th>时间</th><th>标的</th><th>方向</th><th>数量</th><th>价格</th></tr>
    ${orders.slice(0, 60).map(o => `<tr>
      <td class="muted">${new Date(o.ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
      <td style="font-family:var(--font)">${esc(o.name || o.symbol)}</td>
      <td class="${o.side === 'BUY' ? 'up' : 'down'}">${o.side === 'BUY' ? '买入' : '卖出'}</td>
      <td>${o.qty}</td><td>${fmt.num(o.price)}</td></tr>`).join('')}
    </table></div>` : '<div class="card muted" style="text-align:center">暂无订单记录</div>';
}

async function renderPM(body) {
  body.innerHTML = '<div class="card muted">加载 Polymarket 市场…</div>';
  const list = await fetchPolymarkets(16);
  body.innerHTML = `<div class="card"><div class="card-title">事件预测市场 ${list[0]?.live ? '<span class="badge b-green">实时</span>' : '<span class="badge">演示数据</span>'}</div>
    ${list.map((m, i) => `<div class="list-item" data-pm="${i}">
      <div class="li-main"><div class="li-title" style="font-size:14px">${esc(m.question)}</div>
      <div class="li-sub">成交量 $${fmt.big(m.volume)} · 截止 ${String(m.endDate || '').slice(0, 10)}</div></div>
      <div class="li-right"><span class="badge ${m.yes >= 0.5 ? 'b-green' : 'b-red'}" style="font-size:13px">YES ${m.yes == null ? '--' : Math.round(m.yes * 100) + '¢'}</span></div>
    </div>`).join('')}
    <div class="muted" style="margin-top:10px">点击可模拟买入 YES/NO。实盘 CLOB 签名下单需在设置配置 Polygon 私钥(仅桌面版,默认关闭)。</div></div>`;

  body.addEventListener('click', e => {
    const item = e.target.closest('[data-pm]');
    if (!item) return;
    const m = list[+item.dataset.pm];
    if (m.yes == null) return toast('该市场暂无价格');
    sheet(`
      <h3>模拟交易事件市场</h3>
      <div class="muted" style="margin-bottom:12px">${esc(m.question)}</div>
      <div class="field"><label>方向</label><select id="pm-side"><option value="YES">YES @ ${Math.round(m.yes * 100)}¢</option><option value="NO">NO @ ${Math.round((1 - m.yes) * 100)}¢</option></select></div>
      <div class="field"><label>份数(shares)</label><input id="pm-qty" type="number" value="100"></div>
      <button class="btn" id="pm-go">确认模拟买入</button>
    `, {
      onOpen(box, close) {
        box.querySelector('#pm-go').addEventListener('click', async () => {
          const side = box.querySelector('#pm-side').value;
          const qty = +box.querySelector('#pm-qty').value;
          const px = side === 'YES' ? m.yes : 1 - m.yes;
          const res = await placeOrder({ symbol: m.id + ':' + side, name: `${m.question.slice(0, 18)}…[${side}]`, side: 'BUY', qty, price: px });
          toast(res.msg);
          if (res.ok) close();
        });
      }
    });
  });
}
