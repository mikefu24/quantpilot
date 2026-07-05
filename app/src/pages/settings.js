// 设置页
import { toast } from '../ui/components.js';
import { getSettings, saveSettings } from '../core/store.js';
import { notify, requestLocalNotify } from '../trade/notify.js';

export async function renderSettings(root) {
  const s = getSettings();
  const f = (id, label, val, ph = '', type = 'text') =>
    `<div class="field"><label>${label}</label><input id="${id}" type="${type}" value="${val || ''}" placeholder="${ph}"></div>`;

  root.innerHTML = `
  <div class="page">
    <div class="page-title">设置</div>

    <div class="card">
      <div class="card-title">交易模式</div>
      <div class="list-item" style="padding:8px 0">
        <div class="li-main"><div class="li-title">实盘交易</div><div class="li-sub">开启后订单路由至券商适配器;失败自动回落模拟盘</div></div>
        <label class="toggle"><input type="checkbox" id="st-live" ${s.liveTrading ? 'checked' : ''}><span class="tk"></span></label>
      </div>
      <div class="field"><label>实盘通道</label>
        <select id="st-broker">
          <option value="qmt" ${s.activeBroker === 'qmt' ? 'selected' : ''}>财通 QMT 桥接</option>
          <option value="ths" ${s.activeBroker === 'ths' ? 'selected' : ''}>同花顺客户端桥接</option>
          <option value="polymarket" ${s.activeBroker === 'polymarket' ? 'selected' : ''}>Polymarket CLOB</option>
        </select></div>
    </div>

    <div class="card">
      <div class="card-title">券商接入(A股实盘桥接)</div>
      <div class="muted" style="margin-bottom:10px">Mac 无官方券商 API。请在 Windows 机器部署仓库 bridge/ 目录的桥接端(QMT-miniQMT 或 easytrader+同花顺),填入其局域网地址。</div>
      ${f('st-qmt', 'QMT 桥接地址', s.qmtBridgeUrl, 'http://192.168.1.100:9527')}
      ${f('st-qmtToken', 'QMT 桥接 Token', s.qmtBridgeToken, '可选')}
      ${f('st-ths', '同花顺桥接地址', s.thsBridgeUrl, 'http://192.168.1.100:9528')}
    </div>

    <div class="card">
      <div class="card-title">AI 引擎</div>
      <div class="field"><label>深度研究 Provider</label>
        <select id="st-ai">
          <option value="builtin" ${s.aiProvider === 'builtin' ? 'selected' : ''}>仅内置引擎(离线)</option>
          <option value="anthropic" ${s.aiProvider === 'anthropic' ? 'selected' : ''}>Claude (Anthropic)</option>
          <option value="deepseek" ${s.aiProvider === 'deepseek' ? 'selected' : ''}>DeepSeek</option>
        </select></div>
      ${f('st-aikey', 'API Key', s.aiApiKey, 'sk-...', 'password')}
      ${f('st-aimodel', '模型(留空用默认)', s.aiModel, 'claude-sonnet-4-5 / deepseek-chat')}
    </div>

    <div class="card">
      <div class="card-title">实时通知</div>
      ${f('st-feishu', '飞书机器人 Webhook', s.feishuWebhook, 'https://open.feishu.cn/open-apis/bot/v2/hook/...')}
      ${f('st-wecom', '企业微信机器人 Webhook', s.wecomWebhook, 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...')}
      ${f('st-sc', 'Server酱 SendKey(微信推送)', s.serverChanKey, 'SCT...')}
      ${f('st-mailhook', '邮件网关 Webhook', s.emailWebhook, '自建 n8n/Worker 转 SMTP')}
      ${f('st-mailto', '收件邮箱', s.emailTo, 'me@example.com')}
      <button class="btn b-ghost b-sm" id="st-testnotify">发送测试通知</button>
    </div>

    <div class="card">
      <div class="card-title">Polymarket 实盘(高危,默认勿填)</div>
      ${f('st-pmkey', 'Polygon 私钥', s.pmPrivateKey, '仅桌面版建议使用', 'password')}
    </div>

    <button class="btn" id="st-save">保存全部设置</button>
    <div class="muted" style="text-align:center;margin-top:14px">
      QuantPilot v1.0 · 零依赖离线 PWA · 数据缓存于本机<br>
      ⚠️ 本软件仅供学习研究,不构成投资建议,交易风险自负
    </div>
  </div>`;

  root.querySelector('#st-save').addEventListener('click', () => {
    const v = id => root.querySelector('#' + id).value.trim();
    saveSettings({
      liveTrading: root.querySelector('#st-live').checked,
      activeBroker: v('st-broker'),
      qmtBridgeUrl: v('st-qmt'), qmtBridgeToken: v('st-qmtToken'), thsBridgeUrl: v('st-ths'),
      aiProvider: v('st-ai'), aiApiKey: v('st-aikey'), aiModel: v('st-aimodel'),
      feishuWebhook: v('st-feishu'), wecomWebhook: v('st-wecom'), serverChanKey: v('st-sc'),
      emailWebhook: v('st-mailhook'), emailTo: v('st-mailto'),
      pmPrivateKey: v('st-pmkey'),
    });
    toast('✅ 设置已保存');
  });

  root.querySelector('#st-testnotify').addEventListener('click', async () => {
    await requestLocalNotify();
    const n = await notify('🔔 QuantPilot 测试通知', '如果你收到这条消息,通知通道工作正常。');
    toast(n ? `已向 ${n} 个通道发送` : '未配置任何通知通道');
  });

  return () => { };
}
