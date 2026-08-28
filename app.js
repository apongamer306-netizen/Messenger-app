// Socket.io auto connection to the active backend domain
const socket = io(); // Renders origin dynamically

let currentUser = null;
let currentRoom = null;
let peer = null;
let localStream = null;

// DOM Elements
const masterKeyScreen = document.getElementById("masterKeyScreen");
const authScreen = document.getElementById("authScreen");
const dashboardScreen = document.getElementById("dashboardScreen");
const chatScreen = document.getElementById("chatScreen");

const masterKeyInput = document.getElementById("masterKeyInput");
const unlockBtn = document.getElementById("unlockBtn");

const authTitle = document.getElementById("authTitle");
const signupFields = document.getElementById("signupFields");
const fullNameInput = document.getElementById("fullNameInput");
const phoneInput = document.getElementById("phoneInput");
const authPasswordInput = document.getElementById("authPasswordInput");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const authToggleLink = document.getElementById("authToggleLink");
const authToggleMsg = document.getElementById("authToggleMsg");

const dashboardAvatar = document.getElementById("dashboardAvatar");
const dashboardUserName = document.getElementById("dashboardUserName");
const avatarUpload = document.getElementById("avatarUpload");

const createRoomBtn = document.getElementById("createRoomBtn");
const roomCodeInput = document.getElementById("roomCodeInput");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const logoutBtn = document.getElementById("logoutBtn");

const chatUserAvatar = document.getElementById("chatUserAvatar");
const chatUserName = document.getElementById("chatUserName");
const chatRoomCode = document.getElementById("chatRoomCode");
const chatMessages = document.getElementById("chatMessages");
const chatMessageInput = document.getElementById("chatMessageInput");
const sendMessageBtn = document.getElementById("sendMessageBtn");
const fileAttachmentInput = document.getElementById("fileAttachmentInput");
const leaveRoomBtn = document.getElementById("leaveRoomBtn");

const startAudioCallBtn = document.getElementById("startAudioCallBtn");
const startVideoCallBtn = document.getElementById("startVideoCallBtn");
const videoCallOverlay = document.getElementById("videoCallOverlay");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const endCallBtn = document.getElementById("endCallBtn");

let isSignUpMode = true;

// Toggle Password Field Eye Visibility
function togglePasswordVisibility(inputId, iconElem) {
  const input = document.getElementById(inputId);
  if (input.type === "password") {
    input.type = "text";
    iconElem.classList.replace("fa-eye", "fa-eye-slash");
  } else {
    input.type = "password";
    iconElem.classList.replace("fa-slash-eye", "fa-eye");
    iconElem.classList.replace("fa-eye-slash", "fa-eye");
  }
}

// Initial Loading Logic (Auto Login check)
document.addEventListener("DOMContentLoaded", () => {
  const isMasterUnlocked = localStorage.getItem("masterUnlocked");
  const savedUser = JSON.parse(localStorage.getItem("appUser"));

  if (isMasterUnlocked === "true") {
    masterKeyScreen.style.display = "none";
    if (savedUser) {
      currentUser = savedUser;
      showDashboard();
    } else {
      authScreen.style.display = "block";
    }
  } else {
    masterKeyScreen.style.display = "block";
  }
});

// Unlock Master Key
unlockBtn.addEventListener("click", () => {
  if (masterKeyInput.value === "KT EYAMIN") {
    localStorage.setItem("masterUnlocked", "true");
    masterKeyScreen.style.display = "none";
    const savedUser = JSON.parse(localStorage.getItem("appUser"));
    if (savedUser) {
      currentUser = savedUser;
      showDashboard();
    } else {
      authScreen.style.display = "block";
    }
  } else {
    alert("ভুল Master Key দেওয়া হয়েছে!");
  }
});

// Auth Toggle (Login <-> Sign Up)
authToggleLink.addEventListener("click", (e) => {
  e.preventDefault();
  isSignUpMode = !isSignUpMode;
  if (isSignUpMode) {
    authTitle.textContent = "Create Account";
    signupFields.style.display = "block";
    authSubmitBtn.textContent = "Sign Up";
    authToggleMsg.textContent = "Already have account?";
    authToggleLink.textContent = "Login";
  } else {
    authTitle.textContent = "Login Account";
    signupFields.style.display = "none";
    authSubmitBtn.textContent = "Login";
    authToggleMsg.textContent = "Don't have an account?";
    authToggleLink.textContent = "Sign Up";
  }
});

// Authentication Action
authSubmitBtn.addEventListener("click", () => {
  const phone = phoneInput.value.trim();
  const password = authPasswordInput.value.trim();

  if (!phone || !password) return alert("ফোন নম্বর এবং পাসওয়ার্ড প্রদান করুন");

  if (isSignUpMode) {
    const name = fullNameInput.value.trim();
    if (!name) return alert("আপনার নাম লিখুন");
    currentUser = { name, phone, password, pic: "https://via.placeholder.com/100" };
    localStorage.setItem("appUser", JSON.stringify(currentUser));
    showDashboard();
  } else {
    const savedUser = JSON.parse(localStorage.getItem("appUser"));
    if (savedUser && savedUser.phone === phone && savedUser.password === password) {
      currentUser = savedUser;
      showDashboard();
    } else {
      alert("ফোন নম্বর অথবা পাসওয়ার্ডটি সঠিক নয়!");
    }
  }
});

