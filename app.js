const socket = io("https://ekt-chatter.onrender.com", {
  transports: ["websocket", "polling"]
});

let myPeer = new Peer();
let myPeerId = null;
let currentCall = null;
let localStream = null;
let currentCallType = null;

// Fixed Secret Admin Room Code
const ADMIN_ROOM_PIN = "1430909";

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

const masterTitle = document.getElementById("masterTitle");
const masterSubtitle = document.getElementById("masterSubtitle");
const passInputGroup = document.getElementById("passInputGroup");
const masterKeyInput = document.getElementById("masterKeyInput");
const unlockBtn = document.getElementById("unlockBtn");
const directOpenBtn = document.getElementById("directOpenBtn");
const masterToggleMsg = document.getElementById("masterToggleMsg");
const masterToggleLink = document.getElementById("masterToggleLink");

let isCreatingPassword = false;

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
const joinRoomBtn = document.getElementById("joinRoomBtn");

const setPinBtn = document.getElementById("setPinBtn");
const setPinBtnText = document.getElementById("setPinBtnText");
const removePinBtn = document.getElementById("removePinBtn");
const logoutBtn = document.getElementById("logoutBtn");

const chatUserAvatar = document.getElementById("chatUserAvatar");
const chatUserName = document.getElementById("chatUserName");
const chatRoomCode = document.getElementById("chatRoomCode");
const chatMessages = document.getElementById("chatMessages");
const chatMessageInput = document.getElementById("chatMessageInput");
const sendMessageBtn = document.getElementById("sendMessageBtn");
const fileAttachmentInput = document.getElementById("fileAttachmentInput");
const leaveRoomBtn = document.getElementById("leaveRoomBtn");

// Custom Modal Elements
const customModalOverlay = document.getElementById("customModalOverlay");
const modalTitle = document.getElementById("modalTitle");
const modalSubtitle = document.getElementById("modalSubtitle");
const modalInputGroup = document.getElementById("modalInputGroup");
const modalInput = document.getElementById("modalInput");
const modalActionContainer = document.getElementById("modalActionContainer");

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

// Custom Modal System
function showCustomModal(options) {
  modalTitle.textContent = options.title || "Notice";
  modalSubtitle.textContent = options.subtitle || "";
  
  if (options.hasInput) {
    modalInputGroup.style.display = "block";
    modalInput.value = "";
    modalInput.placeholder = options.placeholder || "Enter value";
  } else {
    modalInputGroup.style.display = "none";
  }

  modalActionContainer.innerHTML = `
    <div style="display: flex; gap: 10px; width: 100%; justify-content: center;">
      <button id="modalConfirmBtn" class="btn btn-primary">Confirm</button>
      <button id="modalCancelBtn" class="btn btn-secondary" style="background-color: #6c757d; color: #fff;">Cancel</button>
    </div>
  `;

  const confBtn = document.getElementById("modalConfirmBtn");
  const cancBtn = document.getElementById("modalCancelBtn");

  if (options.hideCancel) {
    cancBtn.style.display = "none";
  }

  customModalOverlay.style.display = "flex";

  return new Promise((resolve) => {
    const handleConfirm = () => {
      cleanup();
      resolve(options.hasInput ? modalInput.value.trim() : true);
    };

    const handleCancel = () => {
      cleanup();
      resolve(null);
    };

    const cleanup = () => {
      customModalOverlay.style.display = "none";
    };

    confBtn.addEventListener("click", handleConfirm);
    cancBtn.addEventListener("click", handleCancel);
  });
}

function showCustomAlert(title, subtitle) {
  return showCustomModal({
    title: title,
    subtitle: subtitle,
    hasInput: false,
    hideCancel: true
  });
}

document.addEventListener("DOMContentLoaded", () => {
  checkActiveSession();
});

