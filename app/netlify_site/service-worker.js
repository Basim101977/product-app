importScripts("/offline-package-manifest.js?v=v2026.11.18-interaction-167");
importScripts("/notification-worker.js?v=v2026.11.18-interaction-167");
/*
 * Application-shell cache only. Student records, permissions, authentication,
 * and attendance marks are excluded from HTTP caches. Prepared account data
 * and the ordered offline outbox use IndexedDB with server validation on sync.
 */
const CACHE_VERSION = "student-attendance-shell-v2026.11.18-interaction-167";
const SHELL_CACHE = CACHE_VERSION;
const RUNTIME_CACHE = "student-attendance-runtime-v2026.11.18-interaction-167";
const APP_SHELL = ["/name-attendance.js?v=v2026.11.18-interaction-167","/sync-reminder.js?v=v2026.11.18-interaction-167", "/sync-reminder.css?v=v2026.11.18-interaction-167","/department-tools.js?v=v2026.11.18-interaction-167","/department-tools.css?v=v2026.11.18-interaction-167","/consolidation-model.js?v=v2026.11.18-interaction-167", "/consolidation.js?v=v2026.11.18-interaction-167", "/consolidation.css?v=v2026.11.18-interaction-167","/roster-name-rail.js?v=v2026.11.18-interaction-167", "/roster-name-rail.css?v=v2026.11.18-interaction-167", "/subject-tools.js?v=v2026.11.18-interaction-167", "/subject-tools.css?v=v2026.11.18-interaction-167",
  "/modal-dismiss.js?v=20261006-141",
  "/roster-filters.js?v=v2026.11.18-interaction-167", "/roster-filters.css?v=v2026.11.18-interaction-167",
  "/lecture-column-actions.js?v=20261006-141",
  "/notifications.js?v=v2026.11.18-interaction-167", "/notification-worker.js?v=v2026.11.18-interaction-167",
  "/attendance-tones.js?v=20261004-121",
  "/private-scope-roster.js?v=v2026.11.18-interaction-167",
  "/private-share.css?v=v2026.11.18-interaction-167",
  "/private-share-model.js?v=v2026.11.18-interaction-167",
  "/private-share.js?v=v2026.11.18-interaction-167",
  "/device-sync-model.js?v=v2026.11.18-interaction-167",
  "/device-workspace.css?v=20260928-study-period-95",
  "/device-workspace-store.js?v=20260927-local-first-1",
  "/device-workspace.js?v=v2026.11.18-interaction-167",
  "/live-attendance.js?v=v2026.11.18-interaction-167",
  "/qr-decoder.js?v=v2026.09.25-daily-actions-35", "/qr-decoder-worker.js", "/vendor/jsQR-1.4.0.min.js",
  "/support-chat.js?v=v2026.11.18-interaction-167", "/support-chat.css?v=v2026.11.18-interaction-167",
  "/help.html", "/help.css", "/help.js", "/help-catalog.js",
  "/guide-lessons.js?v=v2026.09.25-daily-actions-35",
  "/onboarding.js?v=v2026.11.18-interaction-167",
  "/onboarding.css?v=v2026.09.25-daily-actions-35",
  "/",
  "/index.html",
  "/runtime-config.js",
  "/fonts.css?v=20260923-ui2",
  "/assets/fonts/Tajawal-Light.ttf",
  "/assets/fonts/Tajawal-Regular.ttf",
  "/assets/fonts/Tajawal-Medium.ttf",
  "/assets/fonts/Tajawal-Bold.ttf",
  "/assets/fonts/Tajawal-ExtraBold.ttf",
  "/assets/fonts/Tajawal-Black.ttf",
  "/personal-ui.js?v=v2026.11.18-interaction-167",
  "/personal-ui.css?v=v2026.11.18-interaction-167",
  "/name-qr.js?v=v2026.09.25-daily-actions-35",
  "/guide.html",
  "/vendor/qrcode-generator-1.4.4.js",
  "/spreadsheet-import.js?v=20260927-import-status-78",
  "/spreadsheet-worker.js?v=20260923-stability1",
  "/offline-store.js?v=v2026.11.18-interaction-167",
  "/offline-attendance.js?v=v2026.11.18-interaction-167",
  "/settings-ui.js?v=v2026.11.18-interaction-167",
  "/beginner-ui.js?v=v2026.11.18-interaction-167",
  "/beginner-ui.css?v=v2026.11.18-interaction-167",
  "/simple-ui.js?v=20261124-simple-2", "/simple-ui.css?v=20261124-simple-2",
  "/record-window.css?v=v2026.11.18-interaction-167",
  "/card-readers.js?v=20260915-settings1",
  "/settings-ui.css?v=20260923-ui2",
  "/manifest.webmanifest",
  "/assets/hathir-white-brand-768-20260914.webp",
  "/assets/hathir-check-large-icon-192-20260929.png",
  "/assets/hathir-check-large-icon-512-20260929.png",
  "/assets/hathir-check-large-maskable-512-20260929.png",
  "/assets/hathir-check-large-apple-180-20260929.png",
  "/assets/hathir-check-large-favicon-32-20260929.png",
  "/assets/hathir-check-large-favicon-64-20260929.png"
];
APP_SHELL.push(...HATHIR_OFFLINE_PACKAGE.assets);
const CACHEABLE_CDN_ORIGINS = new Set([
  "https://www.gstatic.com",
  "https://cdn.jsdelivr.net"
]);

