const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    maxHttpBufferSize: 1e8,
    cors: { origin: "*" }
});

const roomsHostMap = {}; // রুমের হোস্টের নাম সেভ রাখার জন্য

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

app.use(express.static(__dirname));
app.use('/uploads', express.static(uploadDir));

app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    res.json({
        filePath: `/uploads/${req.file.filename}`,
        fileName: req.file.originalname,
        fileType: req.file.mimetype
    });
});

io.on('connection', (socket) => {

    // রুমে জয়েনিং এবং হোস্ট ট্র্যাক
    socket.on('join-room', ({ roomId, userName, isHost }) => {
        socket.join(roomId);
        socket.currentRoom = roomId;

        if (isHost) {
            roomsHostMap[roomId] = userName;
        }

        const hostName = roomsHostMap[roomId] || "User";

        // জয়েন করার সাথে সাথে নোটিফিকেশন মেসেজ
        socket.emit('system-message', `You joined ${hostName}'s room`);
    });

    socket.on('leave-room', (roomId) => {
        socket.leave(roomId);
    });

    // রিয়েলটাইম মেসেজ হ্যান্ডলার (একদম ইনস্ট্যান্ট ব্রডকাস্ট)
    socket.on('send-message', (data) => {
        io.to(data.roomId).emit('receive-message', data);
    });

    // রিয়েলটাইম ফাইল সেন্ড
    socket.on('send-file', (data) => {
        io.to(data.roomId).emit('receive-file', data);
    });

    // অডিও/ভিডিও কল
    socket.on('call-user', (data) => {
        socket.to(data.roomId).emit('incoming-call', data);
    });

    socket.on('answer-call', (data) => {
        socket.to(data.roomId).emit('call-accepted', data.signal);
    });

    socket.on('end-call', (data) => {
        socket.to(data.roomId).emit('call-ended');
    });

    socket.on('disconnect', () => {
        if (socket.currentRoom) socket.leave(socket.currentRoom);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
