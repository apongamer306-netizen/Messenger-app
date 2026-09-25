// ================= EKT CHATTER — Service Worker =================
// এটা মূলত অ্যাপটাকে "ইনস্টলযোগ্য" (PWA / APK-এ কনভার্ট করার যোগ্য) বানানোর জন্য
// দরকার — Android/Chrome একটা রেজিস্টার করা service worker ছাড়া অ্যাপকে হোম
// স্ক্রিনে ইনস্টল করতে দেয় না। পাশাপাশি এটা অ্যাপ-শেল (HTML/CSS/JS/আইকন)
// ক্যাশ করে রাখে, যাতে নেট একটু স্লো বা মাঝে কেটে গেলেও অ্যাপ সাদা স্ক্রিন না
// দেখিয়ে অন্তত খুলতে পারে। চ্যাট/সকেট ডেটা এখানে ক্যাশ করা হয় না — সেটা
// রিয়েল-টাইম, তাই সবসময় নেটওয়ার্ক থেকেই আসবে।

const CACHE_NAME = "ekt-chatter-shell-v1";
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
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .catch(() => {})
  );
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

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // GET ছাড়া অন্য কিছু (POST/PUT ইত্যাদি) আর socket.io / এক্সটার্নাল রিকোয়েস্ট
  // কখনোই ক্যাশ থেকে সার্ভ করা হয় না — সরাসরি নেটওয়ার্কে যাবে
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/socket.io/")) {
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => cached);
      // ক্যাশে থাকলে সেটা সাথে সাথে দেখানো হয় (দ্রুত লোড), পাশাপাশি ব্যাকগ্রাউন্ডে
      // নেটওয়ার্ক থেকে আপডেট করে ক্যাশ রিফ্রেশ করা হয়
      return cached || networkFetch;
    })
  );
});
