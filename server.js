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

// রুমে কে হোস্ট আর কে মেম্বার তা ট্র্যাক করার অবজেক্ট
const activeRooms = {}; 

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

    // ১. হোস্ট যখন রুম তৈরি করবে
    socket.on('create-room', ({ roomId, hostName, hostPic }) => {
        socket.join(roomId);
        socket.currentRoom = roomId;
        socket.userName = hostName;
        
        activeRooms[roomId] = {
            hostName: hostName || "User Name",
            hostPic: hostPic || ""
        };
    });

    // ২. মেম্বার যখন কোড দিয়ে জয়েন করবে
    socket.on('join-room', ({ roomId, userName, userPic }) => {
        socket.join(roomId);
        socket.currentRoom = roomId;
        socket.userName = userName;

        const roomData = activeRooms[roomId] || { hostName: 'User Name', hostPic: '' };

        // যে জয়েন করলো তাকে সরাসরি হোস্টের ডাটা পাঠানো
        socket.emit('joined-room-info', {
            hostName: roomData.hostName,
            hostPic: roomData.hostPic
        });

        // হোস্টকে জানানো যে কেউ জয়েন করেছে
        socket.to(roomId).emit('user-joined-notify', {
            userName: userName
        });
    });

    // ৩. রিয়েলটাইম মেসেজ পাঠানো (সবার কাছে ইনস্ট্যান্ট পৌঁছাবে)
    socket.on('send-message', (data) => {
        if (data.roomId) {
            io.to(data.roomId).emit('receive-message', data);
        }
    });

    // ৪. ফাইল পাঠানো
    socket.on('send-file', (data) => {
        if (data.roomId) {
            io.to(data.roomId).emit('receive-file', data);
        }
    });

    // ৫. কলিং ফিচার
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
        if (socket.currentRoom) {
            socket.leave(socket.currentRoom);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
