const express = require("express");
const http = require("http");
const cors = require("cors");
const fs = require("fs");
const { Server } = require("socket.io");
const path = require("path");

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

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    users = raw.users || {};
    friendships = arraysToSets(raw.friendships);
    friendRequests = arraysToSets(raw.friendRequests);
    blockedUsers = arraysToSets(raw.blockedUsers);
    directMessages = raw.directMessages || {};
    roomMessages = raw.roomMessages || {};
    profiles = raw.profiles || {};
    directThemes = raw.directThemes || {};
    console.log("Saved data loaded successfully.");
  } catch (e) {
    console.error("Could not load saved data:", e.message);
  }
}

let saveTimer = null;
function saveData() {
  // বারবার ডিস্কে লেখা এড়াতে অল্প সময় অপেক্ষা করে একসাথে সেভ করা হয়
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const payload = {
        users,
        friendships: setsToArrays(friendships),
        friendRequests: setsToArrays(friendRequests),
        blockedUsers: setsToArrays(blockedUsers),
        directMessages: trimMessages(directMessages),
        roomMessages: trimMessages(roomMessages),
        profiles,
        directThemes,
      };
      fs.writeFileSync(DATA_FILE, JSON.stringify(payload));
    } catch (e) {
      console.error("Could not save data:", e.message);
    }
  }, 1500);
}

try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (e) {
  console.error("Could not prepare DATA_DIR:", e.message);
}
console.log(
  process.env.DATA_DIR
    ? `Using persistent DATA_DIR: ${DATA_DIR} (user data will survive redeploys)`
    : `⚠️ No DATA_DIR set — using ephemeral local folder for app-data.json. ` +
      `User accounts WILL be lost on redeploy/restart unless you add a Render ` +
      `Persistent Disk and set the DATA_DIR env var to its mount path.`
);

loadData();

