// ============ AI Berkshire 四大师投研引擎 ============
// 框架来源: a-share-invest skill —— 四大师价值分析(巴菲特/芒格/段永平/李录)
// → 外部形势顾问(宏观/地缘/政策)对抗审核 → 技术面择时 → 分层操作建议
// 内置模式: 用量价因子做程序化代理评分(离线可用)
// LLM 模式: 接 Claude / DeepSeek API 输出完整投研叙述
import { ctx, factorSeries } from '../engine/factors.js';
import { getSettings } from '../core/store.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const stars = s => '★'.repeat(Math.round(s)) + '☆'.repeat(5 - Math.round(s));

/** 内置程序化分析(离线):基于量价特征生成四大师代理评分与择时建议 */
export function analyzeBuiltin(symbol, name, bars, quote) {
  const c = ctx(bars);
  const i = bars.length - 1;
  const px = quote?.price || bars[i].c;

  // —— 代理指标 ——
  const mom60 = i >= 60 ? bars[i].c / bars[i - 60].c - 1 : 0;
  const mom250 = i >= 250 ? bars[i].c / bars[i - 250].c - 1 : mom60 * 3;
  const volat = (c.sd20[i] / px) * Math.sqrt(250);
  const trendSlope = factorSeries('trend_r2', bars)[i] || 0;
  const distHigh = factorSeries('dist_high52', bars)[i] || 0;
  const distLow = factorSeries('dist_low52', bars)[i] || 0;
  const maAlign = factorSeries('ma_align', bars)[i] || 0;
  const drawdownStability = 1 - clamp(volat / 0.6, 0, 1); // 低波动≈经营稳定的代理

  // —— 四大师代理评分(1-5)——
  const masters = [
    {
      key: 'duan', name: '段永平 · 生意本质',
      score: clamp(3 + mom250 * 2 + drawdownStability - 0.5, 1, 5),
      view: mom250 > 0.15 ? '长期价格中枢上移,市场持续为其生意投票,像"对的生意"。'
        : mom250 < -0.2 ? '长期趋势下行,市场对商业模式投了反对票,需要证明"这门生意到底好在哪"。'
          : '长期表现平淡,生意本质需基本面数据进一步验证。',
      ask: '一句话说清这门生意好在哪?现金流从哪来?',
    },
    {
      key: 'buffett', name: '巴菲特 · 护城河与财务',
      score: clamp(3 + drawdownStability * 1.5 + (distHigh > -0.15 ? 0.5 : 0) - (volat > 0.5 ? 1 : 0), 1, 5),
      view: drawdownStability > 0.6 ? '波动率低、回撤受控,价格行为符合有护城河公司的特征。'
        : '价格波动剧烈,若无坚实护城河,高波动会摧毁长期复利,需查 ROE/毛利率 5 年趋势。',
      ask: '10年后护城河还在吗?什么能摧毁它?',
    },
    {
      key: 'munger', name: '芒格 · 逆向思考',
      score: clamp(3 - (distHigh > -0.03 ? 0.8 : 0) - (mom60 > 0.4 ? 1 : 0) + (distLow < 0.15 && trendSlope > 0 ? 0.8 : 0), 1, 5),
      view: distHigh > -0.03 ? '接近52周新高、情绪偏热——"别人贪婪时"需列出所有死法再决定。'
        : distLow < 0.1 ? '接近52周低点,若基本面未坏,可能是逆向机会;若在坏,是价值陷阱。'
          : '估值情绪中性,重点排查:聪明人为什么不买甚至做空?',
      ask: '列出所有死法:路径、概率、影响。',
    },
    {
      key: 'lilu', name: '李录 · 长期趋势',
      score: clamp(3 + trendSlope * 1.2 + maAlign - 0.5, 1, 5),
      view: trendSlope > 0.3 ? '处于强劲长期上升通道,顺应时代级趋势的概率较高。'
        : trendSlope < -0.3 ? '长期趋势向下,需判断是周期低谷还是被时代抛弃。'
          : '趋势不明,需回答:20年后它是"标准石油"还是"3Com"?',
      ask: '它在文明级趋势的价值链中占据什么位置?',
    },
  ];
  const avg = masters.reduce((s, m) => s + m.score, 0) / 4;

  // —— 第五席:外部形势顾问(程序化代理:市场态与波动 regime)——
  const marketStress = clamp(volat / 0.45 + (mom60 < -0.15 ? 0.4 : 0), 0, 1.6);
  const advisor = marketStress > 1.1
    ? { light: '🔴', label: '红灯', note: '波动率极端+趋势恶化,系统性风险特征明显;个股逻辑再好也需延后。宏观/政策面请人工复核。' }
    : marketStress > 0.65
      ? { light: '🟡', label: '黄灯', note: '存在显著逆风(高波动或中期下跌),建议仓位减半、建仓周期拉长。' }
      : { light: '🟢', label: '绿灯', note: '量价环境中性偏顺风,四大师结论维持。宏观/地缘/政策细节建议接入 LLM 模式联网复核。' };

  // —— 技术面择时(-2 ~ +2)——
  let tech = 0;
  const { dif, dea } = c.macd;
  if (maAlign >= 0.75) tech += 0.7; else if (maAlign <= 0.25) tech -= 0.7;
  if (dif[i] > dea[i] && dif[i] > 0) tech += 0.5; else if (dif[i] < dea[i] && dif[i] < 0) tech -= 0.5;
  const r = c.rsi14[i];
  if (r < 30) tech += 0.5; else if (r > 75) tech -= 0.6;
  if (factorSeries('donch_break', bars)[i] === 1) tech += 0.3;
  tech = clamp(tech, -2, 2);

  const support = Math.min(...bars.slice(-20).map(b => b.l));
  const resist = Math.max(...bars.slice(-20).map(b => b.h));

  // —— 综合决断(价值为主,技术为辅)——
  let verdict, verdictCls;
  if (advisor.label === '红灯' || avg < 3.0) { verdict = '回避'; verdictCls = 'b-red'; }
  else if (avg >= 3.5 && advisor.label === '绿灯') { verdict = tech >= 0.5 ? '买入' : '分批建仓'; verdictCls = 'b-green'; }
  else { verdict = tech >= 1 ? '分批建仓(半仓上限)' : '观望'; verdictCls = 'b-orange'; }

  // —— 12个月三情景目标价(纯技术代理:趋势外推±波动)——
  const drift = clamp(trendSlope, -0.5, 0.6);
  const scen = {
    bull: px * (1 + Math.max(drift, 0.05) + volat * 0.8),
    base: px * (1 + drift * 0.5),
    bear: px * (1 - Math.max(volat * 0.9, 0.12)),
  };

  const plans = [
    { name: '激进', pos: advisor.label === '绿灯' ? '≤50%' : '≤25%', entry: `${(support * 1.01).toFixed(2)} ~ ${(px * 1.01).toFixed(2)}`, note: '突破即入,严格止损' },
    { name: '稳健', pos: advisor.label === '绿灯' ? '≤30%' : '≤15%', entry: `${(support * 0.99).toFixed(2)} ~ ${((support + px) / 2).toFixed(2)}`, note: '回调分批 3-3-4' },
    { name: '保守', pos: '≤15%', entry: `${(support * 0.95).toFixed(2)} 附近`, note: '仅在支撑确认后介入' },
  ];

  return {
    mode: 'builtin', symbol, name, price: px,
    masters: masters.map(m => ({ ...m, stars: stars(m.score) })),
    avg, advisor, tech, support, resist, verdict, verdictCls, scen, plans,
    falsify: [
      `收盘跌破 ${(support * 0.97).toFixed(2)}(20日支撑-3%)`,
      '波动率骤升 50% 以上且伴随放量下跌',
      '四大师任一维度评分因基本面恶化跌破 ★★',
    ],
    disclaimer: '内置模式基于量价代理指标,非基本面研究;评分仅供参考,不构成投资建议。深度研究请切换 LLM 模式联网分析。',
  };
}

