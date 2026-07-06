// ============ 全局状态 / 设置 / 事件总线 ============
const LS_SETTINGS = 'qp.settings.v1';

const DEFAULTS = {
  theme: 'dark', // dark | light | green | sepia
  liveTrading: false,
  activeBroker: 'qmt',
  qmtBridgeUrl: '', qmtBridgeToken: '',
  thsBridgeUrl: '',
  pmPrivateKey: '',
  feishuWebhook: '', wecomWebhook: '', serverChanKey: '',
  emailWebhook: '', emailTo: '',
  aiProvider: 'builtin', // builtin | anthropic | deepseek
  aiApiKey: '', aiModel: '',
  qlibBridgeUrl: '', // Qlib 研究后端(bridge/qlib_bridge.py),如 http://127.0.0.1:9529
  watchlist: null, // null = 用默认
};

let settings = null;
export function getSettings() {
  if (!settings) {
    try { settings = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(LS_SETTINGS)) || {}) }; }
    catch { settings = { ...DEFAULTS }; }
  }
  return settings;
}
export function saveSettings(patch) {
  settings = { ...getSettings(), ...patch };
  try { localStorage.setItem(LS_SETTINGS, JSON.stringify(settings)); } catch { }
  emit('settings', settings);
  return settings;
}

// —— 主题 ——
export const THEMES = [
  { id: 'dark', name: '深邃黑', bg: '#0A0A0F', fg: '#F5F5F7' },
  { id: 'light', name: '浅色', bg: '#F2F3F7', fg: '#1C1C1E' },
  { id: 'green', name: '护眼绿', bg: '#CCE8CF', fg: '#1F3325' },
  { id: 'sepia', name: '暖纸', bg: '#F3EAD7', fg: '#3B3226' },
];
export function applyTheme(id) {
  const t = THEMES.find(x => x.id === id) || THEMES[0];
  document.documentElement.dataset.theme = t.id;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = t.bg;
  emit('theme', t.id);
}
export function setTheme(id) { saveSettings({ theme: id }); applyTheme(id); }
export function cycleTheme() {
  const cur = getSettings().theme || 'dark';
  const i = THEMES.findIndex(t => t.id === cur);
  const next = THEMES[(i + 1) % THEMES.length].id;
  setTheme(next);
  return THEMES.find(t => t.id === next);
}

// —— 轻量事件总线 ——
const listeners = {};
export function on(evt, fn) { (listeners[evt] ||= []).push(fn); return () => off(evt, fn); }
export function off(evt, fn) { listeners[evt] = (listeners[evt] || []).filter(f => f !== fn); }
export function emit(evt, data) { (listeners[evt] || []).forEach(f => { try { f(data); } catch (e) { console.error(e); } }); }

// —— 运行日志(策略机器人) ——
const logs = [];
export function log(msg, cls = '') {
  const entry = { ts: new Date().toLocaleTimeString('zh-CN', { hour12: false }), msg, cls };
  logs.unshift(entry);
  if (logs.length > 200) logs.length = 200;
  emit('log', entry);
}
export function getLogs() { return logs; }

// —— 格式化工具 ——
export const fmt = {
  num: (x, d = 2) => x == null || isNaN(x) ? '--' : (+x).toFixed(d),
  pct: (x, d = 2) => x == null || isNaN(x) ? '--' : (x > 0 ? '+' : '') + (+x).toFixed(d) + '%',
  cny: (x) => x == null || isNaN(x) ? '--' : '¥' + (+x).toLocaleString('zh-CN', { maximumFractionDigits: 0 }),
  big: (x) => {
    if (x == null || isNaN(x)) return '--';
    if (Math.abs(x) >= 1e8) return (x / 1e8).toFixed(2) + '亿';
    if (Math.abs(x) >= 1e4) return (x / 1e4).toFixed(1) + '万';
    return String(Math.round(x));
  },
  cls: (x) => x > 0 ? 'up' : x < 0 ? 'down' : 'flat',
};
