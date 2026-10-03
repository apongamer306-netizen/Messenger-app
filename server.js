const express = require("express");
const http = require("http");
const cors = require("cors");
const fs = require("fs");
const { Server } = require("socket.io");
const path = require("path");


// ---------- Image host (Cloudinary primary CDN; imgbb legacy fallback) ----------
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "";
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || "";       // মুছতে দরকার (শুধু সার্ভারে)
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || ""; // মুছতে দরকার (শুধু সার্ভারে)
const nodeCrypto = require("crypto");
const CLOUDINARY_UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET || "";
const IMGBB_API_KEY = process.env.IMGBB_API_KEY || "";
const MAX_FALLBACK_DATA_URL = 900000;
// পুরোনো Node version-এ গ্লোবাল fetch না থাকলে node-fetch দিয়ে fallback করবে
let _fetchImpl = (typeof fetch === "function") ? fetch : null;
async function getFetch() {
  if (_fetchImpl) return _fetchImpl;
  try {
    const mod = await import("node-fetch");
    _fetchImpl = mod.default;
    return _fetchImpl;
  } catch (e) {
    console.warn("⚠️ No global fetch and node-fetch not installed — remote image upload will fail. Run: npm i node-fetch");
    return null;
  }
}

// প্রতিটি আপলোডের জন্য ইউনিক public_id — নাহলে একই নামের (story/post/photo) ফাইল একে অপরকে ওভাররাইট করে
function uniquePublicId(name, fallback) {
  const base = String(name || fallback || "file").replace(/\.[a-zA-Z0-9]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50) || "file";
  return base + "_" + Date.now().toString(36) + "_" + nodeCrypto.randomBytes(4).toString("hex");
}

// ---- Cloudinary (unsigned upload) — এটাই প্রধান, imgbb-র চেয়ে server/automation-এর জন্য অনেক বেশি নির্ভরযোগ্য ----
async function uploadToCloudinary(dataUrl, name) {
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) return null;
  try {
    const raw = String(dataUrl || "");
    if (!raw.startsWith("data:") || raw.length < 32) return null;
    const doFetch = await getFetch();
    if (!doFetch) return null;
    const form = new FormData();
    form.append("file", raw);
    form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    form.append("public_id", uniquePublicId(name, "img"));
    const res = await doFetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
      method: "POST",
      body: form,
    });
    const json = await res.json();
    if (json && json.secure_url) {
      console.log("Cloudinary upload OK:", json.secure_url);
      return json.secure_url;
    }
    console.warn("Cloudinary upload failed:", JSON.stringify((json && json.error) || json));
    return null;
  } catch (e) {
    console.warn("Cloudinary upload error:", e.message);
    return null;
  }
}

// ---- Cloudinary VIDEO (Reels) — একই unsigned preset, শুধু /video/upload এন্ডপয়েন্ট ----
async function uploadVideoToCloudinary(dataUrl, name) {
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) return null;
  try {
    const raw = String(dataUrl || "");
    if (!(raw.startsWith("data:video/") || raw.startsWith("data:audio/")) || raw.length < 32) return null;
    const doFetch = await getFetch();
    if (!doFetch) return null;
    const form = new FormData();
    form.append("file", raw);
    form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    form.append("public_id", uniquePublicId(name, "vid"));
    const res = await doFetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/video/upload`, {
      method: "POST",
      body: form,
    });
    const json = await res.json();
    if (json && json.secure_url) {
      console.log("Cloudinary video upload OK:", json.secure_url);
      return json.secure_url;
    }
    console.warn("Cloudinary video upload failed:", JSON.stringify((json && json.error) || json));
    return null;
  } catch (e) {
    console.warn("Cloudinary video upload error:", e.message);
    return null;
  }
}

// ---- imgbb (legacy fallback — মাঝে মাঝে ওদের নিজস্ব bot-protection normal ব্যবহারকারীকেও ব্লক করে) ----
async function uploadToImgbb(dataUrlOrBase64, name) {
  if (!IMGBB_API_KEY) return null;
  try {
    let b64 = String(dataUrlOrBase64 || "");
    if (b64.startsWith("data:")) {
      const i = b64.indexOf(",");
      if (i >= 0) b64 = b64.slice(i + 1);
    }
    if (!b64 || b64.length < 32) return null;
    const doFetch = await getFetch();
    if (!doFetch) return null;
    const body = new URLSearchParams();
    body.set("key", IMGBB_API_KEY);
    body.set("image", b64);
    if (name) body.set("name", String(name).slice(0, 80));
    const res = await doFetch("https://api.imgbb.com/1/upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://imgbb.com/",
        "Origin": "https://imgbb.com",
      },
      body: body.toString(),
    });
    const json = await res.json();
    if (json && json.success && json.data) {
      console.log("imgbb upload OK:", json.data.display_url || json.data.url);
      return json.data.display_url || json.data.url || null;
    }
    console.warn("Remote image upload failed:", JSON.stringify(json && (json.error || json.status_txt || json)));
    return null;
  } catch (e) {
    console.warn("Remote image upload error:", e.message);
    return null;
  }
}

async function resolveImageSrc(dataUrlOrHttp, name) {
  const raw = String(dataUrlOrHttp || "");
  if (raw.startsWith("http://") || raw.startsWith("https://")) return { src: raw, host: "url" };
  if (!raw.startsWith("data:")) return null;
  let remote = await uploadToCloudinary(raw, name);
  if (!remote) remote = await uploadToImgbb(raw, name);
  if (remote) return { src: remote, host: "cdn" };
  if (raw.length <= MAX_FALLBACK_DATA_URL) return { src: raw, host: "local" };
  return null;
}
if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_UPLOAD_PRESET) console.log("Image CDN: Cloudinary configured.");
else if (IMGBB_API_KEY) console.log("Image CDN: imgbb key loaded (legacy).");
else console.warn("⚠️ No image CDN configured — local data-URL fallback.");


const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  maxHttpBufferSize: 1e8, // allow base64 images/files through sockets

  // ছবি/ফাইল base64 আকারে যায় বলে কম্প্রেশন চালু করলে ট্রান্সফার অনেক দ্রুত হয়
  perMessageDeflate: { threshold: 1024 },
  httpCompression: { threshold: 1024 },

  // ওয়েবসকেট আগে চেষ্টা করা হবে — পোলিং-এ পড়ে গেলে মেসেজে দেরি হয়
  transports: ["websocket", "polling"],
  pingInterval: 20000,
  pingTimeout: 25000,
});

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// ================= মেইনটেনেন্স মোড: অ্যাপ সাময়িক বন্ধ =================
// চালু/বন্ধ: অ্যাডমিন প্যানেল থেকে (Maintenance বক্স), অথবা Render Environment-এ MAINTENANCE=1 (MAINTENANCE_MSG=বার্তা)।
// অ্যাডমিন নিজে ঢুকতে চাইলে একবার  /admin-bypass?key=<ADMIN_PASSWORD>  খুললেই হবে (ব্রাউজারে কুকি বসে যায়)।
// ঐচ্ছিক: Render Environment-এ ADMIN_PHONES=01XXXXXXXXX,01YYYYYYYYY দিলে শুধু এই ফোন নম্বরে লগইন করা অ্যাকাউন্টই (পাসওয়ার্ড জানলেও) অ্যাডমিন কাজ করতে পারবে
const ADMIN_PHONES = String(process.env.ADMIN_PHONES || "").split(",").map((x) => x.trim()).filter(Boolean);
function isAdminAccount(socket) { return !ADMIN_PHONES.length || ADMIN_PHONES.includes(socketToPhone[socket.id] || ""); }
const BYPASS_COOKIE = "ekt_admin";
let _bypassVal = "";
function bypassValue() { return _bypassVal || (_bypassVal = nodeCrypto.createHash("sha256").update("ekt-bypass:" + ADMIN_PASSWORD).digest("hex").slice(0, 40)); }
function hasBypass(cookieHeader) {
  return String(cookieHeader || "").split(";").some((c) => c.trim() === BYPASS_COOKIE + "=" + bypassValue());
}
function maintenanceActive() {
  if (maintenance.on && maintenance.until && Date.now() > maintenance.until) { maintenance = { on: false, msg: "", until: 0 }; try { saveData(); } catch (e) {} }
  return !!maintenance.on;
}
function maintStatus() { return { on: maintenanceActive(), msg: maintenance.msg || "", until: maintenance.until || 0, needPhone: ADMIN_PHONES.length > 0 }; }
function escHtml(t) { return String(t || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function broadcastMaintenance() {
  const st = maintStatus();
  io.sockets.sockets.forEach((sk) => {
    if (!st.on || !(sk._bypass || adminSockets.has(sk.id))) sk.emit("maintenance", st);
  });
}
setInterval(() => { const was = maintenance.on; if (was && !maintenanceActive()) broadcastMaintenance(); }, 20000);

// আপটাইম-রোবট / Render health check-এর জন্য: মেইনটেনেন্সেও সবসময় 200 দেয়
app.get(["/healthz", "/health"], (req, res) => res.status(200).type("text/plain").send("ok"));
app.head(["/healthz", "/health"], (req, res) => res.status(200).end());

const bypassTries = {};
app.use((req, res, next) => {
  if (req.path === "/admin-bypass") {
    const ip = String((req.headers["x-forwarded-for"] || req.ip || "")).split(",")[0].trim();
    const isHttps = String(req.headers["x-forwarded-proto"] || "").indexOf("https") === 0;
    const grant = () => res.setHeader("Set-Cookie", BYPASS_COOKIE + "=" + bypassValue() + "; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax" + (isHttps ? "; Secure" : ""));
    // ভুল পাসওয়ার্ড বারবার দিয়ে অনুমান ঠেকাতে: একই আইপি থেকে ১০ মিনিটে সর্বোচ্চ ৮ বার
    const rl = bypassTries[ip] && Date.now() - bypassTries[ip].t < 600000 ? bypassTries[ip] : (bypassTries[ip] = { n: 0, t: Date.now() });
    if (rl.n >= 8) return res.status(429).json({ ok: false, error: "too_many" });
    const passOk = (p) => { const a = nodeCrypto.createHash("sha256").update(String(p || "")).digest(), b = nodeCrypto.createHash("sha256").update(ADMIN_PASSWORD).digest(); return nodeCrypto.timingSafeEqual(a, b); };
    if (req.method === "POST") {
      const body = req.body || {};
      const phoneOk = !ADMIN_PHONES.length || ADMIN_PHONES.includes(String(body.phone || "").trim());
      if (passOk(body.password) && phoneOk) { rl.n = 0; grant(); return res.json({ ok: true }); }
      rl.n++;
      return res.status(403).json({ ok: false, error: "denied" });
    }
    if (!ADMIN_PHONES.length && passOk(req.query.key)) { rl.n = 0; grant(); return res.redirect("/"); } // ADMIN_PHONES দেওয়া থাকলে লিংক বন্ধ — শুধু ফর্ম (নম্বর+পাসওয়ার্ড)
    rl.n++;
    return res.status(403).send("Forbidden");
  }
  if (!maintenanceActive() || hasBypass(req.headers.cookie)) return next();
  if (req.path.indexOf("/socket.io") === 0) return next(); // সকেট নিজে আলাদাভাবে আটকানো হয়
  if (req.path.indexOf("/api/") === 0) return res.status(503).json({ error: "maintenance" });
  const wantsPage = req.method === "GET" && (req.path === "/" || /\.html?$/i.test(req.path) || String(req.headers.accept || "").indexOf("text/html") !== -1);
  if (!wantsPage) return next(); // app.js / style.css / ছবি — সমস্যা নেই
  const until = maintenance.until ? new Date(maintenance.until).toLocaleTimeString("bn-BD", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dhaka" }) : "";
  res.status(503).set({ "Retry-After": "300", "Cache-Control": "no-store", "Content-Type": "text/html; charset=utf-8" }).send(
    '<!doctype html><html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>সাময়িক বন্ধ</title>' +
    '<style>html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;background:#0b0b18;color:#fff;font-family:system-ui,sans-serif;text-align:center;padding:24px;box-sizing:border-box}' +
    '.c{max-width:420px}.i{font-size:54px}h1{font-size:24px;margin:14px 0 8px}p{opacity:.8;line-height:1.6;margin:6px 0}</style></head><body><div class="c"><div class="i">🛠️</div><h1>অ্যাপ সাময়িকভাবে বন্ধ আছে</h1>' +
    "<p>" + escHtml(maintenance.msg || "কিছু কাজ চলছে। অনুগ্রহ করে একটু পরে আবার আসুন।") + "</p>" + (until ? "<p>আনুমানিক " + escHtml(until) + " পর্যন্ত</p>" : "") +
    '<div style="margin-top:26px"><button id="ab" style="background:transparent;border:1px solid rgba(255,255,255,.25);color:#fff;border-radius:10px;padding:8px 16px;cursor:pointer;font:inherit">Admin</button>' +
    '<div id="af" style="display:none;margin-top:12px;flex-direction:column;gap:8px">' +
    (ADMIN_PHONES.length ? '<input id="ap" type="tel" placeholder="Admin phone" style="padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.25);background:transparent;color:#fff;font:inherit">' : '') +
    '<input id="aw" type="password" placeholder="Admin password" style="padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.25);background:transparent;color:#fff;font:inherit">' +
    '<button id="ag" style="padding:10px;border-radius:10px;border:none;background:#f97316;color:#fff;cursor:pointer;font:inherit">Enter</button><div id="ae" style="color:#f87171;font-size:13px;min-height:16px"></div></div></div>' +
    '</div><script>var auto=setTimeout(function(){location.reload()},30000);' +
    'document.getElementById("ab").onclick=function(){clearTimeout(auto);var f=document.getElementById("af");f.style.display=f.style.display==="flex"?"none":"flex"};' +
    'function go(){var p=document.getElementById("ap");fetch("/admin-bypass",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({password:document.getElementById("aw").value,phone:p?p.value:""})}).then(function(r){return r.json()}).then(function(j){if(j.ok)location.reload();else document.getElementById("ae").textContent=j.error==="too_many"?"অনেকবার ভুল, একটু পরে চেষ্টা করুন":"ভুল পাসওয়ার্ড/নম্বর"}).catch(function(){document.getElementById("ae").textContent="সমস্যা হয়েছে"})}' +
    'document.getElementById("ag").onclick=go;document.getElementById("aw").onkeydown=function(e){if(e.key==="Enter")go()};</script></body></html>'
  );
});

// Serve the frontend files (index.html, app.js, style.css) from this same folder
// ================= দ্রুত লোড: gzip/brotli + ক্যাশ, আর সংবেদনশীল ফাইল ব্লক =================
const zlib = require("zlib");
// server.js / package.json / ডেটা ফাইল যেন ডাউনলোড করা না যায়
app.use((req, res, next) => {
  if (/^\/(server\.js|package(-lock)?\.json|app-data\.json|\.env.*|\.git.*|node_modules|data)(\/|$)/i.test(req.path)) return res.status(404).end();
  next();
});
const FAST_FILES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "application/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
};
const fastCache = {};
app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  const def = FAST_FILES[req.path];
  if (!def) return next();
  try {
    const file = path.join(__dirname, def[0]);
    const st = fs.statSync(file);
    let e = fastCache[def[0]];
    if (!e || e.mtime !== st.mtimeMs) {
      const raw = fs.readFileSync(file);
      e = fastCache[def[0]] = {
        mtime: st.mtimeMs, raw,
        br: zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } }),
        gz: zlib.gzipSync(raw, { level: 9 }),
        etag: '"' + nodeCrypto.createHash("sha1").update(raw).digest("hex").slice(0, 20) + '"',
      };
    }
    res.setHeader("ETag", e.etag);
    res.setHeader("Cache-Control", "no-cache"); // প্রতিবার যাচাই করবে, বদলায়নি হলে 304 (ডাউনলোড ছাড়া)
    res.setHeader("Vary", "Accept-Encoding");
    res.setHeader("Content-Type", def[1]);
    if (req.headers["if-none-match"] === e.etag) return res.status(304).end();
    const ae = String(req.headers["accept-encoding"] || "");
    let body = e.raw;
    if (/\bbr\b/.test(ae)) { res.setHeader("Content-Encoding", "br"); body = e.br; }
    else if (/\bgzip\b/.test(ae)) { res.setHeader("Content-Encoding", "gzip"); body = e.gz; }
    res.setHeader("Content-Length", body.length);
    return res.end(req.method === "HEAD" ? undefined : body);
  } catch (err) { return next(); }
});

app.use(express.static(path.join(__dirname)));

// ================= DATA STORE (now saved to disk) =================
// আগে সব ডেটা শুধু মেমোরিতে ছিল, তাই সার্ভার রিস্টার্ট/স্লিপ হলেই ফ্রেন্ড লিস্ট
// মুছে যেত। এখন ডেটা app-data.json ফাইলে সেভ হয় এবং সার্ভার চালু হলে আবার লোড হয়।
//
// ⚠️ গুরুত্বপূর্ণ: Render-এর ফ্রি/স্ট্যান্ডার্ড ওয়েব সার্ভিসের ডিস্ক "ephemeral" —
// প্রতিবার নতুন ডিপ্লয় বা রিস্টার্ট হলে এই ফাইলটা মুছে যায়, ফলে আগে রেজিস্টার করা
// সব ইউজার/পাসওয়ার্ড হারিয়ে যায় (এই কারণেই অন্য ডিভাইসে লগইন ফেইল করে, কারণ ওই
// ডিভাইসের লোকাল ক্যাশ নেই আর সার্ভারেও ডেটা নেই)। এটা ঠিক করার আসল সমাধান হলো
// Render Dashboard → এই সার্ভিস → "Disks" থেকে একটা Persistent Disk যোগ করে (যেমন
// মাউন্ট পাথ "/data") এবং Environment ভ্যারিয়েবল DATA_DIR=/data সেট করে দেওয়া —
// তাহলে ডিপ্লয়/রিস্টার্ট হলেও ইউজার ডেটা আর মুছে যাবে না।
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, "app-data.json");
const MAX_SAVED_MESSAGES = 100; // প্রতি চ্যাটে সর্বশেষ কতগুলো মেসেজ ফাইলে রাখা হবে

let users = {};              // phone -> { name, phone, password, pic }
let profiles = {};           // phone -> { bio, location, work, education, relationship, items: [...] }
let directThemes = {};       // "phoneA|phoneB" (sorted) -> themeData
let friendships = {};        // phone -> Set(phone)
let friendRequests = {};     // phone -> Set(phone)  (requests received BY this phone)
let blockedUsers = {};       // phone -> Set(phone)  (phones THIS user has blocked)
let directMessages = {};     // "phoneA|phoneB" (sorted) -> [ messages ]
let roomMessages = {};       // roomCode -> [ messages ]
const STORY_TTL = 24 * 60 * 60 * 1000; // ২৪ ঘণ্টা
let stories = [];            // [ { id, phone, name, pic, media, text, bg, time, expires, views:[phone] } ]
// ---- Cloudinary থেকে ফাইল মোছা (ইউজার কিছু ডিলিট করলে ক্লাউডেও মুছে যাবে) ----
function parseCloudinaryUrl(url) {
  const m = String(url || "").match(/^https?:\/\/res\.cloudinary\.com\/([^/]+)\/(image|video|raw)\/upload\/(.+)$/);
  if (!m) return null;
  let parts = m[3].split("/");
  const vi = parts.findIndex((p) => /^v\d+$/.test(p));
  if (vi >= 0) parts = parts.slice(vi + 1);
  else parts = parts.filter((p) => p.indexOf(",") === -1 && !/^[a-z]{1,3}_[^/]+$/.test(p));
  if (!parts.length) return null;
  let publicId = parts.join("/");
  try { publicId = decodeURIComponent(publicId); } catch (e) {}
  if (m[2] !== "raw") publicId = publicId.replace(/\.[a-zA-Z0-9]+$/, "");
  return { cloud: m[1], type: m[2], publicId };
}

async function deleteFromCloudinary(url) {
  const info = parseCloudinaryUrl(url);
  if (!info) return false; // Cloudinary-র ফাইল না (যেমন imgbb) — কিছু করার নেই
  if (!CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    console.warn("Cloudinary delete skipped: CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET সেট করা নেই →", info.publicId);
    return false;
  }
  if (CLOUDINARY_CLOUD_NAME && info.cloud !== CLOUDINARY_CLOUD_NAME) return false;
  try {
    const doFetch = await getFetch();
    if (!doFetch) return false;
    const timestamp = Math.floor(Date.now() / 1000);
    const toSign = "invalidate=true&public_id=" + info.publicId + "&timestamp=" + timestamp + CLOUDINARY_API_SECRET;
    const signature = nodeCrypto.createHash("sha1").update(toSign).digest("hex");
    const body = new URLSearchParams({ public_id: info.publicId, timestamp: String(timestamp), invalidate: "true", api_key: CLOUDINARY_API_KEY, signature });
    const res = await doFetch(`https://api.cloudinary.com/v1_1/${info.cloud}/${info.type}/destroy`, { method: "POST", body });
    const json = await res.json();
    console.log("Cloudinary delete:", info.type, info.publicId, "→", (json && (json.result || (json.error && json.error.message))) || "?");
    return !!(json && json.result === "ok");
  } catch (e) {
    console.warn("Cloudinary delete error:", e.message);
    return false;
  }
}