// Master Screen Logic
function updateMasterScreenUI() {
  const savedPin = localStorage.getItem("appMasterPin");

  if (savedPin) {
    masterTitle.textContent = "Enter Security PIN";
    masterSubtitle.textContent = "Please enter your password to proceed";
    passInputGroup.style.display = "block";
    unlockBtn.style.display = "block";
    unlockBtn.textContent = "Unlock";
    directOpenBtn.style.display = "none";
    masterToggleMsg.parentElement.style.display = "none";
  } else {
    if (isCreatingPassword) {
      masterTitle.textContent = "Create Password";
      masterSubtitle.textContent = "Set a password for app security";
      passInputGroup.style.display = "block";
      unlockBtn.style.display = "block";
      unlockBtn.textContent = "Save Password";
      directOpenBtn.style.display = "none";
      masterToggleMsg.textContent = "Don't want password?";
      masterToggleLink.textContent = "Open Directly";
      masterToggleMsg.parentElement.style.display = "block";
    } else {
      masterTitle.textContent = "Welcome";
      masterSubtitle.textContent = "You can enter directly or set a security password";
      passInputGroup.style.display = "none";
      unlockBtn.style.display = "none";
      directOpenBtn.style.display = "block";
      masterToggleMsg.textContent = "Want extra security?";
      masterToggleLink.textContent = "Create Password";
      masterToggleMsg.parentElement.style.display = "block";
    }
  }
}

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
    updateMasterScreenUI();
  }
}

masterToggleLink.addEventListener("click", (e) => {
  e.preventDefault();
  isCreatingPassword = !isCreatingPassword;
  masterKeyInput.value = "";
  updateMasterScreenUI();
});

unlockBtn.addEventListener("click", async () => {
  const savedPin = localStorage.getItem("appMasterPin");
  const enteredPin = masterKeyInput.value.trim();

  if (savedPin) {
    if (enteredPin === savedPin) {
      grantAccess();
    } else {
      await showCustomAlert("Access Denied", "ভুল Security PIN দিয়েছেন!");
    }
  } else if (isCreatingPassword) {
    if (!enteredPin) {
      return await showCustomAlert("Input Error", "অনুগ্রহ করে একটি পাসওয়ার্ড প্রদান করুন!");
    }
    localStorage.setItem("appMasterPin", enteredPin);
    await showCustomAlert("Success", "পাসওয়ার্ড সফলভাবে সেভ করা হয়েছে!");
    grantAccess();
  }
});

directOpenBtn.addEventListener("click", () => {
  grantAccess();
});

function grantAccess() {
  sessionStorage.setItem("masterUnlocked", "true");
  masterKeyScreen.style.display = "none";
  
  const savedUser = JSON.parse(localStorage.getItem("appUser"));
  if (savedUser) {
    currentUser = savedUser;
    showDashboard();
  } else {
    authScreen.style.display = "block";
  }
}

// Security PIN Management
function updateDashboardPinUI() {
  const savedPin = localStorage.getItem("appMasterPin");
  if (savedPin) {
    setPinBtnText.textContent = "Change Security PIN";
    removePinBtn.style.display = "block";
  } else {
    setPinBtnText.textContent = "Set Security PIN";
    removePinBtn.style.display = "none";
  }
}

if (setPinBtn) {
  setPinBtn.addEventListener("click", async () => {
    const savedPin = localStorage.getItem("appMasterPin");

    if (savedPin) {
      const oldPin = await showCustomModal({
        title: "Change Security PIN",
        subtitle: "আপনার বর্তমান Security PIN টি দিন:",
        hasInput: true,
        placeholder: "Enter Old PIN"
      });

      if (oldPin === null) return;

      if (oldPin === savedPin) {
        const newPin = await showCustomModal({
          title: "New Security PIN",
          subtitle: "নতুন Security PIN টি সেট করুন:",
          hasInput: true,
          placeholder: "Enter New PIN"
        });

        if (newPin && newPin.trim() !== "") {
          localStorage.setItem("appMasterPin", newPin.trim());
          updateDashboardPinUI();
          await showCustomAlert("Success", "নতুন Security PIN সফলভাবে সেভ করা হয়েছে!");
        } else if (newPin !== null) {
          await showCustomAlert("Error", "Security PIN ফাঁকা রাখা যাবে না!");
        }
      } else {
        await showCustomAlert("Failed", "ভুল Security PIN দিয়েছেন!");
      }

    } else {
      const newPin = await showCustomModal({
        title: "Set Security PIN",
        subtitle: "আপনার Security PIN টি সেট করুন:",
        hasInput: true,
        placeholder: "Enter New PIN"
      });

      if (newPin && newPin.trim() !== "") {
        localStorage.setItem("appMasterPin", newPin.trim());
        updateDashboardPinUI();
        await showCustomAlert("Success", "Security PIN সফলভাবে সেট করা হয়েছে!");
      } else if (newPin !== null) {
        await showCustomAlert("Error", "Security PIN ফাঁকা রাখা যাবে না!");
      }
    }
  });
}

