// ================= EKT CHATTER — Service Worker (v2) =================
// কোড (app.js/style.css/index.html) বদলালে নিচের ভার্সন নম্বর বাড়িয়ে দিন (v3, v4...)
const CACHE_NAME = "ekt-chatter-shell-v2";
const CORE_ASSETS = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// যেগুলো কখনো ক্যাশ হবে না (সরাসরি নেটওয়ার্কে যাবে)
function shouldBypass(req, url) {
  if (req.method !== "GET") return true;
  if (url.origin !== self.location.origin) return true;            // Cloudinary, TURN ইত্যাদি
  if (url.pathname.startsWith("/socket.io/")) return true;         // রিয়েল-টাইম সকেট
  if (url.pathname.startsWith("/api/")) return true;               // /api/ice-servers (TURN ক্রেডেনশিয়াল)
  if (url.pathname.startsWith("/admin-bypass")) return true;
  if (url.pathname === "/health" || url.pathname === "/healthz") return true;
  if (/\.(mpeg|mp3|mp4|webm|ogg|wav)$/i.test(url.pathname)) return true; // রিংটোন/মিডিয়া (range request)
  if (req.headers.has("range")) return true;
  return false;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (shouldBypass(req, url)) return;

  // নেটওয়ার্ক আগে → না পেলে ক্যাশ। এতে নতুন deploy সাথে সাথে পাওয়া যায়,
  // আর নেট না থাকলে অন্তত অ্যাপ শেল খোলে।
  event.respondWith(
    fetch(req)
      .then((res) => {
        // শুধু সফল (200) রেসপন্স ক্যাশ হবে — maintenance (503) বা আংশিক (206) নয়
        if (res && res.status === 200 && res.type === "basic") {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === "navigate") {
          const shell = await caches.match("/index.html") || await caches.match("/");
          if (shell) return shell;
        }
        return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      })
  );
});
