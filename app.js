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

// Authentication Logic (Updated for LocalStorage Sync)
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

  const localUsers = getStoredUsers();

  if (isSignUpMode) {
    const name = fullNameInput.value.trim();
    if (!name) return await showCustomAlert("Input Missing", "আপনার নাম লিখুন");
    
    if (localUsers[phone]) {
      return await showCustomAlert("Error", "এই নম্বরটি ইতিমধ্যেই নিবন্ধিত!");
    }

    const newUser = { name, phone, password, pic: "https://via.placeholder.com/100" };
    
    // Local Storage-এ ইউজার সেভ করা 
    saveUserToStorage(newUser);
    
    // সকেট সার্ভারে ব্যাকআপ রেজিস্টার 
    socket.emit("register-user", newUser, async (res) => {
      currentUser = newUser;
      localStorage.setItem("appUser", JSON.stringify(currentUser));
      showDashboard();
    });

  } else {
    // LocalStorage থেকে পাসওয়ার্ড চেক করা
    const localUser = localUsers[phone];
    if (localUser && localUser.password === password) {
      currentUser = localUser;
      localStorage.setItem("appUser", JSON.stringify(currentUser));
      showDashboard();
    } else {
      // ব্যাকএন্ড সার্ভার থেকেও একবার চেষ্টা করার জন্য Fallback
      socket.emit("login-user", { phone, password }, async (res) => {
        if (res.success) {
          currentUser = res.user;
          saveUserToStorage(currentUser); // লোকাল স্টোরেজে না থাকলে সেভ করে নেয়া
          localStorage.setItem("appUser", JSON.stringify(currentUser));
          showDashboard();
        } else {
          await showCustomAlert("Login Failed", "ফোন নম্বর বা পাসওয়ার্ড ভুল!");
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

// Profile Picture Upload Handler (Base64 সেভ এবং LocalStorage আপডেট)
avatarUpload.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (evt) => {
      currentUser.pic = evt.target.result;
      dashboardAvatar.src = currentUser.pic;
      
      // কারেন্ট ইউজার ও ফুল ডাটাবেজে পিকচার আপডেট
      localStorage.setItem("appUser", JSON.stringify(currentUser));
      saveUserToStorage(currentUser);
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

// Logout Handler (কারেন্ট সেশন মুছে যাবে কিন্তু LocalStorage Database থেকে অ্যাকাউন্ট ডাটা মুছবে না)
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
      text: text
    };
  }
}
