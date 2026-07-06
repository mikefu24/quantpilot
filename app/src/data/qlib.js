// ============ Qlib 研究后端客户端(bridge/qlib_bridge.py) ============
import { getSettings } from '../core/store.js';

function base() {
  const u = (getSettings().qlibBridgeUrl || '').trim();
  return u ? u.replace(/\/$/, '') : null;
}
export function qlibConfigured() { return !!base(); }

async function call(path, opts = {}) {
  const b = base();
  if (!b) throw new Error('未配置 Qlib 后端(设置→AI 引擎)');
  const r = await fetch(b + path, { signal: AbortSignal.timeout(opts.timeout || 8000), ...opts });
  return r.json();
}

export const qlibHealth = () => call('/health');
export const qlibSignal = (symbol) => call('/signal?symbol=' + encodeURIComponent(symbol));
export const qlibTopk = (k = 10) => call('/topk?k=' + k);
export const qlibTrain = (cfg = {}) => call('/train', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(cfg), timeout: 600000, // 训练可能数分钟
});

/** SH600519 -> sh600519(转回 app 代码格式) */
export function fromQlibCode(code) {
  return /^(SH|SZ)\d{6}$/.test(code) ? code.toLowerCase() : code;
}
