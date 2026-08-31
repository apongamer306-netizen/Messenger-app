const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());

app.use(express.static(path.join(__dirname)));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e8 // ফাইল পাঠানোর সাইজ বড় রাখার জন্য
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const users = {};
const roomMessages = {};

io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.on("register-user", (userData, callback) => {
    users[userData.phone] = userData;
    if (typeof callback === "function") {
      callback({ success: true, user: userData });
    }
  });

  socket.on("login-user", (credentials, callback) => {
    const user = users[credentials.phone];
    if (user && user.password === credentials.password) {
      callback({ success: true, user: user });
    } else {
      callback({ success: false, message: "ফোন নম্বর বা পাসওয়ার্ড ভুল!" });
    }
  });

  socket.on("join-room", ({ roomCode, user, peerId }) => {
    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.userData = user;

    if (!roomMessages[roomCode]) {
      roomMessages[roomCode] = [];
    }
    // রুমে অন্য ইউজারদের নোটিফিকেশন পাঠানো
    socket.to(roomCode).emit("user-joined-notify", { user });
  });

  // পেজ রিফ্রেশ বা পুনরায় যুক্ত হলে আগের চ্যাট হিস্ট্রি ফিরিয়ে দেওয়ার হ্যান্ডলার
  socket.on("get-room-history", (roomCode, callback) => {
    if (roomMessages[roomCode]) {
      callback(roomMessages[roomCode]);
    } else {
      callback([]);
    }
  });

  socket.on("send-message", (msgData, callback) => {
    const roomCode = msgData.roomCode;
    if (!roomMessages[roomCode]) {
      roomMessages[roomCode] = [];
    }
    roomMessages[roomCode].push(msgData);
    
    socket.to(roomCode).emit("receive-message", msgData);

    if (typeof callback === "function") {
      callback({ success: true });
    }
  });

  socket.on("call-user", (data) => {
    socket.to(data.roomCode).emit("incoming-call", data);
  });

  socket.on("accept-call-notify", (data) => {
    socket.to(data.roomCode).emit("call-accepted-by-receiver", data);
  });

  socket.on("end-call", (data) => {
    socket.to(data.roomCode).emit("call-directly-ended") || socket.to(data.roomCode).emit("call-ended");
  });

  socket.on("leave-room", ({ roomCode }) => {
    socket.leave(roomCode);
    checkAndCleanRoom(roomCode);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    if (socket.roomCode) {
      checkAndCleanRoom(socket.roomCode);
    }
  });

  function checkAndCleanRoom(roomCode) {
    const room = io.sockets.adapter.rooms.get(roomCode);
    const numClients = room ? room.size : 0;

    if (numClients === 0) {
      if (roomMessages[roomCode]) {
        delete roomMessages[roomCode];
      }
    }
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
