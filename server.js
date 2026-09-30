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

// Serve the frontend files (index.html, app.js, style.css) from this same folder
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

// ================= অ্যাডমিন প্যানেল =================
// অ্যাডমিন প্যানেলে ঢুকতে এই পাসওয়ার্ডটা লাগবে। চাইলে Render-এর Environment
// ভ্যারিয়েবল ADMIN_PASSWORD সেট করে এটা পরিবর্তন করা যাবে (নিরাপত্তার জন্য উত্তম)।
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "tawsiya i love you";

const roomMembers = {};      // roomCode -> Map(socket.id -> { user, peerId })
const phoneToSocket = {};    // phone -> socket.id
const socketToPhone = {};    // socket.id -> phone
const socketToRoom = {};     // socket.id -> roomCode

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
  console.log("Saved data loaded successfully.");
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
  io.to(socketId).emit("friend-list-updated", getFriendPayload(phone));
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
  io.to(roomCode).emit("room-members-update", members);
}

io.on("connection", (socket) => {
  // ---------- USER / SESSION ----------
  socket.on("set-user-socket", ({ phone }) => {
    if (!phone) return;
    socketToPhone[socket.id] = phone;
    phoneToSocket[phone] = socket.id;
  });

  socket.on("register-user", (newUser, callback) => {
    if (newUser && newUser.phone) {
      if (bannedUsers[newUser.phone]) {
        if (typeof callback === "function") callback({ success: false, banned: true });
        return;
      }
      users[newUser.phone] = { ...(users[newUser.phone] || {}), ...newUser };
      saveData();
    }
    if (typeof callback === "function") callback({ success: true });
  });

  socket.on("login-user", ({ phone, password }, callback) => {
    if (typeof callback !== "function") return;
    if (bannedUsers[phone]) {
      callback({
        success: false,
        banned: true,
        reason: (bannedUsers[phone] && bannedUsers[phone].reason) || "আপনার অ্যাকাউন্ট ব্যান করা হয়েছে।",
      });
      return;
    }
    const user = users[phone];
    if (user && user.password === password) {
      callback({ success: true, user });
    } else {
      callback({ success: false });
    }
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
    io.emit("admin-new-report", report); // অ্যাডমিন প্যানেল খোলা থাকলে সে-ই কেবল দেখাবে
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
    callback({ success: true, posts: out.slice(0, 40) });
  });

  // সবার Reels (কেউ আপলোড করলেই সবাই দেখবে)
  socket.on("get-reels", (payload, callback) => {
    if (typeof callback !== "function") return;
    const out = [];
    Object.keys(profiles).forEach((p) => {
      if (bannedUsers[p]) return;
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
      if (sid) io.to(sid).emit("stories-updated");
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
    io.emit("admin-new-report", report);
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
  socket.on("admin-login", ({ password }, callback) => {
    if (typeof callback !== "function") return;
    if (password === ADMIN_PASSWORD) {
      const userList = Object.values(users).map((u) => {
        const p = profiles[u.phone] || {};
        const ban = bannedUsers[u.phone] || null;
        const friendPhones = Array.from(ensureSet(friendships, u.phone));
        const friends = friendPhones.map((fp) => publicUser(fp));
        return {
          name: u.name,
          phone: u.phone,
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
      callback({ success: true, users: userList, reports: reports.slice().reverse(), stories: stories.slice().reverse() });
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
      io.to(sid).emit("account-banned", { reason: bannedUsers[phone].reason });
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
    delete users[phone];
    delete profiles[phone];
    delete friendships[phone];
    delete friendRequests[phone];
    delete blockedUsers[phone];
    delete bannedUsers[phone];
    // remove from others' friend lists / requests
    Object.keys(friendships).forEach((p) => {
      if (friendships[p] && friendships[p].has) friendships[p].delete(phone);
    });
    Object.keys(friendRequests).forEach((p) => {
      if (friendRequests[p] && friendRequests[p].has) friendRequests[p].delete(phone);
    });
    // wipe direct message keys involving this phone
    Object.keys(directMessages).forEach((key) => {
      if (key.split("|").includes(phone)) delete directMessages[key];
    });
    Object.keys(directThemes).forEach((key) => {
      if (key.split("|").includes(phone)) delete directThemes[key];
    });
    saveData();
    const sid = phoneToSocket[phone];
    if (sid) {
      io.to(sid).emit("account-deleted");
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
      io.to(reporterSocket).emit("report-status-update", { reportId: report.id, status: report.status });
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

    users[user.phone] = { ...(users[user.phone] || {}), ...user };
    socketToPhone[socket.id] = user.phone;
    phoneToSocket[user.phone] = socket.id;

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
        if (!f || !f.phone || f.phone === user.phone) return;
        if (!users[f.phone]) {
          users[f.phone] = { name: f.name, phone: f.phone, pic: f.pic };
        }
        ensureSet(friendships, user.phone).add(f.phone);
        ensureSet(friendships, f.phone).add(user.phone);
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
    users[fromUser.phone] = { ...(users[fromUser.phone] || {}), ...fromUser };
    ensureSet(friendRequests, toUserPhone).add(fromUser.phone);
    saveData();

    const targetSocket = phoneToSocket[toUserPhone];
    if (targetSocket) io.to(targetSocket).emit("receive-friend-request");
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
    const myFriends = ensureSet(friendships, myPhone);
    const myOutgoing = []; // optional: track pending outbound — skip for now
    const results = Object.values(users)
      .filter((u) => {
        if (!u || !u.phone || u.phone === myPhone) return false;
        if (bannedUsers[u.phone]) return false;
        const name = (u.name || "").toLowerCase();
        const phone = (u.phone || "").toLowerCase();
        return name.includes(q) || phone.includes(q);
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
    if (targetSocket) io.to(targetSocket).emit("receive-direct-message", msgData);

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
      io.to(senderSocket).emit("direct-messages-seen", { byPhone: viewerPhone });
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
      users[user.phone] = { ...(users[user.phone] || {}), ...user };
      phoneToSocket[user.phone] = socket.id;
      socketToPhone[socket.id] = user.phone;
    }

    if (!roomMembers[roomCode]) roomMembers[roomCode] = new Map();
    roomMembers[roomCode].set(socket.id, { user, peerId });

    socket.to(roomCode).emit("user-joined-notify", { user });
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

    socket.to(roomCode).emit("receive-message", msgData);
    if (typeof callback === "function") callback();
  });

  socket.on("set-room-theme", ({ roomCode, themeData }) => {
    if (!roomCode) return;
    socket.to(roomCode).emit("room-theme-update", themeData);
  });

  // ---------- DIRECT CHAT THEME (দুই পাশেই একসাথে বদলাবে) ----------
  socket.on("set-direct-theme", ({ fromPhone, toPhone, themeData }) => {
    if (!fromPhone || !toPhone) return;
    directThemes[directKey(fromPhone, toPhone)] = themeData || {};
    saveData();
    const targetSocket = phoneToSocket[toPhone];
    if (targetSocket) {
      io.to(targetSocket).emit("direct-theme-update", { fromPhone, themeData });
    }
  });

  socket.on("get-direct-theme", ({ myPhone, friendPhone }, callback) => {
    if (typeof callback === "function") {
      callback(directThemes[directKey(myPhone, friendPhone)] || null);
    }
  });

  // ---------- USER PROFILE (তথ্য + ছবি/ভিডিও/অডিও) ----------
  socket.on("get-profile", ({ phone, viewerPhone }, callback) => {
    if (typeof callback !== "function") return;
    const base = publicUser(phone);
    const p = profiles[phone] || {};
    let relation = "none"; // none | friends | outgoing | incoming | self
    if (viewerPhone && viewerPhone === phone) relation = "self";
    else if (viewerPhone && phone) {
      if (ensureSet(friendships, viewerPhone).has(phone)) relation = "friends";
      else if (ensureSet(friendRequests, phone).has(viewerPhone)) relation = "outgoing";
      else if (ensureSet(friendRequests, viewerPhone).has(phone)) relation = "incoming";
    }
    callback({ ...base, ...p, relation, friendCount: ensureSet(friendships, phone).size });
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
    saveData();
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
    saveData();
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
      if (sid) io.to(sid).emit("friend-profile-updated", { phone });
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
      if (sid) io.to(sid).emit("friend-profile-updated", { phone });
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
      if (sid) io.to(sid).emit("friend-profile-updated", { phone });
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
    targets.forEach((ph) => { const sid = phoneToSocket[ph]; if (sid) io.to(sid).emit("item-updated", payload); });
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
      if (sid) io.to(sid).emit("story-reacted", { storyId: id, phone: reactorPhone, name: u.name || "Someone", type: reacts[reactorPhone] || null, reacts });
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
      if (targetSocket) io.to(targetSocket).emit("receive-direct-message", msg);
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
    if (targetSocket) io.to(targetSocket).emit("direct-call-upgraded");
  });

  socket.on("direct-call-reject", ({ toPhone }) => {
    const targetSocket = phoneToSocket[toPhone];
    if (targetSocket) io.to(targetSocket).emit("direct-call-rejected");
  });

  // ---------- ROOM CALL SIGNALING ----------
  socket.on("call-user", (data) => {
    if (!data || !data.roomCode) return;
    socket.to(data.roomCode).emit("incoming-call", data);
  });

  socket.on("accept-call-notify", ({ roomCode }) => {
    if (!roomCode) return;
    socket.to(roomCode).emit("call-accepted-by-receiver");
  });

  socket.on("end-call", ({ roomCode }) => {
    if (!roomCode) return;
    socket.to(roomCode).emit("call-ended");
  });

  // ---------- DIRECT (FRIEND) CALL SIGNALING ----------
  // রুম কোড ছাড়াই এক ফ্রেন্ড থেকে আরেক ফ্রেন্ডের কাছে কল পাঠানো হয়
  socket.on("direct-call-user", (data) => {
    if (!data || !data.toPhone) return;
    const targetSocket = phoneToSocket[data.toPhone];
    if (targetSocket) {
      io.to(targetSocket).emit("direct-incoming-call", data);
    } else {
      io.to(socket.id).emit("direct-call-unavailable", { toPhone: data.toPhone });
    }
  });

  socket.on("direct-call-accept", ({ toPhone }) => {
    const targetSocket = phoneToSocket[toPhone];
    if (targetSocket) io.to(targetSocket).emit("direct-call-accepted");
  });

  socket.on("direct-call-end", ({ toPhone }) => {
    const targetSocket = phoneToSocket[toPhone];
    if (targetSocket) io.to(targetSocket).emit("direct-call-ended");
  });

  // ---------- DISCONNECT CLEANUP ----------
  socket.on("disconnect", () => {
    const phone = socketToPhone[socket.id];
    if (phone && phoneToSocket[phone] === socket.id) {
      delete phoneToSocket[phone];
    }
    delete socketToPhone[socket.id];

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
