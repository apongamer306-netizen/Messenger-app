const socket = io();
let masterKey = "KT EYAMIN";
let isSignupMode = false;
let currentRoom = "";
let currentUser = { name: "", pic: "" };
let localStream = null;
let peer = null;
let ringtoneAudio = new Audio('https://assets.mixkit.co/active_storage/sfx/1359/1359-preview.mp3');
ringtoneAudio.loop = true;

document.addEventListener("DOMContentLoaded", () => {
    const savedTheme = localStorage.getItem("appTheme") || "light";
    applyTheme(savedTheme);

    // সেসন মেমোরি থেকে ডাটা লোড (ইনকোগনিটো বা সেম ব্রাউজার ট্যাবের ওভাররাইট বাগ ফিক্সের জন্য)
    const savedName = sessionStorage.getItem("session_userName") || localStorage.getItem("userName");
    const savedPic = sessionStorage.getItem("session_userPic") || localStorage.getItem("userProfilePic");

    if (savedName) currentUser.name = savedName;
    if (savedPic) currentUser.pic = savedPic;

    if (currentUser.pic) {
        if (document.getElementById('profile-img-preview')) document.getElementById('profile-img-preview').src = currentUser.pic;
        if (document.getElementById('room-user-pic')) document.getElementById('room-user-pic').src = currentUser.pic;
    }

    checkAutoLogin();
});

function toggleTheme() {
    const isLight = document.body.classList.contains("light-mode");
    const newTheme = isLight ? "dark" : "light";
    applyTheme(newTheme);
    localStorage.setItem("appTheme", newTheme);
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

function checkAutoLogin() {
    const isSiteUnlocked = localStorage.getItem("isSiteUnlocked");
    const isLoggedIn = sessionStorage.getItem("isLoggedIn") || localStorage.getItem("isLoggedIn");

    if (isSiteUnlocked === "true") {
        document.getElementById('site-lock-screen').classList.add('hidden');

        if (isLoggedIn === "true") {
            document.getElementById('auth-screen').classList.add('hidden');
            if (document.getElementById('user-display-name')) {
                document.getElementById('user-display-name').innerText = currentUser.name || "User";
            }
            document.getElementById('dashboard-screen').classList.remove('hidden');
        } else {
            document.getElementById('auth-screen').classList.remove('hidden');
        }
    } else {
        document.getElementById('site-lock-screen').classList.remove('hidden');
    }
}

function unlockSite() {
    const enteredKey = document.getElementById('site-key-input').value;
    if (enteredKey === masterKey) {
        localStorage.setItem("isSiteUnlocked", "true");
        document.getElementById('site-lock-screen').classList.add('hidden');
        checkAutoLogin();
    } else {
        alert("ভুল পাসওয়ার্ড!");
    }
}

function toggleAuthMode() {
    isSignupMode = !isSignupMode;
    const nameInput = document.getElementById('auth-name');
    if (isSignupMode) {
        document.getElementById('auth-title').innerText = "Create Account";
        document.getElementById('auth-btn').innerText = "Sign Up";
        document.getElementById('auth-toggle').innerText = "Already have account? Login";
        nameInput.classList.remove('hidden');
    } else {
        document.getElementById('auth-title').innerText = "Login";
        document.getElementById('auth-btn').innerText = "Login";
        document.getElementById('auth-toggle').innerText = "Create New Account";
        nameInput.classList.add('hidden');
    }
}

function handleAuth() {
    const name = document.getElementById('auth-name').value.trim();
    const phone = document.getElementById('auth-phone').value.trim();
    const pass = document.getElementById('auth-pass').value.trim();

    if (!phone || !pass) return alert("ফোন নম্বর এবং পাসওয়ার্ড প্রদান করুন");

    if (isSignupMode) {
        if (!name) return alert("অনুগ্রহ করে আপনার নাম লিখুন");

        currentUser.name = name;
        sessionStorage.setItem('session_userName', name);
        sessionStorage.setItem('isLoggedIn', "true");
        localStorage.setItem('userName', name);
        localStorage.setItem('isLoggedIn', "true");

        document.getElementById('user-display-name').innerText = name;
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('dashboard-screen').classList.remove('hidden');
    } else {
        currentUser.name = name || phone;
        sessionStorage.setItem('session_userName', currentUser.name);
        sessionStorage.setItem('isLoggedIn', "true");

        document.getElementById('user-display-name').innerText = currentUser.name;
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('dashboard-screen').classList.remove('hidden');
    }
}

function previewProfilePic(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = () => {
            const imageDataUrl = reader.result;
            currentUser.pic = imageDataUrl;
            document.getElementById('profile-img-preview').src = imageDataUrl;
            document.getElementById('room-user-pic').src = imageDataUrl;
            sessionStorage.setItem('session_userPic', imageDataUrl);
            localStorage.setItem('userProfilePic', imageDataUrl);
        };
        reader.readAsDataURL(file);
    }
}

