/* 851 复习库 Service Worker —— 首次打开后即可离线 */
const CACHE = 'g851-v2';
const ASSETS = [
 "./",
 "index.html",
 "按年份.html",
 "搜索.html",
 "manifest.webmanifest",
 "icon.svg",
 "851-应用光学-简答与画图-p49-56.html",
 "851-真题-2025-2026.html",
 "851-简答题-按章节.html",
 "851-计算题-应用光学-解析法.html",
 "851-计算题-早年真题-2009-2015.html",
 "851-计算题-早年真题-补遗1.html",
 "851-计算题-早年真题-补遗2.html",
 "851-计算题-第10章-光学仪器.html",
 "851-计算题-第1章-电磁理论.html",
 "851-计算题-第2章-干涉.html",
 "851-计算题-第3章-衍射.html",
 "851-计算题-第4章-光在各向异性介质中的传播特性.html",
 "851-计算题-第5章-感应双折射.html",
 "851-计算题-第7章-几何光学.html",
 "851-计算题-第8章-理想光学系统.html",
 "851-计算题-第9章-光路计算.html",
 "figs/fig-2009-10-a.png",
 "figs/fig-2009-10-b.png",
 "figs/fig-2016-kdp-long.png",
 "figs/fig-2016-plate45.png",
 "figs/fig-2017-axis-virtual.png",
 "figs/fig-2017-kdp-vhalf.png",
 "figs/fig-2017-nodes.png",
 "figs/fig-2017-prism-xyz.png",
 "figs/fig-2017-wollaston.png",
 "figs/fig-2018-abc.png",
 "figs/fig-2018-crossprism.png",
 "figs/fig-2018-prism-chain.png",
 "figs/fig-2018-quartz-plate.png",
 "figs/fig-2019-kdp-mod.png",
 "figs/fig-2019-meniscus-ab.png",
 "figs/fig-2019-planes.png",
 "figs/fig-2019-virtual-ab.png",
 "figs/fig-2020-kdp.png",
 "figs/fig-2020-prism-chain.png",
 "figs/fig-2020-virtual-ab.png",
 "figs/fig-2021-aberr.png",
 "figs/fig-2021-calcite-prism.png",
 "figs/fig-2021-cardinal.png",
 "figs/fig-2021-lens-water.png",
 "figs/fig-2021-neg-ab.png",
 "figs/fig-2022-kdp-ab.png",
 "figs/fig-2022-neg-ab.png",
 "figs/fig-2022-prism.png",
 "figs/fig-2023-aimg.png",
 "figs/fig-2023-crystal-plate.png",
 "figs/fig-2023-distortion.png",
 "figs/fig-2023-grating-qr.png",
 "figs/fig-2023-kdp.png",
 "figs/fig-2023-prism.png",
 "figs/fig-2023-reflect-ellipse.png",
 "figs/fig-2023-schmidt.png",
 "figs/fig-2024-calcite-plates.png",
 "figs/fig-2024-linbo3-axes.png",
 "figs/fig-2024-neg-ab.png",
 "figs/fig-2024-prism.png",
 "figs/fig-2025-t1-kdp.png",
 "figs/fig-2025-t2-prism.png",
 "figs/fig-2025-t2-young.png",
 "figs/fig-2025-t3-nodes.png",
 "figs/fig-2025-t3-prisms.png",
 "figs/fig-2025-t3-virtual.png",
 "figs/fig-2025-t4-sys.png",
 "figs/fig-851-p63-pentaprism.png",
 "figs/fig-851-p64-pentaprism.png",
 "figs/fig-851-p65-pentaprism100.png",
 "figs/fig-851-p66-lens-mirror-prism.png",
 "figs/fig-851-p69-doublet.png"
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(resp => {
      const copy = resp.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return resp;
    }).catch(() => caches.match('index.html')))
  );
});
