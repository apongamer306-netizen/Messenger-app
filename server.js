const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e8
});

app.use(express.static(__dirname));

io.on("connection", (socket) => {
  // Join Room Functionality Fix
  socket.on("join-room", ({ roomCode, user }) => {
    socket.join(roomCode);
    // রুমের সবাইকে (ইনক্লুডিং যে সদ্য জয়েন করল) নোটিফিকেশন পাঠাবে
    io.to(roomCode).emit("user-joined-notify", { user });
  });

  // Message Sending Broadcast Fix
  socket.on("send-message", (msgData) => {
    io.to(msgData.roomCode).emit("receive-message", msgData);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