// অন্য কোথাও একই ফাইল ব্যবহার হচ্ছে কি? (থাকলে ক্লাউড থেকে মুছব না)
function isMediaReferenced(url) {
  if (!url) return false;
  for (const ph of Object.keys(profiles)) {
    const p = profiles[ph] || {};
    if (p.cover === url) return true;
    if ((p.posts || []).some((x) => x && x.media && x.media.src === url)) return true;
    if ((p.items || []).some((x) => x && x.src === url)) return true;
  }
  if (stories.some((st) => (st.media && st.media.src === url) || (st.music && st.music.src === url))) return true;
  if (Object.values(users).some((u) => u && u.pic === url)) return true;
  return false;
}
function cleanupMedia(urls) {
  Array.from(new Set((urls || []).filter(Boolean))).forEach((u) => {
    if (!isMediaReferenced(u)) deleteFromCloudinary(u);
  });
}
const storyUrls = (st) => (st ? [st.media && st.media.src, st.music && st.music.src] : []);

// ---- পোস্ট ↔ ছবি/রিলস সংযোগ: যেভাবেই আপলোড হোক, সব জায়গায় দেখা যাবে ----
// পোস্টে ছবি → Photos-এও, পোস্টে ভিডিও → Reels-এও; Photos/Reels-এ আপলোড → Posts-এও
function syncMediaLinks(p) {
  if (!p) return;
  if (!Array.isArray(p.posts)) p.posts = [];
  if (!Array.isArray(p.items)) p.items = [];
  const itemIds = new Set(p.items.map((i) => i && i.id));
  const postIds = new Set(p.posts.map((x) => x && x.id));
  p.posts.forEach((post) => {
    if (!post || post.itemId || !post.media || !post.media.src) return;
    const src = String(post.media.src);
    post.itemId = "lp_" + post.id;
    if (src.startsWith("data:") || itemIds.has(post.itemId)) return;
    const isVid = post.media.type === "video";
    p.items.push({ id: post.itemId, kind: isVid ? "reel" : "photo", src, host: post.media.host, name: isVid ? "video" : "photo", caption: post.text || "", timestamp: post.timestamp || Date.now(), postId: post.id });
    itemIds.add(post.itemId);
  });
  p.items.forEach((it) => {
    if (!it || it.postId || (it.kind !== "photo" && it.kind !== "reel")) return;
    const src = String(it.src || "");
    it.postId = "pi_" + it.id;
    if (!src || src.startsWith("data:") || postIds.has(it.postId)) return;
    p.posts.push({ id: it.postId, text: it.caption || "", media: { type: it.kind === "reel" ? "video" : "image", src, host: it.host }, timestamp: it.timestamp || Date.now(), likes: [], comments: [], itemId: it.id });
    postIds.add(it.postId);
  });
  const byTime = (a, b) => (b.timestamp || 0) - (a.timestamp || 0);
  const photos = p.items.filter((i) => i && i.kind === "photo").sort(byTime).slice(0, 100);
  const reels = p.items.filter((i) => i && i.kind === "reel").sort(byTime).slice(0, 30);
  p.items = photos.concat(reels);
  p.posts.sort(byTime);
  p.posts = p.posts.slice(0, 100);
}
function syncAllMediaLinks() { Object.keys(profiles).forEach((ph) => syncMediaLinks(profiles[ph])); }

// প্রোফাইল/কভার ছবি আপলোড হলে Photos ট্যাব ও পোস্ট ফিডেও দেখানো
function publishProfileMediaAsPost(phone, src, host, kindLabel) {
  if (!phone || !src) return;
  if (!profiles[phone]) profiles[phone] = {};
  if (!Array.isArray(profiles[phone].items)) profiles[phone].items = [];
  if (!Array.isArray(profiles[phone].posts)) profiles[phone].posts = [];
  const ts = Date.now();
  const itemId = "pm_" + ts.toString(36) + Math.random().toString(36).slice(2, 6);
  const postId = "pp_" + ts.toString(36) + Math.random().toString(36).slice(2, 6);
  const caption = kindLabel === "cover" ? "আমার নতুন কভার ছবি" : "আমার নতুন প্রোফাইল ছবি";
  const item = {
    id: itemId,
    kind: "photo",
    src,
    host: host || "cdn",
    name: kindLabel === "cover" ? "cover" : "profile",
    caption,
    timestamp: ts,
    postId,
    fromProfile: kindLabel === "cover" ? "cover" : "avatar",
  };
  const post = {
    id: postId,
    text: caption,
    media: { type: "image", src, host: host || "cdn" },
    timestamp: ts,
    likes: [],
    comments: [],
    itemId,
    fromProfile: item.fromProfile,
  };
  const keepReels = profiles[phone].items.filter((it) => it && it.kind === "reel");
  const photos = [item].concat(profiles[phone].items.filter((it) => it && it.kind === "photo")).slice(0, 100);
  profiles[phone].items = photos.concat(keepReels);
  profiles[phone].posts.unshift(post);
  profiles[phone].posts = profiles[phone].posts.slice(0, 100);
  syncMediaLinks(profiles[phone]);
}


function purgeExpiredStories() {
  const before = stories.length;
  const now = Date.now();
  const expired = stories.filter((st) => st.expires <= now);
  stories = stories.filter((st) => st.expires > now);
  if (stories.length !== before) { saveData(); expired.forEach((st) => cleanupMedia(storyUrls(st))); }
}
setInterval(() => purgeExpiredStories(), 5 * 60 * 1000);
setTimeout(() => { try { syncAllMediaLinks(); saveData(); } catch (e) { console.warn("sync media links:", e.message); } }, 1500); // প্রতি ৫ মিনিটে মেয়াদ-শেষ স্টোরি মুছে ফেলা
let reports = [];            // [ { id, fromPhone, fromName, message, time, status } ]
let bannedUsers = {};        // phone -> { reason, time }
let deletedHashes = {};      // sha256(id) -> 1  (শুধু হ্যাশ — মুছে ফেলা অ্যাকাউন্ট যেন পুরোনো ডিভাইস থেকে আবার তৈরি না হয়; আর কোনো তথ্য রাখা হয় না)
let maintenance = { on: false, msg: "", until: 0, by: "" }; // অ্যাপ সাময়িক বন্ধ (মেইনটেনেন্স মোড)
let shortsData = {};         // YouTube ভিডিও আইডি -> { t, c, likes:[phone], comments:[...] }  (শুধু যেগুলোতে লাইক/কমেন্ট পড়েছে)
let shortsPrefs = {};        // phone -> { w:{শব্দ:স্কোর}, ch:{চ্যানেল:স্কোর} }  (কার কী পছন্দ — সাজেশনের জন্য)
let phoneAliases = {};       // পুরোনো নম্বর -> নতুন নম্বর (নম্বর বদলালে পুরোনো ডিভাইস যেন নকল অ্যাকাউন্ট না বানায়)

// ================= অ্যাডমিন প্যানেল =================
// অ্যাডমিন প্যানেলে ঢুকতে এই পাসওয়ার্ডটা লাগবে। চাইলে Render-এর Environment
// ভ্যারিয়েবল ADMIN_PASSWORD সেট করে এটা পরিবর্তন করা যাবে (নিরাপত্তার জন্য উত্তম)।
// ⚠️ আগে এখানে একটা ডিফল্ট পাসওয়ার্ড কোডে লেখা ছিল (GitHub-এ সবাই দেখতে পেত)। এখন ডিফল্ট নেই —
// Render → Environment-এ ADMIN_PASSWORD সেট না করলে একটা এলোমেলো পাসওয়ার্ড তৈরি হয় যেটা কেউ অনুমান করতে পারবে না
// (অর্থাৎ অ্যাডমিন প্যানেল কার্যত বন্ধ থাকবে)। অ্যাডমিন প্যানেল চালাতে ADMIN_PASSWORD সেট করুন।
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || nodeCrypto.randomBytes(24).toString("hex");
if (!process.env.ADMIN_PASSWORD) console.warn("⚠️ ADMIN_PASSWORD সেট করা নেই — অ্যাডমিন প্যানেল বন্ধ। Render Environment-এ ADMIN_PASSWORD সেট করুন।");

// ---------- পাসওয়ার্ড হ্যাশ (Node-এর নিজস্ব crypto.scrypt — নতুন কোনো প্যাকেজ লাগে না) ----------
function hashPassword(pw) {
  const salt = nodeCrypto.randomBytes(16);
  const h = nodeCrypto.scryptSync(String(pw), salt, 32);
  return "sc1$" + salt.toString("hex") + "$" + h.toString("hex");
}
function isHashedPassword(v) {
  return typeof v === "string" && /^sc1\$[0-9a-f]{32}\$[0-9a-f]{64}$/.test(v);
}
function verifyPassword(pw, stored) {
  if (typeof stored !== "string" || !stored || pw == null) return false;
  if (isHashedPassword(stored)) {
    const parts = stored.split("$");
    const calc = nodeCrypto.scryptSync(String(pw), Buffer.from(parts[1], "hex"), 32);
    return nodeCrypto.timingSafeEqual(calc, Buffer.from(parts[2], "hex"));
  }
  // পুরোনো (হ্যাশ হয়নি এমন) পাসওয়ার্ড — লগইনের সময় নিজে থেকেই হ্যাশে বদলে যাবে
  const a = Buffer.from(String(pw));
  const b = Buffer.from(stored);
  return a.length === b.length && nodeCrypto.timingSafeEqual(a, b);
}


// ================= অ্যাকাউন্ট সেটিংস: ইমেইল / ডিভাইস হিস্ট্রি / স্থায়ী ডিলিট =================
function idHash(id) {
  return nodeCrypto.createHash("sha256").update("ekt:" + String(id || "").trim().toLowerCase()).digest("hex");
}
function isDeletedId(id) { return !!deletedHashes[idHash(id)]; }
function normalizeEmail(e) {
  const v = String(e || "").trim().toLowerCase();
  if (!v || v.length > 120) return "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? v : "";
}
function normalizePhoneInput(p) {
  const v = String(p || "").replace(/[\s-]/g, "");
  return /^\+?[0-9]{6,18}$/.test(v) ? v : "";
}
// লগইনে ফোন নম্বর বা ইমেইল — যেটাই দেওয়া হোক, অ্যাকাউন্টের আসল key (phone) ফেরত দেয়
function resolveLoginPhone(idf) {
  const s = String(idf || "").trim();
  if (!s) return null;
  if (users[s]) return s;
  // দ্বিতীয় (অতিরিক্ত) নম্বর দিয়েও লগইন চলবে
  const compact = s.replace(/[\s-]/g, "");
  if (/^\+?[0-9]{6,18}$/.test(compact)) {
    if (users[compact]) return compact;
    const ua = Object.values(users).find((x) => x && x.altNum === compact);
    if (ua) return ua.phone;
  }
  const em = s.toLowerCase();
  if (em.indexOf("@") > 0) {
    const u = Object.values(users).find((x) => x && x.email === em);
    if (u) return u.phone;
  }
  return null;
}
// কোনো অ্যাকাউন্টের দ্বিতীয় নম্বর হিসেবে এই নম্বর আছে কি না (exceptPhone-এর নিজেরটা বাদে)
function altTaken(num, exceptPhone) {
  if (!num) return false;
  return Object.values(users).some((x) => x && x.altNum === num && x.phone !== exceptPhone);
}
function emailTaken(em, exceptPhone) {
  if (!em) return false;
  if (users[em] && users[em].phone !== exceptPhone) return true;
  return Object.values(users).some((x) => x && x.email === em && x.phone !== exceptPhone);
}
function selfUserPayload(user, password) {
  const copy = { ...user };
  delete copy.loginHistory;
  delete copy.revoked;
  copy.password = String(password);
  copy.pid = pidOf(user.phone); // নিজের প্রোফাইল লিংক বানাতে
  return copy;
}

