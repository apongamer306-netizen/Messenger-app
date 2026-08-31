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

// রিমোট অডিও চালানোর জন্য গ্লোবাল অডিও এলিমেন্ট
let remoteAudioElement = document.createElement("audio");
remoteAudioElement.autoplay = true;
remoteAudioElement.style.display = "none";
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

// Call Elements
const startAudioCallBtn = document.getElementById("startAudioCallBtn");
const startVideoCallBtn = document.getElementById("startVideoCallBtn");
const callModal = document.getElementById("callModal");
const callStatusText = document.getElementById("callStatusText");
const callVideoGrid = document.getElementById("callVideoGrid");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const callProfileGrid = document.getElementById("callProfileGrid");
const localCallAvatar = document.getElementById("localCallAvatar");
const remoteCallAvatar = document.getElementById("remoteCallAvatar");
const localCallName = document.getElementById("localCallName");
const remoteCallName = document.getElementById("remoteCallName");
const acceptCallBtn = document.getElementById("acceptCallBtn");
const rejectCallBtn = document.getElementById("rejectCallBtn");

// Custom Modal Elements
const customModalOverlay = document.getElementById("customModalOverlay");
const modalTitle = document.getElementById("modalTitle");
const modalSubtitle = document.getElementById("modalSubtitle");
const modalInputGroup = document.getElementById("modalInputGroup");
const modalInput = document.getElementById("modalInput");
const modalActionContainer = document.getElementById("modalActionContainer");

// Theme Toggle Elements
const themeToggleBtn = document.getElementById("themeToggleBtn");
const bodyElement = document.body;

// Load Saved Theme
const savedTheme = localStorage.getItem("appTheme") || "dark-theme";
bodyElement.className = savedTheme;
updateThemeIcon(savedTheme);

if (themeToggleBtn) {
  themeToggleBtn.addEventListener("click", () => {
    if (bodyElement.classList.contains("dark-theme")) {
      bodyElement.classList.replace("dark-theme", "light-theme");
      localStorage.setItem("appTheme", "light-theme");
      updateThemeIcon("light-theme");
    } else {
      bodyElement.classList.replace("light-theme", "dark-theme");
      localStorage.setItem("appTheme", "dark-theme");
      updateThemeIcon("dark-theme");
    }
  });
}

function updateThemeIcon(theme) {
  if (!themeToggleBtn) return;
  const icon = themeToggleBtn.querySelector("i");
  if (icon) {
    if (theme === "light-theme") {
      icon.className = "fa-solid fa-sun";
    } else {
      icon.className = "fa-solid fa-moon";
    }
  }
}

let isSignUpMode = false;

// LocalStorage Helper Functions
function getStoredUsers() {
  const users = localStorage.getItem("usersDatabase");
  return users ? JSON.parse(users) : {};
}

function saveUserToStorage(user) {
  const users = getStoredUsers();
  users[user.phone] = user;
  localStorage.setItem("usersDatabase", JSON.stringify(users));
}