/** LLM 模式:调用 Claude / DeepSeek 输出完整四大师投研报告(Markdown) */
export async function analyzeLLM(symbol, name, bars, quote) {
  const s = getSettings();
  const brief = summarizeBars(bars, quote);
  const prompt = `你是"AI Berkshire 投研决策体系"。对 ${name}(${symbol}) 执行完整流程,输出中文 Markdown 报告:

1. **四大师对抗分析**(各 ★1-5,必须呈现真实冲突,不许和稀泥):
   - 段永平·生意本质:这是不是"对的生意"?一句话说清好在哪
   - 巴菲特·护城河与财务:五类护城河验证,10年后还在吗
   - 芒格·逆向思考:列出所有死法(路径/概率/影响),聪明人为什么不买
   - 李录·长期趋势:20年后它是"标准石油"还是"3Com"
2. **外部形势顾问对抗审核**(第五席):宏观/流动性/产业政策/地缘,输出 🟢🟡🔴 三色判定,黄灯仓位减半、红灯否决
3. **技术面择时**(基于下方量价数据):评分 -2~+2,支撑/阻力,分批节奏
4. **综合决断**:只能是 买入/分批建仓/观望/回避/卖出;12个月乐观/中性/悲观目标价及触发条件
5. **分层操作建议**(激进/稳健/保守,各带仓位上限)
6. **镜子测试**(5句话)与**证伪条件**(没有证伪条件不许出报告)

量价数据:
${brief}

事实与观点分开;结尾附免责声明。`;

  if (s.aiProvider === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'x-api-key': s.aiApiKey,
        'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model: s.aiModel || 'claude-sonnet-4-5', max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return { mode: 'llm', markdown: j.content?.[0]?.text || '' };
  }
  if (s.aiProvider === 'deepseek') {
    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.aiApiKey },
      body: JSON.stringify({ model: s.aiModel || 'deepseek-chat', messages: [{ role: 'user', content: prompt }] }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message || 'DeepSeek 错误');
    return { mode: 'llm', markdown: j.choices?.[0]?.message?.content || '' };
  }
  throw new Error('未配置 LLM(设置→AI 引擎)');
}

function summarizeBars(bars, quote) {
  const i = bars.length - 1;
  const c = ctx(bars);
  const px = quote?.price || bars[i].c;
  const pct = (n) => i >= n ? ((bars[i].c / bars[i - n].c - 1) * 100).toFixed(1) + '%' : 'N/A';
  return [
    `现价 ${px}  日期 ${bars[i].t}  样本 ${bars.length} 根日K`,
    `涨跌: 5日 ${pct(5)} / 20日 ${pct(20)} / 60日 ${pct(60)} / 250日 ${pct(250)}`,
    `MA5 ${c.ma5[i]?.toFixed(2)} MA20 ${c.ma20[i]?.toFixed(2)} MA60 ${c.ma60[i]?.toFixed(2)}`,
    `RSI14 ${c.rsi14[i]?.toFixed(1)}  MACD-DIF ${c.macd.dif[i]?.toFixed(3)} DEA ${c.macd.dea[i]?.toFixed(3)}`,
    `年化波动 ${((c.sd20[i] / px) * Math.sqrt(250) * 100).toFixed(1)}%`,
    `20日支撑 ${Math.min(...bars.slice(-20).map(b => b.l)).toFixed(2)} 阻力 ${Math.max(...bars.slice(-20).map(b => b.h)).toFixed(2)}`,
  ].join('\n');
}
