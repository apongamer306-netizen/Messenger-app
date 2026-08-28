const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// সকেট সাইজ ১০০ এমবি পর্যন্ত অ্যালাউ করা
const io = new Server(server, {
    maxHttpBufferSize: 1e8,
    cors: { origin: "*" }
});

// Uploads ফোল্ডার নিশ্চিত করা
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// ফাইল ও ভিডিও সেভ করার স্টোরেজ
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

app.use(express.static(__dirname));
app.use('/uploads', express.static(uploadDir));

// ফাইল আপলোড সার্ভিস API
app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    
    // ফাইলের ডাউনলোড লিংক ও নাম পাঠানো
    res.json({
        filePath: `/uploads/${req.file.filename}`,
        fileName: req.file.originalname,
        fileType: req.file.mimetype
    });
});

// রিয়েলটাইম সকেট ম্যানেজমেন্ট
io.on('connection', (socket) => {

    socket.on('join-room', (roomId, userName) => {
        socket.join(roomId);
        socket.currentRoom = roomId;
        socket.userName = userName;
    });

    socket.on('leave-room', (roomId) => {
        socket.leave(roomId);
    });

    // ১. টেক্সট মেসেজ ব্রডকাস্ট
    socket.on('send-message', (data) => {
        io.in(data.roomId).emit('receive-message', data);
    });

    // ২. ছবি/ভিডিও/ফাইল ব্রডকাস্ট
    socket.on('send-file', (data) => {
        io.in(data.roomId).emit('receive-file', data);
    });

    // ৩. কল রিং দেওয়া (অন্য ফোনে রিং বাজানোর জন্য)
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