// Custom Popup Modal
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
  modalTitle.textContent = title;
  modalSubtitle.textContent = subtitle;
  modalInputGroup.style.display = "none";

  modalActionContainer.innerHTML = `
    <div style="display: flex; gap: 10px; width: 100%; justify-content: center;">
      <button id="modalConfirmBtn" class="btn btn-primary" style="width: 100%;">Confirm</button>
    </div>
  `;

  const confBtn = document.getElementById("modalConfirmBtn");
  customModalOverlay.style.display = "flex";

  return new Promise((resolve) => {
    const handleConfirm = () => {
      confBtn.removeEventListener("click", handleConfirm);
      customModalOverlay.style.display = "none";
      resolve(true);
    };
    confBtn.addEventListener("click", handleConfirm);
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
      await showCustomAlert("Access Denied", "ভুল Security PIN দিয়েছেন!");
    }
  } else if (isCreatingPassword) {
    if (!enteredPin) {
      return await showCustomAlert("Input Error", "অনুগ্রহ করে একটি পাসওয়ার্ড প্রদান করুন!");
    }
    localStorage.setItem("appMasterPin", enteredPin);
    await showCustomAlert("Success", "পাসওয়ার্ড সফলভাবে সেভ করা হয়েছে!");
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
          await showCustomAlert("Success", "নতুন Security PIN সফলভাবে সেভ করা হয়েছে!");
        } else if (newPin !== null) {
          await showCustomAlert("Error", "Security PIN ফাঁকা রাখা যাবে না!");
        }
      } else {
        await showCustomAlert("Failed", "ভুল Security PIN দিয়েছেন!");
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
        await showCustomAlert("Success", "Security PIN সফলভাবে সেট করা হয়েছে!");
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
      subtitle: "পাসওয়ার্ড রিমুভ করতে আপনার বর্তমান Security PIN টি দিন:",
      hasInput: true,
      placeholder: "Enter Security PIN"
    });

    if (enteredPin === null) return;

    if (enteredPin === savedPin) {
      localStorage.removeItem("appMasterPin");
      updateDashboardPinUI();
      await showCustomAlert("Remove Success", "আপনার Security PIN টি সফলভাবে রিমুভ করা হয়েছে!");
    } else {
      await showCustomAlert("Remove Failed", "ভুল Security PIN দিয়েছেন! পাসওয়ার্ড রিমুভ করা সম্ভব হয়নি।");
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

  if (!phone || !password) return await showCustomAlert("Input Missing", "ফোন নম্বর এবং পাসওয়ার্ড প্রদান করুন");

  const localUsers = getStoredUsers();

  if (isSignUpMode) {
    const name = fullNameInput.value.trim();
    if (!name) return await showCustomAlert("Input Missing", "আপনার নাম লিখুন");
    
    if (localUsers[phone]) {
      return await showCustomAlert("Error", "এই নম্বরটি ইতিমধ্যেই নিবন্ধিত!");
    }

    const newUser = { name, phone, password, pic: "https://via.placeholder.com/100" };
    saveUserToStorage(newUser);
    
    socket.emit("register-user", newUser, async (res) => {
      currentUser = newUser;
      localStorage.setItem("appUser", JSON.stringify(currentUser));
      showDashboard();
    });

  } else {
    const localUser = localUsers[phone];
    if (localUser && localUser.password === password) {
      currentUser = localUser;
      localStorage.setItem("appUser", JSON.stringify(currentUser));
      showDashboard();
    } else {
      socket.emit("login-user", { phone, password }, async (res) => {
        if (res.success) {
          currentUser = res.user;
          saveUserToStorage(currentUser);
          localStorage.setItem("appUser", JSON.stringify(currentUser));
          showDashboard();
        } else {
          await showCustomAlert("Login Failed", "ফোন নম্বর বা পাসওয়ার্ড ভুল!");
        }
      });
    }
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
      saveUserToStorage(currentUser);
    };
    reader.readAsDataURL(file);
  }
});

// CREATE ROOM HANDLER
createRoomBtn.addEventListener("click", () => {
  const randomCode = Math.floor(100000 + Math.random() * 900000).toString();
  joinRoom(randomCode);
});