function getClientIp(sock) {
  try {
    const h = sock.handshake || {};
    const xf = (h.headers && h.headers["x-forwarded-for"]) || "";
    const ip = String(xf).split(",")[0].trim() || h.address || "";
    return String(ip).replace(/^::ffff:/, "").slice(0, 64);
  } catch (e) { return ""; }
}
function parseDevice(ua) {
  ua = String(ua || "");
  let os = "Unknown OS";
  if (/Android/i.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
  else if (/Windows/i.test(ua)) os = "Windows";
  else if (/Mac OS X|Macintosh/i.test(ua)) os = "macOS";
  else if (/CrOS/i.test(ua)) os = "ChromeOS";
  else if (/Linux/i.test(ua)) os = "Linux";
  let br = "Browser";
  if (/Edg\//i.test(ua)) br = "Edge";
  else if (/OPR\/|Opera/i.test(ua)) br = "Opera";
  else if (/SamsungBrowser/i.test(ua)) br = "Samsung Internet";
  else if (/Firefox\//i.test(ua)) br = "Firefox";
  else if (/Chrome\//i.test(ua) || /CriOS/i.test(ua)) br = "Chrome";
  else if (/Safari\//i.test(ua)) br = "Safari";
  return br + " · " + os;
}
// প্রতিটা ডিভাইস একবার করে থাকে (deviceId দিয়ে); লগইন/সাইনআপ হলে "lastLogin" বদলায়, অ্যাপ খুললে "lastSeen"
function recordDevice(user, sock, deviceId, method) {
  if (!user) return;
  if (!Array.isArray(user.loginHistory)) user.loginHistory = [];
  const ua = (sock && sock.handshake && sock.handshake.headers && sock.handshake.headers["user-agent"]) || "";
  const id = String(deviceId || "").slice(0, 64) || ("ua_" + idHash(ua).slice(0, 12));
  const now = Date.now();
  if (method !== "session" && user.revoked) delete user.revoked[id]; // নতুন করে লগইন করলে আবার অনুমতি
  const ip = getClientIp(sock);
  const device = parseDevice(ua);
  let e = user.loginHistory.find((x) => x && x.deviceId === id);
  if (e) {
    e.ip = ip; e.device = device; e.lastSeen = now;
    if (method !== "session") { e.lastLogin = now; e.method = method; }
  } else {
    user.loginHistory.push({ deviceId: id, device, ip, method, firstLogin: now, lastLogin: now, lastSeen: now });
  }
  user.loginHistory.sort((a, b) => (b.lastLogin || 0) - (a.lastLogin || 0));
  user.loginHistory = user.loginHistory.slice(0, 20);
}
// ডিভাইস -> তার চালু সকেটগুলো (রিমোট লগআউটে ওই ডিভাইসকে সাথে সাথে বের করে দিতে)
const deviceSockets = {};    // "phone|deviceId" -> Set(socket.id)
const socketDevice = {};     // socket.id -> "phone|deviceId"
function devKey(phone, did) { return String(phone) + "|" + String(did || "").slice(0, 64); }
function bindDeviceSocket(socket, phone, did) {
  const d = String(did || "").slice(0, 64);
  if (!phone || !d) return;
  const k = devKey(phone, d);
  const old = socketDevice[socket.id];
  if (old && old !== k && deviceSockets[old]) { deviceSockets[old].delete(socket.id); if (!deviceSockets[old].size) delete deviceSockets[old]; }
  if (!deviceSockets[k]) deviceSockets[k] = new Set();
  deviceSockets[k].add(socket.id);
  socketDevice[socket.id] = k;
}
function unbindDeviceSocket(socket) {
  const k = socketDevice[socket.id];
  if (k && deviceSockets[k]) { deviceSockets[k].delete(socket.id); if (!deviceSockets[k].size) delete deviceSockets[k]; }
  delete socketDevice[socket.id];
}
function isRevokedDevice(phone, did) {
  const u = users[phone];
  return !!(u && did && u.revoked && u.revoked[String(did).slice(0, 64)]);
}
function devRef(did) { return idHash("dev:" + did).slice(0, 16); }

function touchDevice(phone, deviceId) {
  const u = users[phone];
  if (!u || !deviceId || !Array.isArray(u.loginHistory)) return;
  const e = u.loginHistory.find((x) => x && x.deviceId === String(deviceId).slice(0, 64));
  if (!e) return;
  const now = Date.now();
  if (now - (e.lastSeen || 0) > 5 * 60 * 1000) { e.lastSeen = now; saveData(); }
}

// ---------- নম্বর বদলালে: সব জায়গায় পুরোনো নম্বর -> নতুন নম্বর ----------
function renamePhoneEverywhere(oldP, newP) {
  const swap = (v) => (v === oldP ? newP : v);
  const swapKey = (obj) => {
    if (obj && Object.prototype.hasOwnProperty.call(obj, oldP)) { obj[newP] = obj[oldP]; delete obj[oldP]; }
  };
  const u = users[oldP];
  delete users[oldP];
  u.phone = newP;
  users[newP] = u;

  delete profiles[newP];
  [friendships, friendRequests, blockedUsers].forEach((st) => delete st[newP]);
  swapKey(profiles);
  swapKey(bannedUsers);
  [friendships, friendRequests, blockedUsers].forEach((st) => {
    swapKey(st);
    Object.keys(st).forEach((k) => {
      const set = st[k];
      if (set && set.has && set.has(oldP)) { set.delete(oldP); set.add(newP); }
    });
  });

  Object.keys(directMessages).forEach((key) => {
    const parts = key.split("|");
    if (!parts.includes(oldP)) return;
    const list = directMessages[key] || [];
    delete directMessages[key];
    list.forEach((m) => {
      if (!m) return;
      m.senderPhone = swap(m.senderPhone);
      m.receiverPhone = swap(m.receiverPhone);
      if (m.shared && m.shared.ownerPhone === oldP) m.shared.ownerPhone = newP;
    });
    const nk = directKey(...parts.map(swap));
    directMessages[nk] = (directMessages[nk] || []).concat(list).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  });
  Object.keys(directThemes).forEach((key) => {
    const parts = key.split("|");
    if (!parts.includes(oldP)) return;
    const t = directThemes[key];
    delete directThemes[key];
    directThemes[directKey(...parts.map(swap))] = t;
  });

  Object.values(profiles).forEach((pr) => {
    ((pr && pr.posts) || []).forEach((post) => {
      if (!post) return;
      if (Array.isArray(post.likes)) post.likes = post.likes.map(swap);
      swapKey(post.reacts);
      (post.comments || []).forEach((c) => { if (c && c.authorPhone === oldP) c.authorPhone = newP; });
      if (post.sharedFrom && post.sharedFrom.ownerPhone === oldP) post.sharedFrom.ownerPhone = newP;
    });
  });
  stories.forEach((st) => {
    st.phone = swap(st.phone);
    if (Array.isArray(st.views)) st.views = st.views.map(swap);
    if (Array.isArray(st.likes)) st.likes = st.likes.map(swap);
    swapKey(st.reacts);
  });
  reports.forEach((r) => { r.fromPhone = swap(r.fromPhone); r.storyOwner = swap(r.storyOwner); });

  if (phoneToSocket[oldP]) { phoneToSocket[newP] = phoneToSocket[oldP]; delete phoneToSocket[oldP]; }
  Object.keys(socketToPhone).forEach((k) => { if (socketToPhone[k] === oldP) socketToPhone[k] = newP; });
  Object.keys(roomMembers).forEach((rc) => {
    roomMembers[rc].forEach((m) => { if (m && m.user && m.user.phone === oldP) m.user = { ...m.user, phone: newP }; });
  });

  Object.keys(phoneAliases).forEach((k) => { if (phoneAliases[k] === oldP) phoneAliases[k] = newP; });
  phoneAliases[oldP] = newP;
  delete phoneAliases[newP];
  delete deletedHashes[idHash(newP)];
}

// ---------- অ্যাকাউন্ট স্থায়ীভাবে মুছে ফেলা (কোনো হিস্ট্রি/ডেটা রাখা হয় না) ----------
function purgeUserCompletely(phone) {
  const delPid = pidOf(phone); // মুছে ফেলার আগেই pid নিয়ে রাখা — বন্ধুদের ক্লায়েন্ট এটা দিয়েই চিনবে
  const u = users[phone] || {};
  const p = profiles[phone] || {};
  const urls = [u.pic, p.cover];
  (p.posts || []).forEach((x) => { if (x && x.media) urls.push(x.media.src); });
  (p.items || []).forEach((x) => { if (x) urls.push(x.src); });
  stories.filter((st) => st.phone === phone).forEach((st) => storyUrls(st).forEach((x) => urls.push(x)));
  const formerFriends = Array.from(ensureSet(friendships, phone));

  delete users[phone];
  delete profiles[phone];
  delete bannedUsers[phone];
  [friendships, friendRequests, blockedUsers].forEach((st) => {
    delete st[phone];
    Object.keys(st).forEach((k) => { if (st[k] && st[k].delete) st[k].delete(phone); });
  });
  Object.keys(directMessages).forEach((key) => { if (key.split("|").includes(phone)) delete directMessages[key]; });
  Object.keys(directThemes).forEach((key) => { if (key.split("|").includes(phone)) delete directThemes[key]; });

  stories = stories.filter((st) => st.phone !== phone);
  delete shortsPrefs[phone];
  Object.keys(shortsData).forEach((id) => { const d = shortsData[id]; d.likes = (d.likes || []).filter((x) => x !== phone); d.comments = (d.comments || []).filter((c) => c.authorPhone !== phone); });
  stories.forEach((st) => {
    if (Array.isArray(st.views)) st.views = st.views.filter((x) => x !== phone);
    if (Array.isArray(st.likes)) st.likes = st.likes.filter((x) => x !== phone);
    if (st.reacts) delete st.reacts[phone];
  });
  Object.values(profiles).forEach((pr) => {
    ((pr && pr.posts) || []).forEach((post) => {
      if (!post) return;
      if (Array.isArray(post.likes)) post.likes = post.likes.filter((x) => x !== phone);
      if (post.reacts) delete post.reacts[phone];
      if (Array.isArray(post.comments)) post.comments = post.comments.filter((c) => !c || c.authorPhone !== phone);
      if (post.sharedFrom && post.sharedFrom.ownerPhone === phone) post.sharedFrom.ownerName = "Deleted user";
    });
  });
  reports = reports.filter((r) => r && r.fromPhone !== phone && r.storyOwner !== phone);

  const sid = phoneToSocket[phone];
  delete phoneToSocket[phone];
  Object.keys(socketToPhone).forEach((k) => { if (socketToPhone[k] === phone) delete socketToPhone[k]; });
  Object.keys(roomMembers).forEach((rc) => {
    const mp = roomMembers[rc];
    let changed = false;
    mp.forEach((m, k) => { if (m && m.user && m.user.phone === phone) { mp.delete(k); changed = true; } });
    if (changed) broadcastRoomMembers(rc);
  });
  Object.keys(phoneAliases).forEach((k) => { if (k === phone || phoneAliases[k] === phone) delete phoneAliases[k]; });

  // শুধু একটা এক-মুখী হ্যাশ — যাতে মুছে ফেলা অ্যাকাউন্ট পুরোনো ডিভাইস থেকে আবার জীবিত না হয়
  deletedHashes[idHash(phone)] = 1;
  if (u.email) deletedHashes[idHash(u.email)] = 1;
  if (u.altNum) deletedHashes[idHash(u.altNum)] = 1;

  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  enqueueSave();
  cleanupMedia(urls);
  formerFriends.forEach((fp) => {
    sendFriendData(fp);
    const fs2 = phoneToSocket[fp];
    if (fs2) { sendTo(fs2, "friend-profile-updated", { phone: delPid }); sendTo(fs2, "stories-updated"); }
  });
  return sid;
}

// ক্লায়েন্ট থেকে আসা ইউজার-ডেটা মার্জ করার নিরাপদ উপায়:
// শুধু name/pic/phone নেওয়া হয়। পাসওয়ার্ড শুধু তখনই সেট হয় যখন ওই অ্যাকাউন্টে আগে থেকে পাসওয়ার্ড নেই
// (নতুন রেজিস্ট্রেশন বা সার্ভার ডেটা হারালে রিকভারি)। আগে যে কেউ অন্যের ফোন নম্বর দিয়ে তার পাসওয়ার্ড বদলে দিতে পারত।
function mergeClientUser(u) {
  if (!u || typeof u.phone !== "string" || !u.phone) return null;
  if (isDeletedId(u.phone) || phoneAliases[u.phone]) return null; // মুছে ফেলা / নম্বর-বদলানো অ্যাকাউন্ট আর তৈরি হবে না
  const existing = users[u.phone] || {};
  const merged = { ...existing, phone: u.phone };
  if (typeof u.name === "string") merged.name = u.name.slice(0, 80);
  if (typeof u.pic === "string") merged.pic = u.pic;
  if (!existing.password && typeof u.password === "string" && u.password) {
    merged.password = hashPassword(u.password);
  }
  if (!existing.email) {
    const em = normalizeEmail(u.email);
    if (em && !emailTaken(em, u.phone)) merged.email = em;
  }
  users[u.phone] = merged;
  return merged;
}

const roomMembers = {};      // roomCode -> Map(socket.id -> { user, peerId })
const phoneToSocket = {};    // phone -> socket.id
const socketToPhone = {};    // socket.id -> phone
const socketToRoom = {};     // socket.id -> roomCode

// ================= গোপনীয়তা: ফোন নম্বর / ইমেইল অন্য ইউজারকে দেখানো হয় না =================
// প্রতিটা ইউজারের একটা এলোমেলো পাবলিক আইডি (pid) থাকে। সার্ভার যা-ই পাঠাক, প্রাপকের নিজের
// নম্বর/ইমেইল ছাড়া বাকি সব নম্বর-ইমেইল pid দিয়ে বদলে যায় (শুধু অ্যাডমিন আসল তথ্য দেখে)।
// ক্লায়েন্ট থেকে pid এলে সার্ভার আবার আসল নম্বরে ফিরিয়ে নেয় — তাই ফ্রেন্ড/চ্যাট/কল আগের মতোই চলে।
const PID_RE = /^u[0-9a-f]{16}$/;
const PHONE_KEY_RE = /phone/i;
const EMAIL_KEY_RE = /^e-?mail/i;
const FREE_TEXT_KEYS = new Set(["text", "message", "caption", "content", "bio", "about", "reason", "fileContent"]);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
let pidToPhone = {};
const selfPhoneBySocket = {};   // socket.id -> এই সকেটের নিজের ফোন/ইমেইল-আইডি
const adminSockets = new Set(); // সফলভাবে অ্যাডমিন-লগইন করা সকেট

function pidOf(id) {
  const s = String(id);
  if (PID_RE.test(s)) return s;
  const u = hasOwn(users, s) ? users[s] : null;
  if (u) {
    if (!u.pid || !PID_RE.test(u.pid)) u.pid = "u" + nodeCrypto.randomBytes(8).toString("hex");
    pidToPhone[u.pid] = s;
    return u.pid;
  }
  return "x" + idHash(s).slice(0, 16); // মুছে ফেলা/অজানা — আর ফেরত যায় না
}
function rebuildPidMap() {
  pidToPhone = {};
  Object.keys(users).forEach((k) => { if (users[k]) pidOf(k); });
}
function phoneFromPid(pid) {
  let p = pidToPhone[pid];
  if (!(p && hasOwn(users, p) && users[p].pid === pid)) {
    rebuildPidMap();
    p = pidToPhone[pid];
  }
  return p && hasOwn(users, p) && users[p].pid === pid ? p : null;
}

// ক্লায়েন্ট → সার্ভার: pid থাকলে আসল ফোনে ফিরিয়ে নেওয়া (জায়গাতেই বদলায়)
function unscrubIn(v, depth) {
  if (typeof v === "string") return v.length === 17 && PID_RE.test(v) ? (phoneFromPid(v) || v) : v;
  if (!v || typeof v !== "object" || depth > 10 || Buffer.isBuffer(v)) return v;
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = unscrubIn(v[i], depth + 1); return v; }
  Object.keys(v).forEach((k) => { v[k] = unscrubIn(v[k], depth + 1); });
  return v;
}

// সার্ভার → ক্লায়েন্ট: প্রাপকের নিজেরটা ছাড়া সব নম্বর/ইমেইল সরানো
function scrubWalk(v, key, self, depth) {
  if (typeof v === "string") {
    if (v.length > 128 || v === self || PID_RE.test(v)) return v;
    if (hasOwn(users, v) && !FREE_TEXT_KEYS.has(key)) return pidOf(v);
    if (key && PHONE_KEY_RE.test(key) && v && v !== "unknown") return pidOf(v);
    return v;
  }
  if (!v || typeof v !== "object" || depth > 12 || Buffer.isBuffer(v)) return v;
  if (Array.isArray(v)) return v.map((x) => scrubWalk(x, key, self, depth + 1));
  const selfObj = !!self && v.phone === self;
  const out = {};
  Object.keys(v).forEach((k) => {
    if (EMAIL_KEY_RE.test(k) && !selfObj) return; // অন্যের ইমেইল কখনোই না
    if ((k === "pid" || k === "password" || k === "loginHistory" || k === "deviceId" || k === "altNum" || k === "revoked") && !selfObj) return; // রুমে join-এর user অবজেক্টে পাসওয়ার্ডও থাকতে পারে — অন্যকে কখনো না
    const nk = hasOwn(users, k) && k !== self ? pidOf(k) : k; // reacts ইত্যাদি map-এর key
    out[nk] = scrubWalk(v[k], k, self, depth + 1);
  });
  return out;
}
// এই সকেটের আসল ইউজার (ক্লায়েন্টের পাঠানো viewerPhone বিশ্বাস করা হয় না — নকল করা যায়)
function viewerOf(sock) { return selfPhoneBySocket[sock.id] || socketToPhone[sock.id] || ""; }
function areFriends(a, b) { return !!a && !!b && ensureSet(friendships, a).has(b); }
function canSeeContent(sock, ownerPhone) {
  if (adminSockets.has(sock.id)) return true;
  const v = viewerOf(sock);
  return !!v && (v === ownerPhone || areFriends(v, ownerPhone));
}
function recipientPhone(sid) { return selfPhoneBySocket[sid] || socketToPhone[sid] || ""; }
function outboundFor(sid, data, forceRaw) {
  if (forceRaw || adminSockets.has(sid)) return data;
  return scrubWalk(data, "", recipientPhone(sid), 0);
}
function setSelf(sock, phone) { if (phone) selfPhoneBySocket[sock.id] = phone; }
function sendTo(sid, ev, data) {
  if (data === undefined) io.to(sid).emit(ev);
  else io.to(sid).emit(ev, outboundFor(sid, data));
}
function emitRoom(roomCode, ev, data, exceptSid) {
  const room = io.sockets.adapter.rooms.get(roomCode);
  if (!room) return;
  Array.from(room).forEach((sid) => { if (sid !== exceptSid) sendTo(sid, ev, data); });
}
function emitAdmins(ev, data) {
  adminSockets.forEach((sid) => io.to(sid).emit(ev, data));
}

function setsToArrays(obj) {
  const out = {};
  for (const key in obj) out[key] = Array.from(obj[key]);
  return out;
}

function arraysToSets(obj) {
  const out = {};
  if (!obj) return out;
  for (const key in obj) out[key] = new Set(obj[key] || []);
  return out;
}

function trimMessages(store) {
  const out = {};
  for (const key in store) {
    const list = store[key] || [];
    out[key] = list.slice(-MAX_SAVED_MESSAGES);
  }
  return out;
}

// ================= স্থায়ী স্টোরেজ (MongoDB Atlas — ফ্রি) =================
// MONGODB_URI সেট করা থাকলে সব ডেটা MongoDB-তে সেভ হবে, তাই Render রিস্টার্ট/ডিপ্লয় হলেও
// ইউজার অ্যাকাউন্ট, ফ্রেন্ড লিস্ট, প্রোফাইল, মেসেজ মুছবে না — এবং যেকোনো ফোন থেকে লগইন চলবে।
// সেট করা না থাকলে আগের মতোই app-data.json ফাইলে সেভ হবে।
const MONGODB_URI = process.env.MONGODB_URI || "";
let mongoCol = null;
const lastSavedJson = {}; // key -> শেষবার যে JSON সেভ হয়েছে (বদলায়নি এমন অংশ আবার লেখা এড়াতে)

async function connectMongo() {
  if (!MONGODB_URI) return;
  const { MongoClient } = require("mongodb");
  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  mongoCol = client.db(process.env.MONGODB_DB || "ektchatter").collection("appdata");
  console.log("✅ MongoDB connected — user data is now persistent.");
}

async function readStoredData() {
  if (mongoCol) {
    const docs = await mongoCol.find({}).toArray();
    if (docs.length) {
      const raw = {};
      docs.forEach((d) => {
        try {
          raw[d._id] = JSON.parse(d.json);
          lastSavedJson[d._id] = d.json;
        } catch (e) {
          console.error("Bad stored doc for key", d._id, e.message);
        }
      });
      return raw;
    }
    console.log("MongoDB is empty — trying to seed from local app-data.json (if any).");
  }
  if (!fs.existsSync(DATA_FILE)) return null;
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

async function loadData() {
  const raw = await readStoredData();
  if (!raw) return;
  users = raw.users || {};
  // আগে সেভ হওয়া পুরোনো প্লেইন-টেক্সট পাসওয়ার্ডগুলো একবার হ্যাশে বদলে ফেলা
  let migrated = 0;
  Object.keys(users).forEach((p) => {
    const u = users[p];
    if (u && typeof u.password === "string" && u.password && !isHashedPassword(u.password)) {
      u.password = hashPassword(u.password);
      migrated++;
    }
  });
  if (migrated) { console.log("Password hashed for " + migrated + " existing users."); setTimeout(saveData, 0); }
  friendships = arraysToSets(raw.friendships);
  friendRequests = arraysToSets(raw.friendRequests);
  blockedUsers = arraysToSets(raw.blockedUsers);
  directMessages = raw.directMessages || {};
  roomMessages = raw.roomMessages || {};
  profiles = raw.profiles || {};
  directThemes = raw.directThemes || {};
  reports = raw.reports || [];
  stories = raw.stories || [];
  bannedUsers = raw.bannedUsers || {};
  deletedHashes = raw.deletedIds || {};
  phoneAliases = raw.phoneAliases || {};
  shortsData = raw.shortsData || {};
  maintenance = raw.maintenance || (/^(1|on|true|yes)$/i.test(String(process.env.MAINTENANCE || "")) ? { on: true, msg: String(process.env.MAINTENANCE_MSG || ""), until: 0, by: "env" } : maintenance);
  shortsPrefs = raw.shortsPrefs || {};
  try { rebuildPidMap(); setTimeout(saveData, 0); } catch (e) { console.warn("pid init:", e.message); }
  console.log("Saved data loaded successfully.");
  try {
    const postCount = Object.keys(profiles).reduce((n, p) => n + (((profiles[p] || {}).posts) || []).length, 0);
    const itemCount = Object.keys(profiles).reduce((n, p) => n + (((profiles[p] || {}).items) || []).length, 0);
    console.log(`📊 Loaded: users=${Object.keys(users).length}, profiles=${Object.keys(profiles).length}, posts=${postCount}, photos=${itemCount}, stories=${stories.length}`);
  } catch (e) {}
}

function buildPayload() {
  return {
    users,
    friendships: setsToArrays(friendships),
    friendRequests: setsToArrays(friendRequests),
    blockedUsers: setsToArrays(blockedUsers),
    directMessages: trimMessages(directMessages),
    roomMessages: trimMessages(roomMessages),
    profiles,
    directThemes,
    stories,
    reports: reports.slice(-300), // সর্বশেষ ৩০০টা রিপোর্ট রাখা হয়
    bannedUsers,
    deletedIds: deletedHashes,
    phoneAliases,
    shortsData,
    shortsPrefs,
    maintenance,
  };
}

async function persistPayload() {
  const payload = buildPayload();
  if (mongoCol) {
    const ops = [];
    const pending = {};
    for (const key of Object.keys(payload)) {
      const json = JSON.stringify(payload[key]);
      if (lastSavedJson[key] === json) continue;
      pending[key] = json;
      ops.push({
        replaceOne: {
          filter: { _id: key },
          replacement: { json, updated: new Date() },
          upsert: true,
        },
      });
    }
    if (ops.length) {
      await mongoCol.bulkWrite(ops);
      Object.assign(lastSavedJson, pending);
      console.log("💾 Saved to MongoDB:", Object.keys(pending).join(", "));
    }
    return;
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(payload));
}

// একসাথে দুটো সেভ যেন ওভারল্যাপ না করে — লাইন ধরে একটার পর একটা চলবে
let saveChain = Promise.resolve();
function enqueueSave() {
  saveChain = saveChain
    .then(persistPayload)
    .catch((e) => console.error("Could not save data:", e.message));
  return saveChain;
}

let saveTimer = null;
function saveData() {
  // বারবার ডিস্কে/ডাটাবেসে লেখা এড়াতে অল্প সময় অপেক্ষা করে একসাথে সেভ করা হয়
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    enqueueSave();
  }, 1500);
}

try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (e) {
  console.error("Could not prepare DATA_DIR:", e.message);
}
console.log(
  MONGODB_URI
    ? "Using MongoDB for persistent storage."
    : process.env.DATA_DIR
    ? `Using persistent DATA_DIR: ${DATA_DIR} (user data will survive redeploys)`
    : `⚠️ No DATA_DIR set — using ephemeral local folder for app-data.json. ` +
      `User accounts WILL be lost on redeploy/restart unless you add a Render ` +
      `Persistent Disk and set the DATA_DIR env var to its mount path.`
);

// সার্ভার বন্ধ হওয়ার আগে শেষবার সেভ করা
["SIGINT", "SIGTERM"].forEach((sig) => {
  process.on(sig, async () => {
    setTimeout(() => process.exit(0), 8000).unref(); // আটকে গেলে জোর করে বন্ধ
    try {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      await enqueueSave();
    } catch (e) {}
    process.exit(0);
  });
});

function ensureSet(obj, key) {
  if (!obj[key]) obj[key] = new Set();
  return obj[key];
}

function directKey(phoneA, phoneB) {
  return [phoneA, phoneB].sort().join("|");
}

function publicUser(phone) {
  const u = users[phone];
  if (!u) return { phone, name: "Unknown", pic: "https://via.placeholder.com/100" };
  return { name: u.name, phone: u.phone, pic: u.pic };
}

function getFriendPayload(phone) {
  return {
    requests: Array.from(ensureSet(friendRequests, phone)).map(publicUser),
    friends: Array.from(ensureSet(friendships, phone)).map(publicUser),
  };
}

function sendFriendData(phone) {
  const socketId = phoneToSocket[phone];
  if (!socketId) return;
  sendTo(socketId, "friend-list-updated", getFriendPayload(phone));
}

function broadcastRoomMembers(roomCode) {
  const membersMap = roomMembers[roomCode];
  const members = membersMap
    ? Array.from(membersMap.values()).map((m) => ({
        name: m.user.name,
        phone: m.user.phone,
        pic: m.user.pic,
      }))
    : [];
  emitRoom(roomCode, "room-members-update", members);
}

// ---------- YouTube Shorts ফিড ----------
// ভিডিও আমাদের সার্ভারে আসে না — শুধু ভিডিও আইডি + টাইটেল মনে রাখা হয় (কয়েক বাইট)। ভিডিও চলে সরাসরি
// YouTube-এর প্লেয়ার থেকে। YOUTUBE_API_KEY Render-এর Environment-এ সেট করতে হয়।
// খরচ: প্রতি রিফ্রেশে ৪টা সার্চ (৪০০ কোটা) — ছয় ঘণ্টায় একবার, তাই দিনের ১০,০০০ কোটার অনেক নিচে থাকে।
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || "";
// টপিক লেখার নিয়ম: "ভাষা:সার্চ-লেখা" (bn = বাংলা, hi = হিন্দি, en = ইংরেজি)। ভাষা না দিলে সব ভাষা।
// Render-এ SHORTS_TOPICS দিলে কমা দিয়ে আলাদা করে নিজের টপিক বসানো যায়।
const SHORTS_TOPICS = (process.env.SHORTS_TOPICS
  ? process.env.SHORTS_TOPICS.split(",").map((x) => x.trim()).filter(Boolean)
  : [
    // টপিকের নিয়ম: bn:/hi: = বাংলা/হিন্দি · x: = বিদেশি (চীন/কোরিয়া ইত্যাদি) — গান/ইমোশন/অ্যাকশন · a: = অ্যানিমে (যেকোনো ভাষা) · বিনা প্রিফিক্স = বাংলা/হিন্দি/উর্দু অডিও বা গানের ভিডিও
    // বাংলাদেশের টিকটক-ধাঁচের ভিডিও
    "bn:bangladeshi tiktok viral shorts", "bn:bangla tiktok video shorts", "bn:bd tiktok trending shorts", "bn:bangla tiktok funny shorts",
    // বাংলাদেশের কমেডিয়ান / কমেডি
    "bn:bangla comedy shorts", "bn:bangladeshi comedian funny shorts", "bn:bangla funny video shorts", "bn:bangla natok funny shorts", "bn:বাংলা ফানি ভিডিও", "bn:bangla funny dubbing shorts",
    // গানে টিকটক / নাচ (মেয়েদের)
    "bn:bangla song tiktok dance shorts", "bn:bangladeshi girl dance song tiktok shorts", "bn:bangla lip sync song shorts", "bn:bangla viral dance shorts", "viral tiktok dance song shorts", "bollywood song dance shorts",
    // নতুন ভাইরাল টিকটক (ইউটিউবে)
    "viral tiktok trend shorts", "new viral tiktok shorts", "hi:viral reels hindi shorts", "bn:new viral bangla shorts",
    // ওমর
    "bn:omor on fire shorts", "bn:omor funny shorts",
    // কাপল / প্রেম
    "bn:bangla romantic couple video shorts", "bn:bangladeshi romantic couple shorts", "bn:bangla couple romantic song shorts", "hi:romantic couple video shorts", "hi:romantic couple song status shorts", "x:chinese romantic couple shorts", "x:korean romantic couple shorts", "romantic couple shorts", "bn:bangla couple video shorts", "bn:bangladeshi couple cute shorts", "bn:bangla love story shorts", "bn:bangla romantic song status shorts", "hi:couple goals shorts", "hi:love song status shorts",
    // স্যাড / ইমোশনাল / শায়ারি
    "bn:bangla sad status shorts", "bn:bangla sad song status shorts", "bn:bangla emotional status shorts", "bn:bangla shayari status shorts",
    "hi:sad shayari shorts", "hi:love shayari status shorts", "hi:shayari shorts", "hi:sad song status shorts", "hi:jealousy love song status shorts", "hi:emotional status shorts",
    // হালকা মজা / গেমিং (বাংলা-হিন্দি)
    "hi:hindi comedy shorts", "hi:funny hindi video shorts", "hi:desi comedy shorts", "bn:bangla gaming shorts", "hi:free fire hindi shorts", "hi:gta funny hindi shorts",
    // বিদেশি (চীন/কোরিয়া ইত্যাদি) — একই ধরনের টপিক: গান, ভালোবাসা, ইমোশন, কাপল, অ্যাকশন
    "x:chinese sad love song shorts", "x:chinese jealousy love song shorts", "x:mandarin emotional song edit shorts", "x:chinese drama couple shorts", "x:chinese drama fight scene shorts", "x:chinese drama action edit shorts",
    "x:korean drama couple shorts", "x:korean sad love song shorts", "x:kdrama emotional edit shorts", "x:korean girl dance song shorts", "x:chinese girl dance song shorts",
    // অ্যানিমে — অ্যাকশন, ইমোশন, লাভ, স্যাড
    "a:anime action edit shorts", "a:anime sad edit shorts", "a:anime love edit shorts", "a:anime emotional amv shorts", "a:anime fight scene shorts", "a:anime couple edit shorts",
  ]);
console.log(YOUTUBE_API_KEY ? "▶️ YOUTUBE_API_KEY পাওয়া গেছে — Shorts চালু" : "⚠️ YOUTUBE_API_KEY সেট করা নেই — Shorts বন্ধ");
let shortsPool = [];       // { id, title, channel }
let shortsAt = 0;          // শেষ সফল রিফ্রেশ
let shortsFailAt = 0;      // শেষ ব্যর্থ চেষ্টা (বারবার চেষ্টা ঠেকাতে)
let shortsErr = "";
let shortsBusy = null;     // চলতে থাকা রিফ্রেশের Promise

function isoSecs(d) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d || "");
  if (!m) return 0;
  return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
}
async function ytJson(url) {
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || "YouTube API status " + r.status);
  return j;
}
// ---------- ভাষা ফিল্টার: বিদেশি কথা-বলা ভিডিও বাদ; গান/ভিজ্যুয়াল হলে বিদেশিও চলবে ----------
const OK_LANGS = new Set(["bn", "hi", "ur", "ne", "as", "or", "pa", "gu", "mr", "ta", "te", "kn", "ml", "si", "sa", "bho", "mai"]);
const SA_SCRIPT = /[\u0980-\u09FF\u0900-\u097F\u0600-\u06FF\u0A00-\u0A7F\u0B80-\u0BFF]/; // বাংলা/দেবনাগরী/আরবি-উর্দু/গুরমুখী/তামিল
function shortLangOk(base, sn) {
  sn = sn || {};
  const lang = String(sn.defaultAudioLanguage || sn.defaultLanguage || "").toLowerCase().split("-")[0];
  const music = String(sn.categoryId || "") === "10";
  const text = (base.title || "") + " " + (base.channel || "");
  if (base.foreignOk === "any") return true;   // a: অ্যানিমে — যেকোনো ভাষা
  if (base.foreignOk) return music || !lang || !["en", "ja", "es", "fr", "de", "pt", "ru", "id", "th", "vi", "tr"].includes(lang); // x: টপিক — চীন/কোরিয়ান ইত্যাদি চলবে; ইংরেজি-জাপানি ইত্যাদি কথা নয়
  if (lang && OK_LANGS.has(lang)) return true;
  if (music) return true;                       // গানের ভিডিও — ভাষা যাই হোক, কথা নয়
  if (lang) return false;                       // অন্য ভাষার কথা-বলা ভিডিও
  if (SA_SCRIPT.test(text)) return true;        // ভাষা লেখা নেই কিন্তু বাংলা/হিন্দি হরফে লেখা
  return base.tl === "bn" || base.tl === "hi" || base.tl === "ur"; // বাংলা/হিন্দি সার্চে পাওয়া, ভাষা অজানা
}
function refreshShorts(extraTopics) {
  if (!YOUTUBE_API_KEY) return Promise.resolve();
  if (shortsBusy) return shortsBusy;
  if (Date.now() - shortsFailAt < 10 * 60 * 1000) return Promise.resolve();
  shortsBusy = (async () => {
    try {
      // প্রতিবার ৪টা আলাদা টপিক — সব ধরন ঘুরে ঘুরে মিশবে
      // কারো পছন্দের টপিক থাকলে (সর্বোচ্চ ২টা) সেগুলো আগে, বাকিটা এলোমেলো
      const extra = Array.isArray(extraTopics) ? extraTopics.slice(0, 2) : [];
      const picks = extra.concat(SHORTS_TOPICS.slice().sort(() => Math.random() - 0.5)).slice(0, 4);
      const found = new Map();
      for (const topic of picks) {
        const lm = /^(bn|hi|en|ur|ar|x|a):(.*)$/.exec(topic);
        const lang = lm && lm[1] !== "x" && lm[1] !== "a" ? lm[1] : "";
        const foreignOk = lm && lm[1] === "a" ? "any" : (lm && lm[1] === "x" ? "yes" : "");
        const q = lm ? lm[2].trim() : topic;
        const u = new URL("https://www.googleapis.com/youtube/v3/search");
        u.searchParams.set("part", "snippet");
        u.searchParams.set("type", "video");
        u.searchParams.set("videoDuration", "short");
        u.searchParams.set("videoEmbeddable", "true");
        u.searchParams.set("safeSearch", "moderate");
        u.searchParams.set("maxResults", "50");
        if (lang) u.searchParams.set("relevanceLanguage", lang);
        u.searchParams.set("order", ["relevance", "viewCount", "date"][Math.floor(Math.random() * 3)]);
        u.searchParams.set("q", q);
        u.searchParams.set("key", YOUTUBE_API_KEY);
        const j = await ytJson(u);
        (j.items || []).forEach((it) => {
          const id = it && it.id && it.id.videoId;
          if (id && /^[\w-]{11}$/.test(id) && !found.has(id)) {
            found.set(id, { id, title: String((it.snippet && it.snippet.title) || "").slice(0, 150), channel: String((it.snippet && it.snippet.channelTitle) || "").slice(0, 60), foreignOk, tl: lang });
          }
        });
      }
      // আসল শর্টস কি না (৬৫ সেকেন্ডের মধ্যে), embed চলে কি না, পাবলিক কি না — এক কোটায় যাচাই
      const ids = Array.from(found.keys());
      const good = [];
      for (let i = 0; i < ids.length; i += 50) {
        const u = new URL("https://www.googleapis.com/youtube/v3/videos");
        u.searchParams.set("part", "contentDetails,status,snippet");
        u.searchParams.set("id", ids.slice(i, i + 50).join(","));
        u.searchParams.set("key", YOUTUBE_API_KEY);
        const j = await ytJson(u);
        (j.items || []).forEach((v) => {
          const secs = isoSecs(v.contentDetails && v.contentDetails.duration);
          if (!(v.status && v.status.embeddable && v.status.privacyStatus === "public" && secs > 0 && secs <= 65)) return;
          const base = found.get(v.id);
          if (!base || !shortLangOk(base, v.snippet)) return; // ইংরেজি/জাপানি/চাইনিজ ইত্যাদি কথাবলা ভিডিও বাদ
          good.push({ id: base.id, title: base.title, channel: base.channel, d: secs });
        });
      }
      const have = new Set(shortsPool.map((x) => x.id));
      shortsPool = good.filter((x) => x && !have.has(x.id)).concat(shortsPool).slice(0, 500);
      shortsAt = Date.now();
      shortsErr = "";
      console.log("✅ YouTube Shorts রিফ্রেশ সফল: নতুন " + good.length + "টা, মোট পুল " + shortsPool.length + "টা");
    } catch (e) {
      shortsFailAt = Date.now();
      shortsErr = String((e && e.message) || e).slice(0, 200);
      console.warn("⚠️ YouTube Shorts রিফ্রেশ ব্যর্থ:", shortsErr);
    } finally {
      shortsBusy = null;
    }
  })();
  return shortsBusy;
}

