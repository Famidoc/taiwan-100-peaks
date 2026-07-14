const CACHE_NAME = 'taiwan-100-peaks-v1';
const ASSETS = [
  './',
  './index.html',
  './favicon.svg',
  './manifest.json'
];

// 安裝階段：快取基本靜態資源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// 啟用階段：清理舊快取
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 攔截請求
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // 為了避免快取導致 peaks.json 與 images 更新失敗，我們只對基本骨架 (index.html, CSS, JS) 進行快取
  // 對於 data/peaks.json 和 images/ 圖片，我們優先請求網絡，失敗時再嘗試本機快取 (Network First)
  if (url.pathname.includes('/data/') || url.pathname.includes('/images/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.status === 200) {
            const resClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, resClone);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request);
        })
    );
  } else {
    // 對於基本骨架 (html, css, js)，我們採用 Cache First (快取優先) 確保極速載入，並在背景非同步更新快取
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          fetch(event.request).then((networkResponse) => {
            if (networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, networkResponse);
              });
            }
          }).catch(() => {
            // 忽略網路錯誤
          });
          return cachedResponse;
        }
        return fetch(event.request);
      })
    );
  }
});