// JOIN ROOM HANDLER
joinRoomBtn.addEventListener("click", () => {
  modalTitle.textContent = "Join Room";
  modalSubtitle.textContent = "Select room type to join:";
  modalInputGroup.style.display = "none";

  modalActionContainer.innerHTML = `
    <button id="optJoinSpecialBtn" class="btn btn-primary" style="background: linear-gradient(135deg, #0d6efd, #0b5ed7); color: #fff; width: 100%; margin-bottom: 8px;">
      <i class="fa-solid fa-star" style="margin-right: 6px;"></i>Join Special Room
    </button>
    <button id="optJoinRandomBtn" class="btn btn-primary" style="background: linear-gradient(135deg, #198754, #157347); color: #fff; width: 100%; margin-bottom: 8px;">
      <i class="fa-solid fa-shuffle" style="margin-right: 6px;"></i>Join Random Room
    </button>
    <button id="optCancelBtn" class="btn btn-secondary" style="background-color: #6c757d; color: #fff; width: 100%;">Cancel</button>
  `;

  customModalOverlay.style.display = "flex";

  document.getElementById("optJoinSpecialBtn").onclick = async () => {
    customModalOverlay.style.display = "none";
    const enteredPin = await showCustomModal({
      title: "Special Room Access",
      subtitle: "স্পেশাল রুমে প্রবেশ করতে Secret PIN টি লিখুন:",
      hasInput: true,
      placeholder: "Enter Secret PIN"
    });

    if (enteredPin === null) return;

    if (enteredPin === ADMIN_ROOM_PIN) {
      joinRoom(ADMIN_ROOM_PIN);
    } else {
      await showCustomAlert("Access Denied", "ভুল Secret PIN! আপনি স্পেশাল রুমে জয়েন করতে পারবেন না।");
    }
  };

  document.getElementById("optJoinRandomBtn").onclick = async () => {
    customModalOverlay.style.display = "none";
    const code = await showCustomModal({
      title: "Join Random Room",
      subtitle: "৬ ডিজিটের রুম কোডটি লিখুন:",
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

  dashboardScreen.style.display = "none";
  chatScreen.style.display = "flex";
  chatUserName.textContent = currentUser.name;
  chatUserAvatar.src = currentUser.pic;

  if (code === ADMIN_ROOM_PIN) {
    chatRoomCode.textContent = "Special Room";
    chatScreen.classList.add("special-room-chat");
  } else {
    chatRoomCode.textContent = "Code: " + code;
    chatScreen.classList.remove("special-room-chat");
  }

  // সোকেটের মাধ্যমে রুমে জয়েন করা
  socket.emit("join-room", { roomCode: code, user: currentUser, peerId: myPeerId }, (response) => {
    if (response && !response.success) {
      console.warn("Server room notice:", response.message);
    }
  });

  // পেজ রিফ্রেশ বা পুনরায় প্রবেশ করলে সার্ভার থেকে আগের চ্যাট হিস্ট্রি ফিরিয়ে আনা[cite: 3]
  chatMessages.innerHTML = "";
  socket.emit("get-room-history", code, (historyMessages) => {
    if (historyMessages && Array.isArray(historyMessages)) {
      historyMessages.forEach((msgData) => {
        appendChatMessage(msgData);
      });
    }
  });
}

leaveRoomBtn.addEventListener("click", () => {
  socket.emit("leave-room", { roomCode: currentRoom });
  sessionStorage.removeItem("activeRoom");
  currentRoom = null;
  chatScreen.classList.remove("special-room-chat");
  chatMessages.innerHTML = "";
  chatScreen.style.display = "none";
  dashboardScreen.style.display = "block";
});

logoutBtn.addEventListener("click", () => {
  localStorage.removeItem("appUser");
  sessionStorage.removeItem("activeRoom");
  sessionStorage.removeItem("masterUnlocked");
  currentUser = null;
  location.reload();
});

// Messaging System & File Attachment
sendMessageBtn.addEventListener("click", sendChatMessage);
chatMessageInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") sendChatMessage();
});

fileAttachmentInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(evt) {
    const fileData = {
      id: "msg_" + Date.now(),
      roomCode: currentRoom,
      sender: currentUser.name,
      senderPic: currentUser.pic || "https://via.placeholder.com/40",
      fileType: file.type,
      fileContent: evt.target.result,
      fileName: file.name
    };
    socket.emit("send-message", fileData);
    appendChatMessage(fileData);
  };
  reader.readAsDataURL(file);
});