function showDashboard() {
  authScreen.style.display = "none";
  dashboardScreen.style.display = "block";
  dashboardUserName.textContent = currentUser.name;
  if (currentUser.pic) dashboardAvatar.src = currentUser.pic;
  initPeer();
}

// Avatar Photo Upload
avatarUpload.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (evt) => {
      currentUser.pic = evt.target.result;
      dashboardAvatar.src = currentUser.pic;
      localStorage.setItem("appUser", JSON.stringify(currentUser));
    };
    reader.readAsDataURL(file);
  }
});

// Create Room Action
createRoomBtn.addEventListener("click", () => {
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  joinRoom(code);
});

// Join Room Action
joinRoomBtn.addEventListener("click", () => {
  const code = roomCodeInput.value.trim().toUpperCase();
  if (code) joinRoom(code);
});

function joinRoom(code) {
  currentRoom = code;
  socket.emit("join-room", { roomCode: code, user: currentUser });
  dashboardScreen.style.display = "none";
  chatScreen.style.display = "flex";
  chatUserName.textContent = currentUser.name;
  chatUserAvatar.src = currentUser.pic;
  chatRoomCode.textContent = "Code: " + code;
}

// Logout Action
logoutBtn.addEventListener("click", () => {
  localStorage.removeItem("appUser");
  currentUser = null;
  location.reload();
});

// Send Chat Message / Files
sendMessageBtn.addEventListener("click", sendChatMessage);
chatMessageInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") sendChatMessage();
});

function sendChatMessage() {
  const text = chatMessageInput.value.trim();
  if (text && currentRoom) {
    const msgData = { roomCode: currentRoom, sender: currentUser.name, text: text, file: null, fileType: null };
    socket.emit("send-message", msgData);
    appendMessage(msgData, true);
    chatMessageInput.value = "";
  }
}

// File/Media Attachment Handling
fileAttachmentInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file || !currentRoom) return;

  const reader = new FileReader();
  reader.onload = (evt) => {
    let fType = "file";
    if (file.type.startsWith("image/")) fType = "image";
    else if (file.type.startsWith("video/")) fType = "video";
    else if (file.type.startsWith("audio/")) fType = "audio";

    const msgData = {
      roomCode: currentRoom,
      sender: currentUser.name,
      text: "",
      file: evt.target.result,
      fileType: fType
    };

    socket.emit("send-message", msgData);
    appendMessage(msgData, true);
    fileAttachmentInput.value = "";
  };
  reader.readAsDataURL(file);
});

// Receive Socket Message
socket.on("receive-message", (data) => {
  appendMessage(data, false);
});

function appendMessage(data, isMe) {
  const div = document.createElement("div");
  div.classList.add("message-bubble", isMe ? "my-msg" : "other-msg");
  
  if (data.text) {
    div.textContent = (isMe ? "" : data.sender + ": ") + data.text;
  }

  if (data.file) {
    if (data.fileType === "image") {
      const img = document.createElement("img");
      img.src = data.file;
      img.className = "message-media";
      div.appendChild(img);
    } else if (data.fileType === "video") {
      const vid = document.createElement("video");
      vid.src = data.file;
      vid.controls = true;
      vid.className = "message-media";
      div.appendChild(vid);
    } else if (data.fileType === "audio") {
      const aud = document.createElement("audio");
      aud.src = data.file;
      aud.controls = true;
      div.appendChild(aud);
    }
  }

  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// PeerJS Audio/Video Call Handling
function initPeer() {
  peer = new Peer();
  peer.on("call", (call) => {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((stream) => {
      localStream = stream;
      localVideo.srcObject = stream;
      videoCallOverlay.style.display = "flex";
      call.answer(stream);
      call.on("stream", (remoteStream) => {
        remoteVideo.srcObject = remoteStream;
      });
    });
  });
}

startVideoCallBtn.addEventListener("click", () => startCall(true));
startAudioCallBtn.addEventListener("click", () => startCall(false));

function startCall(enableVideo) {
  navigator.mediaDevices.getUserMedia({ video: enableVideo, audio: true }).then((stream) => {
    localStream = stream;
    localVideo.srcObject = stream;
    videoCallOverlay.style.display = "flex";

    socket.emit("request-peer-id", { roomCode: currentRoom });
    socket.once("peer-id-response", (peerId) => {
      if (peerId) {
        const call = peer.call(peerId, stream);
        call.on("stream", (remoteStream) => {
          remoteVideo.srcObject = remoteStream;
        });
      }
    });
  });
}

endCallBtn.addEventListener("click", () => {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }
  videoCallOverlay.style.display = "none";
});

leaveRoomBtn.addEventListener("click", () => {
  chatScreen.style.display = "none";
  dashboardScreen.style.display = "block";
});

// Theme Switcher Logic
const themeToggleBtn = document.getElementById("themeToggleBtn");
themeToggleBtn.addEventListener("click", () => {
  document.body.classList.toggle("light-theme");
});
