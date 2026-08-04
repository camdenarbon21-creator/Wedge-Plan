// Bump CACHE on every deploy or phones will serve the old app forever.
const CACHE = "wedge-v1";
const ASSETS = ["./", "./index.html", "./manifest.json", "./app.js", "./styles.css"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  // Never cache Supabase — it must hit the network or fail to the local queue.
  if (url.hostname.endsWith("supabase.co")) return;

  // Cache-first for app shell: the range has bad reception and the app must open.
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok && e.request.method === "GET") {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match("./index.html")))
  );
});
