// 策略实验室:回测 / 因子挖掘 / ML训练 / 自动交易机器人
import { esc, segmented, toast, sparkline } from '../ui/components.js';
import { STRATEGIES, getStrategy } from '../engine/strategies.js';
import { runBacktest } from '../engine/backtest.js';
import { rankFactorsByIC, mineFactors, trainMLModel, mlSignalFn } from '../engine/ml.js';
import { FACTOR_LIST } from '../engine/factors.js';
import { fetchKlines, fetchQuotes, DEFAULT_WATCHLIST, marketOf } from '../data/feeds.js';
import { qlibConfigured, qlibHealth, qlibTrain, qlibTopk, fromQlibCode } from '../data/qlib.js';
import { getSettings, fmt, log } from '../core/store.js';
import { placeOrder } from '../trade/brokers.js';
import { paperBroker } from '../trade/paper.js';
import { notify } from '../trade/notify.js';

let botTimer = null; // 模块级:切页不停止机器人
export function botRunning() { return !!botTimer; }

export async function renderStrategy(root) {
  const wl = getSettings().watchlist || DEFAULT_WATCHLIST;
  root.innerHTML = `
  <div class="page">
    <div class="page-title">策略实验室</div>
    <div class="page-sub">内置 ${STRATEGIES.length} 大策略模型 · ${FACTOR_LIST.length} 个量价因子 · 遗传算法因子挖掘 · 浏览器内机器学习</div>
    <div id="st-seg"></div>
    <div id="st-body" style="margin-top:14px"></div>
  </div>`;

  const body = root.querySelector('#st-body');
  const views = [renderBacktest, renderMining, renderML, renderQlib, renderBot];
  root.querySelector('#st-seg').appendChild(
    segmented(['策略回测', '因子挖掘', 'ML 训练', 'Qlib', '自动机器人'], i => views[i](body, wl), 0));
  views[0](body, wl);
  return () => { };
}

// ---------- 1. 策略回测 ----------
function renderBacktest(body, wl) {
  body.innerHTML = `
    <div class="card">
      <div class="field"><label>标的</label><select id="bt-sym">${wl.map(w => `<option value="${w.symbol}">${esc(w.name)} (${w.symbol})</option>`).join('')}</select></div>
      <div class="field"><label>策略模型</label><select id="bt-strat">${STRATEGIES.map(s => `<option value="${s.id}">【${s.group}】${s.name}</option>`).join('')}</select></div>
      <div class="muted" id="bt-desc" style="margin-bottom:12px"></div>
      <button class="btn" id="bt-run">▶ 运行回测(近2年日线)</button>
    </div>
    <div id="bt-out"></div>`;

  const descEl = body.querySelector('#bt-desc');
  const stratSel = body.querySelector('#bt-strat');
  const updDesc = () => { descEl.textContent = getStrategy(stratSel.value)?.desc || ''; };
  stratSel.addEventListener('change', updDesc); updDesc();

  body.querySelector('#bt-run').addEventListener('click', async () => {
    const sym = body.querySelector('#bt-sym').value;
    const st = getStrategy(stratSel.value);
    const out = body.querySelector('#bt-out');
    out.innerHTML = '<div class="card muted">回测中…</div>';
    const bars = await fetchKlines(sym, 500);
    const res = runBacktest(bars, st.make({ ...st.params }), { tPlus1: marketOf(sym) === 'CN' });
    out.innerHTML = btReport(res, st.name);
  });
}

export function btReport(res, title) {
  const eq = res.equity.map(e => e.v);
  const m = res;
  const kpi = (v, l, cls = '') => `<div class="kpi"><div class="v ${cls}" style="font-size:17px">${v}</div><div class="l">${l}</div></div>`;
  return `
  <div class="card">
    <div class="card-title">${esc(title)} · 回测报告 <span class="badge b-blue">${res.trades.length} 笔交易</span></div>
    <div style="margin:6px 0 12px">${sparkline(eq, { w: 640, h: 70, color: m.totalReturn >= 0 ? '#30D158' : '#FF453A' })}</div>
    <div class="grid3">
      ${kpi(fmt.pct(m.totalReturn * 100), '总收益', m.totalReturn >= 0 ? 'pos' : 'neg')}
      ${kpi(fmt.pct(m.annualReturn * 100), '年化收益', m.annualReturn >= 0 ? 'pos' : 'neg')}
      ${kpi(fmt.num(m.sharpe), '夏普比率', m.sharpe > 1 ? 'pos' : '')}
      ${kpi(fmt.pct(-m.maxDrawdown * 100), '最大回撤', 'neg')}
      ${kpi(fmt.pct(m.winRate * 100), '日胜率')}
      ${kpi(fmt.pct(m.alpha * 100), '超额α(vs 买入持有)', m.alpha >= 0 ? 'pos' : 'neg')}
    </div>
    <hr class="hr">
    <div class="muted">基准(买入持有):${fmt.pct(m.benchReturn * 100)} · 年化波动 ${fmt.pct(m.volatility * 100)} · Calmar ${fmt.num(m.calmar)}</div>
  </div>`;
}

