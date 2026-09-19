const express = require("express");
const http = require("http");
const cors = require("cors");
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

// ================= IN-MEMORY DATA STORE =================
// NOTE: this resets whenever the server restarts. Fine for a demo/small app;
// swap for a real database later if you need messages/users to persist permanently.

const users = {};              // phone -> { name, phone, password, pic }
const friendships = {};        // phone -> Set(phone)
const friendRequests = {};     // phone -> Set(phone)  (requests received BY this phone)
const blockedUsers = {};       // phone -> Set(phone)  (phones THIS user has blocked)
const directMessages = {};     // "phoneA|phoneB" (sorted) -> [ messages ]
const roomMessages = {};       // roomCode -> [ messages ]
const roomMembers = {};        // roomCode -> Map(socket.id -> { user, peerId })

const phoneToSocket = {};      // phone -> socket.id
const socketToPhone = {};      // socket.id -> phone
const socketToRoom = {};       // socket.id -> roomCode

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

function sendFriendData(phone) {
  const socketId = phoneToSocket[phone];
  if (!socketId) return;
  const requests = Array.from(ensureSet(friendRequests, phone)).map(publicUser);
  const friends = Array.from(ensureSet(friendships, phone)).map(publicUser);
  io.to(socketId).emit("friend-list-updated", { requests, friends });
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
    if (newUser && newUser.phone && !users[newUser.phone]) {
      users[newUser.phone] = newUser;
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

  // ---------- FRIENDS ----------
  socket.on("get-friend-data", ({ phone }, callback) => {
    const requests = Array.from(ensureSet(friendRequests, phone)).map(publicUser);
    const friends = Array.from(ensureSet(friendships, phone)).map(publicUser);
    if (typeof callback === "function") callback({ requests, friends });
  });

  socket.on("send-friend-request", ({ fromUser, toUserPhone }) => {
    if (!fromUser || !toUserPhone || fromUser.phone === toUserPhone) return;
    // keep users store fresh
    users[fromUser.phone] = { ...(users[fromUser.phone] || {}), ...fromUser };
    ensureSet(friendRequests, toUserPhone).add(fromUser.phone);

    const targetSocket = phoneToSocket[toUserPhone];
    if (targetSocket) io.to(targetSocket).emit("receive-friend-request");
  });

  socket.on("accept-friend-request", ({ currentUser, friendUser }) => {
    if (!currentUser || !friendUser) return;
    ensureSet(friendships, currentUser.phone).add(friendUser.phone);
    ensureSet(friendships, friendUser.phone).add(currentUser.phone);
    ensureSet(friendRequests, currentUser.phone).delete(friendUser.phone);

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

    const targetSocket = phoneToSocket[receiverPhone];
    if (targetSocket) io.to(targetSocket).emit("receive-direct-message", msgData);

    if (typeof callback === "function") callback({ success: true });
  });

  socket.on("clear-direct-history", ({ senderPhone, receiverPhone }, callback) => {
    const key = directKey(senderPhone, receiverPhone);
    delete directMessages[key];
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
    if (typeof callback === "function") callback({ success: true, isBlocked });
  });

  // ---------- ROOMS / GROUP CHAT ----------
  socket.on("join-room", ({ roomCode, user, peerId }) => {
    if (!roomCode || !user) return;
    socket.join(roomCode);
    socketToRoom[socket.id] = roomCode;

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

    socket.to(roomCode).emit("receive-message", msgData);
    if (typeof callback === "function") callback();
  });

  socket.on("set-room-theme", ({ roomCode, themeData }) => {
    if (!roomCode) return;
    socket.to(roomCode).emit("room-theme-update", themeData);
  });

  // ---------- AUDIO / VIDEO CALL SIGNALING (via PeerJS + room broadcast) ----------
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
