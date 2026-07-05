// ============ QuantPilot 入口:路由 + Tab 栏 ============
import { renderDashboard } from './pages/dashboard.js';
import { renderMarket } from './pages/market.js';
import { renderStrategy } from './pages/strategy.js';
import { renderAI } from './pages/ai.js';
import { renderTrade } from './pages/trade.js';
import { renderSettings } from './pages/settings.js';
import { el } from './ui/components.js';
import { log } from './core/store.js';
import './api.js'; // 挂载 window.qp 命名空间 API

const TABS = [
  { id: 'home', icon: '◉', label: '首页', render: renderDashboard },
  { id: 'market', icon: '📈', label: '行情', render: renderMarket },
  { id: 'strategy', icon: '🧪', label: '策略', render: renderStrategy },
  { id: 'ai', icon: '🧠', label: 'AI', render: renderAI },
  { id: 'trade', icon: '💼', label: '交易', render: renderTrade },
  { id: 'settings', icon: '⚙️', label: '设置', render: renderSettings },
];

const app = document.getElementById('app');
let cleanup = null;

const tabbar = el(`<div class="tabbar">${TABS.map(t =>
  `<button data-tab="${t.id}"><span class="ti">${t.icon}</span>${t.label}</button>`).join('')}</div>`);
document.body.appendChild(tabbar);

async function nav(id, params = {}) {
  const tab = TABS.find(t => t.id === id) || TABS[0];
  tabbar.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab.id));
  if (typeof cleanup === 'function') { try { cleanup(); } catch { } }
  cleanup = null;
  app.innerHTML = '';
  const page = document.createElement('div');
  app.appendChild(page);
  cleanup = await tab.render(page, nav, params);
  history.replaceState(null, '', '#' + tab.id);
}

tabbar.addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (b) nav(b.dataset.tab);
});

// 启动
const initial = (location.hash || '#home').slice(1);
log('QuantPilot 已启动 · 零依赖离线内核');
nav(TABS.some(t => t.id === initial) ? initial : 'home');