// ---------- 2. 因子挖掘 ----------
function renderMining(body, wl) {
  body.innerHTML = `
    <div class="card">
      <div class="field"><label>标的</label><select id="mn-sym">${wl.map(w => `<option value="${w.symbol}">${esc(w.name)}</option>`).join('')}</select></div>
      <div class="row">
        <button class="btn b-ghost" id="mn-ic">单因子 IC 排行</button>
        <button class="btn" id="mn-ga">🧬 遗传算法挖掘</button>
      </div>
    </div>
    <div id="mn-out"></div>`;

  const out = body.querySelector('#mn-out');

  body.querySelector('#mn-ic').addEventListener('click', async () => {
    const sym = body.querySelector('#mn-sym').value;
    out.innerHTML = '<div class="card muted">计算 30+ 因子 Rank IC…</div>';
    const bars = await fetchKlines(sym, 500);
    const ranked = rankFactorsByIC(bars).slice(0, 15);
    out.innerHTML = `<div class="card"><div class="card-title">单因子 Rank IC 排行(预测未来5日收益)</div>
      <table class="tbl"><tr><th>因子</th><th>分组</th><th>IC</th><th>样本</th></tr>
      ${ranked.map(r => `<tr><td>${esc(r.desc)}<div class="muted mono">${r.name}</div></td><td>${r.group}</td>
        <td class="${Math.abs(r.ic) > 0.05 ? (r.ic > 0 ? 'pos' : 'neg') : ''}">${r.ic.toFixed(4)}</td><td>${r.n}</td></tr>`).join('')}
      </table>
      <div class="muted" style="margin-top:10px">|IC| > 0.05 视为有效因子;正 IC 顺势用,负 IC 反向用。</div></div>`;
  });

  body.querySelector('#mn-ga').addEventListener('click', async () => {
    const sym = body.querySelector('#mn-sym').value;
    out.innerHTML = '<div class="card"><div class="card-title">遗传算法进化中</div><div id="mn-prog" class="muted">初始化种群…</div></div>';
    const bars = await fetchKlines(sym, 500);
    await new Promise(r => setTimeout(r, 30));
    const res = mineFactors(bars, {
      onProgress: (g, total, ic) => {
        const p = out.querySelector('#mn-prog');
        if (p) p.textContent = `第 ${g}/${total} 代 · 当前最优组合 IC = ${ic.toFixed(4)}`;
      }
    });
    out.innerHTML = `<div class="card">
      <div class="card-title">🧬 挖掘结果 <span class="badge b-purple">组合 IC ${res.best.ic.toFixed(4)}</span></div>
      <div style="margin-bottom:10px">${sparkline(res.history, { w: 640, h: 46, color: '#BF5AF2' })}</div>
      <div class="muted" style="margin-bottom:8px">进化 ${res.generations} 代的最优因子组合(权重为遗传算法学得):</div>
      <table class="tbl"><tr><th>因子</th><th>分组</th><th>权重</th></tr>
      ${res.best.active.map(g => `<tr><td>${esc(g.desc)}<div class="muted mono">${g.name}</div></td><td>${g.group}</td>
        <td class="${g.w > 0 ? 'pos' : 'neg'}">${g.w.toFixed(3)}</td></tr>`).join('')}
      </table>
      <div class="muted" style="margin-top:10px">可将该组合填入「多因子加权评分」策略回测验证。</div></div>`;
  });
}

