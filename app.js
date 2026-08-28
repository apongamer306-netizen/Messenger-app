const socket = io("https://ekt-chatter.onrender.com", {
  transports: ["websocket", "polling"]
});

let myPeer = new Peer();
let myPeerId = null;
let currentCall = null;
let localStream = null;

myPeer.on("open", (id) => {
  myPeerId = id;
  
  // Peer ID পাওয়ার পর যদি আগের কোনো সেভড রুম থাকে তাতে অটো-রি-জয়েন করবে
  checkAndAutoRejoinRoom();
});

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
const bgImageUpload = document.getElementById("bgImageUpload");

// Call Modal Elements
const callModal = document.getElementById("callModal");
const callStatusText = document.getElementById("callStatusText");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const acceptCallBtn = document.getElementById("acceptCallBtn");
const rejectCallBtn = document.getElementById("rejectCallBtn");
const startAudioCallBtn = document.getElementById("startAudioCallBtn");
const startVideoCallBtn = document.getElementById("startVideoCallBtn");

let isSignUpMode = false;

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
      checkAndAutoRejoinRoom();
    } else {
      authScreen.style.display = "block";
    }
  } else {
    masterKeyScreen.style.display = "block";
  }
});

// অটো-রিজয়েন লজিক (রিফ্রেশ করলেও রুমে রেখে দেওয়ার জন্য)
function checkAndAutoRejoinRoom() {
  const savedRoom = sessionStorage.getItem("currentChatRoom");
  if (savedRoom && currentUser && myPeerId) {
    joinRoom(savedRoom);
  }
}

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
    
    const newUser = { name, phone, password, pic: "https://via.placeholder.com/100" };
    socket.emit("register-user", newUser, (res) => {
      if (res.success) {
        currentUser = res.user;
        localStorage.setItem("appUser", JSON.stringify(currentUser));
        showDashboard();
      } else {
        alert(res.message);
      }
    });

  } else {
    socket.emit("login-user", { phone, password }, (res) => {
      if (res.success) {
        currentUser = res.user;
        localStorage.setItem("appUser", JSON.stringify(currentUser));
        showDashboard();
      } else {
        alert(res.message);
      }
    });
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

createRoomBtn.addEventListener("click", () => {
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  joinRoom(code);
});

joinRoomBtn.addEventListener("click", () => {
  const code = roomCodeInput.value.trim().toUpperCase();
  if (code) joinRoom(code);
});

function joinRoom(code) {
  currentRoom = code;
  sessionStorage.setItem("currentChatRoom", code); // সেশন স্টোরেজে রুম আইডি রাখা হলো

  socket.emit("join-room", { roomCode: code, user: currentUser, peerId: myPeerId });
  
  dashboardScreen.style.display = "none";
  chatScreen.style.display = "flex";
  chatUserName.textContent = currentUser.name;
  chatUserAvatar.src = currentUser.pic;
  chatRoomCode.textContent = "Code: " + code;

  // আগে কোনো সেভ করা ওয়ালপেপার থাকলে তা লোড করা
  const savedBg = localStorage.getItem("chatWallpaper_" + code);
  if (savedBg) {
    chatMessages.style.backgroundImage = `url('${savedBg}')`;
    chatMessages.style.backgroundSize = "cover";
    chatMessages.style.backgroundPosition = "center";
  } else {
    chatMessages.style.backgroundImage = "none";
  }
}

// চ্যাট রুম ব্যাকগ্রাউন্ড / ওয়ালপেপার পরিবর্তন লজিক
bgImageUpload.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file && currentRoom) {
    const reader = new FileReader();
    reader.onload = (evt) => {
      const bgData = evt.target.result;
      chatMessages.style.backgroundImage = `url('${bgData}')`;
      chatMessages.style.backgroundSize = "cover";
      chatMessages.style.backgroundPosition = "center";
      
      // সেই রুমের জন্য ওয়ালপেপার সেভ রাখা
      localStorage.setItem("chatWallpaper_" + currentRoom, bgData);
    };
    reader.readAsDataURL(file);
  }
});

