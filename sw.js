// OneSignal 웹 푸시가 쓰는 서비스 워커 로직을 이 파일 안에 합칩니다.
// (별도 파일로 각자 등록하면 같은 scope("/")를 두고 서로 충돌해서
//  알림 구독이 조용히 실패하는 경우가 있어요.)
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

const CACHE_NAME = "jeju-ev-shell-v2";
const SHELL_ASSETS = ["./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 앱 셸(껍데기 파일)만 캐시-우선으로 서빙합니다.
// 충전소 실시간 API, 지도 타일, 검색 요청은 캐시 대상이 아니라서 항상 네트워크로 나갑니다.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const isShellRequest = url.origin === self.location.origin;
  if (!isShellRequest) return; // 외부 요청(API/타일)은 손대지 않음

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, res.clone()));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
