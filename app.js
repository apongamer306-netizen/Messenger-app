const socket = io();
let masterKey = "KT EYAMIN";
let isSignupMode = false;
let currentRoom = "";
let customThemeUrl = "";
let localStream = null;
let peer = null;

// DOM লোড হওয়ার সাথে সাথে থিম সেট করা
document.addEventListener("DOMContentLoaded", () => {
    const savedTheme = localStorage.getItem("appTheme") || "light";
    applyTheme(savedTheme);
});

// ডার্ক এবং লাইট মোড টগল ফাংশন
function toggleTheme() {
    const isLight = document.body.classList.contains("light-mode");
    const newTheme = isLight ? "dark" : "light";
    
    applyTheme(newTheme);
    localStorage.setItem("appTheme", newTheme); // LocalStorage-এ সেভ রাখা
}

function applyTheme(theme) {
    const themeBtn = document.getElementById("theme-btn");
    
    if (theme === "dark") {
        document.body.classList.remove("light-mode");
        if (themeBtn) themeBtn.innerHTML = '<i class="fa-solid fa-sun"></i>';
    } else {
        document.body.classList.add("light-mode");
        if (themeBtn) themeBtn.innerHTML = '<i class="fa-solid fa-moon"></i>';
    }
}

// আইকন দিয়ে পাসওয়ার্ড দেখা ও লুকানোর ফাংশন
function togglePasswordVisibility(inputId, icon) {
    const input = document.getElementById(inputId);
    if (input.type === "password") {
        input.type = "text";
        icon.classList.remove("fa-eye");
        icon.classList.add("fa-eye-slash");
    } else {
        input.type = "password";
        icon.classList.remove("fa-eye-slash");
        icon.classList.add("fa-eye");
    }
}

function unlockSite() {
    const enteredKey = document.getElementById('site-key-input').value;
    if (enteredKey === masterKey) {
        document.getElementById('site-lock-screen').classList.add('hidden');
        document.getElementById('auth-screen').classList.remove('hidden');
    } else {
        alert("ভুল পাসওয়ার্ড!");
    }
}

function toggleAuthMode() {
    isSignupMode = !isSignupMode;
    document.getElementById('auth-title').innerText = isSignupMode ? "Create Account" : "Login";
    document.getElementById('auth-btn').innerText = isSignupMode ? "Sign Up" : "Login";
    document.getElementById('auth-toggle').innerText = isSignupMode ? "Already have account? Login" : "Create New Account";
}

function handleAuth() {
    const phone = document.getElementById('auth-phone').value;
    const pass = document.getElementById('auth-pass').value;

    if (!phone || !pass) return alert("ফোন ও পাসওয়ার্ড দিন");

    localStorage.setItem('userPhone', phone);
    document.getElementById('user-display-name').innerText = "User: " + phone;

    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('dashboard-screen').classList.remove('hidden');
}

function previewProfilePic(event) {
    const reader = new FileReader();
    reader.onload = () => { document.getElementById('profile-img-preview').src = reader.result; };
    reader.readAsDataURL(event.target.files[0]);
}

function setCustomTheme(event) {
    const reader = new FileReader();
    reader.onload = () => {
        customThemeUrl = reader.result;
        alert("থিম সেট করা হয়েছে!");
    };
    reader.readAsDataURL(event.target.files[0]);
}

function createRoom() {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    document.getElementById('room-code').innerText = code;
    document.getElementById('created-code-display').classList.remove('hidden');
}

function joinRoom() {
    const code = document.getElementById('join-code-input').value.trim();
    if (!code) return alert("রুম কোড দিন");

    currentRoom = code;
    document.getElementById('dashboard-screen').classList.add('hidden');
    document.getElementById('room-screen').classList.remove('hidden');
    document.getElementById('active-room-id').innerText = code;

    if (customThemeUrl) {
        document.getElementById('chat-box').style.backgroundImage = `url(${customThemeUrl})`;
    }

    socket.emit('join-room', currentRoom, localStorage.getItem('userPhone'));
}

function logout() { location.reload(); }

function leaveRoom() {
    document.getElementById('room-screen').classList.add('hidden');
    document.getElementById('dashboard-screen').classList.remove('hidden');
}

function sendMessage() {
    const msg = document.getElementById('msg-input').value;
    const fileInput = document.getElementById('file-input');

    if (fileInput.files.length > 0) {
        const formData = new FormData();
        formData.append('file', fileInput.files[0]);

        fetch('/upload', { method: 'POST', body: formData })
            .then(res => res.json())
            .then(data => {
                socket.emit('send-file', { roomId: currentRoom, fileUrl: data.filePath, fileType: data.fileType, user: localStorage.getItem('userPhone') });
                fileInput.value = '';
            });
    }

    if (msg) {
        socket.emit('send-message', { roomId: currentRoom, message: msg, user: localStorage.getItem('userPhone') });
        document.getElementById('msg-input').value = '';
    }
}

socket.on('receive-message', (data) => {
    const chatBox = document.getElementById('chat-box');
    chatBox.innerHTML += `<p><strong>${data.user}:</strong> ${data.message}</p>`;
    chatBox.scrollTop = chatBox.scrollHeight;
});

socket.on('receive-file', (data) => {
    const chatBox = document.getElementById('chat-box');
    let content = '';

    if (data.fileType.startsWith('image/')) {
        content = `<img src="${data.fileUrl}" style="max-width:100%; border-radius:5px;">`;
    } else if (data.fileType.startsWith('video/')) {
        content = `<video src="${data.fileUrl}" controls style="max-width:100%;"></video>`;
    } else if (data.fileType.startsWith('audio/')) {
        content = `<audio src="${data.fileUrl}" controls></audio>`;
    } else {
        content = `<a href="${data.fileUrl}" download>Download File</a>`;
    }

    chatBox.innerHTML += `<p><strong>${data.user}:</strong><br>${content}</p>`;
    chatBox.scrollTop = chatBox.scrollHeight;
});

function startCall(isVideo) {
    navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true }).then(stream => {
        localStream = stream;
        document.getElementById('localVideo').srcObject = stream;

        peer = new SimplePeer({ initiator: true, trickle: false, stream: stream });

        peer.on('signal', data => {
            socket.emit('call-user', { userToCall: currentRoom, signalData: data, name: localStorage.getItem('userPhone') });
        });

        peer.on('stream', remoteStream => {
            document.getElementById('remoteVideo').srcObject = remoteStream;
        });
    });
}

socket.on('call-made', data => {
    if (confirm(`Incoming Call from ${data.name}. Accept?`)) {
        navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(stream => {
            localStream = stream;
            document.getElementById('localVideo').srcObject = stream;

            peer = new SimplePeer({ initiator: false, trickle: false, stream: stream });
            peer.signal(data.signal);

            peer.on('signal', signal => {
                socket.emit('answer-call', { signal: signal, to: data.from });
            });

            peer.on('stream', remoteStream => {
                document.getElementById('remoteVideo').srcObject = remoteStream;
            });
        });
    }
});

socket.on('call-accepted', signal => { peer.signal(signal); });