function sendChatMessage() {
  const text = chatMessageInput.value.trim();
  if (text && currentRoom) {
    const msgId = "msg_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5);
    const msgData = {
      id: msgId,
      roomCode: currentRoom,
      sender: currentUser.name,
      senderPic: currentUser.pic || "https://via.placeholder.com/40",
      text: text
    };
    socket.emit("send-message", msgData);
    chatMessageInput.value = "";
    appendChatMessage(msgData);
  }
}

socket.on("receive-message", (msg) => {
  appendChatMessage(msg);
});

// রুমে নতুন ইউজার জয়েন করলে সিস্টেম নোটিফিকেশন দেখানো[cite: 3]
socket.on("user-joined-notify", (data) => {
  if (data && data.user) {
    const notificationDiv = document.createElement("div");
    notificationDiv.style.textAlign = "center";
    notificationDiv.style.margin = "10px 0";
    notificationDiv.style.color = "gray";
    notificationDiv.style.fontSize = "13px";
    notificationDiv.innerHTML = `<span>${data.user.name} রুমে প্রবেশ করেছেন।</span>`;
    chatMessages.appendChild(notificationDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
});

function appendChatMessage(msg) {
  const msgDiv = document.createElement("div");
  const isMe = msg.sender === currentUser.name;
  msgDiv.style.display = "flex";
  msgDiv.style.alignItems = "flex-end";
  msgDiv.style.gap = "8px";
  msgDiv.style.justifyContent = isMe ? "flex-end" : "flex-start";
  msgDiv.style.marginBottom = "10px";

  let contentHtml = "";
  if (msg.fileType) {
    if (msg.fileType.startsWith("image/")) {
      contentHtml = `<img src="${msg.fileContent}" style="max-width: 200px; border-radius: 8px; display: block; margin-top: 4px;" />`;
    } else if (msg.fileType.startsWith("video/")) {
      contentHtml = `<video src="${msg.fileContent}" controls style="max-width: 200px; border-radius: 8px; display: block; margin-top: 4px;"></video>`;
    } else if (msg.fileType.startsWith("audio/")) {
      contentHtml = `<audio src="${msg.fileContent}" controls style="max-width: 200px; display: block; margin-top: 4px;"></audio>`;
    } else {
      contentHtml = `<a href="${msg.fileContent}" download="${msg.fileName}" style="color: #fff; text-decoration: underline;">📁 ${msg.fileName}</a>`;
    }
  } else {
    contentHtml = `<span>${msg.text}</span>`;
  }

  const avatarImg = `<img src="${msg.senderPic || 'https://via.placeholder.com/40'}" style="width: 28px; height: 28px; border-radius: 50%; object-fit: cover;" />`;

  if (isMe) {
    msgDiv.innerHTML = `
      <div style="background: #0d6efd; color: #fff; padding: 10px 14px; border-radius: 12px; max-width: 70%; word-break: break-word; position: relative;">
        ${contentHtml}
      </div>
      ${avatarImg}
    `;
  } else {
    msgDiv.innerHTML = `
      ${avatarImg}
      <div style="background: #333; color: #fff; padding: 10px 14px; border-radius: 12px; max-width: 70%; word-break: break-word; position: relative;">
        ${contentHtml}
      </div>
    `;
  }

  chatMessages.appendChild(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}


// ================= CORRECTION FOR AUDIO/VIDEO CALLING =================

startAudioCallBtn.addEventListener("click", () => initiateCall("audio"));
startVideoCallBtn.addEventListener("click", () => initiateCall("video"));

async function initiateCall(type) {
  currentCallType = type;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: type === "video"
    });

    if (type === "video") {
      localVideo.srcObject = localStream;
      callVideoGrid.style.display = "flex";
      callProfileGrid.style.display = "none";
    } else {
      callVideoGrid.style.display = "none";
      callProfileGrid.style.display = "flex";
    }

    localCallAvatar.src = currentUser.pic;
    localCallName.textContent = currentUser.name;
    callStatusText.textContent = "Calling...";
    acceptCallBtn.style.display = "none";
    callModal.style.display = "flex";

    socket.emit("call-user", {
      roomCode: currentRoom,
      callerPeerId: myPeerId,
      callerName: currentUser.name,
      callerPic: currentUser.pic,
      callType: type
    });

  } catch (err) {
    console.error("Media error:", err);
    showCustomAlert("Permission Error", "মাইক্রোফোন বা ক্যামেরা পারমিশন দেওয়া হয়নি অথবা ব্রাউজার ব্লক করে রেখেছে!");
  }
}

