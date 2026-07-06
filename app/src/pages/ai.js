// AI Berkshire 投研页
import { esc, scoreRing, toast, mdToHtml } from '../ui/components.js';
import { analyzeBuiltin, analyzeLLM } from '../ai/berkshire.js';
import { fetchKlines, fetchQuotes, DEFAULT_WATCHLIST } from '../data/feeds.js';
import { qlibConfigured, qlibSignal } from '../data/qlib.js';
import { getSettings, fmt } from '../core/store.js';

export async function renderAI(root) {
  const wl = getSettings().watchlist || DEFAULT_WATCHLIST;
  root.innerHTML = `
  <div class="page">
    <div class="page-title">AI Berkshire</div>
    <div class="page-sub">四大师价值分析(巴菲特·芒格·段永平·李录) → 宏观顾问对抗审核 → 技术择时 → 分层建议</div>
    <div class="card">
      <div class="field"><label>分析标的</label><select id="ai-sym">${wl.map(w => `<option value="${w.symbol}">${esc(w.name)} (${w.symbol})</option>`).join('')}</select></div>
      <div class="row">
        <button class="btn" id="ai-run">⚡ 快速分析(内置引擎)</button>
        <button class="btn b-ghost" id="ai-llm">🧠 深度研究(LLM)</button>
      </div>
      <div class="muted" style="margin-top:8px;text-align:center">内置引擎离线可用(量价代理);深度研究需在设置中配置 Claude/DeepSeek API</div>
    </div>
    <div id="ai-out"></div>
  </div>`;

  const out = root.querySelector('#ai-out');

  async function prep() {
    const sym = root.querySelector('#ai-sym').value;
    const w = wl.find(x => x.symbol === sym);
    out.innerHTML = '<div class="card muted">分析中…</div>';
    const bars = await fetchKlines(sym, 500);
    const quotes = await fetchQuotes([sym]);
    return { sym, name: w?.name || sym, bars, quote: quotes[sym] };
  }

  root.querySelector('#ai-run').addEventListener('click', async () => {
    const { sym, name, bars, quote } = await prep();
    const r = analyzeBuiltin(sym, name, bars, quote);
    out.innerHTML = `
    <div class="card" style="text-align:center">
      <div class="card-title" style="justify-content:center">综合决断</div>
      ${scoreRing(r.avg, 5, '四大师均分', r.avg >= 3.5 ? '#30D158' : r.avg >= 3 ? '#FF9F0A' : '#FF453A')}
      <div style="margin-top:12px"><span class="badge ${r.verdictCls}" style="font-size:15px;padding:8px 18px">${r.verdict}</span></div>
      <div class="muted" style="margin-top:10px">宏观顾问:${r.advisor.light} ${r.advisor.label} · 技术择时 ${r.tech > 0 ? '+' : ''}${r.tech.toFixed(1)}/2</div>
    </div>

    <div class="card"><div class="card-title">四大师对抗分析</div>
      ${r.masters.map(m => `
        <div style="padding:10px 0;border-bottom:.5px solid rgba(255,255,255,.06)">
          <div style="display:flex;justify-content:space-between"><b style="font-size:14px">${m.name}</b><span class="orange mono">${m.stars}</span></div>
          <div class="muted" style="margin-top:4px">${m.view}</div>
          <div style="margin-top:4px;font-size:12px;color:var(--purple)">追问:${m.ask}</div>
        </div>`).join('')}
    </div>

    <div class="card"><div class="card-title">外部形势顾问(第五席)</div>
      <div style="font-size:15px;font-weight:700">${r.advisor.light} ${r.advisor.label}</div>
      <div class="muted" style="margin-top:6px">${r.advisor.note}</div>
    </div>

    <div class="card"><div class="card-title">技术面与12个月情景推演</div>
      <div class="grid3">
        <div class="kpi"><div class="v pos">${fmt.num(r.scen.bull)}</div><div class="l">乐观目标</div></div>
        <div class="kpi"><div class="v">${fmt.num(r.scen.base)}</div><div class="l">中性目标</div></div>
        <div class="kpi"><div class="v neg">${fmt.num(r.scen.bear)}</div><div class="l">悲观目标</div></div>
      </div>
      <hr class="hr">
      <div class="muted">现价 ${fmt.num(r.price)} · 20日支撑 ${fmt.num(r.support)} · 阻力 ${fmt.num(r.resist)}<br>情景推演非承诺,仅由趋势与波动率外推。</div>
    </div>

    <div class="card"><div class="card-title">分层操作建议</div>
      <table class="tbl"><tr><th>风格</th><th>仓位上限</th><th>买入区间</th><th>节奏</th></tr>
      ${r.plans.map(p => `<tr><td>${p.name}</td><td>${p.pos}</td><td>${p.entry}</td><td style="font-family:var(--font)">${p.note}</td></tr>`).join('')}
      </table>
    </div>

    <div class="card"><div class="card-title">证伪条件(触发即离场)</div>
      ${r.falsify.map(f => `<div style="padding:4px 0">🔻 ${f}</div>`).join('')}
      <hr class="hr"><div class="muted">${r.disclaimer}</div>
    </div>
    <div id="ai-qlib"></div>`;

    // Qlib 后端评分(已配置时,异步附加)
    if (qlibConfigured() && (sym.startsWith('sh') || sym.startsWith('sz'))) {
      const box = out.querySelector('#ai-qlib');
      box.innerHTML = '<div class="card muted">获取 Qlib 模型评分…</div>';
      qlibSignal(sym).then(q => {
        if (!box.isConnected) return;
        box.innerHTML = q.ok ? `
          <div class="card"><div class="card-title">Qlib 横截面评分 <span class="badge b-purple">Alpha158 + LGBM</span></div>
            <div class="grid3">
              <div class="kpi"><div class="v ${q.score > 0 ? 'pos' : 'neg'}">${q.score.toFixed(4)}</div><div class="l">模型评分</div></div>
              <div class="kpi"><div class="v">${q.rank}/${q.universe}</div><div class="l">股票池排名</div></div>
              <div class="kpi"><div class="v ${q.percentile > 70 ? 'pos' : q.percentile < 30 ? 'neg' : ''}">${q.percentile}%</div><div class="l">分位(越高越好)</div></div>
            </div></div>`
          : `<div class="card muted">Qlib:${esc(q.msg || '未就绪')}</div>`;
      }).catch(e => { if (box.isConnected) box.innerHTML = `<div class="card muted">Qlib 后端不可达:${esc(e.message)}</div>`; });
    }
  });

  root.querySelector('#ai-llm').addEventListener('click', async () => {
    const s = getSettings();
    if (s.aiProvider === 'builtin' || !s.aiApiKey) { toast('请先到「设置 → AI 引擎」配置 Claude 或 DeepSeek API Key'); return; }
    const { sym, name, bars, quote } = await prep();
    out.innerHTML = '<div class="card muted">🧠 LLM 深度研究中(约 30-60 秒)…</div>';
    try {
      const r = await analyzeLLM(sym, name, bars, quote);
      out.innerHTML = `<div class="card"><div class="card-title">深度研究报告 · ${esc(name)} <span class="badge b-purple">${s.aiProvider}</span></div>${mdToHtml(r.markdown)}</div>`;
    } catch (e) {
      out.innerHTML = `<div class="card"><span class="neg">LLM 调用失败:${esc(e.message)}</span><div class="muted" style="margin-top:6px">浏览器版可能受 CORS 限制,桌面版(DMG)不受限;或检查 API Key。</div></div>`;
    }
  });

  return () => { };
}