function cacheableResponse(response) {
  return response && (response.ok || response.type === "opaque");
}

async function cacheFirst(request) {
  const cached = (await (await caches.open(SHELL_CACHE)).match(request)) || (await (await caches.open(RUNTIME_CACHE)).match(request));
  if (cached) return cached;
  // Reuse exact third-party library/model resources prepared by the original
  // app, but never recover HTML, runtime config or same-origin code from an
  // obsolete release. Keep old caches while old tabs still exist.
  const url=new URL(request.url);
  if(CACHEABLE_CDN_ORIGINS.has(url.origin)){
    const prepared=await caches.match(request);
    if(prepared)return prepared;
  }
  const response = await fetch(request);
  if (cacheableResponse(response)) {
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

async function networkFirstApplicationShell(request) {
  const current=await caches.open(SHELL_CACHE);
  const installed = (await current.match("/index.html")) || (await current.match("/"));
  // This cache is installed atomically with the versioned scripts. A returning
  // teacher must not wait for the network merely to open an installed shell.
  // registerApplicationCache() still checks for a new worker on every opening;
  // its install caches the next complete shell before activation. Never treat
  // an unversioned preparation/legacy cache as the current installed release.
  if(installed)return installed;
  const cached = (await current.match("/index.html")) || (await current.match("/"));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1800);
  try {
    // First opening, or an evicted shell: fetch fresh HTML, retaining the
    // bounded legacy/offline fallback only when this version has no shell.
    const response = await fetch(request, { cache: "no-cache", signal: controller.signal });
    if (cacheableResponse(response)) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put("/index.html", response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    return cached || Response.error();
  } finally {
    clearTimeout(timeout);
  }
}

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil((async()=>{
    const runtime=await caches.open(RUNTIME_CACHE);
    for(const name of await caches.keys()){
      if(!/^student-attendance-(shell|runtime)-/.test(name)||[SHELL_CACHE,RUNTIME_CACHE].includes(name))continue;
      const old=await caches.open(name);
      // Keep downloaded public scanner libraries, discard obsolete app code.
      for(const request of await old.keys())if(CACHEABLE_CDN_ORIGINS.has(new URL(request.url).origin)){
        const response=await old.match(request);
        if(response&&!await runtime.match(request))await runtime.put(request,response);
      }
      await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
  if(['OFFLINE_PACKAGE_STATUS','OFFLINE_PACKAGE_REPAIR'].includes(event.data?.type)&&event.ports?.[0])event.waitUntil((async()=>{
    const cache=await caches.open(SHELL_CACHE),missing=[];
    for(const asset of APP_SHELL)if(!await cache.match(asset)){
      if(event.data.type==='OFFLINE_PACKAGE_REPAIR')try{await cache.add(asset);}catch{}
      if(!await cache.match(asset))missing.push(asset);
    }
    event.ports[0].postMessage({version:HATHIR_OFFLINE_PACKAGE.version,total:APP_SHELL.length,missing,ready:missing.length===0});
  })());
});

async function offlineVideo(request){
  const cache=await caches.open(SHELL_CACHE),response=await cache.match(request.url);
  if(!response)return fetch(request);
  const range=request.headers.get('Range');if(!range)return response;
  const bytes=await response.arrayBuffer(),size=bytes.byteLength,m=/^bytes=(\d*)-(\d*)$/.exec(range);
  let start=m&&m[1]?Number(m[1]):0,end=m&&m[2]?Number(m[2]):size-1;
  if(m&&!m[1]&&m[2]){start=Math.max(0,size-Number(m[2]));end=size-1;}
  if(!m||(!m[1]&&!m[2])||start>=size||end<start)return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+size}});
  end=Math.min(end,size-1);
  return new Response(bytes.slice(start,end+1),{status:206,headers:{'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${size}`,'Content-Length':String(end-start+1)}});
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Serve byte ranges from the complete cached guide, never store a partial
  // response as if it were a complete offline video.
  if (url.origin === self.location.origin && /^\/assets\/help-v\d+\/.*\.mp4$/.test(url.pathname)) {event.respondWith(offlineVideo(request));return;}
  // Firebase API calls contain live identities, roles, and attendance data.
  // Never place them in Cache Storage.
  if (url.hostname.endsWith("googleapis.com") || url.hostname.endsWith("firebaseio.com")) return;

  if (request.mode === "navigate" && url.origin === self.location.origin && ["/", "/index.html"].includes(url.pathname)) {
    event.respondWith(networkFirstApplicationShell(request));
    return;
  }

  if (url.origin === self.location.origin || CACHEABLE_CDN_ORIGINS.has(url.origin)) {
    event.respondWith(cacheFirst(request));
  }
});



