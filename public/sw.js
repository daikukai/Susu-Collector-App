const CACHE_NAME = "susu-collector-v3";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/logo.png",
  "/robots.txt",
];

// Install Event: Cache Core Static Shell gracefully
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log("[ServiceWorker] Pre-caching app shell");
      for (const asset of STATIC_ASSETS) {
        try {
          await cache.add(asset);
        } catch (err) {
          console.warn("[ServiceWorker] Could not pre-cache asset:", asset);
        }
      }
    }).then(() => self.skipWaiting())
  );
});

// Activate Event: Clean Old Caches & Take Control Immediately
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log("[ServiceWorker] Removing old cache:", key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event: Network-First for API, Cache-First / Stale-While-Revalidate for Assets
self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);

  // Ignore non-GET requests
  if (event.request.method !== "GET") return;

  // Network-First strategy for Supabase API requests
  if (requestUrl.hostname.includes("supabase.co")) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({ offline: true }), {
          headers: { "Content-Type": "application/json" },
        });
      })
    );
    return;
  }

  // Cache-First / Stale-While-Revalidate strategy for static resources
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        }
        return networkResponse;
      }).catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