logoutBtn.addEventListener("click", () => {
  localStorage.removeItem("appUser");
  sessionStorage.removeItem("currentChatRoom");
  currentUser = null;
  location.reload();
});

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
  
  const userAvatar = document.createElement("img");
  userAvatar.src = data.senderPic || "https://via.placeholder.com/40";
  userAvatar.className = "msg-avatar";
  div.appendChild(userAvatar);

  const contentBox = document.createElement("div");
  contentBox.className = "msg-content";

  if (data.text) {
    const textNode = document.createElement("p");
    textNode.textContent = data.text;
    contentBox.appendChild(textNode);
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
    } else if (data.fileType === "video") {
      const vid = document.createElement("video");
      vid.src = data.file;
      vid.controls = true;
      vid.className = "chat-media-preview";
      mediaContainer.appendChild(vid);
    }
    contentBox.appendChild(mediaContainer);
  }

  div.appendChild(contentBox);
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

// ------------------- AUDIO / VIDEO CALLING LOGIC -------------------

let incomingCallData = null;

startAudioCallBtn.addEventListener("click", () => initiateCall("audio"));
startVideoCallBtn.addEventListener("click", () => initiateCall("video"));

function initiateCall(type) {
  if (!currentRoom) return;
  const isVideo = type === "video";
  
  navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true })
    .then((stream) => {
      localStream = stream;
      localVideo.srcObject = stream;
      callModal.style.display = "flex";
      callStatusText.textContent = "Calling...";
      acceptCallBtn.style.display = "none";

      socket.emit("call-user", {
        roomCode: currentRoom,
        callerName: currentUser.name,
        callerPeerId: myPeerId,
        callType: type
      });
    })
    .catch((err) => {
      alert("ক্যামেরা বা মাইক্রোফোন চালু করা যাচ্ছে না! ব্রাউজার পারমিশন চেক করুন।");
      console.error(err);
    });
}

socket.on("incoming-call", (data) => {
  incomingCallData = data;
  callModal.style.display = "flex";
  callStatusText.textContent = `${data.callerName} is ${data.callType} calling...`;
  acceptCallBtn.style.display = "inline-block";
});

acceptCallBtn.addEventListener("click", () => {
  if (!incomingCallData) return;
  const isVideo = incomingCallData.callType === "video";

  navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true })
    .then((stream) => {
      localStream = stream;
      localVideo.srcObject = stream;

      const call = myPeer.call(incomingCallData.callerPeerId, stream);
      currentCall = call;

      call.on("stream", (remoteStream) => {
        remoteVideo.srcObject = remoteStream;
        callStatusText.textContent = "Connected";
      });

      acceptCallBtn.style.display = "none";
    })
    .catch((err) => {
      alert("ক্যামেরা/মাইক্রোফোন অ্যাক্সেস করতে সমস্যা হচ্ছে!");
      console.error(err);
    });
});

myPeer.on("call", (call) => {
  currentCall = call;
  
  if (localStream) {
    call.answer(localStream);
    call.on("stream", (remoteStream) => {
      remoteVideo.srcObject = remoteStream;
      callStatusText.textContent = "Connected";
    });
  } else {
    const isVideo = incomingCallData ? incomingCallData.callType === "video" : true;
    navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true }).then((stream) => {
      localStream = stream;
      localVideo.srcObject = stream;
      call.answer(stream);
      call.on("stream", (remoteStream) => {
        remoteVideo.srcObject = remoteStream;
        callStatusText.textContent = "Connected";
      });
    });
  }
});

rejectCallBtn.addEventListener("click", endCall);

socket.on("call-ended", () => {
  closeCallUI();
});

function endCall() {
  if (currentRoom) {
    socket.emit("end-call", { roomCode: currentRoom });
  }
  closeCallUI();
}

function closeCallUI() {
  if (currentCall) currentCall.close();
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  callModal.style.display = "none";
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
}

// রুম থেকে বের হওয়ার বাটন
leaveRoomBtn.addEventListener("click", () => {
  if (currentRoom) {
    socket.emit("leave-room", { roomCode: currentRoom });
    localStorage.removeItem("chatWallpaper_" + currentRoom);
  }
  sessionStorage.removeItem("currentChatRoom");
  chatMessages.innerHTML = "";
  chatScreen.style.display = "none";
  dashboardScreen.style.display = "block";
  currentRoom = null;
});

const themeToggleBtn = document.getElementById("themeToggleBtn");
themeToggleBtn.addEventListener("click", () => {
  document.body.classList.toggle("light-theme");
});