socket.on("incoming-call", (data) => {
  currentCallType = data.callType;
  remoteCallName.textContent = data.callerName;
  remoteCallAvatar.src = data.callerPic;
  localCallAvatar.src = currentUser.pic;
  localCallName.textContent = currentUser.name;
  
  callStatusText.textContent = `Incoming ${data.callType} call from ${data.callerName}`;
  acceptCallBtn.style.display = "inline-block";
  callVideoGrid.style.display = "none";
  callProfileGrid.style.display = "flex";
  callModal.style.display = "flex";

  acceptCallBtn.onclick = async () => {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: currentCallType === "video"
      });

      if (currentCallType === "video") {
        localVideo.srcObject = localStream;
        callVideoGrid.style.display = "flex";
        callProfileGrid.style.display = "none";
      } else {
        callVideoGrid.style.display = "none";
        callProfileGrid.style.display = "flex";
      }

      const call = myPeer.call(data.callerPeerId, localStream);
      handleCallConnection(call);

      socket.emit("accept-call-notify", { roomCode: currentRoom });
      acceptCallBtn.style.display = "none";
      callStatusText.textContent = "Connected";
    } catch (err) {
      console.error("Answer error:", err);
      showCustomAlert("Error", "কল রিসিভ করার সময় ক্যামেরা/মাইক্রোফোন এক্সেস পাওয়া যায়নি!");
    }
  };
});

myPeer.on("call", async (call) => {
  currentCallType = call.metadata ? call.metadata.type : currentCallType;
  try {
    if (!localStream) {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: currentCallType === "video"
      });
    }

    if (currentCallType === "video") {
      localVideo.srcObject = localStream;
      callVideoGrid.style.display = "flex";
      callProfileGrid.style.display = "none";
    } else {
      callVideoGrid.style.display = "none";
      callProfileGrid.style.display = "flex";
    }

    call.answer(localStream);
    handleCallConnection(call);
    callModal.style.display = "flex";
    callStatusText.textContent = "Connected";
  } catch (err) {
    console.error("Auto answer error:", err);
  }
});

function handleCallConnection(call) {
  currentCall = call;
  
  call.on("stream", (remoteStream) => {
    if (currentCallType === "video") {
      remoteVideo.srcObject = remoteStream;
    } else {
      remoteAudioElement.srcObject = remoteStream;
      remoteAudioElement.play().catch(e => console.log("Audio play deferred:", e));
    }
    callStatusText.textContent = "Connected";
  });

  call.on("close", () => {
    endCallCleanup();
  });
  
  call.on("error", (err) => {
    console.error("Call error:", err);
    endCallCleanup();
  });
}

socket.on("call-accepted-by-receiver", () => {
  callStatusText.textContent = "Connected";
});

rejectCallBtn.addEventListener("click", () => {
  socket.emit("end-call", { roomCode: currentRoom });
  endCallCleanup();
});

socket.on("call-ended", () => {
  endCallCleanup();
});

socket.on("call-directly-ended", () => {
  endCallCleanup();
});

function endCallCleanup() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  if (currentCall) {
    currentCall.close();
    currentCall = null;
  }
  callModal.style.display = "none";
  callVideoGrid.style.display = "none";
  callProfileGrid.style.display = "flex";
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  remoteAudioElement.srcObject = null;
  callStatusText.textContent = "Call Ended";
}
