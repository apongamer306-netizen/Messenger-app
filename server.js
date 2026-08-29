const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static(path.join(__dirname, 'public')));

// Store data in-memory
const activeUsers = new Map(); // socket.id -> userData
const onlineUsers = new Map(); // userId -> socket.id
const friendsStore = new Map(); // userId -> Set of friendUserIds
const friendRequests = new Map(); // receiverUserId -> Set of senderUserIds
const roomMessages = new Map(); // roomId -> array of messages

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // 1. User Online Status Tracking
    socket.on('register-user', (user) => {
        if (!user || !user.id) return;
        socket.userId = user.id;
        socket.userData = user;
        
        activeUsers.set(socket.id, user);
        onlineUsers.set(user.id, socket.id);

        if (!friendsStore.has(user.id)) {
            friendsStore.set(user.id, new Set());
        }
        if (!friendRequests.has(user.id)) {
            friendRequests.set(user.id, new Set());
        }

        // Notify friends about online status
        broadcastUserStatus(user.id, 'online');
        sendFriendsList(socket);
    });

    // 2. Room Joining & Messaging
    socket.on('join-room', ({ roomId, user }) => {
        if (!roomId || !user) return;
        
        socket.join(roomId);
        socket.currentRoom = roomId;

        if (!roomMessages.has(roomId)) {
            roomMessages.set(roomId, []);
        }

        // Send existing room history
        socket.emit('room-history', roomMessages.get(roomId));

        // Notify room members
        io.to(roomId).emit('user-joined-room', { user, roomId });
    });

    socket.on('send-room-message', ({ roomId, message }) => {
        if (!roomId || !message) return;
        
        if (!roomMessages.has(roomId)) {
            roomMessages.set(roomId, []);
        }
        
        const history = roomMessages.get(roomId);
        history.push(message);
        if (history.length > 100) history.shift(); // keep last 100

        io.to(roomId).emit('receive-room-message', message);
    });

    // 3. Friend System Logic
    socket.on('send-friend-request', ({ targetUserId }) => {
        const senderId = socket.userId;
        if (!senderId || !targetUserId || senderId === targetUserId) return;

        if (!friendRequests.has(targetUserId)) {
            friendRequests.set(targetUserId, new Set());
        }
        friendRequests.get(targetUserId).add(senderId);

        const targetSocketId = onlineUsers.get(targetUserId);
        if (targetSocketId) {
            io.to(targetSocketId).emit('friend-request-received', {
                fromUser: socket.userData
            });
        }
    });

    socket.on('accept-friend-request', ({ senderId }) => {
        const userId = socket.userId;
        if (!userId || !senderId) return;

        // Add to friends lists
        if (!friendsStore.has(userId)) friendsStore.set(userId, new Set());
        if (!friendsStore.has(senderId)) friendsStore.set(senderId, new Set());

        friendsStore.get(userId).add(senderId);
        friendsStore.get(senderId).add(userId);

        if (friendRequests.has(userId)) {
            friendRequests.get(userId).delete(senderId);
        }

        // Notify both users
        sendFriendsList(socket);
        const senderSocketId = onlineUsers.get(senderId);
        if (senderSocketId) {
            const senderSocket = io.sockets.sockets.get(senderSocketId);
            if (senderSocket) sendFriendsList(senderSocket);
        }
    });

    // 4. Direct 1-on-1 Chat
    socket.on('start-direct-chat', ({ friendId }) => {
        const userId = socket.userId;
        if (!userId || !friendId) return;

        const directRoomId = [userId, friendId].sort().join('_direct_');
        socket.join(directRoomId);

        socket.emit('direct-chat-started', {
            directRoomId,
            friendId
        });
    });

    socket.on('send-direct-message', ({ directRoomId, message }) => {
        io.to(directRoomId).emit('receive-direct-message', message);
    });

    // 5. Disconnect Handler
    socket.on('disconnect', () => {
        if (socket.userId) {
            onlineUsers.delete(socket.userId);
            broadcastUserStatus(socket.userId, 'offline');
        }
        activeUsers.delete(socket.id);
        console.log('User disconnected:', socket.id);
    });

    function broadcastUserStatus(userId, status) {
        const userFriends = friendsStore.get(userId) || new Set();
        userFriends.forEach(friendId => {
            const friendSocketId = onlineUsers.get(friendId);
            if (friendSocketId) {
                io.to(friendSocketId).emit('friend-status-change', { userId, status });
            }
        });
    }

    function sendFriendsList(userSocket) {
        const userId = userSocket.userId;
        const friendIds = Array.from(friendsStore.get(userId) || []);
        
        const friendsList = friendIds.map(fId => ({
            id: fId,
            isOnline: onlineUsers.has(fId)
        }));

        userSocket.emit('update-friends-list', friendsList);
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
