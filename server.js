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
});

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// Serve the frontend files (index.html, app.js, style.css) from this same folder
app.use(express.static(path.join(__dirname)));

// ================= DATA STORE (now saved to disk) =================
// আগে সব ডেটা শুধু মেমোরিতে ছিল, তাই সার্ভার রিস্টার্ট/স্লিপ হলেই ফ্রেন্ড লিস্ট
// মুছে যেত। এখন ডেটা app-data.json ফাইলে সেভ হয় এবং সার্ভার চালু হলে আবার লোড হয়।

const DATA_FILE = path.join(__dirname, "app-data.json");
const MAX_SAVED_MESSAGES = 100; // প্রতি চ্যাটে সর্বশেষ কতগুলো মেসেজ ফাইলে রাখা হবে

let users = {};              // phone -> { name, phone, password, pic }
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
      };
      fs.writeFileSync(DATA_FILE, JSON.stringify(payload));
    } catch (e) {
      console.error("Could not save data:", e.message);
    }
  }, 1500);
}

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

    if (typeof callback === "function") callback({ success: true });
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