// সার্ভার বন্ধ হওয়ার আগে শেষবার সেভ করা
["SIGINT", "SIGTERM"].forEach((sig) => {
  process.on(sig, () => {
    try {
      fs.writeFileSync(
        DATA_FILE,
        JSON.stringify({
          users,
          friendships: setsToArrays(friendships),
          friendRequests: setsToArrays(friendRequests),
          blockedUsers: setsToArrays(blockedUsers),
          directMessages: trimMessages(directMessages),
          roomMessages: trimMessages(roomMessages),
          profiles,
          directThemes,
        })
      );
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
      users[newUser.phone] = { ...(users[newUser.phone] || {}), ...newUser };
      saveData();
    }
    if (typeof callback === "function") callback();
  });

  socket.on("login-user", ({ phone, password }, callback) => {
    const user = users[phone];
    if (user && user.password === password) {
      if (typeof callback === "function") callback({ success: true, user });
    } else {
      if (typeof callback === "function") callback({ success: false });
    }
  });

  // ---------- FRIEND RESTORE / SYNC ----------
  // ক্লায়েন্ট তার ব্রাউজারে সেভ থাকা ফ্রেন্ড লিস্ট পাঠায়। সার্ভারের ডেটা কোনো
  // কারণে মুছে গেলে এখান থেকেই আবার তৈরি হয়ে যায় — তাই ফ্রেন্ড হারায় না।
  socket.on("sync-user-data", ({ user, friends }, callback) => {
    if (!user || !user.phone) {
      if (typeof callback === "function") callback({ requests: [], friends: [] });
      return;
    }

    users[user.phone] = { ...(users[user.phone] || {}), ...user };
    socketToPhone[socket.id] = user.phone;
    phoneToSocket[user.phone] = socket.id;

    if (Array.isArray(friends)) {
      friends.forEach((f) => {
        if (!f || !f.phone || f.phone === user.phone) return;
        // বন্ধুর বেসিক তথ্য রাখা (নাম/ছবি) যদি সার্ভারে না থাকে
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

  // ---------- DIRECT MESSAGES ----------
  socket.on("get-direct-history", ({ senderPhone, receiverPhone }, callback) => {
    const key = directKey(senderPhone, receiverPhone);
    if (typeof callback === "function") callback(directMessages[key] || []);
  });

  socket.on("send-direct-message", (msgData, callback) => {
    const { senderPhone, receiverPhone } = msgData;

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
  socket.on("get-profile", ({ phone }, callback) => {
    if (typeof callback !== "function") return;
    const base = publicUser(phone);
    callback({ ...base, ...(profiles[phone] || {}) });
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

  // প্রোফাইলে নতুন ছবি/ভিডিও/অডিও যোগ করা
  socket.on("add-profile-item", ({ phone, item }, callback) => {
    if (!phone || !item) {
      if (typeof callback === "function") callback({ success: false });
      return;
    }
    if (!profiles[phone]) profiles[phone] = {};
    if (!Array.isArray(profiles[phone].items)) profiles[phone].items = [];
    profiles[phone].items.unshift(item);
    // প্রোফাইলে সর্বোচ্চ ৪০টি আইটেম রাখা হয় (ফাইল যেন বেশি বড় না হয়)
    profiles[phone].items = profiles[phone].items.slice(0, 40);
    saveData();

    // ফ্রেন্ডদের জানানো যে নতুন কিছু পোস্ট হয়েছে
    Array.from(ensureSet(friendships, phone)).forEach((friendPhone) => {
      const sid = phoneToSocket[friendPhone];
      if (sid) io.to(sid).emit("friend-profile-updated", { phone });
    });

    if (typeof callback === "function") callback({ success: true, items: profiles[phone].items });
  });

  socket.on("delete-profile-item", ({ phone, itemId }, callback) => {
    if (profiles[phone] && Array.isArray(profiles[phone].items)) {
      profiles[phone].items = profiles[phone].items.filter((it) => it.id !== itemId);
      saveData();
    }
    if (typeof callback === "function") callback({ success: true });
  });

  // ---------- FACEBOOK-স্টাইল টাইমলাইন পোস্ট (ছবি/ভিডিও/টেক্সট + লাইক + কমেন্ট) ----------
  function notifyFriendsOfProfile(phone) {
    Array.from(ensureSet(friendships, phone)).forEach((friendPhone) => {
      const sid = phoneToSocket[friendPhone];
      if (sid) io.to(sid).emit("friend-profile-updated", { phone });
    });
  }

  socket.on("create-post", ({ phone, text, media }, callback) => {
    if (!phone || (!text && !media)) {
      if (typeof callback === "function") callback({ success: false });
      return;
    }
    if (!profiles[phone]) profiles[phone] = {};
    if (!Array.isArray(profiles[phone].posts)) profiles[phone].posts = [];

    const post = {
      id: "post_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      text: (text || "").slice(0, 2000),
      media: media || null,   // { type: "image"|"video", src }
      timestamp: Date.now(),
      likes: [],
      comments: []
    };

    profiles[phone].posts.unshift(post);
    // সর্বোচ্চ ৬০টি পোস্ট রাখা হয়, তার বেশি হলে পুরনোগুলো বাদ যাবে
    profiles[phone].posts = profiles[phone].posts.slice(0, 60);
    saveData();
    notifyFriendsOfProfile(phone);

    if (typeof callback === "function") callback({ success: true, post });
  });

  socket.on("delete-post", ({ phone, postId }, callback) => {
    if (profiles[phone] && Array.isArray(profiles[phone].posts)) {
      profiles[phone].posts = profiles[phone].posts.filter((p) => p.id !== postId);
      saveData();
      notifyFriendsOfProfile(phone);
    }
    if (typeof callback === "function") callback({ success: true });
  });

  socket.on("toggle-like-post", ({ phone, postId, likerPhone }, callback) => {
    const list = profiles[phone] && profiles[phone].posts;
    const post = Array.isArray(list) ? list.find((p) => p.id === postId) : null;
    if (!post) {
      if (typeof callback === "function") callback({ success: false });
      return;
    }
    if (!Array.isArray(post.likes)) post.likes = [];
    const idx = post.likes.indexOf(likerPhone);
    let liked;
    if (idx === -1) { post.likes.push(likerPhone); liked = true; }
    else { post.likes.splice(idx, 1); liked = false; }
    saveData();

    // পোস্টের মালিককে জানানো (তার প্রোফাইল খোলা থাকলে লাইভ আপডেট হবে)
    const ownerSocket = phoneToSocket[phone];
    if (ownerSocket) io.to(ownerSocket).emit("post-updated", { phone, postId, likes: post.likes, comments: post.comments });

    if (typeof callback === "function") callback({ success: true, liked, likes: post.likes });
  });

  socket.on("add-comment", ({ phone, postId, comment }, callback) => {
    const list = profiles[phone] && profiles[phone].posts;
    const post = Array.isArray(list) ? list.find((p) => p.id === postId) : null;
    if (!post || !comment) {
      if (typeof callback === "function") callback({ success: false });
      return;
    }
    if (!Array.isArray(post.comments)) post.comments = [];

    const newComment = {
      id: "cm_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      authorPhone: comment.authorPhone,
      authorName: comment.authorName,
      authorPic: comment.authorPic,
      text: (comment.text || "").slice(0, 500),
      timestamp: Date.now()
    };
    post.comments.push(newComment);
    saveData();

    const ownerSocket = phoneToSocket[phone];
    if (ownerSocket) io.to(ownerSocket).emit("post-updated", { phone, postId, likes: post.likes, comments: post.comments });
    // কমেন্টকারী যদি অন্য কেউ হয়, তাকেও আপডেট পাঠানো (তার স্ক্রিনেও যেন সাথে সাথে দেখা যায়)
    const commenterSocket = phoneToSocket[comment.authorPhone];
    if (commenterSocket && comment.authorPhone !== phone) {
      io.to(commenterSocket).emit("post-updated", { phone, postId, likes: post.likes, comments: post.comments });
    }

    if (typeof callback === "function") callback({ success: true, comment: newComment });
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

// Fallback: send index.html for any other route (so refreshing on Render works)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