// রুম ক্রিয়েট লজিক
function createRoom() {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    currentRoom = code;
    
    document.getElementById('dashboard-screen').classList.add('hidden');
    document.getElementById('room-screen').classList.remove('hidden');
    document.getElementById('active-room-id').innerText = code;
    document.getElementById('room-user-name').innerText = currentUser.name || "User";
    if (currentUser.pic) document.getElementById('room-user-pic').src = currentUser.pic;

    document.getElementById('chat-box').innerHTML = '';

    socket.emit('create-room', {
        roomId: code,
        hostName: currentUser.name || "User",
        hostPic: currentUser.pic || ""
    });
}

// রুম জয়েন লজিক
function joinRoom() {
    const code = document.getElementById('join-code-input').value.trim().toUpperCase();
    if (!code) return alert("রুম কোড প্রবেশ করান");

    currentRoom = code;

    document.getElementById('dashboard-screen').classList.add('hidden');
    document.getElementById('room-screen').classList.remove('hidden');
    document.getElementById('active-room-id').innerText = code;

    document.getElementById('chat-box').innerHTML = '';

    socket.emit('join-room', {
        roomId: code,
        userName: currentUser.name || "User",
        userPic: currentUser.pic || ""
    });
}

// জয়েন করার পর সার্ভার থেকে পাওয়া হোস্টের নাম ও পিকচার শো করা
socket.on('joined-room-info', (data) => {
    document.getElementById('room-user-name').innerText = data.hostName;
    if (data.hostPic) {
        document.getElementById('room-user-pic').src = data.hostPic;
    }

    // সিস্টেমে মেসেজ শো করানো
    const chatBox = document.getElementById('chat-box');
    const sysDiv = document.createElement('div');
    sysDiv.style.cssText = 'text-align: center; font-size: 13px; color: #38bdf8; margin: 10px 0; font-weight: bold;';
    sysDiv.innerText = `You joined ${data.hostName}'s room`;
    chatBox.appendChild(sysDiv);
});

socket.on('user-joined-notify', (data) => {
    const chatBox = document.getElementById('chat-box');
    const sysDiv = document.createElement('div');
    sysDiv.style.cssText = 'text-align: center; font-size: 12px; color: #4ade80; margin: 8px 0;';
    sysDiv.innerText = `${data.userName} joined the room`;
    chatBox.appendChild(sysDiv);
});

function leaveRoom() {
    socket.emit('leave-room', currentRoom);
    document.getElementById('room-screen').classList.add('hidden');
    document.getElementById('dashboard-screen').classList.remove('hidden');
}

// -----------------------------------------------------------------
// মেসেজিং লজিক (১০০% ইনস্ট্যান্ট সেন্ড ও রিসিভ)
// -----------------------------------------------------------------

async function sendMessage() {
    const msgInput = document.getElementById('msg-input');
    const msg = msgInput.value.trim();
    const fileInput = document.getElementById('file-input');

    if (fileInput.files.length > 0) {
        const formData = new FormData();
        formData.append('file', fileInput.files[0]);

        try {
            const res = await fetch('/upload', { method: 'POST', body: formData });
            const data = await res.json();

            if (data.filePath) {
                socket.emit('send-file', {
                    roomId: currentRoom,
                    filePath: data.filePath,
                    fileName: data.fileName,
                    fileType: data.fileType,
                    senderName: currentUser.name
                });
                fileInput.value = '';
            }
        } catch (err) {
            alert("ফাইল সেন্ড করা সম্ভব হয়নি!");
        }
    }

    if (msg !== "") {
        socket.emit('send-message', {
            roomId: currentRoom,
            message: msg,
            senderName: currentUser.name
        });
        msgInput.value = '';
    }
}

document.getElementById('msg-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

socket.on('receive-message', (data) => {
    const chatBox = document.getElementById('chat-box');
    const isSelf = data.senderName === currentUser.name;

    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-message ${isSelf ? 'self' : ''}`;
    msgDiv.innerText = data.message;

    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
});

socket.on('receive-file', (data) => {
    const chatBox = document.getElementById('chat-box');
    const isSelf = data.senderName === currentUser.name;

    let mediaContent = '';
    if (data.fileType.startsWith('image/')) {
        mediaContent = `
            <div>
                <img src="${data.filePath}" style="max-width:100%; max-height:220px; border-radius:8px; display:block;">
                <a href="${data.filePath}" download="${data.fileName}" style="display:inline-block; margin-top:5px; color:#60a5fa; font-size:12px; text-decoration:underline;">
                    <i class="fa-solid fa-download"></i> Download Image
                </a>
            </div>`;
    } else if (data.fileType.startsWith('video/')) {
        mediaContent = `
            <div>
                <video src="${data.filePath}" controls style="max-width:100%; max-height:220px; border-radius:8px; display:block;"></video>
                <a href="${data.filePath}" download="${data.fileName}" style="display:inline-block; margin-top:5px; color:#60a5fa; font-size:12px; text-decoration:underline;">
                    <i class="fa-solid fa-download"></i> Download Video
                </a>
            </div>`;
    } else {
        mediaContent = `
            <a href="${data.filePath}" download="${data.fileName}" style="color:#60a5fa; text-decoration:underline; font-size:13px;">
                <i class="fa-solid fa-file"></i> Download ${data.fileName}
            </a>`;
    }

    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-message ${isSelf ? 'self' : ''}`;
    msgDiv.innerHTML = mediaContent;

    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
});
