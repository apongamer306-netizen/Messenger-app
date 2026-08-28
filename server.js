const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  maxHttpBufferSize: 1e8
});

app.use(express.static(__dirname));

// মেমোরি ডাটাবেজ (লগইন/সাইন-আপ ডাটা পারমানেন্ট রাখার জন্য)
const registeredUsers = {}; // { phone: { name, phone, password, pic } }

io.on("connection", (socket) => {
  // ১. অ্যাকাউন্ট সাইন-আপ
  socket.on("register-user", (userData, callback) => {
    if (registeredUsers[userData.phone]) {
      callback({ success: false, message: "এই নম্বর দিয়ে ইতিমধ্যে অ্যাকাউন্ট খোলা হয়েছে!" });
    } else {
      registeredUsers[userData.phone] = userData;
      callback({ success: true, user: userData });
    }
  });

  // ২. অ্যাকাউন্ট লগইন
  socket.on("login-user", ({ phone, password }, callback) => {
    const user = registeredUsers[phone];
    if (user && user.password === password) {
      callback({ success: true, user: user });
    } else {
      callback({ success: false, message: "ফোন নম্বর অথবা পাসওয়ার্ডটি সঠিক নয়!" });
    }
  });

  // ৩. চ্যাট রুম কানেকশন
  socket.on("join-room", ({ roomCode, user, peerId }) => {
    socket.join(roomCode);
    socket.peerId = peerId;
    socket.roomCode = roomCode;
    socket.userName = user.name;
    
    // রুমে থাকা বাকিদের জানানো
    io.to(roomCode).emit("user-joined-notify", { user, peerId });
  });

  // ৪. রিয়েল-টাইম মেসেজিং
  socket.on("send-message", (msgData) => {
    io.to(msgData.roomCode).emit("receive-message", msgData);
  });

  // ৫. অডিও/ভিডিও কলিং সিগন্যালিং
  socket.on("call-user", ({ roomCode, callerName, callerPeerId, callType }) => {
    socket.to(roomCode).emit("incoming-call", { callerName, callerPeerId, callType });
  });

  socket.on("end-call", ({ roomCode }) => {
    socket.to(roomCode).emit("call-ended");
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
