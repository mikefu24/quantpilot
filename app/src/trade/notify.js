// ============ 实时通知:飞书 / 企业微信 / Server酱(微信) / 邮件(via webhook) ============
// webhook 用 no-cors fire-and-forget POST,浏览器与桌面版均可用。
import { getSettings } from '../core/store.js';

async function post(url, body) {
  try {
    await fetch(url, {
      method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return true;
  } catch { return false; }
}

/** 发送通知到所有已配置渠道 */
export async function notify(title, text = '') {
  const s = getSettings();
  const jobs = [];
  if (s.feishuWebhook)
    jobs.push(post(s.feishuWebhook, { msg_type: 'text', content: { text: `${title}\n${text}` } }));
  if (s.wecomWebhook)
    jobs.push(post(s.wecomWebhook, { msgtype: 'text', text: { content: `${title}\n${text}` } }));
  if (s.serverChanKey)
    jobs.push(post(`https://sctapi.ftqq.com/${s.serverChanKey}.send`, { title, desp: text }));
  if (s.emailWebhook) // 通用邮件网关(如自建 n8n/Make/Cloudflare Worker 转 SMTP)
    jobs.push(post(s.emailWebhook, { to: s.emailTo || '', subject: title, body: text }));
  // 浏览器本地通知
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted')
    try { new Notification(title, { body: text }); } catch { }
  await Promise.allSettled(jobs);
  return jobs.length;
}

export async function requestLocalNotify() {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default')
    try { await Notification.requestPermission(); } catch { }
}
