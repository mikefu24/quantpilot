// QuantPilot Service Worker —— 离线优先缓存
const CACHE = 'quantpilot-v3';
// v3: Qlib 研究后端集成
const CORE = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'src/main.js', 'src/api.js',
  'src/core/store.js',
  'src/data/feeds.js', 'src/data/qlib.js',
  'src/engine/indicators.js', 'src/engine/factors.js', 'src/engine/strategies.js', 'src/engine/backtest.js', 'src/engine/ml.js',
  'src/trade/paper.js', 'src/trade/brokers.js', 'src/trade/notify.js',
  'src/ai/berkshire.js',
  'src/ui/kchart.js', 'src/ui/components.js',
  'src/pages/dashboard.js', 'src/pages/market.js', 'src/pages/strategy.js', 'src/pages/ai.js', 'src/pages/trade.js', 'src/pages/settings.js',
  'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // 行情等外部请求不缓存,由应用层兜底
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const clone = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
      return res;
    }).catch(() => caches.match('index.html')))
  );
});
