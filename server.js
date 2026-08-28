const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

// Enable CORS for Socket.io
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve static frontend files from current directory
app.use(express.static(path.join(__dirname, "./")));

const roomPeers = {};

io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  // Join Room
  socket.on("join-room", ({ roomCode, user }) => {
    socket.join(roomCode);
    roomPeers[roomCode] = socket.id;
    console.log(`User ${user.name} joined room: ${roomCode}`);
  });

  // Relay Chat Messages & File Attachments
  socket.on("send-message", (msgData) => {
    socket.to(msgData.roomCode).emit("receive-message", msgData);
  });

  // Peer ID Transfer for Audio/Video Calls
  socket.on("request-peer-id", ({ roomCode }) => {
    const peerId = roomPeers[roomCode];
    socket.emit("peer-id-response", peerId);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

// Port settings for local or Render cloud deployment
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
