const express = require('express');
const http = require('http');
const path = require('path');
const multer = require('multer');
const socketIo = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Uploads folder creation
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// Serve static files from root directory
app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.json());

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded.');
    res.json({ filePath: `/uploads/${req.file.filename}`, fileType: req.file.mimetype });
});

io.on('connection', (socket) => {
    socket.on('join-room', (roomId, user) => {
        socket.join(roomId);
        socket.to(roomId).emit('user-connected', user, socket.id);

        socket.on('send-message', (data) => {
            io.to(roomId).emit('receive-message', data);
        });

        socket.on('send-file', (data) => {
            io.to(roomId).emit('receive-file', data);
        });

        socket.on('call-user', (data) => {
            io.to(data.userToCall).emit('call-made', {
                signal: data.signalData,
                from: socket.id,
                name: data.name
            });
        });

        socket.on('answer-call', (data) => {
            io.to(data.to).emit('call-accepted', data.signal);
        });

        socket.on('disconnect', () => {
            socket.to(roomId).emit('user-disconnected', socket.id);
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
