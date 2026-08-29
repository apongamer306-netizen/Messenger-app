const socket = io("https://ekt-chatter.onrender.com", {
  transports: ["websocket", "polling"]
});

let myPeer = new Peer();
let myPeerId = null;
let currentCall = null;
let localStream = null;
let currentCallType = null;

// Remote audio element
let remoteAudioElement = document.createElement("audio");
remoteAudioElement.autoplay = true;
document.body.appendChild(remoteAudioElement);

myPeer.on("open", (id) => {
  myPeerId = id;
  checkActiveSession();
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

// Call Modal Elements
const callModal = document.getElementById("callModal");
const callStatusText = document.getElementById("callStatusText");

const callVideoGrid = document.getElementById("callVideoGrid");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

const callProfileGrid = document.getElementById("callProfileGrid");
const localCallAvatar = document.getElementById("localCallAvatar");
const localCallName = document.getElementById("localCallName");
const remoteCallAvatar = document.getElementById("remoteCallAvatar");
const remoteCallName = document.getElementById("remoteCallName");

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
  checkActiveSession();
});

function checkActiveSession() {
  const isMasterUnlocked = sessionStorage.getItem("masterUnlocked");
  const savedUser = JSON.parse(localStorage.getItem("appUser"));
  const activeRoom = sessionStorage.getItem("activeRoom");

  if (isMasterUnlocked === "true") {
    masterKeyScreen.style.display = "none";
    if (savedUser) {
      currentUser = savedUser;
      if (activeRoom) {
        joinRoom(activeRoom, true);
      } else {
        showDashboard();
      }
    } else {
      authScreen.style.display = "block";
    }
  } else {
    masterKeyScreen.style.display = "block";
    authScreen.style.display = "none";
    dashboardScreen.style.display = "none";
    chatScreen.style.display = "none";
  }
}

unlockBtn.addEventListener("click", () => {
  if (masterKeyInput.value.trim() === "KT EYAMIN") {
    sessionStorage.setItem("masterUnlocked", "true");
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
  chatScreen.style.display = "none";
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
  const code = "1430909";
  joinRoom(code);
});

joinRoomBtn.addEventListener("click", () => {
  const code = roomCodeInput.value.trim().toUpperCase();
  if (code) joinRoom(code);
});

function joinRoom(code, isRefresh = false) {
  currentRoom = code;
  sessionStorage.setItem("activeRoom", code);

  socket.emit("join-room", { roomCode: code, user: currentUser, peerId: myPeerId });
  
  dashboardScreen.style.display = "none";
  chatScreen.style.display = "flex";
  chatUserName.textContent = currentUser.name;
  chatUserAvatar.src = currentUser.pic;
  chatRoomCode.textContent = "Code: " + code;

  if (isRefresh) {
    restoreMessages();
  } else {
    sessionStorage.removeItem("savedChatLogs");
    chatMessages.innerHTML = "";
  }
}

logoutBtn.addEventListener("click", () => {
  localStorage.removeItem("appUser");
  sessionStorage.removeItem("activeRoom");
  sessionStorage.removeItem("masterUnlocked");
  sessionStorage.removeItem("savedChatLogs");
  currentUser = null;
  location.reload();
});

// ------------------- MESSAGE SENDING & STATUS TRACKING -------------------

sendMessageBtn.addEventListener("click", sendChatMessage);
chatMessageInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") sendChatMessage();
});

function sendChatMessage() {
  const text = chatMessageInput.value.trim();
  if (text && currentRoom) {
    const msgId = "msg_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5);
    const msgData = {
      id: msgId,
      roomCode: currentRoom,
      sender: currentUser.name,
      senderPic: currentUser.pic,
      text: text,
      file: null,
      fileType: null,
      status: "sending"
    };

    // ১. নিজের মেসেজ হিসেবে UI-তে যুক্ত করা ("Sending..." স্ট্যাটাস সহ)
    appendMessage(msgData, true);
    chatMessageInput.value = "";

    // ২. সকেটে সেন্ড করা এবং কনফার্মেশন (Ack) পাওয়া মাত্র স্ট্যাটাস "Sent" করা
    socket.emit("send-message", msgData, (ack) => {
      if (ack && ack.success) {
        updateMessageStatus(msgId, "Sent");
      }
    });
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

    const msgId = "msg_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5);
    const msgData = {
      id: msgId,
      roomCode: currentRoom,
      sender: currentUser.name,
      senderPic: currentUser.pic,
      text: "",
      file: evt.target.result,
      fileType: fType,
      fileName: file.name,
      status: "sending"
    };

    appendMessage(msgData, true);
    fileAttachmentInput.value = "";

    socket.emit("send-message", msgData, (ack) => {
      if (ack && ack.success) {
        updateMessageStatus(msgId, "Sent");
      }
    });
  };
  reader.readAsDataURL(file);
});

