const CACHE = 'g851-inline-cd5c616a';
const CORE = [
 "./",
 "index.html",
 "按年份.html",
 "搜索.html",
 "公式墙.html",
 "错题本.html",
 "收藏.html",
 "考点.html",
 "记录.html",
 "专项卷.html",
 "qindex.js",
 "ai-common.js",
 "wrong-filter.js",
 "AI-笔记.html",
 "manifest.webmanifest",
 "icon.svg",
 "bg.png"
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(CORE.map(u => c.add(u).catch(() => {}))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  let url; try { url = new URL(e.request.url); } catch (err) { return; }
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => {
      if (hit) return hit;
      return fetch(e.request).then(res => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => {
        if (e.request.mode === 'navigate') return caches.match('index.html');
        return new Response('', { status: 504, statusText: 'offline' });
      });
    })
  );
});
