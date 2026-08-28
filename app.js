const socket = io();
let masterKey = "KT EYAMIN";
let isSignupMode = false;
let currentRoom = "";
let localStream = null;
let peer = null;

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
                enterRoomInterface(savedRoom);
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

    if (!phone || !pass) {
        return alert("ফোন নম্বর এবং পাসওয়ার্ড প্রদান করুন");
    }

    if (isSignupMode) {
        if (!name) return alert("অনুগ্রহ করে আপনার নাম লিখুন");

        localStorage.setItem('userPhone', phone);
        localStorage.setItem('userPass', pass);
        localStorage.setItem('userName', name);
        localStorage.setItem('isLoggedIn', "true");

        document.getElementById('user-display-name').innerText = name;
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('dashboard-screen').classList.remove('hidden');
    } else {
        const savedPhone = localStorage.getItem('userPhone');
        const savedPass = localStorage.getItem('userPass');
        const savedName = localStorage.getItem('userName');

        if (!savedPhone) {
            return alert("কোনো অ্যাকাউন্ট পাওয়া যায়নি! আগে 'Create New Account' করুন।");
        }

        if (phone === savedPhone && pass === savedPass) {
            localStorage.setItem('isLoggedIn', "true");
            document.getElementById('user-display-name').innerText = savedName || phone;
            document.getElementById('auth-screen').classList.add('hidden');
            document.getElementById('dashboard-screen').classList.remove('hidden');
        } else {
            alert("ভুল ফোন নম্বর অথবা পাসওয়ার্ড!");
        }
    }
}

function previewProfilePic(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = () => {
            const imageDataUrl = reader.result;
            document.getElementById('profile-img-preview').src = imageDataUrl;
            document.getElementById('room-user-pic').src = imageDataUrl;
            localStorage.setItem('userProfilePic', imageDataUrl);
        };
        reader.readAsDataURL(file);
    }
}

function setCustomTheme(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = () => {
            const themeDataUrl = reader.result;
            localStorage.setItem('roomThemeUrl', themeDataUrl);
            applyRoomTheme(themeDataUrl);
        };
        reader.readAsDataURL(file);
    }
}

function applyRoomTheme(themeUrl) {
    const chatBox = document.getElementById('chat-box');
    if (chatBox && themeUrl) {
        chatBox.style.backgroundImage = `url(${themeUrl})`;
        chatBox.style.backgroundSize = 'cover';
        chatBox.style.backgroundPosition = 'center';
    }
}

function createRoom() {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    currentRoom = code;
    localStorage.setItem("currentRoom", code);
    enterRoomInterface(code);
}

function joinRoom() {
    const code = document.getElementById('join-code-input').value.trim();
    if (!code) return alert("রুম কোড প্রবেশ করান");

    currentRoom = code;
    localStorage.setItem("currentRoom", code);
    enterRoomInterface(code);
}

function enterRoomInterface(code) {
    document.getElementById('dashboard-screen').classList.add('hidden');
    document.getElementById('room-screen').classList.remove('hidden');
    
    document.getElementById('active-room-id').innerText = code;
    document.getElementById('room-user-name').innerText = localStorage.getItem('userName') || "User";
    
    const savedPic = localStorage.getItem('userProfilePic');
    if (savedPic) document.getElementById('room-user-pic').src = savedPic;

    const savedThemeUrl = localStorage.getItem('roomThemeUrl');
    if (savedThemeUrl) applyRoomTheme(savedThemeUrl);

    socket.emit('join-room', code, localStorage.getItem('userName'));
}

function logout() { 
    localStorage.clear();
    location.reload(); 
}

function leaveRoom() {
    socket.emit('leave-room', currentRoom);
    localStorage.removeItem("currentRoom");
    document.getElementById('room-screen').classList.add('hidden');
    document.getElementById('dashboard-screen').classList.remove('hidden');
}

// বার্তা এবং মিডিয়া পাঠানোর ফিক্সড লজিক
function sendMessage() {
    const msgInput = document.getElementById('msg-input');
    const msg = msgInput.value.trim();
    const fileInput = document.getElementById('file-input');

    // ১. ফাইল অ্যাটাচমেন্ট হ্যান্ডলিং
    if (fileInput.files.length > 0) {
        const formData = new FormData();
        formData.append('file', fileInput.files[0]);

        fetch('/upload', { method: 'POST', body: formData })
            .then(res => res.json())
            .then(data => {
                socket.emit('send-file', { 
                    roomId: currentRoom, 
                    fileUrl: data.filePath, 
                    fileType: data.fileType, 
                    user: localStorage.getItem('userName') 
                });
                fileInput.value = '';
            })
            .catch(err => console.error("File upload error:", err));
    }

    // ২. টেক্সট মেসেজ হ্যান্ডলিং
    if (msg !== "") {
        socket.emit('send-message', { 
            roomId: currentRoom, 
            message: msg, 
            user: localStorage.getItem('userName') 
        });
        msgInput.value = '';
    }
}

// এন্টার চাপলে মেসেজ পাঠানোর সাপোর্ট
document.getElementById('msg-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

// মেসেজ রিসিভ করা
socket.on('receive-message', (data) => {
    const chatBox = document.getElementById('chat-box');
    const isSelf = data.user === localStorage.getItem('userName');
    
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-message ${isSelf ? 'self' : ''}`;
    msgDiv.innerHTML = `<strong>${data.user}:</strong> ${data.message}`;
    
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
});

// মিডিয়া ফাইল রিসিভ করা
socket.on('receive-file', (data) => {
    const chatBox = document.getElementById('chat-box');
    const isSelf = data.user === localStorage.getItem('userName');
    
    let content = '';
    if (data.fileType.startsWith('image/')) {
        content = `<img src="${data.fileUrl}" style="max-width:100%; max-height:200px; border-radius:6px; margin-top:5px;">`;
    } else if (data.fileType.startsWith('video/')) {
        content = `<video src="${data.fileUrl}" controls style="max-width:100%; max-height:200px; border-radius:6px; margin-top:5px;"></video>`;
    } else if (data.fileType.startsWith('audio/')) {
        content = `<audio src="${data.fileUrl}" controls style="max-width:100%; margin-top:5px;"></audio>`;
    } else {
        content = `<a href="${data.fileUrl}" download target="_blank" style="color:#60a5fa; text-decoration:underline;">Download File</a>`;
    }

    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-message ${isSelf ? 'self' : ''}`;
    msgDiv.innerHTML = `<strong>${data.user}:</strong><br>${content}`;

    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
});

// অডিও এবং ভিডিও কল হ্যান্ডলিং
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
                    from: localStorage.getItem('userName') 
                });
            });

            peer.on('stream', remoteStream => {
                document.getElementById('remoteVideo').srcObject = remoteStream;
            });
        })
        .catch(err => alert("ক্যামেরা বা মাইক্রোফোন অ্যাক্সেস পাওয়া যায়নি!"));
}

socket.on('incoming-call', data => {
    if (confirm(`${data.from} এর থেকে কল আসছে। গ্রহণ করবেন?`)) {
        document.getElementById('video-wrapper').classList.remove('hidden');
        navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(stream => {
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
    }
});

socket.on('call-accepted', signal => { 
    if (peer) peer.signal(signal); 
});
