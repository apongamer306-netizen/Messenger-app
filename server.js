const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ফাইল আপলোড সেটআপ
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ফাইল আপলোড এন্ডপয়েন্ট
app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded");
    res.json({
        filePath: `/uploads/${req.file.filename}`,
        fileType: req.file.mimetype
    });
});

// Realtime Socket Signalling & Chat Handler
io.on('connection', (socket) => {
    
    // রুমে যুক্ত হওয়া
    socket.on('join-room', (roomId, userName) => {
        socket.join(roomId);
        socket.currentRoom = roomId;
    });

    // রুম থেকে লিভ নেওয়া
    socket.on('leave-room', (roomId) => {
        socket.leave(roomId);
    });

    // মেসেজ রিসিভ এবং ব্রডকাস্ট (রুমের সবার কাছে পাঠানো)
    socket.on('send-message', (data) => {
        io.to(data.roomId).emit('receive-message', data);
    });

    // মিডিয়া ফাইল ব্রডকাস্ট
    socket.on('send-file', (data) => {
        io.to(data.roomId).emit('receive-file', data);
    });

    // অডিও/ভিডিও কল সিগন্যালিং
    socket.on('call-user', (data) => {
        socket.to(data.roomId).emit('incoming-call', data);
    });

    socket.on('answer-call', (data) => {
        socket.to(data.roomId).emit('call-accepted', data.signal);
    });

    socket.on('disconnect', () => {
        if (socket.currentRoom) {
            socket.leave(socket.currentRoom);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
