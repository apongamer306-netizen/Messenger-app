const socket = io();

// Master Key (Change if needed)
const MASTER_KEY = "1234"; 

let currentUser = null;
let currentRoomId = null;
let currentDirectRoomId = null;

// DOM Elements
const masterKeyModal = document.getElementById('master-key-modal');
const masterKeyInput = document.getElementById('master-key-input');
const masterKeySubmitBtn = document.getElementById('master-key-submit-btn');

const authContainer = document.getElementById('auth-container');
const authUsername = document.getElementById('auth-username');
const authPassword = document.getElementById('auth-password');
const authActionBtn = document.getElementById('auth-action-btn');

const appDashboard = document.getElementById('app-dashboard');
const displayUserName = document.getElementById('display-user-name');
const logoutBtn = document.getElementById('logout-btn');

const activeRoomBox = document.getElementById('active-room-box');
const currentRoomCodeSpan = document.getElementById('current-room-code');
const createRoomBtn = document.getElementById('create-room-btn');
const joinRoomInput = document.getElementById('join-room-input');
const joinRoomBtn = document.getElementById('join-room-btn');
const leaveRoomBtn = document.getElementById('leave-room-btn');

const roomChatMessages = document.getElementById('room-chat-messages');
const roomChatInput = document.getElementById('room-chat-input');
const sendRoomMsgBtn = document.getElementById('send-room-msg-btn');

const friendsListContainer = document.getElementById('friends-list-container');
const directChatBox = document.getElementById('direct-chat-box');
const directChatUserSpan = document.getElementById('direct-chat-user');
const directChatMessages = document.getElementById('direct-chat-messages');
const directChatInput = document.getElementById('direct-chat-input');
const sendDirectMsgBtn = document.getElementById('send-direct-msg-btn');

// --- 1. Master Key Validation (Always Prompts First) ---
window.addEventListener('DOMContentLoaded', () => {
    sessionStorage.removeItem('mk_verified');
    masterKeyModal.classList.remove('hidden');
});

masterKeySubmitBtn.addEventListener('click', () => {
    const enteredKey = masterKeyInput.value.trim();
    if (enteredKey === MASTER_KEY) {
        sessionStorage.setItem('mk_verified', 'true');
        masterKeyModal.classList.add('hidden');
        checkAuthentication();
    } else {
        alert('ভুল মাস্টার কি! সঠিক মাস্টার কি দিয়ে আবার চেষ্টা করুন।');
    }
});

function checkAuthentication() {
    const savedUser = localStorage.getItem('app_saved_user');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        initDashboard();
    } else {
        authContainer.classList.remove('hidden');
    }
}

// --- 2. Auth Flow ---
authActionBtn.addEventListener('click', () => {
    const username = authUsername.value.trim();
    if (!username) return alert('দয়া করে ইউজারনেম দিন');

    currentUser = {
        id: 'usr_' + Date.now(),
        name: username
    };

    localStorage.setItem('app_saved_user', JSON.stringify(currentUser));
    authContainer.classList.add('hidden');
    initDashboard();
});

logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('app_saved_user');
    sessionStorage.clear();
    location.reload();
});

// --- 3. Dashboard Initialization ---
function initDashboard() {
    appDashboard.classList.remove('hidden');
    displayUserName.textContent = currentUser.name;

    socket.emit('register-user', currentUser);

    const savedRoom = sessionStorage.getItem('active_room_code');
    if (savedRoom) {
        joinRoom(savedRoom);
    }
}

// Nav Tabs Navigation
function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));

    if (tabName === 'rooms') {
        document.getElementById('tab-rooms').classList.remove('hidden');
        document.getElementById('nav-rooms-btn').classList.add('active');
    } else if (tabName === 'friends') {
        document.getElementById('tab-friends').classList.remove('hidden');
        document.getElementById('nav-friends-btn').classList.add('active');
    }
}

// --- 4. Room Management ---
createRoomBtn.addEventListener('click', () => {
    const generatedRoomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    joinRoom(generatedRoomCode);
});