// ---------- Shorts: পছন্দ শেখা (লাইক/কমেন্ট/বেশি দেখা) ----------
const SHORT_STOP = new Set(["shorts", "short", "video", "videos", "viral", "new", "best", "the", "and", "for", "with", "you", "your", "this", "that", "from", "are", "not", "youtube", "ytshorts", "subscribe", "like", "comment", "share", "official", "full", "part", "reels", "trending"]);
function shortWords(title) {
  const out = new Set();
  String(title || "").toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).forEach((w) => {
    if (w.length >= 3 && w.length <= 24 && !SHORT_STOP.has(w) && !/^\d+$/.test(w)) out.add(w);
  });
  return Array.from(out).slice(0, 12);
}
function pruneMap(m, keep) {
  const ks = Object.keys(m);
  if (ks.length <= keep * 1.5) return;
  ks.sort((a, b) => Math.abs(m[b]) - Math.abs(m[a])).slice(keep).forEach((k) => { delete m[k]; });
}
function bumpShortPref(phone, title, channel, w) {
  if (!phone || !users[phone]) return;
  const p = shortsPrefs[phone] || (shortsPrefs[phone] = { w: {}, ch: {} });
  const clamp = (v) => Math.round(Math.max(-12, Math.min(40, v)) * 100) / 100;
  shortWords(title).forEach((x) => { p.w[x] = clamp((p.w[x] || 0) + w); if (!p.w[x]) delete p.w[x]; });
  const c = String(channel || "").slice(0, 60);
  if (c) { p.ch[c] = clamp((p.ch[c] || 0) + w); if (!p.ch[c]) delete p.ch[c]; }
  pruneMap(p.w, 80);
  pruneMap(p.ch, 30);
  saveData();
}
function shortScore(p, v) {
  if (!p) return 0;
  let sc = 0;
  shortWords(v.title).forEach((x) => { sc += p.w[x] || 0; });
  sc += (p.ch[v.channel] || 0) * 1.5;
  return sc;
}
function topShortWords(p, n) {
  if (!p) return [];
  return Object.keys(p.w).filter((k) => p.w[k] >= 3).sort((a, b) => p.w[b] - p.w[a]).slice(0, n);
}
// কারো পছন্দের টপিক ধরে YouTube-এ নতুন সার্চ: প্রতিটা শব্দ ৩ ঘণ্টায় একবার, আর দিনে সর্বোচ্চ ৬ বার (কোটা বাঁচাতে)
const interestFetchedAt = {};
const interestBudget = { day: "", n: 0 };
function interestTopicsFor(p) {
  const today = new Date().toISOString().slice(0, 10);
  if (interestBudget.day !== today) { interestBudget.day = today; interestBudget.n = 0; }
  if (interestBudget.n >= 6) return [];
  const out = topShortWords(p, 2).filter((t) => Date.now() - (interestFetchedAt[t] || 0) > 3 * 60 * 60 * 1000);
  if (!out.length) return [];
  out.forEach((t) => { interestFetchedAt[t] = Date.now(); });
  interestBudget.n++;
  return out.map((t) => t + " shorts");
}
const YT_ID_OK = /^[\w-]{11}$/;
function shortInfo(id, phone) {
  const d = shortsData[id];
  return { id, likes: d ? (d.likes || []).length : 0, comments: d ? (d.comments || []).length : 0, my: !!(d && phone && (d.likes || []).includes(phone)) };
}
function shortEntry(id, title, channel) {
  const d = shortsData[id] || (shortsData[id] = { t: "", c: "", likes: [], comments: [] });
  if (title && !d.t) d.t = String(title).slice(0, 150);
  if (channel && !d.c) d.c = String(channel).slice(0, 60);
  return d;
}
function shortCleanup(id) {
  const d = shortsData[id];
  if (d && !(d.likes || []).length && !(d.comments || []).length) delete shortsData[id];
}