socket.on("user-joined-notify", (data) => {
  const systemMsg = document.createElement("div");
  systemMsg.className = "system-notification";
  systemMsg.innerHTML = `<img src="${data.user.pic}" class="sys-avatar"/> <span><b>${data.user.name}</b> joined the room</span>`;
  chatMessages.appendChild(systemMsg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  saveMessages();
});

socket.on("receive-message", (data) => {
  const isMe = data.sender === currentUser.name;
  appendMessage(data, isMe);
});

function appendMessage(data, isMe) {
  // ডুপ্লিকেট মেসেজ রোধ
  if (data.id && document.getElementById(data.id)) return;

  const div = document.createElement("div");
  div.classList.add("message-bubble", isMe ? "my-msg" : "other-msg");
  if (data.id) div.id = data.id;
  
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

  // নিজের পাঠানো মেসেজ হলে নিচে স্ট্যাটাস ইন্দিকেটর থাকবে
  if (isMe) {
    const statusSpan = document.createElement("span");
    statusSpan.className = "msg-status";
    statusSpan.style.cssText = "font-size: 10px; opacity: 0.7; display: block; text-align: right; margin-top: 3px;";
    
    let statusText = "Sending...";
    if (data.status === "sent") statusText = "Sent";
    if (data.status === "seen") statusText = "Seen";
    
    statusSpan.textContent = statusText;
    contentBox.appendChild(statusSpan);
  }

  div.appendChild(contentBox);
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  // অন্যের পাঠানো মেসেজ রিসিভ করার সাথে সাথে সার্ভারকে "Seen" ইনফো পাঠানো
  if (!isMe && data.id) {
    socket.emit("mark-as-seen", { roomCode: currentRoom, msgId: data.id });
  }

  saveMessages();
}

function updateMessageStatus(msgId, statusText) {
  const msgElem = document.getElementById(msgId);
  if (msgElem) {
    const statusSpan = msgElem.querySelector(".msg-status");
    if (statusSpan) {
      statusSpan.textContent = statusText;
    }
  }
  saveMessages();
}

// সকেট লিসেনার: চ্যাটের অপর কেউ মেসেজটি দেখলে এটি ট্রিগার হবে
socket.on("message-seen", (data) => {
  updateMessageStatus(data.msgId, "Seen");
});

function saveMessages() {
  sessionStorage.setItem("savedChatLogs", chatMessages.innerHTML);
}

function restoreMessages() {
  const saved = sessionStorage.getItem("savedChatLogs");
  if (saved) {
    chatMessages.innerHTML = saved;
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
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

function setCallUI(type, remoteUser) {
  currentCallType = type;
  if (type === "video") {
    callVideoGrid.style.display = "flex";
    callProfileGrid.style.display = "none";
  } else {
    callVideoGrid.style.display = "none";
    callProfileGrid.style.display = "flex";

    localCallAvatar.src = currentUser.pic || "https://via.placeholder.com/100";
    localCallName.textContent = currentUser.name || "Me";

    if (remoteUser) {
      remoteCallAvatar.src = remoteUser.pic || "https://via.placeholder.com/100";
      remoteCallName.textContent = remoteUser.name || "User";
    } else {
      remoteCallAvatar.src = "https://via.placeholder.com/100";
      remoteCallName.textContent = "Connecting...";
    }
  }
}

function initiateCall(type) {
  if (!currentRoom) return;
  const isVideo = type === "video";
  
  navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true }).then((stream) => {
    localStream = stream;
    if (isVideo) {
      localVideo.srcObject = stream;
    }
    
    setCallUI(type, null);
    callModal.style.display = "flex";
    callStatusText.textContent = "Calling...";
    acceptCallBtn.style.display = "none";

    socket.emit("call-user", {
      roomCode: currentRoom,
      callerName: currentUser.name,
      callerPeerId: myPeerId,
      callerPic: currentUser.pic,
      callType: type
    });
  }).catch((err) => alert("Camera & Microphone Access Required!"));
}

socket.on("incoming-call", (data) => {
  incomingCallData = data;
  setCallUI(data.callType, { name: data.callerName, pic: data.callerPic });
  callModal.style.display = "flex";
  callStatusText.textContent = `${data.callerName} is ${data.callType} calling...`;
  acceptCallBtn.style.display = "inline-block";
});

socket.on("call-accepted-by-receiver", (data) => {
  if (currentCallType === "audio") {
    remoteCallAvatar.src = data.receiverPic || "https://via.placeholder.com/100";
    remoteCallName.textContent = data.receiverName || "Connected User";
  }
  callStatusText.textContent = "Connected";
});

acceptCallBtn.addEventListener("click", () => {
  if (!incomingCallData) return;
  const isVideo = incomingCallData.callType === "video";

  navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true }).then((stream) => {
    localStream = stream;
    if (isVideo) {
      localVideo.srcObject = stream;
    }

    setCallUI(incomingCallData.callType, { name: incomingCallData.callerName, pic: incomingCallData.callerPic });

    const call = myPeer.call(incomingCallData.callerPeerId, stream);
    currentCall = call;

    handleStream(call, isVideo);

    socket.emit("accept-call-notify", {
      roomCode: currentRoom,
      receiverName: currentUser.name,
      receiverPic: currentUser.pic
    });

    acceptCallBtn.style.display = "none";
  });
});

myPeer.on("call", (call) => {
  currentCall = call;
  call.answer(localStream);
  const isVideo = currentCallType === "video";
  handleStream(call, isVideo);
});

function handleStream(call, isVideo) {
  call.on("stream", (remoteStream) => {
    if (isVideo) {
      remoteVideo.srcObject = remoteStream;
    } else {
      remoteAudioElement.srcObject = remoteStream;
    }
    callStatusText.textContent = "Connected";
  });
}

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
  }
  callModal.style.display = "none";
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  remoteAudioElement.srcObject = null;
  currentCallType = null;
}

leaveRoomBtn.addEventListener("click", () => {
  sessionStorage.removeItem("activeRoom");
  sessionStorage.removeItem("savedChatLogs");
  currentRoom = null;
  chatMessages.innerHTML = "";
  chatScreen.style.display = "none";
  dashboardScreen.style.display = "block";
});

const themeToggleBtn = document.getElementById("themeToggleBtn");
themeToggleBtn.addEventListener("click", () => {
  document.body.classList.toggle("light-theme");
});