if (removePinBtn) {
  removePinBtn.addEventListener("click", async () => {
    const savedPin = localStorage.getItem("appMasterPin");

    if (!savedPin) {
      return await showCustomAlert("No PIN Found", "বর্তমানে কোনো Security PIN সেট করা নেই!");
    }

    const enteredPin = await showCustomModal({
      title: "Remove Security PIN",
      subtitle: "পাসওয়ার্ড রিমুভ করতে আপনার বর্তমান Security PIN টি দিন:",
      hasInput: true,
      placeholder: "Enter Security PIN"
    });

    if (enteredPin === null) return;

    if (enteredPin === savedPin) {
      localStorage.removeItem("appMasterPin");
      updateDashboardPinUI();
      await showCustomAlert("Remove Success", "আপনার Security PIN টি সফলভাবে রিমুভ করা হয়েছে!");
    } else {
      await showCustomAlert("Remove Failed", "ভুল Security PIN দিয়েছেন! পাসওয়ার্ড রিমুভ করা সম্ভব হয়নি।");
    }
  });
}

// Authentication Logic
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

authSubmitBtn.addEventListener("click", async () => {
  const phone = phoneInput.value.trim();
  const password = authPasswordInput.value.trim();

  if (!phone || !password) return await showCustomAlert("Input Missing", "ফোন নম্বর এবং পাসওয়ার্ড প্রদান করুন");

  if (isSignUpMode) {
    const name = fullNameInput.value.trim();
    if (!name) return await showCustomAlert("Input Missing", "আপনার নাম লিখুন");
    
    const newUser = { name, phone, password, pic: "https://via.placeholder.com/100" };
    socket.emit("register-user", newUser, async (res) => {
      if (res.success) {
        currentUser = res.user;
        localStorage.setItem("appUser", JSON.stringify(currentUser));
        showDashboard();
      } else {
        await showCustomAlert("Error", res.message);
      }
    });

  } else {
    socket.emit("login-user", { phone, password }, async (res) => {
      if (res.success) {
        currentUser = res.user;
        localStorage.setItem("appUser", JSON.stringify(currentUser));
        showDashboard();
      } else {
        await showCustomAlert("Login Failed", res.message);
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
  updateDashboardPinUI();
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

// Create Room Buttons
createRoomBtn.addEventListener("click", () => {
  modalTitle.textContent = "Create Room";
  modalSubtitle.textContent = "Select room type to create:";
  modalInputGroup.style.display = "none";

  modalActionContainer.innerHTML = `
    <button id="optAdminRoomBtn" class="btn btn-primary" style="background-color: #0d6efd; color: #fff;">Admin Room</button>
    <button id="optOwnRoomBtn" class="btn btn-primary" style="background-color: #198754; color: #fff; margin-top: 5px;">Own Room (Random Code)</button>
    <button id="optCancelBtn" class="btn btn-secondary" style="background-color: #6c757d; color: #fff; margin-top: 5px;">Cancel</button>
  `;

  customModalOverlay.style.display = "flex";

  document.getElementById("optAdminRoomBtn").onclick = () => {
    customModalOverlay.style.display = "none";
    joinRoom(ADMIN_ROOM_PIN);
  };

  document.getElementById("optOwnRoomBtn").onclick = () => {
    customModalOverlay.style.display = "none";
    const randomCode = Math.floor(100000 + Math.random() * 900000).toString();
    joinRoom(randomCode);
  };

  document.getElementById("optCancelBtn").onclick = () => {
    customModalOverlay.style.display = "none";
  };
});

// Join Room Buttons
joinRoomBtn.addEventListener("click", () => {
  modalTitle.textContent = "Join Room";
  modalSubtitle.textContent = "Select room type to join:";
  modalInputGroup.style.display = "none";

  modalActionContainer.innerHTML = `
    <button id="optJoinAdminBtn" class="btn btn-primary" style="background-color: #0d6efd; color: #fff;">Admin Room Join</button>
    <button id="optJoinRandomBtn" class="btn btn-primary" style="background-color: #198754; color: #fff; margin-top: 5px;">Random Room Join</button>
    <button id="optCancelBtn" class="btn btn-secondary" style="background-color: #6c757d; color: #fff; margin-top: 5px;">Cancel</button>
  `;

  customModalOverlay.style.display = "flex";

  document.getElementById("optJoinAdminBtn").onclick = async () => {
    customModalOverlay.style.display = "none";
    const enteredPin = await showCustomModal({
      title: "Admin Room Access",
      subtitle: "অ্যাডমিন রুমে প্রবেশ করতে Secret PIN লিখুন:",
      hasInput: true,
      placeholder: "Enter Secret PIN"
    });

    if (enteredPin === null) return;

    if (enteredPin === ADMIN_ROOM_PIN) {
      joinRoom(ADMIN_ROOM_PIN);
    } else {
      await showCustomAlert("Access Denied", "ভুল Secret PIN! আপনি অ্যাডমিন রুমে জয়েন করতে পারবেন না।");
    }
  };

  document.getElementById("optJoinRandomBtn").onclick = async () => {
    customModalOverlay.style.display = "none";
    const code = await showCustomModal({
      title: "Join Random Room",
      subtitle: "আপনার রুম কোডটি লিখুন:",
      hasInput: true,
      placeholder: "Enter 6 Digit Code"
    });

    if (code && code.trim() !== "") {
      joinRoom(code.trim().toUpperCase());
    }
  };

  document.getElementById("optCancelBtn").onclick = () => {
    customModalOverlay.style.display = "none";
  };
});

function joinRoom(code, isRefresh = false) {
  currentRoom = code;
  sessionStorage.setItem("activeRoom", code);

  socket.emit("join-room", { roomCode: code, user: currentUser, peerId: myPeerId });
  
  dashboardScreen.style.display = "none";
  chatScreen.style.display = "flex";
  chatUserName.textContent = currentUser.name;
  chatUserAvatar.src = currentUser.pic;

  // Secret Admin Check - Hidden from header
  if (code === ADMIN_ROOM_PIN) {
    chatRoomCode.textContent = "Admin Room";
  } else {
    chatRoomCode.textContent = "Code: " + code;
  }

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

// Messaging System
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

    appendMessage(msgData, true);
    chatMessageInput.value = "";

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

  if (!isMe && data.id && document.hasFocus()) {
    socket.emit("mark-as-seen", { 
      roomCode: currentRoom, 
      msgId: data.id, 
      seenByPic: currentUser.pic 
    });
  }
});

window.addEventListener("focus", () => {
  if (currentRoom) {
    const unreadMessages = document.querySelectorAll(".other-msg");
    unreadMessages.forEach(msg => {
      if (msg.id) {
        socket.emit("mark-as-seen", { 
          roomCode: currentRoom, 
          msgId: msg.id, 
          seenByPic: currentUser.pic 
        });
      }
    });
  }
});

function appendMessage(data, isMe) {
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

  if (isMe) {
    const statusSpan = document.createElement("span");
    statusSpan.className = "msg-status";
    
    if (data.status === "seen" && data.seenByPic) {
      statusSpan.innerHTML = `<img src="${data.seenByPic}" class="seen-avatar" title="Seen"/>`;
    } else if (data.status === "sent") {
      statusSpan.textContent = "Sent";
    } else {
      statusSpan.textContent = "Sending...";
    }
    
    contentBox.appendChild(statusSpan);
  }

  div.appendChild(contentBox);
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  saveMessages();
}

function updateMessageStatus(msgId, statusText, seenByPic = null) {
  const msgElem = document.getElementById(msgId);
  if (msgElem) {
    const statusSpan = msgElem.querySelector(".msg-status");
    if (statusSpan) {
      if (statusText === "Seen" && seenByPic) {
        statusSpan.innerHTML = `<img src="${seenByPic}" class="seen-avatar" title="Seen"/>`;
      } else {
        statusSpan.textContent = statusText;
      }
    }
  }
  saveMessages();
}

socket.on("message-seen", (data) => {
  updateMessageStatus(data.msgId, "Seen", data.seenByPic);
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

// Audio / Video Calling Logic
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
  }).catch(async () => await showCustomAlert("Permission Error", "Camera & Microphone Access Required!"));
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
