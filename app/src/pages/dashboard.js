// 首页仪表盘
import { el, esc, sparkline } from '../ui/components.js';
import { fetchQuotes, fetchKlines, fetchPolymarkets, DEFAULT_WATCHLIST } from '../data/feeds.js';
import { paperBroker } from '../trade/paper.js';
import { getSettings, fmt, getLogs, on } from '../core/store.js';

export async function renderDashboard(root, nav) {
  const wl = getSettings().watchlist || DEFAULT_WATCHLIST;
  root.innerHTML = `
  <div class="page">
    <div class="page-title">QuantPilot</div>
    <div class="page-sub">${new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })} · AI 驱动多市场交易终端</div>

    <div class="card" style="background:linear-gradient(135deg,rgba(10,132,255,.18),rgba(191,90,242,.14));border-color:rgba(10,132,255,.25)">
      <div class="card-title">模拟账户总权益 <span class="badge b-blue" id="db-mode">模拟盘</span></div>
      <div class="big-num" id="db-equity">--</div>
      <div class="row" style="margin-top:10px">
        <div class="kpi" style="flex:1"><div class="v" id="db-pnl">--</div><div class="l">总盈亏</div></div>
        <div class="kpi" style="flex:1"><div class="v" id="db-cash">--</div><div class="l">可用资金</div></div>
        <div class="kpi" style="flex:1"><div class="v" id="db-poscount">--</div><div class="l">持仓数</div></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">自选行情 <span class="muted" id="db-live"></span></div>
      <div id="db-watch"></div>
    </div>

    <div class="card">
      <div class="card-title">Polymarket 热门事件</div>
      <div id="db-pm" class="muted">加载中…</div>
    </div>

    <div class="card">
      <div class="card-title">机器人日志</div>
      <div class="console" id="db-log"></div>
    </div>
  </div>`;

  const logBox = root.querySelector('#db-log');
  const renderLogs = () => {
    logBox.innerHTML = getLogs().slice(0, 40).map(l =>
      `<div><span class="t">${l.ts}</span><span class="${l.cls}">${esc(l.msg)}</span></div>`).join('') || '<span class="muted">暂无日志。到「策略」页启动自动交易机器人。</span>';
  };
  renderLogs();
  const unsubs = [on('log', renderLogs)];

  // 行情 + 账户
  const symbols = wl.map(w => w.symbol);
  const quotes = await fetchQuotes(symbols);
  if (!root.isConnected) return () => unsubs.forEach(u => u());

  const sum = paperBroker.summary(quotes);
  root.querySelector('#db-equity').textContent = fmt.cny(sum.equity);
  const pnlEl = root.querySelector('#db-pnl');
  pnlEl.textContent = fmt.pct(sum.totalPnlPct);
  pnlEl.className = 'v ' + (sum.totalPnl >= 0 ? 'pos' : 'neg');
  root.querySelector('#db-cash').textContent = fmt.cny(sum.cash);
  root.querySelector('#db-poscount').textContent = sum.positions.length;
  if (getSettings().liveTrading) {
    const m = root.querySelector('#db-mode');
    m.textContent = '实盘'; m.className = 'badge b-red';
  }

  const anyLive = Object.values(quotes).some(q => q.live);
  root.querySelector('#db-live').textContent = anyLive ? '● 实时' : '离线(缓存/模拟)';

  // 迷你K线
  const sparks = {};
  await Promise.all(symbols.slice(0, 10).map(async s => { sparks[s] = (await fetchKlines(s, 30)).map(b => b.c); }));
  if (!root.isConnected) return () => unsubs.forEach(u => u());

  root.querySelector('#db-watch').innerHTML = `<div class="list" style="background:transparent;border:0">` +
    wl.map(w => {
      const q = quotes[w.symbol];
      if (!q) return '';
      const cls = fmt.cls(q.changePct);
      return `<div class="list-item" data-sym="${w.symbol}">
        <div class="li-main"><div class="li-title">${esc(q.name || w.name)}</div><div class="li-sub mono">${w.symbol}</div></div>
        <div>${sparkline(sparks[w.symbol] || [], {})}</div>
        <div class="li-right" style="min-width:86px">
          <div style="font-weight:700">${fmt.num(q.price)}</div>
          <div class="${cls}" style="font-size:12px">${fmt.pct(q.changePct)}</div>
        </div>
      </div>`;
    }).join('') + '</div>';
  root.querySelector('#db-watch').addEventListener('click', e => {
    const item = e.target.closest('[data-sym]');
    if (item) nav('market', { symbol: item.dataset.sym });
  });

  // Polymarket
  fetchPolymarkets(6).then(list => {
    if (!root.isConnected) return;
    root.querySelector('#db-pm').innerHTML = list.map(m => `
      <div class="list-item" style="padding:10px 0">
        <div class="li-main"><div class="li-title" style="font-size:13.5px">${esc(m.question)}</div>
          <div class="li-sub">量 $${fmt.big(m.volume)} · ${m.live ? '实时' : '演示'}</div></div>
        <div class="li-right"><span class="badge ${m.yes >= 0.5 ? 'b-green' : 'b-red'}">YES ${m.yes == null ? '--' : Math.round(m.yes * 100) + '%'}</span></div>
      </div>`).join('');
  });

  return () => unsubs.forEach(u => u());
}
