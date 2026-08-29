const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());

// স্ট্যাটিক ফাইলসমূহ (index.html, style.css, app.js) সার্ভ করার জন্য
app.use(express.static(path.join(__dirname)));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e8 // ৫০ থেকে ১০০ মেগাবাইট পর্যন্ত ফাইল আপলোড সাপোর্ট করার জন্য
});

// ইউজারের ডেটাবেজ (মেমোরিতে জমা রাখা)
const users = {};
// রুমের ফাইল ও মেসেজ ডাটা
const roomMessages = {};

io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  // ইউজার রেজিস্টার
  socket.on("register-user", (userData, callback) => {
    if (users[userData.phone]) {
      callback({ success: false, message: "এই নম্বরটি ইতিমধ্যেই নিবন্ধিত!" });
    } else {
      users[userData.phone] = userData;
      callback({ success: true, user: userData });
    }
  });

  // ইউজার লগইন
  socket.on("login-user", (credentials, callback) => {
    const user = users[credentials.phone];
    if (user && user.password === credentials.password) {
      callback({ success: true, user: user });
    } else {
      callback({ success: false, message: "ফোন নম্বর বা পাসওয়ার্ড ভুল!" });
    }
  });

  // রুমে জয়েন করা
  socket.on("join-room", ({ roomCode, user, peerId }) => {
    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.userData = user;

    if (!roomMessages[roomCode]) {
      roomMessages[roomCode] = [];
    }

    // নোটিফিকেশন পাঠানো
    socket.to(roomCode).emit("user-joined-notify", { user });
  });

  // মেসেজ ও ফাইল সেন্ড করা
  socket.on("send-message", (msgData) => {
    const roomCode = msgData.roomCode;
    if (roomMessages[roomCode]) {
      roomMessages[roomCode].push(msgData);
    }
    io.to(roomCode).emit("receive-message", msgData);
  });

  // কল দেওয়া
  socket.on("call-user", (data) => {
    socket.to(data.roomCode).emit("incoming-call", data);
  });

  // কল কেটে দেওয়া
  socket.on("end-call", (data) => {
    socket.to(data.roomCode).emit("call-ended");
  });

  // রুম থেকে বের হয়ে যাওয়া (Manual Leave)
  socket.on("leave-room", ({ roomCode }) => {
    socket.leave(roomCode);
    checkAndCleanRoom(roomCode);
  });

  // সকেট ডিসকানেক্ট হলে বা পেজ ক্লোজ করলে
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    if (socket.roomCode) {
      checkAndCleanRoom(socket.roomCode);
    }
  });

  // রুমে সদস্য সংখ্যা চেক করে ০ হলে ফাইল ও মেসেজ অটো ডিলিট করার ফাংশন
  function checkAndCleanRoom(roomCode) {
    const room = io.sockets.adapter.rooms.get(roomCode);
    const numClients = room ? room.size : 0;

    console.log(`Room ${roomCode} active users: ${numClients}`);

    // যদি রুমে কেউ না থাকে (লোকসংখ্যা 0)
    if (numClients === 0) {
      if (roomMessages[roomCode]) {
        delete roomMessages[roomCode]; // সমস্ত মেসেজ ও ফাইল সার্ভার থেকে অটো ডিলিট
        console.log(`🧹 Room ${roomCode} empty! All messages & files automatically deleted.`);
      }
    }
  }
});

// যে কোনো URL-এ রিফ্রেশ করলেও যেন একই পেজ লোড হয় (Catch-all route)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