joinRoomBtn.addEventListener('click', () => {
    const code = joinRoomInput.value.trim();
    if (code) joinRoom(code);
});

function joinRoom(roomId) {
    currentRoomId = roomId;
    sessionStorage.setItem('active_room_code', roomId);

    currentRoomCodeSpan.textContent = roomId;
    activeRoomBox.classList.remove('hidden');

    socket.emit('join-room', { roomId, user: currentUser });
}

leaveRoomBtn.addEventListener('click', () => {
    sessionStorage.removeItem('active_room_code');
    currentRoomId = null;
    activeRoomBox.classList.add('hidden');
    roomChatMessages.innerHTML = '';
});

sendRoomMsgBtn.addEventListener('click', sendRoomMessage);
function sendRoomMessage() {
    const text = roomChatInput.value.trim();
    if (!text || !currentRoomId) return;

    const messageData = {
        sender: currentUser.name,
        text: text,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    socket.emit('send-room-message', { roomId: currentRoomId, message: messageData });
    roomChatInput.value = '';
}

socket.on('receive-room-message', (msg) => {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('msg-item');
    msgDiv.innerHTML = `<strong>${msg.sender}:</strong> ${msg.text}`;
    roomChatMessages.appendChild(msgDiv);
    roomChatMessages.scrollTop = roomChatMessages.scrollHeight;
});

socket.on('room-history', (messages) => {
    roomChatMessages.innerHTML = '';
    messages.forEach(msg => {
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('msg-item');
        msgDiv.innerHTML = `<strong>${msg.sender}:</strong> ${msg.text}`;
        roomChatMessages.appendChild(msgDiv);
    });
});

// --- 5. Friends & Direct Messaging System ---
document.getElementById('add-friend-in-room-btn').addEventListener('click', () => {
    alert('রুমের অন্য বন্ধুদের কাছে ফ্রেন্ড রিকোয়েস্ট পাঠানো হয়েছে!');
});

socket.on('update-friends-list', (friends) => {
    friendsListContainer.innerHTML = '';
    
    if(friends.length === 0) {
        friendsListContainer.innerHTML = '<p>আপনার কোনো ফ্রেন্ড যুক্ত নেই।</p>';
        return;
    }

    friends.forEach(friend => {
        const friendCard = document.createElement('div');
        friendCard.classList.add('friend-card');
        
        const statusClass = friend.isOnline ? 'online' : '';

        friendCard.innerHTML = `
            <div class="profile-avatar">
                ${friend.id.substring(4, 6)}
                <span class="status-indicator ${statusClass}"></span>
            </div>
            <div>
                <h4>Friend (${friend.id.substring(0, 6)})</h4>
                <small>${friend.isOnline ? 'অনলাইন আছে' : 'অফলাইন'}</small>
            </div>
        `;

        friendCard.addEventListener('click', () => {
            startDirectChat(friend.id);
        });

        friendsListContainer.appendChild(friendCard);
    });
});

socket.on('friend-status-change', () => {
    socket.emit('register-user', currentUser);
});

function startDirectChat(friendId) {
    directChatUserSpan.textContent = friendId;
    directChatBox.classList.remove('hidden');
    socket.emit('start-direct-chat', { friendId });
}

socket.on('direct-chat-started', ({ directRoomId }) => {
    currentDirectRoomId = directRoomId;
    directChatMessages.innerHTML = '';
});

function closeDirectChat() {
    directChatBox.classList.add('hidden');
    currentDirectRoomId = null;
}

sendDirectMsgBtn.addEventListener('click', () => {
    const text = directChatInput.value.trim();
    if (!text || !currentDirectRoomId) return;

    const messageData = {
        sender: currentUser.name,
        text: text
    };

    socket.emit('send-direct-message', { directRoomId: currentDirectRoomId, message: messageData });
    directChatInput.value = '';
});

socket.on('receive-direct-message', (msg) => {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('msg-item');
    msgDiv.innerHTML = `<strong>${msg.sender}:</strong> ${msg.text}`;
    directChatMessages.appendChild(msgDiv);
    directChatMessages.scrollTop = directChatMessages.scrollHeight;
});
