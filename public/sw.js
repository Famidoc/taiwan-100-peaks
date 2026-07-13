self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // 直接請求網絡，不做本機快取以避免快取造成相本更新滯後，但此空 fetch 攔截已足夠觸發 PWA 安裝
  event.respondWith(fetch(event.request));
});
