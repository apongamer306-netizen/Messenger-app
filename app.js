const socket = io();
let masterKey = "KT EYAMIN";
let isSignupMode = false;
let currentRoom = "";
let currentUser = { name: "", pic: "" };

document.addEventListener("DOMContentLoaded", () => {
    // সেসন অনুযায়ী ইউজার নেম সেট করা (যাতে একই ব্রাউজারে ওভাররাইট না হয়)
    const savedName = sessionStorage.getItem("session_userName") || localStorage.getItem("userName") || "User Name";
    const savedPic = sessionStorage.getItem("session_userPic") || localStorage.getItem("userProfilePic");

    currentUser.name = savedName;
    currentUser.pic = savedPic;

    // ক্লিক ও কিবোর্ড প্রেস ব্যাকআপ হ্যান্ডলার যুক্ত করা
    const sendBtn = document.querySelector('.fa-paper-plane')?.parentElement;
    if (sendBtn) sendBtn.onclick = sendMessage;

    const msgInput = document.getElementById('msg-input');
    if (msgInput) {
        msgInput.onkeypress = (e) => {
            if (e.key === 'Enter') sendMessage();
        };
    }
});

function createRoom() {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    currentRoom = code;

    document.getElementById('dashboard-screen').classList.add('hidden');
    document.getElementById('room-screen').classList.remove('hidden');
    document.getElementById('active-room-id').innerText = code;
    
    // হেডার ও ইন্টারফেসে নাম বসানো
    document.getElementById('room-user-name').innerText = currentUser.name;
    if (currentUser.pic && document.getElementById('room-user-pic')) {
        document.getElementById('room-user-pic').src = currentUser.pic;
    }

    document.getElementById('chat-box').innerHTML = '';

    socket.emit('create-room', {
        roomId: code,
        hostName: currentUser.name,
        hostPic: currentUser.pic
    });
}

function joinRoom() {
    const code = document.getElementById('join-code-input').value.trim().toUpperCase();
    if (!code) return alert("রুম কোড দিন!");

    currentRoom = code;

    document.getElementById('dashboard-screen').classList.add('hidden');
    document.getElementById('room-screen').classList.remove('hidden');
    document.getElementById('active-room-id').innerText = code;

    document.getElementById('chat-box').innerHTML = '';

    socket.emit('join-room', {
        roomId: code,
        userName: currentUser.name,
        userPic: currentUser.pic
    });
}

// জয়েন করার পর কার রুমে ঢুকেছে তা হেডার ও মেসেজে আপডেট করা
socket.on('joined-room-info', (data) => {
    // ১.getHeader-এ হোস্টের নাম ও ছবি আপডেট
    const roomUserTitle = document.getElementById('room-user-name');
    if (roomUserTitle) roomUserTitle.innerText = data.hostName;

    if (data.hostPic && document.getElementById('room-user-pic')) {
        document.getElementById('room-user-pic').src = data.hostPic;
    }

    // ২. চ্যাটবক্সে "You joined X's room" দেখানো
    const chatBox = document.getElementById('chat-box');
    const sysDiv = document.createElement('div');
    sysDiv.style.cssText = 'text-align: center; font-size: 13px; color: #38bdf8; margin: 10px 0; font-weight: 500;';
    sysDiv.innerText = `You joined ${data.hostName}'s room`;
    chatBox.appendChild(sysDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
});

// হোস্টের স্ক্রিনে নোটিফিকেশন যাওয়া
socket.on('user-joined-notify', (data) => {
    const chatBox = document.getElementById('chat-box');
    const sysDiv = document.createElement('div');
    sysDiv.style.cssText = 'text-align: center; font-size: 13px; color: #4ade80; margin: 10px 0; font-weight: 500;';
    sysDiv.innerText = `${data.userName} joined the room`;
    chatBox.appendChild(sysDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
});

// -----------------------------------------------------------------
// গ্যারান্টিড মেসেজ সেন্ড ও রিসিভ
// -----------------------------------------------------------------

async function sendMessage() {
    const msgInput = document.getElementById('msg-input');
    const msg = msgInput.value.trim();

    if (msg !== "" && currentRoom !== "") {
        socket.emit('send-message', {
            roomId: currentRoom,
            message: msg,
            senderName: currentUser.name
        });
        msgInput.value = '';
    }
}

socket.on('receive-message', (data) => {
    const chatBox = document.getElementById('chat-box');
    const isSelf = data.senderName === currentUser.name;

    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-message ${isSelf ? 'self' : ''}`;
    
    // মেসেজ বাবল ডিজাইন
    msgDiv.style.cssText = `
        max-width: 70%;
        padding: 8px 14px;
        margin: 5px 0;
        border-radius: 12px;
        word-break: break-word;
        font-size: 14px;
        ${isSelf ? 'margin-left: auto; background-color: #2563eb; color: #fff;' : 'margin-right: auto; background-color: #334155; color: #fff;'}
    `;
    
    msgDiv.innerText = data.message;

    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
});
