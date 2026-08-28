// Render Socket connection via dynamic location host
const socket = io(window.location.origin);

let currentUser = null;
let currentRoom = null;

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

let isSignUpMode = true;

function togglePasswordVisibility(inputId, iconElem) {
  const input = document.getElementById(inputId);
  if (input.type === "password") {
    input.type = "text";
    iconElem.classList.replace("fa-eye", "fa-eye-slash");
  } else {
    input.type = "password";
    iconElem.classList.replace("fa-eye-slash", "fa-eye");
  }
}

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
}

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
  // Socket Joining Event
  socket.emit("join-room", { roomCode: code, user: currentUser });
  
  dashboardScreen.style.display = "none";
  chatScreen.style.display = "flex";
  chatUserName.textContent = currentUser.name;
  chatUserAvatar.src = currentUser.pic;
  chatRoomCode.textContent = "Code: " + code;
}

logoutBtn.addEventListener("click", () => {
  localStorage.removeItem("appUser");
  currentUser = null;
  location.reload();
});

// Send Chat Message
sendMessageBtn.addEventListener("click", sendChatMessage);
chatMessageInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") sendChatMessage();
});

function sendChatMessage() {
  const text = chatMessageInput.value.trim();
  if (text && currentRoom) {
    const msgData = {
      roomCode: currentRoom,
      sender: currentUser.name,
      senderPic: currentUser.pic,
      text: text,
      file: null,
      fileType: null
    };
    socket.emit("send-message", msgData);
    chatMessageInput.value = "";
  }
}

fileAttachmentInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file || !currentRoom) return;

  const reader = new FileReader();
  reader.onload = (evt) => {
    let fType = "file";
    if (file.type.startsWith("image/")) fType = "image";
    else if (file.type.startsWith("video/")) fType = "video";

    const msgData = {
      roomCode: currentRoom,
      sender: currentUser.name,
      senderPic: currentUser.pic,
      text: "",
      file: evt.target.result,
      fileType: fType,
      fileName: file.name
    };

    socket.emit("send-message", msgData);
    fileAttachmentInput.value = "";
  };
  reader.readAsDataURL(file);
});

// Socket Event Listeners
socket.on("user-joined-notify", (data) => {
  const systemMsg = document.createElement("div");
  systemMsg.className = "system-notification";
  systemMsg.innerHTML = `<img src="${data.user.pic}" class="sys-avatar"/> <span><b>${data.user.name}</b> joined the room</span>`;
  chatMessages.appendChild(systemMsg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
});

socket.on("receive-message", (data) => {
  const isMe = data.sender === currentUser.name;
  appendMessage(data, isMe);
});

function appendMessage(data, isMe) {
  const div = document.createElement("div");
  div.classList.add("message-bubble", isMe ? "my-msg" : "other-msg");
  
  if (data.text) {
    const textNode = document.createElement("p");
    textNode.textContent = (isMe ? "" : data.sender + ": ") + data.text;
    div.appendChild(textNode);
  }

  if (data.file) {
    const mediaContainer = document.createElement("div");
    mediaContainer.className = "media-wrapper";

    if (data.fileType === "image") {
      const img = document.createElement("img");
      img.src = data.file;
      img.className = "chat-media-preview";
      img.onclick = () => openFullscreenImage(data.file);
      mediaContainer.appendChild(img);

      const downloadBtn = document.createElement("a");
      downloadBtn.href = data.file;
      downloadBtn.download = data.fileName || "image.png";
      downloadBtn.className = "download-btn";
      downloadBtn.innerHTML = `<i class="fa-solid fa-download"></i> Download`;
      mediaContainer.appendChild(downloadBtn);

    } else if (data.fileType === "video") {
      const vid = document.createElement("video");
      vid.src = data.file;
      vid.controls = true;
      vid.className = "chat-media-preview";
      mediaContainer.appendChild(vid);
    }
    div.appendChild(mediaContainer);
  }

  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function openFullscreenImage(src) {
  const modal = document.createElement("div");
  modal.className = "fullscreen-modal";
  modal.onclick = () => modal.remove();
  const img = document.createElement("img");
  img.src = src;
  modal.appendChild(img);
  document.body.appendChild(modal);
}

leaveRoomBtn.addEventListener("click", () => {
  chatScreen.style.display = "none";
  dashboardScreen.style.display = "block";
});

const themeToggleBtn = document.getElementById("themeToggleBtn");
themeToggleBtn.addEventListener("click", () => {
  document.body.classList.toggle("light-theme");
});