// ---------- 3. ML 训练 ----------
function renderML(body, wl) {
  body.innerHTML = `
    <div class="card">
      <div class="field"><label>标的</label><select id="ml-sym">${wl.map(w => `<option value="${w.symbol}">${esc(w.name)}</option>`).join('')}</select></div>
      <div class="muted" style="margin-bottom:12px">逻辑回归(SGD+L2)· 全部 ${FACTOR_LIST.length} 因子 z-score 特征 · 预测未来5日涨跌 · 前70%训练/后30%验证</div>
      <button class="btn b-green" id="ml-train">🤖 训练模型并回测</button>
    </div>
    <div id="ml-out"></div>`;

  body.querySelector('#ml-train').addEventListener('click', async () => {
    const sym = body.querySelector('#ml-sym').value;
    const out = body.querySelector('#ml-out');
    out.innerHTML = '<div class="card muted">特征工程 + SGD 训练中…</div>';
    const bars = await fetchKlines(sym, 500);
    await new Promise(r => setTimeout(r, 30));
    const trained = trainMLModel(bars, FACTOR_LIST.map(f => f.name));
    if (!trained) { out.innerHTML = '<div class="card muted">样本不足(需≥100条训练样本)</div>'; return; }
    const bt = runBacktest(bars, mlSignalFn(trained), { tPlus1: marketOf(sym) === 'CN' });
    out.innerHTML = `
      <div class="card"><div class="card-title">训练结果</div>
        <div class="grid3">
          <div class="kpi"><div class="v">${(trained.accTrain * 100).toFixed(1)}%</div><div class="l">训练集准确率</div></div>
          <div class="kpi"><div class="v ${trained.accTest > 0.52 ? 'pos' : ''}">${(trained.accTest * 100).toFixed(1)}%</div><div class="l">验证集准确率</div></div>
          <div class="kpi"><div class="v">${trained.samples}</div><div class="l">样本数</div></div>
        </div>
        <hr class="hr"><div class="card-title">因子重要性 Top8(|权重|)</div>
        <table class="tbl"><tr><th>因子</th><th>权重</th></tr>
        ${trained.importance.slice(0, 8).map(f => `<tr><td>${esc(f.desc)}</td><td class="${f.w > 0 ? 'pos' : 'neg'}">${f.w.toFixed(3)}</td></tr>`).join('')}
        </table></div>` + btReport(bt, 'ML 模型信号');
  });
}

// ---------- 4. Qlib 研究后端 ----------
function renderQlib(body) {
  if (!qlibConfigured()) {
    body.innerHTML = `<div class="card">
      <div class="card-title">Qlib 研究后端(Alpha158 + LightGBM)</div>
      <div class="muted">未配置。在本机运行 <span class="mono">python bridge/qlib_bridge.py</span>,
      然后到「设置 → AI 引擎」填入地址(默认 <span class="mono">http://127.0.0.1:9529</span>)。</div></div>`;
    return;
  }
  body.innerHTML = `
    <div class="card">
      <div class="card-title">Qlib 研究后端 <span class="badge" id="ql-status">检测中…</span></div>
      <div class="row">
        <button class="btn b-ghost" id="ql-train">🏋️ 训练模型(csi300,数分钟)</button>
        <button class="btn" id="ql-topk">📊 查看 TopK 选股</button>
      </div>
      <div class="muted" style="margin-top:8px">训练在你本机的 Python 进程中执行;TopK 为模型最新截面评分最高的股票,可一键模拟买入验证。</div>
    </div>
    <div id="ql-out"></div>`;

  const status = body.querySelector('#ql-status');
  qlibHealth().then(h => {
    status.textContent = h.ready ? '模型就绪' : '在线·未训练';
    status.className = 'badge ' + (h.ready ? 'b-green' : 'b-orange');
  }).catch(() => { status.textContent = '不可达'; status.className = 'badge b-red'; });

  const out = body.querySelector('#ql-out');

  body.querySelector('#ql-train').addEventListener('click', async () => {
    out.innerHTML = '<div class="card muted">训练中(Alpha158 特征 + LightGBM,请耐心等待)…</div>';
    try {
      const r = await qlibTrain({});
      out.innerHTML = r.ok
        ? `<div class="card"><div class="card-title">训练完成</div>
           <div class="grid3">
             <div class="kpi"><div class="v">${r.samples}</div><div class="l">预测样本</div></div>
             <div class="kpi"><div class="v">${r.universe}</div><div class="l">股票池</div></div>
             <div class="kpi"><div class="v">${r.asof}</div><div class="l">截面日期</div></div>
           </div></div>`
        : `<div class="card"><span class="neg">训练失败:${esc(r.msg)}</span></div>`;
      renderQlib(body);
    } catch (e) { out.innerHTML = `<div class="card"><span class="neg">后端不可达:${esc(e.message)}</span></div>`; }
  });

  body.querySelector('#ql-topk').addEventListener('click', async () => {
    out.innerHTML = '<div class="card muted">获取 TopK…</div>';
    try {
      const r = await qlibTopk(10);
      if (!r.ok) { out.innerHTML = `<div class="card muted">${esc(r.msg)}</div>`; return; }
      out.innerHTML = `<div class="card"><div class="card-title">Qlib TopK 选股(评分降序)</div>
        <table class="tbl"><tr><th>代码</th><th>评分</th><th></th></tr>
        ${r.top.map(t => `<tr><td class="mono">${esc(t.symbol)}</td>
          <td class="${t.score > 0 ? 'pos' : 'neg'}">${t.score.toFixed(4)}</td>
          <td><button class="btn b-ghost b-sm" data-qbuy="${fromQlibCode(t.symbol)}">模拟买入</button></td></tr>`).join('')}
        </table>
        <div class="muted" style="margin-top:8px">注意:评分基于桥接端数据(官方示例数据截止 2020-09,仅验证链路;实盘信号请换新数据源)。</div></div>`;
      out.querySelector('table').addEventListener('click', async e => {
        const sym = e.target.dataset?.qbuy;
        if (!sym) return;
        const q = await fetchQuotes([sym]);
        const px = q[sym]?.price;
        if (!px) return toast('拿不到 ' + sym + ' 的价格');
        const res = await placeOrder({ symbol: sym, name: q[sym]?.name || sym, side: 'BUY', qty: 100, price: px });
        toast(res.msg);
      });
    } catch (e) { out.innerHTML = `<div class="card"><span class="neg">后端不可达:${esc(e.message)}</span></div>`; }
  });
}

