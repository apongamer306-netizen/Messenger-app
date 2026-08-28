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
  }
});

app.use(express.static(path.join(__dirname, "./")));

io.on("connection", (socket) => {

  socket.on("join-room", ({ roomCode, user, ownerName }) => {
    socket.join(roomCode);
    io.to(roomCode).emit("user-joined-notify", { user, ownerName });
  });

  socket.on("send-message", (msgData) => {
    io.to(msgData.roomCode).emit("receive-message", msgData);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