io.on("connection", (socket) => {
  socket._bypass = hasBypass(socket.handshake && socket.handshake.headers && socket.handshake.headers.cookie);
  if (maintenanceActive() && !socket._bypass) socket.emit("maintenance", maintStatus());
  socket.use((packet, next) => {
    const ev = String(packet[0] || "");
    const cb = packet[packet.length - 1];
    // অ্যাডমিন-ইভেন্ট: ADMIN_PHONES সেট থাকলে শুধু ওই অ্যাকাউন্ট থেকেই চলবে
    if (ev.indexOf("admin-") === 0 && !isAdminAccount(socket)) {
      if (typeof cb === "function") { try { cb({ success: false, error: "not_admin" }); } catch (e) {} }
      return;
    }
    // মেইনটেনেন্সে সাধারণ ইউজারের সব ইভেন্ট আটকানো; অ্যাডমিন-ইভেন্ট ও বাইপাস করা অ্যাডমিন চলবে
    if (!maintenanceActive() || socket._bypass || adminSockets.has(socket.id) || ev.indexOf("admin-") === 0) return next();
    if (typeof cb === "function") { try { cb({ success: false, maintenance: true, error: "maintenance" }); } catch (e) {} }
    socket.emit("maintenance", maintStatus());
  });
  // প্রতিটা ইভেন্টে: ইনকামিং pid → আসল ফোন, আর ack/callback-এর উত্তর থেকে অন্যের নম্বর-ইমেইল সরানো
  socket.use((packet, next) => {
    try {
      const ev = String(packet[0] || "");
      const first = packet[1];
      const adminCall = ev.indexOf("admin-") === 0 && first && typeof first === "object" && first.password === ADMIN_PASSWORD;
      for (let i = 1; i < packet.length; i++) {
        if (typeof packet[i] === "function") {
          const cb = packet[i];
          packet[i] = (...a) => cb(...a.map((x) => outboundFor(socket.id, x, adminCall)));
        } else {
          packet[i] = unscrubIn(packet[i], 0);
        }
      }
    } catch (e) { console.warn("privacy middleware:", e.message); }
    next();
  });

  // ---------- USER / SESSION ----------
  socket.on("set-user-socket", ({ phone, deviceId }) => {
    if (!phone) return;
    // অন্য ডিভাইস থেকে লগআউট করে দেওয়া ডিভাইস আবার ঢুকতে চাইলে বের করে দেওয়া
    if (isRevokedDevice(phone, deviceId)) { socket.emit("force-logout"); return; }
    bindDeviceSocket(socket, phone, deviceId);
    socketToPhone[socket.id] = phone;
    setSelf(socket, phone);
    phoneToSocket[phone] = socket.id;
    touchDevice(phone, deviceId);
  });

  socket.on("register-user", (newUser, callback) => {
    const reply = (r) => { if (typeof callback === "function") callback(r); };
    if (newUser && newUser.phone) {
      if (bannedUsers[newUser.phone]) return reply({ success: false, banned: true });
      if (newUser.fresh) {
        // নতুন সাইনআপ: আগে থেকে থাকা নম্বর/ইমেইলে সাইনআপ করা যাবে না
        const key = String(newUser.phone).trim();
        if ((users[key] && users[key].password) || altTaken(key, key)) return reply({ success: false, error: "exists" });
        const em = normalizeEmail(newUser.email);
        if (newUser.email && !em) return reply({ success: false, error: "bad_email" });
        if (em && emailTaken(em, key)) return reply({ success: false, error: "email_taken" });
        // একই নম্বর দিয়ে নতুন করে সাইনআপ করলে পুরোনো ডিলিট/অ্যালিয়াস চিহ্ন সরে যায়
        delete deletedHashes[idHash(key)];
        delete phoneAliases[key];
        newUser.phone = key;
        if (em) newUser.email = em; else delete newUser.email;
        const merged = mergeClientUser(newUser);
        if (merged) { recordDevice(merged, socket, newUser.deviceId, "signup"); setSelf(socket, merged.phone); }
        saveData();
        return reply({ success: true });
      }
      if (isDeletedId(newUser.phone)) return reply({ success: false, deleted: true });
      if (phoneAliases[newUser.phone]) return reply({ success: false, renamed: true });
      mergeClientUser(newUser);
      saveData();
    }
    reply({ success: true });
  });

  socket.on("login-user", (payload, callback) => {
    if (typeof callback !== "function") return;
    const { phone: loginId, password, deviceId } = payload || {};
    const phone = (typeof loginId === "string" ? resolveLoginPhone(loginId) : null) || loginId;
    if (bannedUsers[phone]) {
      callback({
        success: false,
        banned: true,
        reason: (bannedUsers[phone] && bannedUsers[phone].reason) || "আপনার অ্যাকাউন্ট ব্যান করা হয়েছে।",
      });
      return;
    }
    const user = typeof phone === "string" ? users[phone] : null;
    if (user && verifyPassword(password, user.password)) {
      if (!isHashedPassword(user.password)) user.password = hashPassword(password);
      recordDevice(user, socket, deviceId, String(loginId).indexOf("@") > 0 ? "email" : "phone");
      setSelf(socket, user.phone);
      saveData();
      // ক্লায়েন্ট আগের মতোই পাসওয়ার্ড সহ ইউজার অবজেক্ট আশা করে (লোকাল ক্যাশের জন্য) — তাই যেটা টাইপ করা হয়েছে সেটাই ফেরত যায়
      callback({ success: true, user: selfUserPayload(user, password) });
    } else {
      callback({ success: false });
    }
  });

  // ---------- সেটিংস: পাসওয়ার্ড / ইমেইল / নম্বর / লগইন হিস্ট্রি ----------
  socket.on("change-password", ({ phone, oldPassword, newPassword }, callback) => {
    const reply = (r) => { if (typeof callback === "function") callback(r); };
    const u = typeof phone === "string" ? users[phone] : null;
    if (!u || !verifyPassword(oldPassword, u.password)) return reply({ success: false, error: "wrong_password" });
    const np = String(newPassword || "").trim();
    if (np.length < 6) return reply({ success: false, error: "too_short" });
    if (np === String(oldPassword)) return reply({ success: false, error: "same" });
    u.password = hashPassword(np);
    saveData();
    reply({ success: true });
  });

  socket.on("get-login-history", ({ phone, deviceId }, callback) => {
    if (typeof callback !== "function") return;
    const u = typeof phone === "string" ? users[phone] : null;
    if (!u || socketToPhone[socket.id] !== phone) return callback({ success: false });
    const did = String(deviceId || "").slice(0, 64);
    const list = (u.loginHistory || []).map((e) => ({
      ref: devRef(e.deviceId), device: e.device, ip: e.ip, method: e.method,
      lastLogin: e.lastLogin, lastSeen: e.lastSeen, firstLogin: e.firstLogin,
      current: !!did && e.deviceId === did,
    }));
    callback({ success: true, list });
  });

  socket.on("change-email", ({ phone, password, email }, callback) => {
    const reply = (r) => { if (typeof callback === "function") callback(r); };
    const u = typeof phone === "string" ? users[phone] : null;
    if (!u || !verifyPassword(password, u.password)) return reply({ success: false, error: "wrong_password" });
    const em = normalizeEmail(email);
    if (!em) return reply({ success: false, error: "bad_email" });
    if (emailTaken(em, phone)) return reply({ success: false, error: "email_taken" });
    if (isDeletedId(em) && !users[em]) delete deletedHashes[idHash(em)];
    const oldKey = u.phone;
    // শুধু ইমেইল দিয়ে খোলা অ্যাকাউন্টে ইমেইলই ছিল লগইন-আইডি — তাই নতুন ইমেইলেই আইডি বদলায়
    if (u.email && u.email === oldKey && em !== oldKey) {
      renamePhoneEverywhere(oldKey, em);
      users[em].email = em;
      saveData();
      Array.from(ensureSet(friendships, em)).forEach((fp) => sendFriendData(fp));
      return reply({ success: true, email: em, phone: em, renamed: true });
    }
    u.email = em;
    saveData();
    reply({ success: true, email: em, phone: oldKey });
  });

  socket.on("change-phone", ({ phone, password, newPhone }, callback) => {
    const reply = (r) => { if (typeof callback === "function") callback(r); };
    const u = typeof phone === "string" ? users[phone] : null;
    if (!u || !verifyPassword(password, u.password)) return reply({ success: false, error: "wrong_password" });
    const np = normalizePhoneInput(newPhone);
    if (!np) return reply({ success: false, error: "bad_phone" });
    if (np === phone) return reply({ success: false, error: "same" });
    if (u.altNum && np === u.altNum) return reply({ success: false, error: "dup_own" });
    if (users[np] || bannedUsers[np] || altTaken(np, phone)) return reply({ success: false, error: "phone_taken" });
    renamePhoneEverywhere(phone, np);
    saveData();
    setSelf(socket, np);
    socket.emit("account-phone-changed", { phone: np });
    Array.from(ensureSet(friendships, np)).forEach((fp) => sendFriendData(fp));
    reply({ success: true, phone: np, user: selfUserPayload(users[np], password) });
  });

  // ---------- সেটিংস: পার্সোনাল ডিটেইলস (পাসওয়ার্ড যাচাই, দ্বিতীয় নম্বর, নম্বর/ইমেইল রিমুভ) ----------
  // ভুল পাসওয়ার্ড বারবার দিলে এই সকেটে কিছুক্ষণ আটকে দেওয়া হয় (পাসওয়ার্ড আন্দাজ ঠেকাতে)
  let pwFails = 0, pwBlockedUntil = 0;
  const pwGate = (u, password) => {
    const now = Date.now();
    if (now < pwBlockedUntil) return "too_many";
    if (u && verifyPassword(password, u.password)) { pwFails = 0; return ""; }
    pwFails++;
    if (pwFails >= 6) { pwBlockedUntil = now + 60 * 1000; pwFails = 0; return "too_many"; }
    return "wrong_password";
  };
  const contactInfo = (u) => ({
    phone: EMAIL_KEY_ONLY(u) ? "" : u.phone,
    altNum: u.altNum || "",
    email: u.email || (EMAIL_KEY_ONLY(u) ? u.phone : ""),
    key: u.phone,
  });
  const EMAIL_KEY_ONLY = (u) => String(u.phone || "").indexOf("@") > 0;

  socket.on("verify-password", ({ phone, password }, callback) => {
    const reply = (r) => { if (typeof callback === "function") callback(r); };
    const u = typeof phone === "string" ? users[phone] : null;
    const bad = pwGate(u, password);
    if (bad) return reply({ success: false, error: bad });
    reply(Object.assign({ success: true }, contactInfo(u)));
  });

  socket.on("set-alt-phone", ({ phone, password, newPhone }, callback) => {
    const reply = (r) => { if (typeof callback === "function") callback(r); };
    const u = typeof phone === "string" ? users[phone] : null;
    const bad = pwGate(u, password);
    if (bad) return reply({ success: false, error: bad });
    if (EMAIL_KEY_ONLY(u)) return reply({ success: false, error: "need_primary" }); // আগে মূল নম্বর যোগ করতে হবে
    const np = normalizePhoneInput(newPhone);
    if (!np) return reply({ success: false, error: "bad_phone" });
    if (np === u.phone || np === u.altNum) return reply({ success: false, error: "dup_own" });
    if (users[np] || bannedUsers[np] || altTaken(np, u.phone)) return reply({ success: false, error: "phone_taken" });
    u.altNum = np;
    saveData();
    reply(Object.assign({ success: true }, contactInfo(u)));
  });

  // which: "primary" | "alt"
  socket.on("remove-phone", ({ phone, password, which }, callback) => {
    const reply = (r) => { if (typeof callback === "function") callback(r); };
    const u = typeof phone === "string" ? users[phone] : null;
    const bad = pwGate(u, password);
    if (bad) return reply({ success: false, error: bad });
    if (which === "alt") {
      if (!u.altNum) return reply({ success: false, error: "not_found" });
      delete u.altNum;
      saveData();
      return reply(Object.assign({ success: true }, contactInfo(u)));
    }
    if (EMAIL_KEY_ONLY(u)) return reply({ success: false, error: "not_found" });
    // মূল নম্বর সরালে: দ্বিতীয় নম্বর থাকলে সেটাই মূল হয়, না থাকলে ইমেইল থাকতে হবে
    let nextKey = "";
    if (u.altNum) nextKey = u.altNum;
    else if (u.email) nextKey = u.email;
    else return reply({ success: false, error: "last_id" });
    if (users[nextKey] && nextKey !== u.altNum) return reply({ success: false, error: "phone_taken" });
    const oldKey = u.phone;
    if (nextKey === u.altNum) delete u.altNum;
    renamePhoneEverywhere(oldKey, nextKey);
    saveData();
    setSelf(socket, nextKey);
    socket.emit("account-phone-changed", { phone: nextKey });
    Array.from(ensureSet(friendships, nextKey)).forEach((fp) => sendFriendData(fp));
    reply(Object.assign({ success: true, renamed: true, newKey: nextKey }, contactInfo(users[nextKey]), { user: selfUserPayload(users[nextKey], password) }));
  });

  socket.on("remove-email", ({ phone, password }, callback) => {
    const reply = (r) => { if (typeof callback === "function") callback(r); };
    const u = typeof phone === "string" ? users[phone] : null;
    const bad = pwGate(u, password);
    if (bad) return reply({ success: false, error: bad });
    if (EMAIL_KEY_ONLY(u)) return reply({ success: false, error: "last_id" }); // ইমেইলই লগইন-আইডি
    if (!u.email) return reply({ success: false, error: "not_found" });
    delete u.email;
    saveData();
    reply(Object.assign({ success: true }, contactInfo(u)));
  });

  // অন্য ডিভাইস থেকে লগআউট: পাসওয়ার্ড লাগে। ওই ডিভাইস অনলাইনে থাকলে সাথে সাথে বের হয়ে যায়,
  // অফলাইনে থাকলে পরের বার অ্যাপ খুললেই বের হবে (আবার লগইন করলে ঠিক হয়ে যায়)।
  socket.on("logout-device", ({ phone, password, ref }, callback) => {
    const reply = (r) => { if (typeof callback === "function") callback(r); };
    const u = typeof phone === "string" ? users[phone] : null;
    const bad = pwGate(u, password);
    if (bad) return reply({ success: false, error: bad });
    const e = (u.loginHistory || []).find((x) => x && devRef(x.deviceId) === String(ref || ""));
    if (!e) return reply({ success: false, error: "not_found" });
    const did = e.deviceId;
    u.loginHistory = u.loginHistory.filter((x) => x !== e);
    if (!u.revoked) u.revoked = {};
    u.revoked[did] = Date.now();
    const keys = Object.keys(u.revoked);
    if (keys.length > 50) keys.sort((a, b) => u.revoked[a] - u.revoked[b]).slice(0, keys.length - 50).forEach((k) => delete u.revoked[k]);
    saveData();
    const set = deviceSockets[devKey(u.phone, did)];
    if (set) Array.from(set).forEach((sid) => { io.to(sid).emit("force-logout"); if (phoneToSocket[u.phone] === sid) delete phoneToSocket[u.phone]; });
    reply({ success: true });
  });

  // নিজের এই ডিভাইস থেকে লগআউট করলে তালিকা থেকে এই ডিভাইসটা সরানো (নিজের সকেট থেকেই আসতে হবে)
  socket.on("device-signout", ({ phone, deviceId }, callback) => {
    const reply = (r) => { if (typeof callback === "function") callback(r); };
    const u = typeof phone === "string" ? users[phone] : null;
    const did = String(deviceId || "").slice(0, 64);
    if (!u || !did || socketDevice[socket.id] !== devKey(u.phone, did)) return reply({ success: false });
    u.loginHistory = (u.loginHistory || []).filter((x) => x && x.deviceId !== did);
    saveData();
    reply({ success: true });
  });

  // ---------- YouTube Shorts: সামনের কয়েকটা ভিডিও (আগে দেখা আইডি বাদ দিয়ে) ----------
  socket.on("get-shorts", async (data, callback) => {
    const reply = (r) => { if (typeof callback === "function") callback(r); };
    if (!YOUTUBE_API_KEY) return reply({ success: false, error: "no_key" });
    const seen = new Set(Array.isArray(data && data.seen) ? data.seen.slice(-300).map(String) : []);
    const ph = String((data && data.phone) || "");
    const pref = users[ph] ? shortsPrefs[ph] : null;
    const stale = Date.now() - shortsAt > 6 * 60 * 60 * 1000;
    let fresh = shortsPool.filter((v) => !seen.has(v.id));
    const mine = pref ? interestTopicsFor(pref) : [];
    if (!shortsPool.length || !fresh.length) await refreshShorts(mine);
    else if (stale || fresh.length < 12 || mine.length) refreshShorts(mine); // পেছনে চলবে, অপেক্ষা করাবে না
    fresh = shortsPool.filter((v) => !seen.has(v.id));
    if (!shortsPool.length) return reply({ success: false, error: shortsErr ? "api_error" : "empty", detail: shortsErr });
    const list = fresh.length ? fresh : shortsPool; // সব দেখা হয়ে গেলে আবার শুরু
    // পছন্দের সাথে মিললে আগে আসবে, তবে কিছুটা এলোমেলোও থাকবে যেন একঘেয়ে না হয়
    const out = list
      .map((v) => ({ v, k: Math.max(-12, Math.min(shortScore(pref, v), 12)) + Math.random() * 6 }))
      .sort((x, y) => y.k - x.k)
      .slice(0, 12)
      .map((x) => x.v);
    reply({ success: true, shorts: out });
  });

  // ---------- Shorts: লাইক / কমেন্ট / পছন্দ ----------
  socket.on("short-state", ({ ids, phone }, callback) => {
    if (typeof callback !== "function") return;
    const list = (Array.isArray(ids) ? ids : []).slice(0, 40).filter((id) => YT_ID_OK.test(String(id))).map((id) => shortInfo(String(id), String(phone || "")));
    callback({ success: true, list });
  });

  socket.on("short-like", ({ id, phone, like, title, channel }, callback) => {
    const reply = (r) => { if (typeof callback === "function") callback(r); };
    id = String(id || ""); phone = String(phone || "");
    if (!YT_ID_OK.test(id) || !users[phone] || bannedUsers[phone]) return reply({ success: false });
    const d = shortEntry(id, title, channel);
    const has = d.likes.includes(phone);
    const want = like !== false;
    if (want && !has) { d.likes.push(phone); bumpShortPref(phone, title || d.t, channel || d.c, 3); }
    else if (!want && has) { d.likes = d.likes.filter((x) => x !== phone); bumpShortPref(phone, title || d.t, channel || d.c, -3); }
    shortCleanup(id);
    saveData();
    reply(Object.assign({ success: true }, shortInfo(id, phone)));
  });

  socket.on("short-comments", ({ id }, callback) => {
    if (typeof callback !== "function") return;
    id = String(id || "");
    if (!YT_ID_OK.test(id)) return callback({ success: false });
    const d = shortsData[id];
    callback({ success: true, comments: d ? (d.comments || []).filter((c) => !bannedUsers[c.authorPhone]).slice(-100) : [] });
  });

  socket.on("short-comment", ({ id, phone, text, title, channel }, callback) => {
    const reply = (r) => { if (typeof callback === "function") callback(r); };
    id = String(id || ""); phone = String(phone || "");
    const clean = String(text || "").trim().slice(0, 500);
    if (!YT_ID_OK.test(id) || !users[phone] || bannedUsers[phone] || !clean) return reply({ success: false });
    const d = shortEntry(id, title, channel);
    const u = users[phone];
    const c = { id: "cm_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), authorPhone: phone, authorName: u.name, authorPic: u.pic, text: clean, timestamp: Date.now() };
    d.comments.push(c);
    if (d.comments.length > 300) d.comments = d.comments.slice(-300);
    bumpShortPref(phone, title || d.t, channel || d.c, 2);
    saveData();
    reply({ success: true, comment: c, count: d.comments.length });
  });

  socket.on("short-comment-delete", ({ id, commentId, phone }, callback) => {
    const reply = (r) => { if (typeof callback === "function") callback(r); };
    id = String(id || ""); phone = String(phone || "");
    const d = shortsData[id];
    if (!d || !users[phone]) return reply({ success: false });
    const i = d.comments.findIndex((c) => c && c.id === commentId && c.authorPhone === phone); // শুধু নিজের কমেন্ট
    if (i < 0) return reply({ success: false });
    d.comments.splice(i, 1);
    const count = d.comments.length;
    shortCleanup(id);
    saveData();
    reply({ success: true, count });
  });

  // কতক্ষণ দেখেছে: পুরো দেখলে/বারবার দেখলে ঐ ধরনের ভিডিও বেশি আসবে; শুরুতেই স্কিপ করলে কম আসবে
  socket.on("short-watch", ({ phone, title, channel, watched, dur, loops }) => {
    phone = String(phone || "");
    if (!users[phone] || bannedUsers[phone]) return;
    const w = Math.max(0, Math.min(Number(watched) || 0, 900));
    const d = Math.max(0, Math.min(Number(dur) || 0, 120));
    let r = d > 0 ? w / d : (w >= 8 ? 1 : 0);
    if ((Number(loops) || 0) >= 1) r = Math.max(r, 1);
    let delta = 0;
    if (r >= 0.9) delta = r >= 1.8 ? 3 : 2;     // পুরো দেখেছে (বা আবার দেখেছে)
    else if (r >= 0.6) delta = 0.5;              // বেশিরভাগ দেখেছে
    else if (r < 0.35) delta = w < 2.5 ? -2 : -1; // মাঝপথে/শুরুতেই স্কিপ
    if (delta) bumpShortPref(phone, title, channel, delta);
  });

  // কয়েক সেকেন্ড ধরে দেখলে ছোট সংকেত (লাইকের চেয়ে কম ওজন)
  socket.on("short-signal", ({ phone, title, channel }) => {
    phone = String(phone || "");
    if (!users[phone] || bannedUsers[phone]) return;
    bumpShortPref(phone, title, channel, 1);
  });

  // ---------- রিপোর্ট সিস্টেম ----------
  // যে কেউ একটা সমস্যা রিপোর্ট করলে সেটা লিস্টে যোগ হয় এবং সাথে সাথে
  // অ্যাডমিন প্যানেল খোলা থাকলে সেখানে রিয়েল-টাইমে নোটিফিকেশন যায়।
  socket.on("submit-report", ({ fromPhone, fromName, message }, callback) => {
    const text = (message || "").toString().trim();
    if (!text) {
      if (typeof callback === "function") callback({ success: false, error: "Empty report" });
      return;
    }
    const report = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      fromPhone: fromPhone || "unknown",
      fromName: fromName || "Unknown",
      message: text.slice(0, 1000),
      time: Date.now(),
      status: "pending", // pending | resolved | dismissed
    };
    reports.push(report);
    saveData();
    emitAdmins("admin-new-report", report); // অ্যাডমিন প্যানেল খোলা থাকলে সে-ই কেবল দেখাবে
    if (typeof callback === "function") callback({ success: true });
  });

  // ---------- HOME ফিড / REELS / সাজেশন ----------
  function ownerInfo(p) {
    const u = users[p] || {};
    return { ownerPhone: p, ownerName: u.name || "User", ownerPic: u.pic || "" };
  }

  // আমার + বন্ধুদের পোস্ট, নতুন আগে
  socket.on("get-feed", ({ phone }, callback) => {
    if (typeof callback !== "function") return;
    const allowed = Array.from(ensureSet(friendships, phone)).concat([phone]);
    let out = [];
    allowed.forEach((p) => {
      if (bannedUsers[p]) return;
      const posts = (profiles[p] && profiles[p].posts) || [];
      posts.forEach((post) => out.push({ ...post, reacts: reactsOf(post), ...ownerInfo(p) }));
    });
    out.sort((a, b) => b.timestamp - a.timestamp);
    if (!out.length) console.log(`get-feed: 0 posts for ${phone} (friends=${allowed.length - 1}, ownPosts=${(((profiles[phone] || {}).posts) || []).length}, userExists=${!!users[phone]})`);
    callback({ success: true, posts: out.slice(0, 40) });
  });

  // সবার Reels (কেউ আপলোড করলেই সবাই দেখবে)
  socket.on("get-reels", (payload, callback) => {
    if (typeof callback !== "function") return;
    const out = [];
    Object.keys(profiles).forEach((p) => {
      if (bannedUsers[p]) return;
      if (!canSeeContent(socket, p)) return; // বন্ধু না হলে রিলসও দেখা যাবে না
      ((profiles[p] && profiles[p].items) || []).forEach((it) => {
        if (it && it.kind === "reel" && it.src) {
          // রিলস সাধারণত একটা পোস্টের সাথে যুক্ত — রিঅ্যাকশন/কমেন্ট/শেয়ার সেই পোস্টেই জমা হয়
          const t = resolveTarget("reel", p, it.id);
          const o = t ? t.obj : it;
          out.push({ id: it.id, src: it.src, caption: it.caption || "", timestamp: it.timestamp || 0, reacts: reactsOf(o), comments: (o.comments || []).slice(-100), commentCount: (o.comments || []).length, shares: o.shares || 0, ...ownerInfo(p) });
        }
      });
    });
    out.sort((a, b) => b.timestamp - a.timestamp);
    callback({ success: true, reels: out.slice(0, 40) });
  });

  // "People you may know": যারা বন্ধু না, রিকোয়েস্টও পেন্ডিং না
  socket.on("suggest-users", ({ phone }, callback) => {
    if (typeof callback !== "function") return;
    const myFriends = ensureSet(friendships, phone);
    const list = Object.values(users)
      .filter((u) => u && u.phone && u.phone !== phone && !bannedUsers[u.phone] && !myFriends.has(u.phone)
        && !ensureSet(friendRequests, u.phone).has(phone) && !ensureSet(friendRequests, phone).has(u.phone))
      .slice(0, 12)
      .map((u) => publicUser(u.phone));
    callback(list);
  });

  // ---------- STORY (২৪ ঘণ্টা পর অটো ডিলিট) ----------
  function notifyStoryChange(phone) {
    Array.from(ensureSet(friendships, phone)).concat([phone]).forEach((p) => {
      const sid = phoneToSocket[p];
      if (sid) sendTo(sid, "stories-updated");
    });
  }

  socket.on("add-story", async ({ phone, text, bg, media, music, duration }, callback) => {
    const reply = (r) => { if (typeof callback === "function") callback(r); };
    const cleanText = String(text || "").slice(0, 300);
    if (!phone || (!cleanText && !media)) return reply({ success: false, message: "খালি স্টোরি দেওয়া যাবে না।" });
    const u = users[phone] || {};
    let mediaOut = null;
    if (media && media.src) {
      const src = String(media.src);
      if (media.type === "video") {
        if (!src.startsWith("data:video/")) return reply({ success: false, message: "ভিডিও ঠিক নেই।" });
        const remote = await uploadVideoToCloudinary(src, "story");
        if (!remote) return reply({ success: false, message: "ভিডিও আপলোড হয়নি।" });
        mediaOut = { type: "video", src: remote };
      } else {
        const resolved = src.startsWith("data:") ? await resolveImageSrc(src, "story") : { src };
        if (!resolved || !resolved.src) return reply({ success: false, message: "ছবি আপলোড হয়নি।" });
        mediaOut = { type: "image", src: resolved.src };
      }
    }
    let musicOut = null;
    if (music && music.src && !mediaOut || (music && music.src && mediaOut && mediaOut.type === "image")) {
      const msrc = String(music.src);
      if (!msrc.startsWith("data:audio/") || msrc.length > 14e6) return reply({ success: false, message: "গানের ফাইল ঠিক নেই বা অনেক বড়।" });
      const remote = await uploadVideoToCloudinary(msrc, "story-music");
      if (!remote) return reply({ success: false, message: "গান আপলোড হয়নি।" });
      musicOut = { src: remote, name: String(music.name || "music").slice(0, 80) };
    }
    const dur = Math.max(3000, Math.min(15000, parseInt(duration, 10) || 5000)); // ছবি/লেখার স্টোরি সর্বোচ্চ ১৫ সেকেন্ড
    const now = Date.now();
    const story = {
      id: "st_" + now.toString(36) + Math.random().toString(36).slice(2, 6),
      phone, name: u.name || "User", pic: u.pic || "",
      media: mediaOut, music: musicOut, duration: dur, text: cleanText, bg: String(bg || "").slice(0, 60),
      time: now, expires: now + STORY_TTL, views: [],
    };
    stories.push(story);
    saveData();
    notifyStoryChange(phone);
    reply({ success: true, story });
  });

  // আমার + বন্ধুদের চলমান স্টোরি
  socket.on("get-stories", ({ phone }, callback) => {
    if (typeof callback !== "function") return;
    purgeExpiredStories();
    const allowed = new Set(Array.from(ensureSet(friendships, phone)).concat([phone]));
    callback({ success: true, stories: stories.filter((st) => allowed.has(st.phone)) });
  });

  socket.on("view-story", ({ phone, storyId }) => {
    const st = stories.find((x) => x.id === storyId);
    if (st && phone && st.phone !== phone && !st.views.includes(phone)) { st.views.push(phone); saveData(); }
  });

  socket.on("delete-story", ({ phone, storyId }, callback) => {
    const st = stories.find((x) => x.id === storyId);
    if (st && st.phone === phone) { stories = stories.filter((x) => x.id !== storyId); saveData(); notifyStoryChange(phone); cleanupMedia(storyUrls(st)); }
    if (typeof callback === "function") callback({ success: true });
  });

  // স্টোরি রিপোর্ট → সাধারণ রিপোর্ট লিস্টেই যায় (type: "story")
  socket.on("report-story", ({ fromPhone, fromName, storyId, reason }, callback) => {
    const st = stories.find((x) => x.id === storyId);
    if (!st) { if (typeof callback === "function") callback({ success: false }); return; }
    const report = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      fromPhone: fromPhone || "unknown", fromName: fromName || "Unknown",
      message: ("Story report: " + String(reason || "অনুপযুক্ত স্টোরি")).slice(0, 300),
      type: "story", storyId: st.id, storyOwner: st.phone, storyOwnerName: st.name,
      storyPreview: st.media ? { type: st.media.type, src: st.media.src } : null,
      storyText: st.text || "",
      time: Date.now(), status: "pending",
    };
    reports.push(report);
    saveData();
    emitAdmins("admin-new-report", report);
    if (typeof callback === "function") callback({ success: true });
  });

  socket.on("admin-delete-story", ({ password, storyId }, callback) => {
    if (password !== ADMIN_PASSWORD) { if (typeof callback === "function") callback({ success: false }); return; }
    const st = stories.find((x) => x.id === storyId);
    stories = stories.filter((x) => x.id !== storyId);
    reports.forEach((r) => { if (r.storyId === storyId && r.status === "pending") r.status = "resolved"; });
    saveData();
    cleanupMedia(storyUrls(st));
    if (st) notifyStoryChange(st.phone);
    if (typeof callback === "function") callback({ success: true, stories: stories.slice().reverse(), reports: reports.slice().reverse() });
  });

  // ---------- অ্যাডমিন প্যানেল ----------
  socket.on("admin-set-maintenance", ({ password, on, msg, minutes }, callback) => {
    if (typeof callback !== "function") return;
    if (password !== ADMIN_PASSWORD) return callback({ success: false });
    const who = socketToPhone[socket.id] || "";
    const mins = Math.max(0, Math.min(Number(minutes) || 0, 60 * 24 * 7));
    maintenance = on ? { on: true, msg: String(msg || "").slice(0, 200), until: mins ? Date.now() + mins * 60000 : 0, by: who } : { on: false, msg: "", until: 0, by: who };
    console.log("[maintenance]", on ? "ON" : "OFF", "by", who || "(unknown)", mins ? "for " + mins + " min" : "");
    adminSockets.add(socket.id);
    saveData();
    broadcastMaintenance();
    callback(Object.assign({ success: true }, maintStatus(), { by: (users[who] && users[who].name) || who }));
  });

  socket.on("admin-login", ({ password }, callback) => {
    if (typeof callback !== "function") return;
    if (password === ADMIN_PASSWORD) {
      adminSockets.add(socket.id);
      const userList = Object.values(users).map((u) => {
        const p = profiles[u.phone] || {};
        const ban = bannedUsers[u.phone] || null;
        const friendPhones = Array.from(ensureSet(friendships, u.phone));
        const friends = friendPhones.map((fp) => publicUser(fp));
        return {
          name: u.name,
          phone: u.phone,
          email: u.email || "",
          pic: u.pic || "https://via.placeholder.com/80",
          bio: p.bio || "",
          location: p.location || "",
          work: p.work || "",
          education: p.education || "",
          relationship: p.relationship || "",
          about: p.about || "",
          friendCount: friendPhones.length,
          friends: friends,
          banned: !!ban,
          banReason: ban ? (ban.reason || "") : "",
          banTime: ban ? ban.time : null,
        };
      });
      // banned users who were deleted from users map still show? only active users
      purgeExpiredStories();
      callback({ success: true, users: userList, reports: reports.slice().reverse(), stories: stories.slice().reverse(), maintenance: Object.assign(maintStatus(), { by: (users[maintenance.by] && users[maintenance.by].name) || maintenance.by || "" }) });
    } else {
      callback({ success: false });
    }
  });

  // ---------- অ্যাডমিন: ব্যান / আনব্যান / ডিলিট ----------
  socket.on("admin-ban-user", ({ password, phone, reason }, callback) => {
    if (password !== ADMIN_PASSWORD || !phone) {
      if (typeof callback === "function") callback({ success: false });
      return;
    }
    bannedUsers[phone] = { reason: (reason || "").toString().slice(0, 200), time: Date.now() };
    saveData();
    const sid = phoneToSocket[phone];
    if (sid) {
      sendTo(sid, "account-banned", { reason: bannedUsers[phone].reason });
    }
    if (typeof callback === "function") callback({ success: true, banned: true });
  });

  socket.on("admin-unban-user", ({ password, phone }, callback) => {
    if (password !== ADMIN_PASSWORD || !phone) {
      if (typeof callback === "function") callback({ success: false });
      return;
    }
    delete bannedUsers[phone];
    saveData();
    if (typeof callback === "function") callback({ success: true, banned: false });
  });

  socket.on("admin-delete-user", ({ password, phone }, callback) => {
    if (password !== ADMIN_PASSWORD || !phone) {
      if (typeof callback === "function") callback({ success: false });
      return;
    }
    const sid = purgeUserCompletely(phone);
    if (sid) {
      sendTo(sid, "account-deleted");
      try { io.sockets.sockets.get(sid)?.disconnect(true); } catch (e) {}
    }
    if (typeof callback === "function") callback({ success: true });
  });

  socket.on("admin-report-action", ({ password, reportId, action }, callback) => {
    if (password !== ADMIN_PASSWORD) {
      if (typeof callback === "function") callback({ success: false, error: "Unauthorized" });
      return;
    }
    const report = reports.find((r) => r.id === reportId);
    if (!report) {
      if (typeof callback === "function") callback({ success: false, error: "Not found" });
      return;
    }
    if (action === "remove-story" && report.storyId) {
      const st = stories.find((x) => x.id === report.storyId);
      stories = stories.filter((x) => x.id !== report.storyId);
      if (st) { notifyStoryChange(st.phone); cleanupMedia(storyUrls(st)); }
      action = "resolve";
    }
    report.status = action === "resolve" ? "resolved" : "dismissed";
    saveData();

    // যে ইউজার রিপোর্ট করেছিল, তাকে জানিয়ে দেওয়া (সে অনলাইনে থাকলে)
    const reporterSocket = phoneToSocket[report.fromPhone];
    if (reporterSocket) {
      sendTo(reporterSocket, "report-status-update", { reportId: report.id, status: report.status });
    }

    if (typeof callback === "function") callback({ success: true, report });
  });

  // ---------- FRIEND RESTORE / SYNC ----------
  // ক্লায়েন্ট তার ব্রাউজারে সেভ থাকা ফ্রেন্ড লিস্ট পাঠায়। সার্ভারের ডেটা কোনো
  // কারণে মুছে গেলে এখান থেকেই আবার তৈরি হয়ে যায় — তাই ফ্রেন্ড হারায় না।
  socket.on("sync-user-data", ({ user, friends, profile }, callback) => {
    if (!user || !user.phone) {
      if (typeof callback === "function") callback({ requests: [], friends: [] });
      return;
    }

    if (isDeletedId(user.phone)) {
      if (typeof callback === "function") callback({ requests: [], friends: [], deleted: true });
      return;
    }
    if (phoneAliases[user.phone]) {
      if (typeof callback === "function") callback({ requests: [], friends: [], renamed: true });
      return;
    }
    if (isRevokedDevice(user.phone, user.deviceId)) {
      socket.emit("force-logout");
      if (typeof callback === "function") callback({ requests: [], friends: [], revoked: true });
      return;
    }
    const hadAccount = !!(users[user.phone] && users[user.phone].password);
    bindDeviceSocket(socket, user.phone, user.deviceId);
    mergeClientUser(user);
    socketToPhone[socket.id] = user.phone;
    setSelf(socket, user.phone);
    phoneToSocket[user.phone] = socket.id;
    // এই ডিভাইস আগে লগইন-হিস্ট্রিতে না থাকলে (পুরোনো সেশন) পাসওয়ার্ড মিললে যোগ করা
    if (hadAccount && users[user.phone]) {
      const su = users[user.phone];
      const did = String(user.deviceId || "").slice(0, 64);
      const known = did && Array.isArray(su.loginHistory) && su.loginHistory.some((x) => x && x.deviceId === did);
      if (known) touchDevice(user.phone, did);
      else if (did && verifyPassword(user.password, su.password)) recordDevice(su, socket, did, "session");
    }

    // ক্লায়েন্টের ব্যাকআপ প্রোফাইল (bio/location + ছোট গ্যালারি) সার্ভারে ফেরত আনা —
    // Render রিস্টার্টে ephemeral ডিস্ক মুছে গেলেও ইউজার লগইন করলেই ডেটা ফিরে আসে (ফ্রি)
    if (profile && typeof profile === "object") {
      const existing = profiles[user.phone] || {};
      const merged = { ...existing };
      ["bio", "location", "work", "education", "relationship", "about"].forEach((k) => {
        if (profile[k] && !merged[k]) merged[k] = String(profile[k]).slice(0, 2000);
      });
      // গ্যালারি আইটেম: সর্বোচ্চ ৬টা, প্রতিটা ছোট রাখা (base64 খুব বড় হলে স্কিপ)
      if (Array.isArray(profile.items) && (!merged.items || !merged.items.length)) {
        merged.items = profile.items
          .filter((it) => it && it.src && String(it.src).length < 400000)
          .slice(0, 6);
      }
      profiles[user.phone] = merged;
    }

    if (Array.isArray(friends)) {
      friends.forEach((f) => {
        if (!f || !f.phone) return;
        let fp = f.phone;
        if (phoneAliases[fp]) fp = phoneAliases[fp]; // বন্ধু নম্বর বদলালে নতুন নম্বরে মিলিয়ে নেওয়া
        if (fp === user.phone || isDeletedId(fp)) return; // মুছে ফেলা অ্যাকাউন্ট আর ফিরবে না
        if (!users[fp]) {
          if (fp !== f.phone || PID_RE.test(fp)) return;
          users[fp] = { name: f.name, phone: fp, pic: f.pic };
        }
        ensureSet(friendships, user.phone).add(fp);
        ensureSet(friendships, fp).add(user.phone);
      });
    }

    saveData();
    if (typeof callback === "function") callback(getFriendPayload(user.phone));
  });

  // ---------- FRIENDS ----------
  socket.on("get-friend-data", ({ phone }, callback) => {
    if (typeof callback === "function") callback(getFriendPayload(phone));
  });

  socket.on("send-friend-request", ({ fromUser, toUserPhone }) => {
    if (!fromUser || !toUserPhone || fromUser.phone === toUserPhone) return;
    mergeClientUser(fromUser);
    ensureSet(friendRequests, toUserPhone).add(fromUser.phone);
    saveData();

    const targetSocket = phoneToSocket[toUserPhone];
    if (targetSocket) sendTo(targetSocket, "receive-friend-request");
  });

  socket.on("accept-friend-request", ({ currentUser, friendUser }) => {
    if (!currentUser || !friendUser) return;
    ensureSet(friendships, currentUser.phone).add(friendUser.phone);
    ensureSet(friendships, friendUser.phone).add(currentUser.phone);
    ensureSet(friendRequests, currentUser.phone).delete(friendUser.phone);
    saveData();

    sendFriendData(currentUser.phone);
    sendFriendData(friendUser.phone);
  });

  socket.on("reject-friend-request", ({ currentUser, fromPhone }) => {
    if (!currentUser || !fromPhone) return;
    ensureSet(friendRequests, currentUser.phone).delete(fromPhone);
    saveData();
    sendFriendData(currentUser.phone);
  });

  socket.on("remove-friend", ({ currentPhone, friendPhone }, callback) => {
    if (!currentPhone || !friendPhone) {
      if (typeof callback === "function") callback({ success: false });
      return;
    }
    ensureSet(friendships, currentPhone).delete(friendPhone);
    ensureSet(friendships, friendPhone).delete(currentPhone);
    saveData();
    sendFriendData(currentPhone);
    sendFriendData(friendPhone);
    if (typeof callback === "function") callback({ success: true });
  });

  // নাম বা ফোন দিয়ে ইউজার সার্চ (ফ্রেন্ড রিকোয়েস্ট পাঠানোর জন্য)
  socket.on("search-users", ({ query, myPhone }, callback) => {
    if (typeof callback !== "function") return;
    const q = (query || "").toString().trim().toLowerCase();
    if (!q || q.length < 1) {
      callback([]);
      return;
    }
    myPhone = viewerOf(socket) || myPhone;
    // প্রোফাইল লিংক (…/u/<id>) বা শুধু আইডি পেস্ট করলে সরাসরি সেই ইউজার
    const pm = q.match(/(?:^|[\/=#])(u[0-9a-f]{16})(?:[\/?#]|$)/);
    if (pm) {
      const lp = phoneFromPid(pm[1]);
      if (!lp || lp === myPhone || bannedUsers[lp]) return callback([]);
      return callback([{
        ...publicUser(lp),
        isFriend: ensureSet(friendships, myPhone).has(lp),
        requestPending: ensureSet(friendRequests, lp).has(myPhone),
      }]);
    }
    const myFriends = ensureSet(friendships, myPhone);
    const myOutgoing = []; // optional: track pending outbound — skip for now
    const results = Object.values(users)
      .filter((u) => {
        if (!u || !u.phone || u.phone === myPhone) return false;
        if (bannedUsers[u.phone]) return false;
        const name = (u.name || "").toLowerCase();
        const phone = (u.phone || "").toLowerCase();
        const qCompact = q.replace(/[\s-]/g, "");
        // নাম দিয়ে আংশিক সার্চ চলবে; নম্বর/ইমেইল শুধু হুবহু মিললে (আংশিক মিলিয়ে নম্বর খুঁজে বের করা যাবে না)
        return name.includes(q) || phone === q || phone === qCompact || (!!u.email && u.email === q);
      })
      .slice(0, 25)
      .map((u) => ({
        ...publicUser(u.phone),
        isFriend: myFriends.has(u.phone),
        requestPending: ensureSet(friendRequests, u.phone).has(myPhone),
      }));
    callback(results);
  });

  // ---------- DIRECT MESSAGES ----------
  socket.on("get-direct-history", ({ senderPhone, receiverPhone }, callback) => {
    const key = directKey(senderPhone, receiverPhone);
    if (typeof callback === "function") callback(directMessages[key] || []);
  });

  // Render sleep/restart হলে ephemeral ডিস্ক থেকে app-data.json মুছে গেলে ফ্রেন্ডের
  // সাথে করা মেসেজ যেন হারিয়ে না যায় — ক্লায়েন্ট নিজের ব্রাউজার-ক্যাশে রাখা মেসেজ
  // এখানে পাঠায়, সার্ভার সেগুলো নিজের স্টোরের সাথে মার্জ করে ফিরিয়ে দেয়/সেভ করে
  // রাখে, ঠিক যেমনটা "sync-user-data" ফ্রেন্ড-লিস্টের জন্য করে।
  function mergeDirectMessageLists(a, b) {
    const seen = new Set();
    const out = [];
    (a || []).concat(b || []).forEach((m) => {
      if (!m || !m.senderPhone) return;
      const key = m.clientId || [m.senderPhone, m.timestamp, m.text || m.fileContent || ""].join("|");
      if (seen.has(key)) return;
      seen.add(key);
      out.push(m);
    });
    out.sort((x, y) => (x.timestamp || 0) - (y.timestamp || 0));
    return out;
  }

  socket.on("sync-direct-messages", ({ myPhone, friendPhone, cachedMessages }, callback) => {
    if (!myPhone || !friendPhone) {
      if (typeof callback === "function") callback([]);
      return;
    }
    const key = directKey(myPhone, friendPhone);
    const existing = directMessages[key] || [];
    const safeCache = Array.isArray(cachedMessages) ? cachedMessages.slice(-200) : [];
    const merged = mergeDirectMessageLists(existing, safeCache);
    if (merged.length !== existing.length) {
      directMessages[key] = merged;
      saveData();
    }
    if (typeof callback === "function") callback(directMessages[key] || []);
  });

  socket.on("send-direct-message", (msgData, callback) => {
    const { senderPhone, receiverPhone } = msgData;

    if (bannedUsers[senderPhone]) {
      if (typeof callback === "function") callback({ success: false, error: "banned" });
      return;
    }
    if (ensureSet(blockedUsers, senderPhone).has(receiverPhone)) {
      if (typeof callback === "function") callback({ success: false, error: "blocked_by_you" });
      return;
    }
    if (ensureSet(blockedUsers, receiverPhone).has(senderPhone)) {
      if (typeof callback === "function") callback({ success: false, error: "blocked_by_them" });
      return;
    }

    const key = directKey(senderPhone, receiverPhone);
    if (!directMessages[key]) directMessages[key] = [];
    directMessages[key].push(msgData);
    saveData();

    const targetSocket = phoneToSocket[receiverPhone];
    if (targetSocket) sendTo(targetSocket, "receive-direct-message", msgData);

    // Messenger-এর মতো স্ট্যাটাস: রিসিভার অনলাইনে থাকলে "Delivered"
    if (typeof callback === "function") {
      callback({ success: true, delivered: !!targetSocket });
    }
  });

  // রিসিভার চ্যাট খুললে সব মেসেজ "Seen" হিসেবে মার্ক হয় এবং সেন্ডার জানতে পারে
  socket.on("mark-direct-seen", ({ viewerPhone, friendPhone }) => {
    if (!viewerPhone || !friendPhone) return;
    const key = directKey(viewerPhone, friendPhone);
    const list = directMessages[key] || [];
    let changed = false;
    list.forEach((m) => {
      if (m.senderPhone === friendPhone && !m.seen) {
        m.seen = true;
        changed = true;
      }
    });
    if (changed) saveData();

    const senderSocket = phoneToSocket[friendPhone];
    if (senderSocket) {
      sendTo(senderSocket, "direct-messages-seen", { byPhone: viewerPhone });
    }
  });

  socket.on("clear-direct-history", ({ senderPhone, receiverPhone }, callback) => {
    const key = directKey(senderPhone, receiverPhone);
    delete directMessages[key];
    saveData();
    if (typeof callback === "function") callback();
  });

  socket.on("toggle-block-user", ({ currentPhone, targetPhone }, callback) => {
    const set = ensureSet(blockedUsers, currentPhone);
    let isBlocked;
    if (set.has(targetPhone)) {
      set.delete(targetPhone);
      isBlocked = false;
    } else {
      set.add(targetPhone);
      isBlocked = true;
    }
    saveData();
    if (typeof callback === "function") callback({ success: true, isBlocked });
  });

  // ---------- ROOMS / GROUP CHAT ----------
  socket.on("join-room", ({ roomCode, user, peerId }) => {
    if (!roomCode || !user) return;
    socket.join(roomCode);
    socketToRoom[socket.id] = roomCode;

    if (user.phone) {
      mergeClientUser(user);
      phoneToSocket[user.phone] = socket.id;
      socketToPhone[socket.id] = user.phone;
      setSelf(socket, user.phone);
    }

    if (!roomMembers[roomCode]) roomMembers[roomCode] = new Map();
    roomMembers[roomCode].set(socket.id, { user, peerId });

    emitRoom(roomCode, "user-joined-notify", { user }, socket.id);
    broadcastRoomMembers(roomCode);
  });

  socket.on("leave-room", ({ roomCode }) => {
    if (!roomCode) return;
    socket.leave(roomCode);
    if (roomMembers[roomCode]) {
      roomMembers[roomCode].delete(socket.id);
    }
    delete socketToRoom[socket.id];
    broadcastRoomMembers(roomCode);
  });

  socket.on("get-room-history", (roomCode, callback) => {
    if (typeof callback === "function") callback(roomMessages[roomCode] || []);
  });

  socket.on("send-message", (msgData, callback) => {
    const { roomCode } = msgData;
    if (!roomCode) return;
    if (!roomMessages[roomCode]) roomMessages[roomCode] = [];
    roomMessages[roomCode].push(msgData);
    saveData();

    emitRoom(roomCode, "receive-message", msgData, socket.id);
    if (typeof callback === "function") callback();
  });

  socket.on("set-room-theme", ({ roomCode, themeData }) => {
    if (!roomCode) return;
    emitRoom(roomCode, "room-theme-update", themeData, socket.id);
  });

  // ---------- DIRECT CHAT THEME (দুই পাশেই একসাথে বদলাবে) ----------
  socket.on("set-direct-theme", ({ fromPhone, toPhone, themeData }) => {
    if (!fromPhone || !toPhone) return;
    directThemes[directKey(fromPhone, toPhone)] = themeData || {};
    saveData();
    const targetSocket = phoneToSocket[toPhone];
    if (targetSocket) {
      sendTo(targetSocket, "direct-theme-update", { fromPhone, themeData });
    }
  });

  socket.on("get-direct-theme", ({ myPhone, friendPhone }, callback) => {
    if (typeof callback === "function") {
      callback(directThemes[directKey(myPhone, friendPhone)] || null);
    }
  });

  // ---------- USER PROFILE (তথ্য + ছবি/ভিডিও/অডিও) ----------
  socket.on("get-profile", ({ phone }, callback) => {
    if (typeof callback !== "function") return;
    if (typeof phone !== "string" || !hasOwn(users, phone) || bannedUsers[phone]) return callback(null);
    const viewerPhone = viewerOf(socket);
    const isAdmin = adminSockets.has(socket.id);
    const base = publicUser(phone);
    let relation = "none"; // none | friends | outgoing | incoming | self
    if (viewerPhone && viewerPhone === phone) relation = "self";
    else if (viewerPhone && phone) {
      if (ensureSet(friendships, viewerPhone).has(phone)) relation = "friends";
      else if (ensureSet(friendRequests, phone).has(viewerPhone)) relation = "outgoing";
      else if (ensureSet(friendRequests, viewerPhone).has(phone)) relation = "incoming";
    }
    // বন্ধু (বা নিজে/অ্যাডমিন) না হলে কিছুই দেখা যাবে না — শুধু নাম আর প্রোফাইল ছবি, যাতে চিনে ফ্রেন্ড রিকোয়েস্ট পাঠানো যায়
    if (relation !== "self" && relation !== "friends" && !isAdmin) {
      return callback({ name: base.name, phone: base.phone, pic: base.pic, relation, locked: true });
    }
    const p = profiles[phone] || {};
    callback({ ...base, ...p, relation, friendCount: ensureSet(friendships, phone).size });
  });

  // নিজের প্রোফাইল লিংকের আইডি (শুধু নিজেরটাই পাওয়া যায়)
  socket.on("get-my-link", (_p, callback) => {
    if (typeof callback !== "function") return;
    const me = viewerOf(socket);
    if (!me || !hasOwn(users, me)) return callback({ success: false });
    callback({ success: true, linkId: pidOf(me) });
  });

  socket.on("update-avatar", async ({ phone, dataUrl, name }, callback) => {
    if (!phone || !dataUrl) {
      if (typeof callback === "function") callback({ success: false, error: "missing", message: "ছবি পাওয়া যায়নি।" });
      return;
    }
    const resolved = await resolveImageSrc(dataUrl, name || "avatar");
    if (!resolved || !resolved.src) {
      if (typeof callback === "function") callback({ success: false, error: "upload_failed", message: "ছবি আপলোড হয়নি।" });
      return;
    }
    if (!users[phone]) users[phone] = { phone };
    const oldPic = users[phone].pic;
    users[phone].pic = resolved.src;
    // প্রোফাইল ছবি Photos + পোস্ট ফিডেও দেখাবে
    publishProfileMediaAsPost(phone, resolved.src, resolved.host, "avatar");
    saveData();
    try { notifyFriendsOfProfile(phone); } catch (e) {}
    if (oldPic && oldPic !== resolved.src) cleanupMedia([oldPic]);
    if (typeof callback === "function") callback({ success: true, pic: resolved.src });
  });

  socket.on("update-cover", async ({ phone, dataUrl, name }, callback) => {
    if (!phone || !dataUrl) {
      if (typeof callback === "function") callback({ success: false, error: "missing", message: "ছবি পাওয়া যায়নি।" });
      return;
    }
    const resolved = await resolveImageSrc(dataUrl, name || "cover");
    if (!resolved || !resolved.src) {
      if (typeof callback === "function") callback({ success: false, error: "upload_failed", message: "ছবি আপলোড হয়নি।" });
      return;
    }
    if (!profiles[phone]) profiles[phone] = {};
    const oldCover = profiles[phone].cover;
    profiles[phone].cover = resolved.src;
    // কভার ছবি Photos + পোস্ট ফিডেও দেখাবে
    publishProfileMediaAsPost(phone, resolved.src, resolved.host, "cover");
    saveData();
    try { notifyFriendsOfProfile(phone); } catch (e) {}
    if (oldCover && oldCover !== resolved.src) cleanupMedia([oldCover]);
    if (typeof callback === "function") callback({ success: true, cover: resolved.src });
  });

  socket.on("update-display-name", ({ phone, name }, callback) => {
    const clean = (name || "").toString().trim().slice(0, 40);
    if (!phone || !clean) {
      if (typeof callback === "function") callback({ success: false, error: "invalid" });
      return;
    }
    if (!users[phone]) users[phone] = { phone };
    users[phone].name = clean;
    saveData();
    if (typeof callback === "function") callback({ success: true, name: clean });
  });

  socket.on("save-profile", ({ phone, profile }, callback) => {
    if (!phone) {
      if (typeof callback === "function") callback({ success: false });
      return;
    }
    const existing = profiles[phone] || {};
    profiles[phone] = { ...existing, ...(profile || {}) };
    saveData();
    if (typeof callback === "function") callback({ success: true, profile: profiles[phone] });
  });

  socket.on("add-profile-item", async ({ phone, item }, callback) => {
    if (!phone || !item) {
      if (typeof callback === "function") callback({ success: false, error: "missing", message: "ছবি পাওয়া যায়নি।" });
      return;
    }
    if (item.kind && item.kind !== "photo") {
      if (typeof callback === "function") callback({ success: false, error: "photos_only", message: "শুধু ছবি।" });
      return;
    }
    item.kind = "photo";
    item.caption = String(item.caption || "").slice(0, 500);
    if (item.src && String(item.src).startsWith("data:")) {
      const resolved = await resolveImageSrc(item.src, item.name || "photo");
      if (!resolved || !resolved.src) {
        if (typeof callback === "function") callback({ success: false, error: "upload_failed", message: "ছবি আপলোড হয়নি।" });
        return;
      }
      item.src = resolved.src;
      item.host = resolved.host;
    }
    if (!profiles[phone]) profiles[phone] = {};
    if (!Array.isArray(profiles[phone].items)) profiles[phone].items = [];
    // ছবি (সর্বোচ্চ ১০০) + বিদ্যমান reels আলাদা রাখা
    {
      const keepReels = profiles[phone].items.filter((it) => it && it.kind === "reel");
      const photos = [item].concat(profiles[phone].items.filter((it) => it && it.kind === "photo")).slice(0, 100);
      profiles[phone].items = photos.concat(keepReels);
    }
    syncMediaLinks(profiles[phone]);
    saveData();

    Array.from(ensureSet(friendships, phone)).forEach((friendPhone) => {
      const sid = phoneToSocket[friendPhone];
      if (sid) sendTo(sid, "friend-profile-updated", { phone });
    });

    if (typeof callback === "function") callback({ success: true, items: profiles[phone].items, posts: profiles[phone].posts });
  });

  // ---------- Reels (শুধু ভিডিও) ----------
  socket.on("add-profile-reel", async ({ phone, item }, callback) => {
    const reply = (r) => { if (typeof callback === "function") callback(r); };
    if (!phone || !item || !item.src) return reply({ success: false, error: "missing", message: "ভিডিও পাওয়া যায়নি।" });

    let src = String(item.src);
    if (src.startsWith("data:")) {
      if (!src.startsWith("data:video/")) return reply({ success: false, error: "videos_only", message: "Reels-এ শুধু ভিডিও।" });
      const remote = await uploadVideoToCloudinary(src, item.name || "reel");
      if (!remote) return reply({ success: false, error: "upload_failed", message: "রিলস আপলোড হয়নি।" });
      src = remote;
    } else if (!/^https?:\/\//.test(src)) {
      return reply({ success: false, error: "invalid", message: "ভিডিও ঠিক নেই।" });
    }

    const reel = {
      id: String(item.id || ("r" + Date.now().toString(36))).slice(0, 60),
      kind: "reel",
      src,
      name: String(item.name || "reel").slice(0, 120),
      caption: String(item.caption || "").slice(0, 500),
      timestamp: Date.now(),
    };
    if (!profiles[phone]) profiles[phone] = {};
    if (!Array.isArray(profiles[phone].items)) profiles[phone].items = [];
    const photos = profiles[phone].items.filter((it) => it && it.kind === "photo");
    const reels = [reel].concat(profiles[phone].items.filter((it) => it && it.kind === "reel")).slice(0, 30);
    profiles[phone].items = photos.concat(reels);
    syncMediaLinks(profiles[phone]);
    saveData();

    Array.from(ensureSet(friendships, phone)).forEach((friendPhone) => {
      const sid = phoneToSocket[friendPhone];
      if (sid) sendTo(sid, "friend-profile-updated", { phone });
    });
    reply({ success: true, items: profiles[phone].items, posts: profiles[phone].posts });
  });

  socket.on("delete-profile-item", ({ phone, itemId }, callback) => {
    if (profiles[phone] && Array.isArray(profiles[phone].items)) {
      const it = profiles[phone].items.find((x) => x.id === itemId);
      const gone = [it && it.src];
      profiles[phone].items = profiles[phone].items.filter((x) => x.id !== itemId);
      if (it && it.postId && Array.isArray(profiles[phone].posts)) {
        const linked = profiles[phone].posts.find((p) => p.id === it.postId);
        if (linked && linked.media) gone.push(linked.media.src);
        profiles[phone].posts = profiles[phone].posts.filter((p) => p.id !== it.postId);
      }
      saveData();
      cleanupMedia(gone);
      notifyFriendsOfProfile(phone);
    }
    const pr = profiles[phone] || {};
    if (typeof callback === "function") callback({ success: true, items: pr.items || [], posts: pr.posts || [] });
  });

  // ---------- FACEBOOK-স্টাইল টাইমলাইন পোস্ট (ছবি/ভিডিও/টেক্সট + লাইক + কমেন্ট) ----------
  function notifyFriendsOfProfile(phone) {
    Array.from(ensureSet(friendships, phone)).forEach((friendPhone) => {
      const sid = phoneToSocket[friendPhone];
      if (sid) sendTo(sid, "friend-profile-updated", { phone });
    });
  }

  socket.on("create-post", async ({ phone, text, media }, callback) => {
    if (!phone || (!text && !media)) {
      if (typeof callback === "function") callback({ success: false });
      return;
    }
    if (!profiles[phone]) profiles[phone] = {};
    if (!Array.isArray(profiles[phone].posts)) profiles[phone].posts = [];

    let mediaOut = media || null;
    if (mediaOut) {
      if (mediaOut.type === "video") {
        let vsrc = String(mediaOut.src || "");
        if (vsrc.startsWith("data:video/")) {
          const remote = await uploadVideoToCloudinary(vsrc, "post-video");
          if (!remote) {
            if (typeof callback === "function") callback({ success: false, error: "upload_failed", message: "ভিডিও আপলোড হয়নি।" });
            return;
          }
          vsrc = remote;
        } else if (!/^https?:\/\//.test(vsrc)) {
          if (typeof callback === "function") callback({ success: false, error: "invalid", message: "ভিডিও ঠিক নেই।" });
          return;
        }
        mediaOut = { type: "video", src: vsrc };
      } else {
        mediaOut.type = "image";
        if (mediaOut.src && String(mediaOut.src).startsWith("data:")) {
          const resolved = await resolveImageSrc(mediaOut.src, "post");
          if (!resolved || !resolved.src) {
            if (typeof callback === "function") callback({ success: false, error: "upload_failed", message: "ছবি আপলোড হয়নি।" });
            return;
          }
          mediaOut = { type: "image", src: resolved.src, host: resolved.host };
        }
      }
    }

    const post = {
      id: "post_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      text: (text || "").slice(0, 2000),
      media: mediaOut,
      timestamp: Date.now(),
      likes: [],
      comments: []
    };

    profiles[phone].posts.unshift(post);
    // সর্বোচ্চ ৬০টি পোস্ট রাখা হয়, তার বেশি হলে পুরনোগুলো বাদ যাবে
    profiles[phone].posts = profiles[phone].posts.slice(0, 100);
    syncMediaLinks(profiles[phone]);
    saveData();
    notifyFriendsOfProfile(phone);

    if (typeof callback === "function") callback({ success: true, post, items: profiles[phone].items, posts: profiles[phone].posts });
  });

  socket.on("delete-post", ({ phone, postId }, callback) => {
    if (profiles[phone] && Array.isArray(profiles[phone].posts)) {
      const post = profiles[phone].posts.find((p) => p.id === postId);
      const gone = [post && post.media && post.media.src];
      profiles[phone].posts = profiles[phone].posts.filter((p) => p.id !== postId);
      if (post && post.itemId && Array.isArray(profiles[phone].items)) {
        const linked = profiles[phone].items.find((i) => i.id === post.itemId);
        if (linked) gone.push(linked.src);
        profiles[phone].items = profiles[phone].items.filter((i) => i.id !== post.itemId);
      }
      saveData();
      cleanupMedia(gone);
      notifyFriendsOfProfile(phone);
    }
    const pr = profiles[phone] || {};
    if (typeof callback === "function") callback({ success: true, items: pr.items || [], posts: pr.posts || [] });
  });

  // ---------- REACTIONS (Like/Love/Care/Haha/Wow/Sad/Angry) · COMMENTS · SHARE ----------
  // পোস্ট, রিলস আর স্টোরি — তিন জায়গার জন্যই একই লজিক।
  // ডেটা: obj.reacts = { phone: "love" }, obj.likes = [phone...] (পুরনো কোডের সাথে মিল রাখতে), obj.shares = সংখ্যা
  const REACT_TYPES = ["like", "love", "care", "haha", "wow", "sad", "angry"];

  function reactsOf(o) {
    const r = Object.assign({}, (o && o.reacts) || {});
    ((o && o.likes) || []).forEach((ph) => { if (!r[ph]) r[ph] = "like"; }); // পুরনো লাইক = "like"
    return r;
  }

  // kind: "post" | "reel" | "story" → আসল অবজেক্ট খুঁজে দেয়
  function resolveTarget(kind, ownerPhone, id) {
    if (kind === "story") {
      const st = stories.find((x) => x.id === id);
      return st ? { obj: st, kind: "story", owner: st.phone, media: st.media || null, caption: st.text || "" } : null;
    }
    const pr = profiles[ownerPhone];
    if (!pr) return null;
    if (kind === "reel") {
      const item = (pr.items || []).find((i) => i && i.id === id && i.kind === "reel");
      if (!item) return null;
      const post = item.postId ? (pr.posts || []).find((x) => x && x.id === item.postId) : null;
      return { obj: post || item, kind: "reel", owner: ownerPhone, postId: post ? post.id : null, reelId: item.id, media: { type: "video", src: item.src }, caption: item.caption || (post && post.text) || "" };
    }
    const post = (pr.posts || []).find((x) => x && x.id === id);
    if (!post) return null;
    const item = post.itemId ? (pr.items || []).find((i) => i && i.id === post.itemId && i.kind === "reel") : null;
    return { obj: post, kind: "post", owner: ownerPhone, postId: post.id, reelId: item ? item.id : null, media: post.media || null, caption: post.text || "" };
  }

  function itemPayload(t, id) {
    const o = t.obj;
    return {
      kind: t.kind, ownerPhone: t.owner, id,
      postId: t.postId || null, reelId: t.reelId || null,
      reacts: reactsOf(o), likes: o.likes || [],
      commentCount: (o.comments || []).length, shares: o.shares || 0,
    };
  }

  // মালিক + মালিকের বন্ধুরা (+ যে করল সে) সাথে সাথে আপডেট পাবে
  function broadcastItem(t, id, extra, alsoPhone) {
    const payload = Object.assign(itemPayload(t, id), extra || {});
    if (t.kind === "story") return payload;
    const targets = new Set(Array.from(ensureSet(friendships, t.owner)).concat([t.owner]));
    if (alsoPhone) targets.add(alsoPhone);
    targets.forEach((ph) => { const sid = phoneToSocket[ph]; if (sid) sendTo(sid, "item-updated", payload); });
    return payload;
  }

  function setReaction(t, phone, type) {
    const o = t.obj;
    const reacts = reactsOf(o);
    if (REACT_TYPES.includes(type)) reacts[phone] = type; else delete reacts[phone];
    o.reacts = reacts;
    o.likes = Object.keys(reacts);
    return reacts;
  }

  function applyReaction(kind, ownerPhone, id, reactorPhone, type, callback) {
    const reply = (r) => { if (typeof callback === "function") callback(r); };
    if (!reactorPhone || bannedUsers[reactorPhone] || !["post", "reel", "story"].includes(kind)) return reply({ success: false });
    const t = resolveTarget(kind, ownerPhone, id);
    if (!t) return reply({ success: false });
    const reacts = setReaction(t, reactorPhone, type);
    saveData();
    const payload = broadcastItem(t, id, {}, reactorPhone);
    if (t.kind === "story" && t.owner !== reactorPhone) {
      const u = users[reactorPhone] || {};
      const sid = phoneToSocket[t.owner];
      if (sid) sendTo(sid, "story-reacted", { storyId: id, phone: reactorPhone, name: u.name || "Someone", type: reacts[reactorPhone] || null, reacts });
    }
    reply({ success: true, reacts, likes: t.obj.likes, my: reacts[reactorPhone] || null, payload });
  }

  socket.on("react-item", ({ kind, ownerPhone, id, reactorPhone, type }, callback) => {
    applyReaction(kind, ownerPhone, id, reactorPhone, type, callback);
  });

  // পুরনো "লাইক" বাটনের সাথে সামঞ্জস্য
  socket.on("toggle-like-post", ({ phone, postId, likerPhone }, callback) => {
    const t = resolveTarget("post", phone, postId);
    if (!t) { if (typeof callback === "function") callback({ success: false }); return; }
    const had = !!reactsOf(t.obj)[likerPhone];
    applyReaction("post", phone, postId, likerPhone, had ? null : "like", (res) => {
      if (typeof callback === "function") callback(res && res.success ? Object.assign({ liked: !had }, res) : res);
    });
  });

  // কারা রিঅ্যাক্ট করেছে (পোস্ট/রিলস/স্টোরি)
  socket.on("get-reactors", ({ kind, ownerPhone, id }, callback) => {
    if (typeof callback !== "function") return;
    const t = resolveTarget(kind, ownerPhone, id);
    if (!t) return callback({ success: false });
    const r = reactsOf(t.obj);
    callback({ success: true, list: Object.keys(r).map((ph) => Object.assign({}, publicUser(ph), { phone: ph, type: r[ph] })) });
  });

  // স্টোরির ভিউয়ার + তাদের রিঅ্যাকশন (শুধু মালিক দেখতে পাবে)
  socket.on("get-story-viewers", ({ phone, storyId }, callback) => {
    if (typeof callback !== "function") return;
    const st = stories.find((x) => x.id === storyId);
    if (!st || st.phone !== phone) return callback({ success: false });
    const r = reactsOf(st);
    const all = Array.from(new Set((st.views || []).concat(Object.keys(r))));
    callback({ success: true, list: all.map((ph) => Object.assign({}, publicUser(ph), { phone: ph, type: r[ph] || null })) });
  });

  socket.on("add-comment", ({ phone, postId, comment, kind }, callback) => {
    const reply = (r) => { if (typeof callback === "function") callback(r); };
    const t = resolveTarget(kind === "reel" ? "reel" : "post", phone, postId);
    if (!t || !comment || !String(comment.text || "").trim() || bannedUsers[comment.authorPhone]) return reply({ success: false });
    const o = t.obj;
    if (!Array.isArray(o.comments)) o.comments = [];

    const newComment = {
      id: "cm_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      authorPhone: comment.authorPhone,
      authorName: comment.authorName,
      authorPic: comment.authorPic,
      text: String(comment.text || "").slice(0, 500),
      timestamp: Date.now()
    };
    o.comments.push(newComment);
    saveData();

    // মালিক, তার বন্ধুরা আর কমেন্টকারী — সবার স্ক্রিনে সাথে সাথে কমেন্ট দেখা যাবে
    broadcastItem(t, postId, { comments: o.comments.slice(-100) }, comment.authorPhone);
    reply({ success: true, comment: newComment });
  });

  // ---------- COMMENT: এডিট / ডিলিট / হাইড ----------
  socket.on("edit-comment", ({ kind, ownerPhone, postId, commentId, editorPhone, text }, callback) => {
    const reply = (r) => { if (typeof callback === "function") callback(r); };
    const t = resolveTarget(kind === "reel" ? "reel" : "post", ownerPhone, postId);
    if (!t || !commentId || !editorPhone || bannedUsers[editorPhone]) return reply({ success: false });
    const o = t.obj;
    if (!Array.isArray(o.comments)) return reply({ success: false });
    const c = o.comments.find((x) => x && x.id === commentId);
    if (!c || c.authorPhone !== editorPhone) return reply({ success: false, message: "শুধু নিজের কমেন্ট এডিট করা যায়।" });
    const clean = String(text || "").trim().slice(0, 500);
    if (!clean) return reply({ success: false, message: "খালি কমেন্ট রাখা যায় না।" });
    c.text = clean;
    c.edited = true;
    c.editedAt = Date.now();
    saveData();
    broadcastItem(t, postId, { comments: o.comments.slice(-100) }, editorPhone);
    reply({ success: true, comment: c, comments: o.comments });
  });

  socket.on("delete-comment", ({ kind, ownerPhone, postId, commentId, actorPhone }, callback) => {
    const reply = (r) => { if (typeof callback === "function") callback(r); };
    const t = resolveTarget(kind === "reel" ? "reel" : "post", ownerPhone, postId);
    if (!t || !commentId || !actorPhone || bannedUsers[actorPhone]) return reply({ success: false });
    const o = t.obj;
    if (!Array.isArray(o.comments)) return reply({ success: false });
    const idx = o.comments.findIndex((x) => x && x.id === commentId);
    if (idx < 0) return reply({ success: false });
    const c = o.comments[idx];
    // কমেন্টকারী নিজে ডিলিট করতে পারে, অথবা পোস্টের মালিক
    if (c.authorPhone !== actorPhone && t.owner !== actorPhone) {
      return reply({ success: false, message: "এই কমেন্ট ডিলিট করার অনুমতি নেই।" });
    }
    o.comments.splice(idx, 1);
    saveData();
    broadcastItem(t, postId, { comments: o.comments.slice(-100), commentCount: o.comments.length }, actorPhone);
    reply({ success: true, comments: o.comments });
  });

  socket.on("hide-comment", ({ kind, ownerPhone, postId, commentId, actorPhone, hide }, callback) => {
    const reply = (r) => { if (typeof callback === "function") callback(r); };
    const t = resolveTarget(kind === "reel" ? "reel" : "post", ownerPhone, postId);
    if (!t || !commentId || !actorPhone) return reply({ success: false });
    // শুধু পোস্টের মালিক হাইড করতে পারে
    if (t.owner !== actorPhone) return reply({ success: false, message: "শুধু পোস্টের মালিক কমেন্ট হাইড করতে পারে।" });
    const o = t.obj;
    if (!Array.isArray(o.comments)) return reply({ success: false });
    const c = o.comments.find((x) => x && x.id === commentId);
    if (!c) return reply({ success: false });
    c.hidden = hide !== false;
    c.hiddenBy = actorPhone;
    saveData();
    broadcastItem(t, postId, { comments: o.comments.slice(-100) }, actorPhone);
    reply({ success: true, comment: c, comments: o.comments });
  });

  // ---------- SHARE ----------
  // mode: "feed" = নিজের ফিডে শেয়ার · "friend" = বন্ধুকে মেসেজে পাঠানো · "link" = লিংক কপি/সিস্টেম শেয়ার (শুধু গণনা)
  socket.on("share-item", ({ kind, ownerPhone, id, sharerPhone, mode, text, toPhone }, callback) => {
    const reply = (r) => { if (typeof callback === "function") callback(r); };
    if (!sharerPhone || bannedUsers[sharerPhone] || (kind !== "post" && kind !== "reel")) return reply({ success: false });
    const t = resolveTarget(kind, ownerPhone, id);
    if (!t) return reply({ success: false, message: "এটি আর পাওয়া যাচ্ছে না।" });
    const owner = users[t.owner] || {};
    const sharer = users[sharerPhone] || {};
    const note = String(text || "").slice(0, 2000);
    const cap = String(t.caption || "").replace(/\s+/g, " ").trim();
    const mediaOut = t.media && t.media.src ? { type: t.media.type === "video" ? "video" : "image", src: t.media.src } : null;

    if (mode === "feed") {
      if (!profiles[sharerPhone]) profiles[sharerPhone] = {};
      if (!Array.isArray(profiles[sharerPhone].posts)) profiles[sharerPhone].posts = [];
      const post = {
        id: "post_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        text: note,
        media: mediaOut ? Object.assign({}, mediaOut, t.media && t.media.host ? { host: t.media.host } : {}) : null,
        timestamp: Date.now(), likes: [], comments: [],
        itemId: "shared", // Photos/Reels-এ ডুপ্লিকেট আইটেম তৈরি হবে না
        sharedFrom: { ownerPhone: t.owner, ownerName: owner.name || "User", text: cap.slice(0, 500), kind },
      };
      profiles[sharerPhone].posts.unshift(post);
      profiles[sharerPhone].posts = profiles[sharerPhone].posts.slice(0, 100);
      t.obj.shares = (t.obj.shares || 0) + 1;
      saveData();
      notifyFriendsOfProfile(sharerPhone);
      const payload = broadcastItem(t, id, {}, sharerPhone);
      return reply({ success: true, post, shares: t.obj.shares, payload });
    }

    if (mode === "friend") {
      if (!toPhone || toPhone === sharerPhone) return reply({ success: false });
      if (ensureSet(blockedUsers, sharerPhone).has(toPhone)) return reply({ success: false, message: "আপনি এই ইউজারকে ব্লক করে রেখেছেন।" });
      if (ensureSet(blockedUsers, toPhone).has(sharerPhone)) return reply({ success: false, message: "মেসেজ পাঠানো যায়নি।" });
      const label = kind === "reel" ? "Reel" : "পোস্ট";
      const msg = {
        clientId: "sh" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        senderPhone: sharerPhone, senderName: sharer.name || "User", senderPic: sharer.pic || "",
        receiverPhone: toPhone, timestamp: Date.now(),
        text: "↪️ " + (owner.name || "User") + " এর " + label + (cap ? ": " + cap.slice(0, 80) : ""),
        shared: { kind, ownerPhone: t.owner, ownerName: owner.name || "User", caption: cap.slice(0, 200), note: note.slice(0, 500), mediaType: mediaOut ? mediaOut.type : "", mediaSrc: mediaOut ? mediaOut.src : "" },
      };
      const key = directKey(sharerPhone, toPhone);
      if (!directMessages[key]) directMessages[key] = [];
      directMessages[key].push(msg);
      t.obj.shares = (t.obj.shares || 0) + 1;
      saveData();
      const targetSocket = phoneToSocket[toPhone];
      if (targetSocket) sendTo(targetSocket, "receive-direct-message", msg);
      const payload = broadcastItem(t, id, {}, sharerPhone);
      return reply({ success: true, delivered: !!targetSocket, shares: t.obj.shares, payload });
    }

    // "link"
    t.obj.shares = (t.obj.shares || 0) + 1;
    saveData();
    const payload = broadcastItem(t, id, {}, sharerPhone);
    reply({ success: true, shares: t.obj.shares, payload, link: mediaOut ? mediaOut.src : "" });
  });

  // ---------- CALL: অডিও থেকে ভিডিওতে সুইচ ----------
  socket.on("direct-call-upgrade", ({ toPhone }) => {
    const targetSocket = phoneToSocket[toPhone];
    if (targetSocket) sendTo(targetSocket, "direct-call-upgraded");
  });

  socket.on("direct-call-reject", ({ toPhone }) => {
    const targetSocket = phoneToSocket[toPhone];
    if (targetSocket) sendTo(targetSocket, "direct-call-rejected");
  });

  // ---------- ROOM CALL SIGNALING ----------
  socket.on("call-user", (data) => {
    if (!data || !data.roomCode) return;
    emitRoom(data.roomCode, "incoming-call", data, socket.id);
  });

  socket.on("accept-call-notify", ({ roomCode }) => {
    if (!roomCode) return;
    emitRoom(roomCode, "call-accepted-by-receiver", undefined, socket.id);
  });

  socket.on("end-call", ({ roomCode }) => {
    if (!roomCode) return;
    emitRoom(roomCode, "call-ended", undefined, socket.id);
  });

  // ---------- DIRECT (FRIEND) CALL SIGNALING ----------
  // রুম কোড ছাড়াই এক ফ্রেন্ড থেকে আরেক ফ্রেন্ডের কাছে কল পাঠানো হয়
  socket.on("direct-call-user", (data) => {
    if (!data || !data.toPhone) return;
    const targetSocket = phoneToSocket[data.toPhone];
    if (targetSocket) {
      sendTo(targetSocket, "direct-incoming-call", data);
    } else {
      sendTo(socket.id, "direct-call-unavailable", { toPhone: data.toPhone });
    }
  });

  socket.on("direct-call-accept", ({ toPhone }) => {
    const targetSocket = phoneToSocket[toPhone];
    if (targetSocket) sendTo(targetSocket, "direct-call-accepted");
  });

  socket.on("direct-call-end", ({ toPhone }) => {
    const targetSocket = phoneToSocket[toPhone];
    if (targetSocket) sendTo(targetSocket, "direct-call-ended");
  });

  // ---------- DISCONNECT CLEANUP ----------
  socket.on("disconnect", () => {
    const phone = socketToPhone[socket.id];
    if (phone && phoneToSocket[phone] === socket.id) {
      delete phoneToSocket[phone];
    }
    delete socketToPhone[socket.id];
    delete selfPhoneBySocket[socket.id];
    unbindDeviceSocket(socket);
    adminSockets.delete(socket.id);

    const roomCode = socketToRoom[socket.id];
    if (roomCode && roomMembers[roomCode]) {
      roomMembers[roomCode].delete(socket.id);
      broadcastRoomMembers(roomCode);
    }
    delete socketToRoom[socket.id];
  });
});

// ---------- কল-এর জন্য TURN সার্ভারের ক্রেডেনশিয়াল (একাধিক ফ্রি সার্ভিস একসাথে) ----------
// আলাদা নেটওয়ার্কের দুই ডিভাইসের মধ্যে কল চালাতে TURN সার্ভার লাগে। ক্রেডেনশিয়াল পাবলিক
// GitHub-এ না রেখে Render-এর Environment-এ রাখা হয়। যতগুলো সার্ভিসের তথ্য দেওয়া থাকবে, সব
// একসাথে ব্রাউজারে যায় — একটা ফুরিয়ে গেলে বা বন্ধ থাকলে অন্যটা দিয়ে কল চলবে।
//
//  ১) Metered (কার্ড ছাড়া ০.৫ GB, কার্ড দিলে ২০ GB):
//       METERED_APP = অ্যাপের নাম (যেমন ektchatter),  METERED_API_KEY = API Key
//  ২) Cloudflare (মাসে ১,০০০ GB ফ্রি, কার্ড/PayPal লাগে):
//       CF_TURN_KEY_ID,  CF_TURN_API_TOKEN
//  ৩) যেকোনো অন্য সার্ভিস (ExpressTURN, Turnix, Xirsys ইত্যাদি) — ড্যাশবোর্ডের ক্রেডেনশিয়াল দিয়ে:
//       EXTRA_ICE_SERVERS = [{"urls":"turn:সার্ভার:3478","username":"...","credential":"..."}]
let iceCache = { at: 0, data: null };

async function fetchIceFromCloudflare(keyId, token) {
  const r = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: 86400 }),
    }
  );
  if (!r.ok) throw new Error("Cloudflare TURN API status " + r.status);
  const body = await r.json();
  return Array.isArray(body.iceServers) ? body.iceServers : body.iceServers ? [body.iceServers] : [];
}