// ---------- 5. 自动交易机器人 ----------
function renderBot(body, wl) {
  const running = botRunning();
  body.innerHTML = `
    <div class="card">
      <div class="card-title">自动交易机器人 <span class="badge ${running ? 'b-green' : ''}" id="bot-badge">${running ? '运行中' : '已停止'}</span></div>
      <div class="field"><label>标的池(自选全部)</label><input value="${wl.map(w => w.name).join('、')}" disabled></div>
      <div class="field"><label>策略</label><select id="bot-strat">${STRATEGIES.map(s => `<option value="${s.id}">【${s.group}】${s.name}</option>`).join('')}</select></div>
      <div class="field"><label>扫描间隔(秒)</label><input id="bot-int" type="number" value="60" min="15"></div>
      <div class="field"><label>单标的最大买入金额(¥)</label><input id="bot-max" type="number" value="50000"></div>
      <button class="btn ${running ? 'b-red' : 'b-green'}" id="bot-toggle">${running ? '■ 停止机器人' : '▶ 启动机器人'}</button>
      <div class="muted" style="margin-top:10px;text-align:center">
        信号触发即${getSettings().liveTrading ? '路由实盘适配器' : '模拟盘下单'},并推送飞书/微信/邮件通知。关闭页面后停止。
      </div>
    </div>`;

  body.querySelector('#bot-toggle').addEventListener('click', () => {
    if (botTimer) {
      clearInterval(botTimer); botTimer = null;
      log('🛑 机器人已停止', 'neg');
      renderBot(body, wl);
      return;
    }
    const stratId = body.querySelector('#bot-strat').value;
    const interval = Math.max(15, +body.querySelector('#bot-int').value) * 1000;
    const maxAmt = +body.querySelector('#bot-max').value || 50000;
    const st = getStrategy(stratId);
    log(`🚀 机器人启动:${st.name} · 扫描 ${wl.length} 个标的 · 间隔 ${interval / 1000}s`, 'pos');
    notify('🚀 QuantPilot 机器人启动', `策略:${st.name},标的:${wl.map(w => w.name).join('、')}`);

    const tick = async () => {
      for (const w of wl) {
        try {
          const bars = await fetchKlines(w.symbol, 300);
          const quotes = await fetchQuotes([w.symbol]);
          const px = quotes[w.symbol]?.price || bars[bars.length - 1].c;
          const sig = st.make({ ...st.params })(bars, bars.length - 1, {});
          if (sig === 'BUY' || (typeof sig === 'number' && sig > 0.6)) {
            const isCN = marketOf(w.symbol) === 'CN';
            let qty = Math.floor(maxAmt / px);
            if (isCN) qty = Math.floor(qty / 100) * 100;
            if (qty > 0) {
              const res = await placeOrder({ symbol: w.symbol, name: w.name, side: 'BUY', qty, price: px });
              log(`📈 ${w.name} 触发买入信号 → ${res.msg}`, res.ok ? 'pos' : 'neg');
            }
          } else if (sig === 'SELL' || sig === 0) {
            const pos = paperBroker.positions[w.symbol];
            const sellable = pos ? pos.qty - (pos.todayQty || 0) : 0;
            if (sellable > 0) {
              const res = await placeOrder({ symbol: w.symbol, name: w.name, side: 'SELL', qty: sellable, price: px });
              log(`📉 ${w.name} 触发卖出信号 → ${res.msg}`, res.ok ? 'neg' : '');
            }
          } else {
            log(`· ${w.name} 无信号(HOLD)`);
          }
        } catch (e) { log(`⚠️ ${w.name} 扫描失败:${e.message}`, 'neg'); }
      }
    };
    tick();
    botTimer = setInterval(tick, interval);
    renderBot(body, wl);
  });
}
