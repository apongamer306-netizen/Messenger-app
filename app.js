const socket = io();
let masterKey = "KT EYAMIN";
let isSignupMode = false;
let currentRoom = "";
let localStream = null;
let peer = null;
let isHostUser = false;
let ringtoneAudio = new Audio('https://assets.mixkit.co/active_storage/sfx/1359/1359-preview.mp3');
ringtoneAudio.loop = true;

document.addEventListener("DOMContentLoaded", () => {
    const savedTheme = localStorage.getItem("appTheme") || "light";
    applyTheme(savedTheme);

    const savedProfilePic = localStorage.getItem("userProfilePic");
    if (savedProfilePic) {
        if (document.getElementById('profile-img-preview')) document.getElementById('profile-img-preview').src = savedProfilePic;
        if (document.getElementById('room-user-pic')) document.getElementById('room-user-pic').src = savedProfilePic;
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
    const isLoggedIn = localStorage.getItem("isLoggedIn");
    const savedName = localStorage.getItem("userName");
    const savedRoom = localStorage.getItem("currentRoom");

    if (isSiteUnlocked === "true") {
        document.getElementById('site-lock-screen').classList.add('hidden');

        if (isLoggedIn === "true") {
            document.getElementById('auth-screen').classList.add('hidden');
            if(document.getElementById('user-display-name')) document.getElementById('user-display-name').innerText = savedName || "User";

            if (savedRoom) {
                currentRoom = savedRoom;
                enterRoomInterface(savedRoom, false);
            } else {
                document.getElementById('dashboard-screen').classList.remove('hidden');
            }
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

function createRoom() {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    currentRoom = code;
    isHostUser = true;
    localStorage.setItem("currentRoom", code);
    enterRoomInterface(code, true);
}

function joinRoom() {
    const code = document.getElementById('join-code-input').value.trim();
    if (!code) return alert("রুম কোড প্রবেশ করান");

    currentRoom = code;
    isHostUser = false;
    localStorage.setItem("currentRoom", code);
    enterRoomInterface(code, false);
}

function enterRoomInterface(code, isHost) {
    document.getElementById('dashboard-screen').classList.add('hidden');
    document.getElementById('room-screen').classList.remove('hidden');
    document.getElementById('active-room-id').innerText = code;
    document.getElementById('room-user-name').innerText = localStorage.getItem('userName') || "User";

    // চ্যাটবক্স আগেরগুলো ক্লিয়ার করা
    const chatBox = document.getElementById('chat-box');
    if (chatBox) chatBox.innerHTML = '';

    if (!socket.connected) socket.connect();
    socket.emit('join-room', { 
        roomId: code, 
        userName: localStorage.getItem('userName'),
        isHost: isHost 
    });
}

function leaveRoom() {
    socket.emit('leave-room', currentRoom);
    localStorage.removeItem("currentRoom");
    document.getElementById('room-screen').classList.add('hidden');
    document.getElementById('dashboard-screen').classList.remove('hidden');
}

// -----------------------------------------------------------------
// রিয়েলটাইম ইনস্ট্যান্ট মেসেজিং
// -----------------------------------------------------------------

async function sendMessage() {
    const msgInput = document.getElementById('msg-input');
    const msg = msgInput.value.trim();
    const fileInput = document.getElementById('file-input');
    const sender = localStorage.getItem('userName');

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
                    user: sender
                });
                fileInput.value = '';
            }
        } catch (err) {
            alert("ফাইল সেন্ড করা যায়নি!");
        }
    }

    if (msg !== "") {
        socket.emit('send-message', {
            roomId: currentRoom,
            message: msg,
            user: sender
        });
        msgInput.value = '';
    }
}

document.getElementById('msg-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

// সিস্টেম মেসেজ (You joined X's room)
socket.on('system-message', (text) => {
    const chatBox = document.getElementById('chat-box');
    const sysDiv = document.createElement('div');
    sysDiv.style.textAlign = 'center';
    sysDiv.style.fontSize = '12px';
    sysDiv.style.color = '#94a3b8';
    sysDiv.style.margin = '8px 0';
    sysDiv.innerText = text;

    chatBox.appendChild(sysDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
});

// টেক্সট মেসেজ
socket.on('receive-message', (data) => {
    const chatBox = document.getElementById('chat-box');
    const isSelf = data.user === localStorage.getItem('userName');

    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-message ${isSelf ? 'self' : ''}`;
    msgDiv.innerText = data.message;

    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
});

// ফাইল/মেডিয়া
socket.on('receive-file', (data) => {
    const chatBox = document.getElementById('chat-box');
    const isSelf = data.user === localStorage.getItem('userName');

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

// -----------------------------------------------------------------
// কল সিগন্যালিং
// -----------------------------------------------------------------

function startCall(isVideo) {
    document.getElementById('video-wrapper').classList.remove('hidden');

    navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true })
        .then(stream => {
            localStream = stream;
            document.getElementById('localVideo').srcObject = stream;

            peer = new SimplePeer({ initiator: true, trickle: false, stream: stream });

            peer.on('signal', data => {
                socket.emit('call-user', {
                    roomId: currentRoom,
                    signalData: data,
                    isVideo: isVideo,
                    from: localStorage.getItem('userName')
                });
            });

            peer.on('stream', remoteStream => {
                document.getElementById('remoteVideo').srcObject = remoteStream;
            });
        })
        .catch(() => alert("ক্যামেরা/মাইক্রোফোন চালু করার পারমিশন প্রয়োজন!"));
}

socket.on('incoming-call', data => {
    ringtoneAudio.play().catch(() => {});

    const callType = data.isVideo ? "ভিডিও" : "অডিও";
    const accept = confirm(`${data.from} থেকে ${callType} কল আসছে... রিসিভ করবেন?`);

    ringtoneAudio.pause();
    ringtoneAudio.currentTime = 0;

    if (accept) {
        document.getElementById('video-wrapper').classList.remove('hidden');
        navigator.mediaDevices.getUserMedia({ video: data.isVideo, audio: true }).then(stream => {
            localStream = stream;
            document.getElementById('localVideo').srcObject = stream;

            peer = new SimplePeer({ initiator: false, trickle: false, stream: stream });
            peer.signal(data.signalData);

            peer.on('signal', signal => {
                socket.emit('answer-call', { signal: signal, roomId: currentRoom });
            });

            peer.on('stream', remoteStream => {
                document.getElementById('remoteVideo').srcObject = remoteStream;
            });
        });
    } else {
        socket.emit('end-call', { roomId: currentRoom });
    }
});

socket.on('call-accepted', signal => {
    if (peer) peer.signal(signal);
});

socket.on('call-ended', () => {
    ringtoneAudio.pause();
    ringtoneAudio.currentTime = 0;
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    document.getElementById('video-wrapper').classList.add('hidden');
    alert("কল সমাপ্ত হয়েছে।");
});