async function fetchIceFromMetered(appName, apiKey) {
  const r = await fetch(
    `https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`
  );
  if (!r.ok) throw new Error("Metered TURN API status " + r.status);
  const body = await r.json();
  return Array.isArray(body) ? body : [];
}

function readExtraIceServers() {
  const raw = process.env.EXTRA_ICE_SERVERS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  } catch (e) {
    console.error("EXTRA_ICE_SERVERS সঠিক JSON নয়:", e.message);
    return [];
  }
}

app.get("/api/ice-servers", async (req, res) => {
  res.set("Cache-Control", "no-store");

  try {
    if (iceCache.data && Date.now() - iceCache.at < 60 * 60 * 1000) {
      return res.json(iceCache.data);
    }

    const jobs = [];
    if (typeof fetch === "function") {
      if (process.env.METERED_APP && process.env.METERED_API_KEY) {
        jobs.push(["metered", fetchIceFromMetered(process.env.METERED_APP, process.env.METERED_API_KEY)]);
      }
      if (process.env.CF_TURN_KEY_ID && process.env.CF_TURN_API_TOKEN) {
        jobs.push(["cloudflare", fetchIceFromCloudflare(process.env.CF_TURN_KEY_ID, process.env.CF_TURN_API_TOKEN)]);
      }
    }
    const extra = readExtraIceServers();
    if (extra.length) jobs.push(["extra", Promise.resolve(extra)]);

    if (!jobs.length) return res.json({ iceServers: [], hasTurn: false, providers: [] });

    const results = await Promise.allSettled(jobs.map((j) => j[1]));
    let list = [];
    const providers = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled" && Array.isArray(r.value) && r.value.length) {
        list = list.concat(r.value);
        providers.push(jobs[i][0]);
      } else if (r.status === "rejected") {
        console.error(`ICE provider "${jobs[i][0]}" failed:`, r.reason && r.reason.message);
      }
    });

    // পোর্ট 53 ফায়ারফক্সে সমস্যা করে, তাই বাদ দেওয়া হলো
    list = list
      .map((s) => {
        const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter(
          (u) => u && !/:53(\?|$)/.test(u)
        );
        return { ...s, urls };
      })
      .filter((s) => s.urls.length);

    const data = { iceServers: list, hasTurn: list.some((s) => s.username), providers };
    // শুধু সফল হলেই ক্যাশ করা হয়, নইলে পরের রিকোয়েস্টে আবার চেষ্টা হবে
    if (list.length) iceCache = { at: Date.now(), data };
    res.json(data);
  } catch (e) {
    console.error("ICE server fetch failed:", e.message);
    res.json({ iceServers: [], hasTurn: false, providers: [] });
  }
});

// Fallback: send index.html for any other route (so refreshing on Render works)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const PORT = process.env.PORT || 3000;
(async () => {
  try {
    await connectMongo();
  } catch (e) {
    // MongoDB সেট করা আছে কিন্তু কানেক্ট হয়নি — ফাঁকা ডেটা নিয়ে চালু হলে পরে সব মুছে যেতে পারে, তাই বন্ধ করে দেওয়া হলো
    console.error("❌ MongoDB connection failed:", e.message);
    process.exit(1);
  }
  try {
    await loadData();
  } catch (e) {
    console.error("Could not load saved data:", e.message);
    if (mongoCol) process.exit(1); // লোড না হলে সেভ করলে পুরোনো ডেটা ওভাররাইট হয়ে যাবে
  }
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
})();
