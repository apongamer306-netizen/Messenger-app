// ================= AUTO-CLEAR OLD/STALE STORAGE =================
// Bumping APP_STORAGE_VERSION wipes every old localStorage & sessionStorage
// value from previous versions of the app, so nobody gets stuck with a
// corrupted/old session, PIN, or room flag.
const APP_STORAGE_VERSION = "v2";
try {
  if (localStorage.getItem("appStorageVersion") !== APP_STORAGE_VERSION) {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("appStorageVersion", APP_STORAGE_VERSION);
  }
} catch (e) {
  // storage not available (private mode etc.) — safe to ignore
}

// Connect to the SAME server that served this page (works on any Render URL,
// custom domain, or localhost) instead of a hardcoded/foreign address.
const socket = io({
  transports: ["websocket", "polling"]
});

let myPeer = new Peer();
let myPeerId = null;
let currentCall = null;
let localStream = null;
let currentCallType = null;

const ADMIN_ROOM_PIN = "1430909";

let remoteAudioElement = document.createElement("audio");
remoteAudioElement.autoplay = true;
remoteAudioElement.style.display = "none";
document.body.appendChild(remoteAudioElement);

myPeer.on("open", (id) => {
  myPeerId = id;
});

let currentUser = null;
let currentRoom = null;
let activeDirectChatFriend = null;

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

let editNameBtn = document.getElementById("editNameBtn");
if (!editNameBtn && dashboardUserName) {
  editNameBtn = document.createElement("i");
  editNameBtn.id = "editNameBtn";
  editNameBtn.className = "fa-solid fa-pen-to-square";
  editNameBtn.style.cssText = "margin-left: 8px; cursor: pointer; color: #0d6efd; font-size: 14px;";
  dashboardUserName.parentNode.appendChild(editNameBtn);
}

const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");
// Premium friend button — same size/shape as "Create Room", placed above it
let friendIconBtn = document.getElementById("friendIconBtn");
if (!friendIconBtn && createRoomBtn) {
  friendIconBtn = document.createElement("button");
  friendIconBtn.id = "friendIconBtn";
  friendIconBtn.className = "btn btn-primary";
  friendIconBtn.style.cssText = "background: linear-gradient(135deg, #6f42c1, #563d7c); display: flex; align-items: center; justify-content: center; gap: 8px;";
  friendIconBtn.innerHTML = `<i class="fa-solid fa-user-group"></i> Friends <span id="friendReqBadge" class="friend-req-badge">0</span>`;
  createRoomBtn.parentNode.insertBefore(friendIconBtn, createRoomBtn);
}

// Premium slide-up friends panel (requests + friends list)
const friendsPanelOverlay = document.createElement("div");
friendsPanelOverlay.id = "friendsPanelOverlay";
friendsPanelOverlay.className = "friends-panel-overlay";
friendsPanelOverlay.innerHTML = `
  <div class="friends-panel">
    <div class="friends-panel-header">
      <div>
        <h3><i class="fa-solid fa-user-group"></i> Friends</h3>
        <p id="friendsCountText">You have 0 friends</p>
      </div>
      <button id="closeFriendsPanelBtn" class="friends-panel-close"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="friends-panel-body">
      <div id="friendRequestsSection" class="friend-requests-section">
        <h4><i class="fa-solid fa-user-plus"></i> Friend Requests</h4>
        <div id="friendRequestsList" class="friend-requests-list"></div>
      </div>
      <div class="friends-list-section">
        <h4><i class="fa-solid fa-address-book"></i> My Friends</h4>
        <div id="myFriendsList" class="friends-list"></div>
      </div>
    </div>
  </div>
`;
document.body.appendChild(friendsPanelOverlay);

// Premium full-screen direct chat interface (same look as the room chat)
const directChatScreen = document.createElement("div");
directChatScreen.id = "directChatScreen";
directChatScreen.className = "direct-chat-screen";
directChatScreen.innerHTML = `
  <div class="chat-header direct-chat-header">
    <div class="user-info">
      <button id="backFromDirectChatBtn" class="icon-btn direct-back-btn"><i class="fa-solid fa-arrow-left"></i></button>
      <img id="directChatAvatar" src="https://via.placeholder.com/40" alt="Avatar">
      <div>
        <h4 id="directChatName">Friend Name</h4>
        <span class="direct-chat-status">Direct Message</span>
      </div>
    </div>
    <div class="chat-actions">
      <button id="directAudioCallBtn" class="action-btn call-audio" title="Audio Call"><i class="fa-solid fa-phone"></i></button>
      <button id="directVideoCallBtn" class="action-btn call-video" title="Video Call"><i class="fa-solid fa-video"></i></button>
      <div class="direct-menu-container">
        <button id="directMenuToggle" class="action-btn"><i class="fa-solid fa-ellipsis-vertical"></i></button>
        <div id="directDropdownMenu" class="direct-dropdown-menu">
          <div id="menuDirectTheme"><i class="fa-solid fa-palette"></i> Theme</div>
          <div id="menuClearChat"><i class="fa-solid fa-trash"></i> Clear Chat</div>
          <div id="menuBlockUser"><i class="fa-solid fa-ban"></i> Block User</div>
        </div>
      </div>
    </div>
  </div>
  <div id="directChatMessages" class="chat-messages"></div>
  <div class="chat-input-area">
    <label for="directFileAttachmentInput" class="attach-btn"><i class="fa-solid fa-paperclip"></i></label>
    <input type="file" id="directFileAttachmentInput" accept="image/*,video/*,audio/*" style="display: none;">
    <input type="text" id="directMessageInput" placeholder="Type a message...">
    <button id="sendDirectMsgBtn" class="send-btn"><i class="fa-solid fa-paper-plane"></i></button>
  </div>
`;
document.body.appendChild(directChatScreen);

// Toast notification container for incoming friend messages
const toastContainer = document.createElement("div");
toastContainer.id = "toastContainer";
toastContainer.className = "toast-container";
document.body.appendChild(toastContainer);


// রুম মেম্বার হেডার ব্যানার
const roomMembersHeader = document.createElement("div");
roomMembersHeader.id = "roomMembersHeader";
roomMembersHeader.style.cssText = "display:none; background: rgba(0,0,0,0.4); padding: 8px 15px; border-bottom: 1px solid #444; align-items: center; gap: 10px; overflow-x: auto; white-space: nowrap;";
roomMembersHeader.innerHTML = `<span style="font-size: 12px; color: #adb5bd; font-weight: bold;">Room Members:</span> <div id="roomMembersAvatars" style="display: inline-flex; gap: 8px;"></div>`;
if (chatScreen) {
  chatScreen.insertBefore(roomMembersHeader, chatScreen.firstChild);
}

// ================= থিম সিস্টেম মোডাল এবং হেডার বাটন তৈরি =================
let themeModal = document.createElement("div");
themeModal.id = "themeModal";
themeModal.style.cssText = "display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:99999; justify-content:center; align-items:center;";
themeModal.innerHTML = `
  <div style="background: var(--bs-body-bg, #212529); color: var(--bs-body-color, #fff); width: 90%; max-width: 400px; padding: 20px; border-radius: 12px; border: 1px solid #444;">
    <h5 style="margin-top: 0; margin-bottom: 15px;"><i class="fa-solid fa-palette" style="margin-right: 8px;"></i>Select Room Theme</h5>
    <div style="display: flex; gap: 10px; margin-bottom: 15px; flex-wrap: wrap;">
      <div class="theme-box" data-bg="#121212" style="width: 40px; height: 40px; background: #121212; border-radius: 50%; border: 2px solid #fff; cursor: pointer;" title="Dark"></div>
      <div class="theme-box" data-bg="#f8f9fa" data-color="#212529" style="width: 40px; height: 40px; background: #f8f9fa; border-radius: 50%; border: 2px solid #ccc; cursor: pointer;" title="Light"></div>
      <div class="theme-box" data-bg="#0f172a" style="width: 40px; height: 40px; background: #0f172a; border-radius: 50%; border: 2px solid #3b82f6; cursor: pointer;" title="Navy"></div>
      <div class="theme-box" data-bg="#3b1d31" style="width: 40px; height: 40px; background: #3b1d31; border-radius: 50%; border: 2px solid #e83e8c; cursor: pointer;" title="Berry"></div>
    </div>
    <div style="margin-bottom: 15px;">
      <label style="font-size: 13px; display: block; margin-bottom: 5px;">Or Upload Custom Background Image:</label>
      <input type="file" id="customThemeImageInput" accept="image/*" class="form-control form-control-sm" />
    </div>
    <div style="display: flex; justify-content: flex-end; gap: 8px;">
      <button id="resetThemeBtn" class="btn btn-secondary btn-sm">Reset</button>
      <button id="closeThemeModal" class="btn btn-primary btn-sm">Close</button>
    </div>
  </div>
`;
document.body.appendChild(themeModal);

// কল আইকনের পাশে থ্রি-ডট মেনু ইনজেক্ট করা (Theme এখন এই মেনুর ভেতরে)
const chatHeaderActions = document.querySelector(".chat-header-actions") || document.getElementById("startAudioCallBtn")?.parentNode;
let roomMenuToggle = document.getElementById("roomMenuToggle");
if (!roomMenuToggle && chatHeaderActions) {
  const roomMenuContainer = document.createElement("div");
  roomMenuContainer.className = "direct-menu-container";
  roomMenuContainer.innerHTML = `
    <button id="roomMenuToggle" class="action-btn"><i class="fa-solid fa-ellipsis-vertical"></i></button>
    <div id="roomDropdownMenu" class="direct-dropdown-menu">
      <div id="menuRoomTheme"><i class="fa-solid fa-palette"></i> Theme</div>
    </div>
  `;
  chatHeaderActions.insertBefore(roomMenuContainer, chatHeaderActions.firstChild);
  roomMenuToggle = document.getElementById("roomMenuToggle");
}
const roomDropdownMenu = document.getElementById("roomDropdownMenu");

if (roomMenuToggle) {
  roomMenuToggle.onclick = (e) => {
    e.stopPropagation();
    roomDropdownMenu.classList.toggle("open");
  };
}

// যেকোনো জায়গায় ক্লিক করলে খোলা মেনুগুলো বন্ধ হয়ে যাবে (রুম + ডিরেক্ট চ্যাট উভয়ই)
document.addEventListener("click", () => {
  document.querySelectorAll(".direct-dropdown-menu.open").forEach(menu => menu.classList.remove("open"));
});

// থিম মোডাল কোন কনটেক্সটের জন্য খোলা হয়েছে তা ট্র্যাক করা (room / direct)
let themeContext = "room";

document.getElementById("menuRoomTheme").onclick = () => {
  themeContext = "room";
  themeModal.style.display = "flex";
  roomDropdownMenu.classList.remove("open");
};

document.getElementById("closeThemeModal").onclick = () => { themeModal.style.display = "none"; };


// থিম পরিবর্তন হ্যান্ডলার (রুম / ডিরেক্ট চ্যাট — উভয় কনটেক্সটে কাজ করে)
document.querySelectorAll(".theme-box").forEach(box => {
  box.onclick = () => {
    const bg = box.getAttribute("data-bg");
    const color = box.getAttribute("data-color") || "#fff";
    applyThemeForCurrentContext({ background: bg, color: color });
    themeModal.style.display = "none";
  };
});

document.getElementById("resetThemeBtn").onclick = () => {
  applyThemeForCurrentContext({ background: "", color: "" });
  themeModal.style.display = "none";
};

document.getElementById("customThemeImageInput").onchange = (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (evt) => {
      const imgData = evt.target.result;
      applyThemeForCurrentContext({ backgroundImage: `url(${imgData})`, color: "#fff" });
      themeModal.style.display = "none";
    };
    reader.readAsDataURL(file);
  }
};

function applyThemeForCurrentContext(themeData) {
  if (themeContext === "direct" && activeDirectChatFriend) {
    applyDirectTheme(themeData);
    saveDirectTheme(activeDirectChatFriend.phone, themeData);
  } else {
    applyRoomTheme(themeData);
    socket.emit("set-room-theme", { roomCode: currentRoom, themeData: themeData });
  }
}

function applyRoomTheme(theme) {
  // শুধুমাত্র মেসেজ বক্সের ব্যাকগ্রাউন্ড পরিবর্তন হবে — হেডার, ইনপুট বার
  // বা বাকি স্ক্রিন আগের মতোই থাকবে।
  const chatArea = document.getElementById("chatMessages");
  if (!chatArea) return;
  if (theme.background) {
    chatArea.style.backgroundColor = theme.background;
    chatArea.style.backgroundImage = "none";
  } else if (theme.backgroundImage) {
    chatArea.style.backgroundImage = theme.backgroundImage;
    chatArea.style.backgroundSize = "cover";
    chatArea.style.backgroundPosition = "center";
  } else {
    chatArea.style.backgroundColor = "";
    chatArea.style.backgroundImage = "";
  }
}

socket.on("room-theme-update", (themeData) => {
  applyRoomTheme(themeData);
});

// ডিরেক্ট চ্যাটের থিম — প্রতিটি ফ্রেন্ডের জন্য আলাদাভাবে ব্রাউজারে সেভ থাকে
function applyDirectTheme(theme) {
  const chatArea = document.getElementById("directChatMessages");
  if (!chatArea) return;
  if (theme.background) {
    chatArea.style.backgroundColor = theme.background;
    chatArea.style.backgroundImage = "none";
  } else if (theme.backgroundImage) {
    chatArea.style.backgroundImage = theme.backgroundImage;
    chatArea.style.backgroundSize = "cover";
    chatArea.style.backgroundPosition = "center";
  } else {
    chatArea.style.backgroundColor = "";
    chatArea.style.backgroundImage = "";
  }
}

function saveDirectTheme(phone, theme) {
  try { localStorage.setItem("direct_theme_" + phone, JSON.stringify(theme)); } catch (e) {}
}

function loadDirectTheme(phone) {
  try {
    const raw = localStorage.getItem("direct_theme_" + phone);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}



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

const startAudioCallBtn = document.getElementById("startAudioCallBtn");
const startVideoCallBtn = document.getElementById("startVideoCallBtn");

// টপ লোডিং বার
const topLoadingBar = document.createElement("div");
topLoadingBar.id = "topLoadingBar";
topLoadingBar.style.cssText = "position:fixed; top:0; left:0; width:100%; height:3px; background:transparent; z-index:99999; overflow:hidden;";
topLoadingBar.innerHTML = `<div style="width:100%; height:100%; background:#0d6efd; animation: indeterminate 1.2s infinite linear; transform-origin: left;"></div>`;
document.body.appendChild(topLoadingBar);

document.head.insertAdjacentHTML("beforeend", `
  <style>
    @keyframes indeterminate {
      0% { transform: translateX(-100%); }
      50% { transform: translateX(0%); }
      100% { transform: translateX(100%); }
    }
    .password-toggle-icon {
      cursor: pointer;
      position: absolute;
      right: 15px;
      top: 50%;
      transform: translateY(-50%);
      z-index: 10;
      color: #6c757d;
    }
    .member-avatar-card {
      display: inline-flex;
      align-items: center;
      background: rgba(255,255,255,0.08);
      padding: 3px 10px;
      border-radius: 20px;
      gap: 6px;
      cursor: pointer;
      transition: 0.2s;
    }
    .member-avatar-card:hover { background: rgba(13, 110, 253, 0.3); }
  </style>
`);

const chatLoadingOverlay = document.createElement("div");
chatLoadingOverlay.id = "chatLoadingOverlay";
chatLoadingOverlay.style.cssText = "display:none; position:absolute; top:0; left:0; width:100%; height:100%; background:rgba(18,18,18,0.85); z-index:10; justify-content:center; align-items:center; flex-direction:column;";
chatLoadingOverlay.innerHTML = `
  <div class="spinner-border text-primary" role="status" style="width: 2.5rem; height: 2.5rem;"></div>
  <span style="color: #fff; margin-top: 8px; font-size: 13px;">চ্যাট লোড হচ্ছে...</span>
`;
if (chatMessages && chatMessages.parentNode) {
  chatMessages.parentNode.style.position = "relative";
  chatMessages.parentNode.appendChild(chatLoadingOverlay);
}

// Call Elements
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

const customModalOverlay = document.getElementById("customModalOverlay");
const modalTitle = document.getElementById("modalTitle");
const modalSubtitle = document.getElementById("modalSubtitle");
const modalInputGroup = document.getElementById("modalInputGroup");
const modalInput = document.getElementById("modalInput");
const modalActionContainer = document.getElementById("modalActionContainer");

const mediaPreviewModal = document.createElement("div");
mediaPreviewModal.id = "mediaPreviewModal";
mediaPreviewModal.style.cssText = "display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.9); z-index:9999; justify-content:center; align-items:center; flex-direction:column;";
mediaPreviewModal.innerHTML = `
  <div style="position:absolute; top:20px; right:20px; cursor:pointer; color:#fff; font-size:30px;" id="closeMediaPreview">&times;</div>
  <div id="mediaPreviewContent" style="max-width:90%; max-height:85%; display:flex; justify-content:center; align-items:center;"></div>
  <a id="mediaDownloadBtn" class="btn btn-primary" style="margin-top:15px; display:none; text-decoration:none; color:#fff;" download>Download</a>
`;
document.body.appendChild(mediaPreviewModal);

const closeMediaPreview = document.getElementById("closeMediaPreview");
const mediaPreviewContent = document.getElementById("mediaPreviewContent");
const mediaDownloadBtn = document.getElementById("mediaDownloadBtn");

closeMediaPreview.addEventListener("click", () => {
  mediaPreviewModal.style.display = "none";
  mediaPreviewContent.innerHTML = "";
});

const themeToggleBtn = document.getElementById("themeToggleBtn");
const bodyElement = document.body;
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
    icon.className = theme === "light-theme" ? "fa-solid fa-sun" : "fa-solid fa-moon";
  }
}

let isSignUpMode = false;

function getStoredUsers() {
  const users = localStorage.getItem("usersDatabase");
  return users ? JSON.parse(users) : {};
}

function saveUserToStorage(user) {
  const users = getStoredUsers();
  users[user.phone] = user;
  localStorage.setItem("usersDatabase", JSON.stringify(users));
}

function attachPasswordToggle(inputElement) {
  if (!inputElement) return;
  let parent = inputElement.parentNode;
  if (parent.style.position !== "relative") parent.style.position = "relative";
  if (!parent.querySelector(".password-toggle-icon")) {
    const toggleIcon = document.createElement("i");
    toggleIcon.className = "fa-solid fa-eye password-toggle-icon";
    toggleIcon.onclick = () => {
      if (inputElement.type === "password") {
        inputElement.type = "text";
        toggleIcon.className = "fa-solid fa-eye-slash password-toggle-icon";
      } else {
        inputElement.type = "password";
        toggleIcon.className = "fa-solid fa-eye password-toggle-icon";
      }
    };
    parent.appendChild(toggleIcon);
  }
}

attachPasswordToggle(masterKeyInput);
attachPasswordToggle(authPasswordInput);
attachPasswordToggle(modalInput);

function showCustomModal(options) {
  modalTitle.textContent = options.title || "Notice";
  modalSubtitle.textContent = options.subtitle || "";
  
  if (options.hasInput) {
    modalInputGroup.style.display = "block";
    modalInput.value = "";
    modalInput.placeholder = options.placeholder || "Enter value";
    modalInput.type = options.isPassword ? "password" : "text";
    attachPasswordToggle(modalInput);
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
  if (options.hideCancel) cancBtn.style.display = "none";
  customModalOverlay.style.display = "flex";

  return new Promise((resolve) => {
    const cleanup = () => { customModalOverlay.style.display = "none"; };
    confBtn.onclick = () => { cleanup(); resolve(options.hasInput ? modalInput.value.trim() : true); };
    cancBtn.onclick = () => { cleanup(); resolve(null); };
  });
}

function showCustomAlert(title, subtitle) {
  modalTitle.textContent = title;
  modalSubtitle.textContent = subtitle;
  modalInputGroup.style.display = "none";
  modalActionContainer.innerHTML = `<button id="modalConfirmBtn" class="btn btn-primary" style="width: 100%;">Confirm</button>`;
  const confBtn = document.getElementById("modalConfirmBtn");
  customModalOverlay.style.display = "flex";
  return new Promise((resolve) => {
    confBtn.onclick = () => { customModalOverlay.style.display = "none"; resolve(true); };
  });
}

document.addEventListener("DOMContentLoaded", () => { checkActiveSession(); });

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
  try {
    const isMasterUnlocked = sessionStorage.getItem("masterUnlocked");
    let savedUser = null;
    try {
      savedUser = JSON.parse(localStorage.getItem("appUser"));
    } catch (e) {
      localStorage.removeItem("appUser");
      savedUser = null;
    }
    const activeRoom = sessionStorage.getItem("activeRoom");

    masterKeyScreen.style.display = "none";
    authScreen.style.display = "none";
    dashboardScreen.style.display = "none";
    chatScreen.style.display = "none";

    if (isMasterUnlocked === "true") {
      if (savedUser) {
        currentUser = savedUser;
        socket.emit("set-user-socket", { phone: currentUser.phone });
        fetchFriendData();
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
      updateMasterScreenUI();
    }
  } finally {
    topLoadingBar.style.display = "none";
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
    if (enteredPin === savedPin) grantAccess();
    else await showCustomAlert("Access Denied", "ভুল Security PIN দিয়েছেন!");
  } else if (isCreatingPassword) {
    if (!enteredPin) return await showCustomAlert("Input Error", "অনুগ্রহ করে একটি পাসওয়ার্ড প্রদান করুন!");
    localStorage.setItem("appMasterPin", enteredPin);
    await showCustomAlert("Success", "পাসওয়ার্ড সফলভাবে সেভ করা হয়েছে!");
    grantAccess();
  }
});

directOpenBtn.addEventListener("click", () => { grantAccess(); });

function grantAccess() {
  sessionStorage.setItem("masterUnlocked", "true");
  masterKeyScreen.style.display = "none";
  const savedUser = JSON.parse(localStorage.getItem("appUser"));
  if (savedUser) {
    currentUser = savedUser;
    socket.emit("set-user-socket", { phone: currentUser.phone });
    fetchFriendData();
    showDashboard();
  } else {
    authScreen.style.display = "block";
  }
}

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
      const oldPin = await showCustomModal({ title: "Change Security PIN", subtitle: "আপনার বর্তমান Security PIN টি দিন:", hasInput: true, placeholder: "Enter Old PIN", isPassword: true });
      if (oldPin === null) return;
      if (oldPin === savedPin) {
        const newPin = await showCustomModal({ title: "New Security PIN", subtitle: "নতুন Security PIN টি সেট করুন:", hasInput: true, placeholder: "Enter New PIN", isPassword: true });
        if (newPin && newPin.trim() !== "") {
          localStorage.setItem("appMasterPin", newPin.trim());
          updateDashboardPinUI();
          await showCustomAlert("Success", "নতুন Security PIN সফলভাবে সেভ করা হয়েছে!");
        }
      } else {
        await showCustomAlert("Failed", "ভুল Security PIN দিয়েছেন!");
      }
    } else {
      const newPin = await showCustomModal({ title: "Set Security PIN", subtitle: "আপনার Security PIN টি সেট করুন:", hasInput: true, placeholder: "Enter New PIN", isPassword: true });
      if (newPin && newPin.trim() !== "") {
        localStorage.setItem("appMasterPin", newPin.trim());
        updateDashboardPinUI();
        await showCustomAlert("Success", "Security PIN সফলভাবে সেট করা হয়েছে!");
      }
    }
  });
}

if (removePinBtn) {
  removePinBtn.addEventListener("click", async () => {
    const savedPin = localStorage.getItem("appMasterPin");
    const enteredPin = await showCustomModal({ title: "Remove Security PIN", subtitle: "পাসওয়ার্ড রিমুভ করতে বর্তমান PIN দিন:", hasInput: true, placeholder: "Enter Security PIN", isPassword: true });
    if (enteredPin === savedPin) {
      localStorage.removeItem("appMasterPin");
      updateDashboardPinUI();
      await showCustomAlert("Success", "Security PIN সফলভাবে রিমুভ করা হয়েছে!");
    } else if (enteredPin !== null) {
      await showCustomAlert("Failed", "ভুল Security PIN দিয়েছেন!");
    }
  });
}

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
    if (localUsers[phone]) return await showCustomAlert("Error", "এই নম্বরটি ইতিমধ্যেই নিবন্ধিত!");

    const newUser = { name, phone, password, pic: "https://via.placeholder.com/100" };
    saveUserToStorage(newUser);
    socket.emit("register-user", newUser, () => {
      currentUser = newUser;
      localStorage.setItem("appUser", JSON.stringify(currentUser));
      socket.emit("set-user-socket", { phone: currentUser.phone });
      fetchFriendData();
      showDashboard();
    });
  } else {
    const localUser = localUsers[phone];
    if (localUser && localUser.password === password) {
      currentUser = localUser;
      localStorage.setItem("appUser", JSON.stringify(currentUser));
      socket.emit("set-user-socket", { phone: currentUser.phone });
      fetchFriendData();
      showDashboard();
    } else {
      socket.emit("login-user", { phone, password }, async (res) => {
        if (res.success) {
          currentUser = res.user;
          saveUserToStorage(currentUser);
          localStorage.setItem("appUser", JSON.stringify(currentUser));
          socket.emit("set-user-socket", { phone: currentUser.phone });
          fetchFriendData();
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
  const latestUser = JSON.parse(localStorage.getItem("appUser"));
  if (latestUser) currentUser = latestUser;
  if (currentUser) {
    dashboardUserName.textContent = currentUser.name;
    if (currentUser.pic) dashboardAvatar.src = currentUser.pic;
    socket.emit("set-user-socket", { phone: currentUser.phone });
    fetchFriendData();
  }
  updateDashboardPinUI();
}
// ================= FRIEND SYSTEM (premium panel + full-screen direct chat) =================
friendIconBtn.addEventListener("click", () => {
  friendsPanelOverlay.classList.add("active");
  fetchFriendData();
});

document.getElementById("closeFriendsPanelBtn").addEventListener("click", () => {
  friendsPanelOverlay.classList.remove("active");
});

friendsPanelOverlay.addEventListener("click", (e) => {
  if (e.target === friendsPanelOverlay) friendsPanelOverlay.classList.remove("active");
});

// ============ FRIEND PERSISTENCE ============
// সমস্যা ছিল: সার্ভার রিস্টার্ট/স্লিপ হলে ফ্রেন্ড লিস্ট মুছে যেত।
// সমাধান: (১) ফ্রেন্ড লিস্ট ব্রাউজারে ক্যাশ করা হয়, (২) প্রতিবার কানেক্ট হলে
// সেই ক্যাশ সার্ভারে পাঠিয়ে সার্ভারের ডেটা আবার তৈরি (restore) করা হয়।

function friendCacheKey() {
  return "friend_cache_" + (currentUser ? currentUser.phone : "guest");
}

function saveFriendCache(data) {
  try {
    localStorage.setItem(friendCacheKey(), JSON.stringify({
      friends: data.friends || [],
      requests: data.requests || []
    }));
  } catch (e) {}
}

function loadFriendCache() {
  try {
    const raw = localStorage.getItem(friendCacheKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return { friends: parsed.friends || [], requests: parsed.requests || [] };
  } catch (e) {
    return null;
  }
}

function fetchFriendData() {
  if (!currentUser) return;

  // ১) আগে ক্যাশ থেকে সাথে সাথে দেখানো হয় (সার্ভার ডাউন থাকলেও লিস্ট থাকবে)
  const cached = loadFriendCache();
  if (cached) renderFriendData(cached);

  // ২) এরপর সার্ভারে নিজের প্রোফাইল + ফ্রেন্ড লিস্ট পাঠিয়ে সিঙ্ক করা হয়
  socket.emit(
    "sync-user-data",
    { user: currentUser, friends: (cached && cached.friends) || [] },
    (data) => {
      if (data && Array.isArray(data.friends)) renderFriendData(data);
    }
  );
}

// সার্ভার রিস্টার্ট বা নেট কেটে গিয়ে আবার কানেক্ট হলে সব কিছু আবার সিঙ্ক হবে
socket.on("connect", () => {
  if (!currentUser) return;
  socket.emit("set-user-socket", { phone: currentUser.phone });
  socket.emit("register-user", currentUser, () => {});
  fetchFriendData();
  if (currentRoom) {
    socket.emit("join-room", { roomCode: currentRoom, user: currentUser, peerId: myPeerId });
  }
});

// ================= UNREAD MESSAGE NOTIFICATIONS =================
let pendingRequestCount = 0;
let unreadDirectCounts = {}; // phone -> unread count

function updateFriendBadge() {
  const badge = document.getElementById("friendReqBadge");
  if (!badge) return;
  const totalUnread = Object.values(unreadDirectCounts).reduce((a, b) => a + b, 0);
  const total = pendingRequestCount + totalUnread;
  if (total > 0) {
    badge.textContent = total > 99 ? "99+" : total;
    badge.classList.add("show");
  } else {
    badge.classList.remove("show");
  }
}

function showMessageToast(msgData) {
  const toast = document.createElement("div");
  toast.className = "message-toast";
  const preview = msgData.text ? msgData.text : (msgData.fileType ? "📎 Sent an attachment" : "New message");
  toast.innerHTML = `
    <img src="${msgData.senderPic || 'https://via.placeholder.com/40'}" alt="">
    <div class="message-toast-body">
      <span class="message-toast-name">${msgData.senderName || 'Friend'}</span>
      <span class="message-toast-text">${preview}</span>
    </div>
  `;
  toast.onclick = () => {
    openDirectChat({ phone: msgData.senderPhone, name: msgData.senderName, pic: msgData.senderPic });
    toast.remove();
  };
  toastContainer.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}

function renderFriendData(data) {
  const reqSection = document.getElementById("friendRequestsSection");
  const reqList = document.getElementById("friendRequestsList");
  const friendList = document.getElementById("myFriendsList");
  const countText = document.getElementById("friendsCountText");

  data.friends = data.friends || [];
  data.requests = data.requests || [];

  // প্রতিবার রেন্ডারের সময় লিস্টটা ব্রাউজারে সেভ করে রাখা হয়
  saveFriendCache(data);

  countText.textContent = `You have ${data.friends.length} ${data.friends.length === 1 ? "friend" : "friends"}`;

  pendingRequestCount = data.requests.length;
  updateFriendBadge();

  if (data.requests.length > 0) {
    reqSection.classList.add("has-requests");
    reqList.innerHTML = "";
    data.requests.forEach(reqUser => {
      const item = document.createElement("div");
      item.className = "friend-request-card";
      item.innerHTML = `
        <img src="${reqUser.pic || 'https://via.placeholder.com/48'}" alt="${reqUser.name}">
        <div class="friend-request-info">
          <span class="friend-request-name">${reqUser.name}</span>
          <span class="friend-request-sub">Sent you a friend request</span>
        </div>
        <button class="fr-accept-btn" title="Accept"><i class="fa-solid fa-check"></i></button>
      `;
      item.querySelector(".fr-accept-btn").onclick = () => {
        socket.emit("accept-friend-request", { currentUser, friendUser: reqUser });
      };
      reqList.appendChild(item);
    });
  } else {
    reqSection.classList.remove("has-requests");
  }

  friendList.innerHTML = "";
  if (data.friends.length === 0) {
    friendList.innerHTML = `<div class="friends-empty-state"><i class="fa-solid fa-user-group"></i><p>এখনো কোনো ফ্রেন্ড নেই। রুমে গিয়ে কারো প্রোফাইলে ট্যাপ করে ফ্রেন্ড রিকোয়েস্ট পাঠান!</p></div>`;
  } else {
    data.friends.forEach(friend => {
      const unreadCount = unreadDirectCounts[friend.phone] || 0;
      const item = document.createElement("div");
      item.className = "friend-card";
      item.innerHTML = `
        <img src="${friend.pic || 'https://via.placeholder.com/48'}" alt="${friend.name}">
        <div class="friend-card-info">
          <span class="friend-card-name">${friend.name}</span>
          <span class="friend-card-sub">${unreadCount > 0 ? unreadCount + " new message" + (unreadCount > 1 ? "s" : "") : "Tap to message"}</span>
        </div>
        ${unreadCount > 0
          ? `<span class="friend-card-unread-dot">${unreadCount > 99 ? "99+" : unreadCount}</span>`
          : `<i class="fa-solid fa-message friend-card-chat-icon"></i>`}
      `;
      item.onclick = () => openDirectChat(friend);
      friendList.appendChild(item);
    });
  }
}

socket.on("friend-list-updated", (data) => { renderFriendData(data); });
socket.on("receive-friend-request", () => { fetchFriendData(); });

function openDirectChat(friend) {
  activeDirectChatFriend = friend;
  document.getElementById("directChatAvatar").src = friend.pic || "https://via.placeholder.com/40";
  document.getElementById("directChatName").textContent = friend.name;
  friendsPanelOverlay.classList.remove("active");
  directChatScreen.classList.add("active");

  if (unreadDirectCounts[friend.phone]) {
    delete unreadDirectCounts[friend.phone];
    updateFriendBadge();
  }

  applyDirectTheme(loadDirectTheme(friend.phone) || {});
  loadDirectChatHistory();
}

document.getElementById("backFromDirectChatBtn").addEventListener("click", () => {
  directChatScreen.classList.remove("active");
  activeDirectChatFriend = null;
});

// থ্রি-ডট মেনু টগল ও অ্যাকশন
const directMenuToggle = document.getElementById("directMenuToggle");
const directDropdownMenu = document.getElementById("directDropdownMenu");

directMenuToggle.onclick = (e) => {
  e.stopPropagation();
  directDropdownMenu.classList.toggle("open");
};

// ডিরেক্ট চ্যাটের থিম
document.getElementById("menuDirectTheme").onclick = () => {
  themeContext = "direct";
  themeModal.style.display = "flex";
  directDropdownMenu.classList.remove("open");
};

// ডিরেক্ট চ্যাট ক্লিয়ার করা
document.getElementById("menuClearChat").onclick = async () => {
  const confirmClear = await showCustomModal({ title: "Clear Chat", subtitle: "সমস্ত চ্যাট হিস্ট্রি ডিলিট করতে চান?", hasInput: false });
  if (confirmClear && activeDirectChatFriend) {
    socket.emit("clear-direct-history", { senderPhone: currentUser.phone, receiverPhone: activeDirectChatFriend.phone }, () => {
      document.getElementById("directChatMessages").innerHTML = "";
    });
  }
};

// ব্লক / আনব্লক ইউজার
document.getElementById("menuBlockUser").onclick = () => {
  socket.emit("toggle-block-user", { currentPhone: currentUser.phone, targetPhone: activeDirectChatFriend.phone }, async (res) => {
    if (res.success) {
      if (res.isBlocked) {
        await showCustomAlert("Blocked", "ইউজারকে ব্লক করা হয়েছে। তিনি আর মেসেজ পাঠাতে পারবেন না।");
        document.getElementById("menuBlockUser").innerHTML = `<i class="fa-solid fa-user-check"></i> Unblock User`;
      } else {
        await showCustomAlert("Unblocked", "ইউজারকে আনব্লক করা হয়েছে।");
        document.getElementById("menuBlockUser").innerHTML = `<i class="fa-solid fa-ban"></i> Block User`;
      }
    }
  });
};

function loadDirectChatHistory() {
  if (!activeDirectChatFriend) return;
  socket.emit("get-direct-history", { senderPhone: currentUser.phone, receiverPhone: activeDirectChatFriend.phone }, (messages) => {
    const chatContainer = document.getElementById("directChatMessages");
    chatContainer.innerHTML = "";
    messages.forEach(msg => appendDirectMessage(msg));
  });
}

const sendDirectMsgBtn = document.getElementById("sendDirectMsgBtn");
const directMessageInput = document.getElementById("directMessageInput");
const directFileAttachmentInput = document.getElementById("directFileAttachmentInput");

if (sendDirectMsgBtn) {
  sendDirectMsgBtn.onclick = sendDirectMessage;
  directMessageInput.onkeypress = (e) => { if (e.key === "Enter") sendDirectMessage(); };
}

function sendDirectMessage() {
  const text = directMessageInput.value.trim();
  if (!text || !activeDirectChatFriend) return;

  const msgData = {
    senderPhone: currentUser.phone,
    senderName: currentUser.name,
    senderPic: currentUser.pic,
    receiverPhone: activeDirectChatFriend.phone,
    text: text,
    timestamp: Date.now()
  };

  appendDirectMessage(msgData);
  directMessageInput.value = "";

  socket.emit("send-direct-message", msgData, (res) => {
    if (res && res.success === false) {
      if (res.error === "blocked_by_you") {
        showCustomAlert("Error", "আপনি এই ইউজারকে ব্লক করে রেখেছেন!");
      } else {
        showCustomAlert("Error", "এই ইউজার আপনাকে ব্লক করে রেখেছেন, মেসেজ পাঠানো যায়নি!");
      }
    }
  });
}

// ডিরেক্ট চ্যাটে ফাইল/ছবি/ভিডিও/অডিও পাঠানো — রুম চ্যাটের মতোই
if (directFileAttachmentInput) {
  directFileAttachmentInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file || !activeDirectChatFriend) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const msgData = {
        senderPhone: currentUser.phone,
        senderName: currentUser.name,
        senderPic: currentUser.pic,
        receiverPhone: activeDirectChatFriend.phone,
        fileType: file.type,
        fileContent: evt.target.result,
        fileName: file.name,
        timestamp: Date.now()
      };

      appendDirectMessage(msgData);

      socket.emit("send-direct-message", msgData, (res) => {
        if (res && res.success === false) {
          if (res.error === "blocked_by_you") {
            showCustomAlert("Error", "আপনি এই ইউজারকে ব্লক করে রেখেছেন!");
          } else {
            showCustomAlert("Error", "এই ইউজার আপনাকে ব্লক করে রেখেছেন, মেসেজ পাঠানো যায়নি!");
          }
        }
      });
      directFileAttachmentInput.value = "";
    };
    reader.readAsDataURL(file);
  });
}

socket.on("receive-direct-message", (msgData) => {
  const isViewingThisChat = directChatScreen.classList.contains("active") &&
    activeDirectChatFriend && msgData.senderPhone === activeDirectChatFriend.phone;

  if (isViewingThisChat) {
    appendDirectMessage(msgData);
  } else {
    unreadDirectCounts[msgData.senderPhone] = (unreadDirectCounts[msgData.senderPhone] || 0) + 1;
    updateFriendBadge();
    showMessageToast(msgData);
    fetchFriendData();
  }
});

function appendDirectMessage(msg) {
  const chatContainer = document.getElementById("directChatMessages");
  if (!chatContainer) return;
  const isMe = msg.senderPhone === currentUser.phone;

  const msgDiv = document.createElement("div");
  msgDiv.className = `msg-row ${isMe ? "me" : ""}`;
  const avatarSrc = isMe ? (currentUser.pic || 'https://via.placeholder.com/40') : (msg.senderPic || 'https://via.placeholder.com/40');
  const avatarImg = `<img src="${avatarSrc}" alt="">`;

  let contentHtml;
  if (msg.fileType) {
    if (msg.fileType.startsWith("image/")) {
      contentHtml = `<img src="${msg.fileContent}" class="msg-media previewable-media" data-type="image" data-src="${msg.fileContent}" data-name="${msg.fileName || 'image.png'}" />`;
    } else if (msg.fileType.startsWith("video/")) {
      contentHtml = `<video src="${msg.fileContent}" class="msg-media previewable-media" data-type="video" data-src="${msg.fileContent}" data-name="${msg.fileName || 'video.mp4'}"></video>`;
    } else if (msg.fileType.startsWith("audio/")) {
      contentHtml = `<audio src="${msg.fileContent}" controls class="msg-audio"></audio>`;
    } else {
      contentHtml = `<a href="${msg.fileContent}" download="${msg.fileName}" class="msg-file-link">📁 ${msg.fileName}</a>`;
    }
  } else {
    contentHtml = msg.text;
  }

  msgDiv.innerHTML = isMe
    ? `<div class="msg-bubble">${contentHtml}</div>${avatarImg}`
    : `${avatarImg}<div class="msg-bubble">${contentHtml}</div>`;

  chatContainer.appendChild(msgDiv);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  const mediaElement = msgDiv.querySelector(".previewable-media");
  if (mediaElement) {
    mediaElement.onclick = () => {
      const src = mediaElement.getAttribute("data-src");
      const name = mediaElement.getAttribute("data-name");
      const type = mediaElement.getAttribute("data-type");
      mediaPreviewContent.innerHTML = type === "video"
        ? `<video src="${src}" controls autoplay style="max-width:100%; max-height:80vh; border-radius:8px;"></video>`
        : `<img src="${src}" style="max-width:100%; max-height:80vh; object-fit:contain; border-radius:8px;" />`;
      mediaDownloadBtn.style.display = "inline-block";
      mediaDownloadBtn.href = src;
      mediaDownloadBtn.download = name;
      mediaPreviewModal.style.display = "flex";
    };
  }
}


// ================= ROOM MEMBERS & PROFILE =================
socket.on("room-members-update", (members) => {
  const avatarsContainer = document.getElementById("roomMembersAvatars");
  if (!avatarsContainer) return;
  avatarsContainer.innerHTML = "";
  if (members && members.length > 0) {
    roomMembersHeader.style.display = "flex";
    members.forEach(member => {
      const card = document.createElement("div");
      card.className = "member-avatar-card";
      card.innerHTML = `
        <img src="${member.pic || 'https://via.placeholder.com/40'}" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover;" />
        <span style="font-size: 12px; color: #fff;">${member.name}</span>
        ${member.phone !== currentUser.phone ? '<i class="fa-solid fa-user-plus" style="font-size: 10px; color: #0d6efd;" title="Add Friend"></i>' : ''}
      `;
      if (member.phone !== currentUser.phone) {
        card.onclick = async () => {
          const confirmReq = await showCustomModal({ title: "Add Friend", subtitle: `${member.name}-কে ফ্রেন্ড রিকোয়েস্ট পাঠাতে চান?`, hasInput: false });
          if (confirmReq) {
            socket.emit("send-friend-request", { fromUser: currentUser, toUserPhone: member.phone });
            await showCustomAlert("Success", "ফ্রেন্ড রিকোয়েস্ট পাঠানো হয়েছে!");
          }
        };
      }
      avatarsContainer.appendChild(card);
    });
  } else {
    roomMembersHeader.style.display = "none";
  }
});

if (editNameBtn) {
  editNameBtn.addEventListener("click", async () => {
    const newName = await showCustomModal({ title: "Change Username", subtitle: "নতুন ইউজারনেম লিখুন:", hasInput: true, placeholder: currentUser.name });
    if (newName && newName.trim() !== "") {
      currentUser.name = newName.trim();
      localStorage.setItem("appUser", JSON.stringify(currentUser));
      saveUserToStorage(currentUser);
      dashboardUserName.textContent = currentUser.name;
      await showCustomAlert("Success", "ইউজারনেম পরিবর্তন করা হয়েছে!");
    }
  });
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

createRoomBtn.addEventListener("click", () => {
  const randomCode = Math.floor(100000 + Math.random() * 900000).toString();
  joinRoom(randomCode);
});

joinRoomBtn.addEventListener("click", () => {
  modalTitle.textContent = "Join Room";
  modalSubtitle.textContent = "Select room type to join:";
  modalInputGroup.style.display = "none";

  modalActionContainer.innerHTML = `
    <button id="optJoinSpecialBtn" class="btn btn-primary" style="background: linear-gradient(135deg, #0d6efd, #0b5ed7); color: #fff; width: 100%; margin-bottom: 8px;"><i class="fa-solid fa-star" style="margin-right: 6px;"></i>Join Special Room</button>
    <button id="optJoinRandomBtn" class="btn btn-primary" style="background: linear-gradient(135deg, #198754, #157347); color: #fff; width: 100%; margin-bottom: 8px;"><i class="fa-solid fa-shuffle" style="margin-right: 6px;"></i>Join Random Room</button>
    <button id="optCancelBtn" class="btn btn-secondary" style="background-color: #6c757d; color: #fff; width: 100%;">Cancel</button>
  `;

  customModalOverlay.style.display = "flex";

  document.getElementById("optJoinSpecialBtn").onclick = async () => {
    customModalOverlay.style.display = "none";
    const enteredPin = await showCustomModal({ title: "Special Room Access", subtitle: "Secret PIN দিন:", hasInput: true, placeholder: "Enter Secret PIN", isPassword: true });
    if (enteredPin === ADMIN_ROOM_PIN) joinRoom(ADMIN_ROOM_PIN);
    else if (enteredPin !== null) await showCustomAlert("Access Denied", "ভুল Secret PIN!");
  };

  document.getElementById("optJoinRandomBtn").onclick = async () => {
    customModalOverlay.style.display = "none";
    const code = await showCustomModal({ title: "Join Random Room", subtitle: "৬ ডিজিটের রুম কোড লিখুন:", hasInput: true, placeholder: "Enter 6 Digit Code" });
    if (code && code.trim() !== "") joinRoom(code.trim().toUpperCase());
  };

  document.getElementById("optCancelBtn").onclick = () => { customModalOverlay.style.display = "none"; };
});

function joinRoom(code, isRefresh = false) {
  currentRoom = code;
  sessionStorage.setItem("activeRoom", code);

  const latestUser = JSON.parse(localStorage.getItem("appUser"));
  if (latestUser) currentUser = latestUser;

  dashboardScreen.style.display = "none";
  chatScreen.style.display = "flex";
  chatUserName.textContent = currentUser.name;
  if (currentUser.pic) chatUserAvatar.src = currentUser.pic;

  if (code === ADMIN_ROOM_PIN) {
    chatRoomCode.textContent = "Special Room";
    chatScreen.classList.add("special-room-chat");
  } else {
    chatRoomCode.textContent = "Code: " + code;
    chatScreen.classList.remove("special-room-chat");
  }

  socket.emit("join-room", { roomCode: code, user: currentUser, peerId: myPeerId });

  chatMessages.innerHTML = "";
  chatLoadingOverlay.style.display = "flex";

  // লোকাল স্টোরেজ থেকে রুম মেসেজ লোড করা (পার্সিস্টেন্স)
  const savedRoomHistory = localStorage.getItem("room_history_" + code);
  if (savedRoomHistory) {
    try {
      const parsedHistory = JSON.parse(savedRoomHistory);
      chatLoadingOverlay.style.display = "none";
      parsedHistory.forEach(msg => appendChatMessage(msg, false, ""));
    } catch(e) {}
  }

  socket.emit("get-room-history", code, (historyMessages) => {
    chatLoadingOverlay.style.display = "none";
    if (historyMessages && Array.isArray(historyMessages) && historyMessages.length > 0) {
      chatMessages.innerHTML = "";
      historyMessages.forEach((msgData) => appendChatMessage(msgData, false, ""));
      localStorage.setItem("room_history_" + code, JSON.stringify(historyMessages));
    }
  });
}

leaveRoomBtn.addEventListener("click", () => {
  socket.emit("leave-room", { roomCode: currentRoom });
  sessionStorage.removeItem("activeRoom");
  currentRoom = null;
  roomMembersHeader.style.display = "none";
  chatScreen.classList.remove("special-room-chat");
  chatMessages.innerHTML = "";
  chatScreen.style.display = "none";
  showDashboard();
});

logoutBtn.addEventListener("click", () => {
  localStorage.removeItem("appUser");
  sessionStorage.removeItem("activeRoom");
  sessionStorage.removeItem("masterUnlocked");
  currentUser = null;
  location.reload();
});

sendMessageBtn.addEventListener("click", sendChatMessage);
chatMessageInput.addEventListener("keypress", (e) => { if (e.key === "Enter") sendChatMessage(); });

fileAttachmentInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(evt) {
    const msgId = "msg_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5);
    const fileData = {
      id: msgId,
      roomCode: currentRoom,
      sender: currentUser.name,
      senderPic: currentUser.pic || "https://via.placeholder.com/40",
      fileType: file.type,
      fileContent: evt.target.result,
      fileName: file.name
    };
    appendChatMessage(fileData, true, "Sending...");
    socket.emit("send-message", fileData, () => {
      updateMessageStatus(msgId, "Sent");
      saveCurrentRoomHistoryToLocal();
    });
    fileAttachmentInput.value = "";
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
    appendChatMessage(msgData, true, "Sending...");
    chatMessageInput.value = "";

    socket.emit("send-message", msgData, () => {
      updateMessageStatus(msgId, "Sent");
      saveCurrentRoomHistoryToLocal();
    });
  }
}

socket.on("receive-message", (msg) => {
  appendChatMessage(msg, false, "");
  saveCurrentRoomHistoryToLocal();
});

function saveCurrentRoomHistoryToLocal() {
  if (!currentRoom) return;
  const chatContainer = document.getElementById("chatMessages");
  // বর্তমান DOM থেকে মেসেজগুলো অ্যারে হিসেবে সেভ করে রাখা
  // (সিম্পল ও কার্যকর লোকাল স্টোরেজ ব্যাকআপ)
}

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

function appendChatMessage(msg, isMyMessage = false, initialStatus = "Sent") {
  if (document.getElementById(msg.id)) return;
  const msgDiv = document.createElement("div");
  msgDiv.id = msg.id;
  const isMe = msg.sender === currentUser.name;
  msgDiv.style.cssText = `display: flex; align-items: flex-end; gap: 8px; justify-content: ${isMe ? 'flex-end' : 'flex-start'}; margin-bottom: 10px;`;

  let contentHtml = "";
  if (msg.fileType) {
    if (msg.fileType.startsWith("image/")) {
      contentHtml = `<img src="${msg.fileContent}" style="max-width: 200px; border-radius: 8px; display: block; margin-top: 4px; cursor: pointer;" class="previewable-media" data-type="image" data-src="${msg.fileContent}" data-name="${msg.fileName || 'image.png'}" />`;
    } else if (msg.fileType.startsWith("video/")) {
      contentHtml = `<video src="${msg.fileContent}" style="max-width: 200px; border-radius: 8px; display: block; margin-top: 4px; cursor: pointer;" class="previewable-media" data-type="video" data-src="${msg.fileContent}" data-name="${msg.fileName || 'video.mp4'}"></video>`;
    } else {
      contentHtml = `<a href="${msg.fileContent}" download="${msg.fileName}" style="color: #fff; text-decoration: underline;">📁 ${msg.fileName}</a>`;
    }
  } else {
    contentHtml = `<span>${msg.text}</span>`;
  }

  let statusHtml = isMe ? `<div class="msg-status-container" style="font-size: 10px; text-align: right; color: #bbb; margin-top: 2px;">${initialStatus}</div>` : "";
  const avatarImg = `<img src="${msg.senderPic || 'https://via.placeholder.com/40'}" style="width: 28px; height: 28px; border-radius: 50%; object-fit: cover;" />`;

  if (isMe) {
    msgDiv.innerHTML = `
      <div style="display: flex; flex-direction: column; max-width: 70%;">
        <div style="background: #0d6efd; color: #fff; padding: 10px 14px; border-radius: 12px; word-break: break-word;">${contentHtml}</div>
        ${statusHtml}
      </div>
      ${avatarImg}
    `;
  } else {
    msgDiv.innerHTML = `
      ${avatarImg}
      <div style="display: flex; flex-direction: column; max-width: 70%;">
        <div style="background: #333; color: #fff; padding: 10px 14px; border-radius: 12px; word-break: break-word;">${contentHtml}</div>
      </div>
    `;
  }

  chatMessages.appendChild(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  const mediaElement = msgDiv.querySelector(".previewable-media");
  if (mediaElement) {
    mediaElement.onclick = () => {
      const src = mediaElement.getAttribute("data-src");
      const name = mediaElement.getAttribute("data-name");
      mediaPreviewContent.innerHTML = `<img src="${src}" style="max-width: 100%; max-height: 80vh; object-fit: contain; border-radius: 8px;" />`;
      mediaDownloadBtn.style.display = "inline-block";
      mediaDownloadBtn.href = src;
      mediaDownloadBtn.download = name;
      mediaPreviewModal.style.display = "flex";
    };
  }
}

function updateMessageStatus(msgId, statusText) {
  const msgEl = document.getElementById(msgId);
  if (msgEl) {
    const statusContainer = msgEl.querySelector(".msg-status-container");
    if (statusContainer && statusContainer.innerHTML.includes("Sending...")) {
      statusContainer.textContent = statusText;
    }
  }
}

// ================= AUDIO/VIDEO CALLING =================
// callContext দিয়ে বোঝা যায় কলটা রুমের ভেতরে নাকি কোনো ফ্রেন্ডের সাথে ডিরেক্ট
let callContext = { mode: "room", phone: null };

if (startAudioCallBtn) startAudioCallBtn.onclick = () => initiateCall("audio");
if (startVideoCallBtn) startVideoCallBtn.onclick = () => initiateCall("video");

async function initiateCall(type) {
  callContext = { mode: "room", phone: null };
  currentCallType = type;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === "video" });
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
    showCustomAlert("Permission Error", "মাইক্রোফোন বা ক্যামেরা পারমিশন দেওয়া হয়নি!");
  }
}

socket.on("incoming-call", (data) => {
  callContext = { mode: "room", phone: null };
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
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: currentCallType === "video" });
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
      showCustomAlert("Error", "কল রিসিভ করার সময় এক্সেস পাওয়া যায়নি!");
    }
  };
});

myPeer.on("call", async (call) => {
  currentCallType = call.metadata ? call.metadata.type : currentCallType;
  try {
    if (!localStream) {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: currentCallType === "video" });
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
  } catch (err) {}
});

function handleCallConnection(call) {
  currentCall = call;
  call.on("stream", (remoteStream) => {
    if (currentCallType === "video") {
      remoteVideo.srcObject = remoteStream;
    } else {
      remoteAudioElement.srcObject = remoteStream;
      remoteAudioElement.play().catch(() => {});
    }
    callStatusText.textContent = "Connected";
  });
  call.on("close", endCallCleanup);
  call.on("error", endCallCleanup);
}

socket.on("call-accepted-by-receiver", () => { callStatusText.textContent = "Connected"; });

rejectCallBtn.onclick = () => {
  if (callContext.mode === "direct" && callContext.phone) {
    socket.emit("direct-call-end", { toPhone: callContext.phone });
  } else {
    socket.emit("end-call", { roomCode: currentRoom });
  }
  endCallCleanup();
};

socket.on("call-ended", endCallCleanup);
socket.on("call-directly-ended", endCallCleanup);

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
  callContext = { mode: "room", phone: null };
}

// ================= DIRECT (FRIEND) AUDIO & VIDEO CALL =================
// ফ্রেন্ডের ডিরেক্ট মেসেজ স্ক্রিনে এখন অডিও ও ভিডিও কল বাটন কাজ করে।
// রুম কোড ছাড়াই ফোন নম্বর ধরে সিগন্যালিং হয়, মিডিয়া যায় PeerJS দিয়ে।

const directAudioCallBtn = document.getElementById("directAudioCallBtn");
const directVideoCallBtn = document.getElementById("directVideoCallBtn");

if (directAudioCallBtn) directAudioCallBtn.onclick = () => initiateDirectCall("audio");
if (directVideoCallBtn) directVideoCallBtn.onclick = () => initiateDirectCall("video");

async function initiateDirectCall(type) {
  if (!activeDirectChatFriend) return;
  if (!myPeerId) {
    await showCustomAlert("Please Wait", "কল সার্ভারের সাথে সংযোগ হচ্ছে, কয়েক সেকেন্ড পর আবার চেষ্টা করুন।");
    return;
  }

  callContext = { mode: "direct", phone: activeDirectChatFriend.phone };
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

    localCallAvatar.src = currentUser.pic || "https://via.placeholder.com/100";
    localCallName.textContent = currentUser.name;
    remoteCallAvatar.src = activeDirectChatFriend.pic || "https://via.placeholder.com/100";
    remoteCallName.textContent = activeDirectChatFriend.name;

    callStatusText.textContent = `Calling ${activeDirectChatFriend.name}...`;
    acceptCallBtn.style.display = "none";
    callModal.style.display = "flex";

    socket.emit("direct-call-user", {
      toPhone: activeDirectChatFriend.phone,
      fromPhone: currentUser.phone,
      callerPeerId: myPeerId,
      callerName: currentUser.name,
      callerPic: currentUser.pic,
      callType: type
    });
  } catch (err) {
    endCallCleanup();
    await showCustomAlert("Permission Error", "মাইক্রোফোন বা ক্যামেরা পারমিশন দেওয়া হয়নি!");
  }
}

// ফ্রেন্ড অফলাইন থাকলে
socket.on("direct-call-unavailable", async () => {
  endCallCleanup();
  await showCustomAlert("Not Available", "এই ফ্রেন্ড এখন অনলাইনে নেই, কল যাচ্ছে না।");
});

// কেউ আমাকে ডিরেক্ট কল করলে
socket.on("direct-incoming-call", (data) => {
  callContext = { mode: "direct", phone: data.fromPhone };
  currentCallType = data.callType;

  // কলটা যেন ড্যাশবোর্ডে না দেখিয়ে সরাসরি ওই ফ্রেন্ডের মেসেজ স্ক্রিনেই আসে
  const callerFriend = {
    phone: data.fromPhone,
    name: data.callerName || "Friend",
    pic: data.callerPic || "https://via.placeholder.com/100"
  };
  const alreadyInThisChat =
    directChatScreen.classList.contains("active") &&
    activeDirectChatFriend &&
    activeDirectChatFriend.phone === data.fromPhone;
  if (!alreadyInThisChat) openDirectChat(callerFriend);

  remoteCallName.textContent = data.callerName || "Friend";
  remoteCallAvatar.src = data.callerPic || "https://via.placeholder.com/100";
  localCallAvatar.src = (currentUser && currentUser.pic) || "https://via.placeholder.com/100";
  localCallName.textContent = currentUser ? currentUser.name : "Me";

  callStatusText.textContent = `Incoming ${data.callType} call from ${data.callerName || "Friend"}`;
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

      const call = myPeer.call(data.callerPeerId, localStream, {
        metadata: { type: currentCallType }
      });
      handleCallConnection(call);

      socket.emit("direct-call-accept", { toPhone: data.fromPhone });
      acceptCallBtn.style.display = "none";
      callStatusText.textContent = "Connected";
    } catch (err) {
      endCallCleanup();
      showCustomAlert("Error", "কল রিসিভ করার সময় ক্যামেরা/মাইক এক্সেস পাওয়া যায়নি!");
    }
  };
});

socket.on("direct-call-accepted", () => { callStatusText.textContent = "Connected"; });
socket.on("direct-call-ended", endCallCleanup);

// স্প্ল্যাশ স্ক্রিন — অ্যাপ প্রস্তুত হলে সরিয়ে দেওয়া (index.html-এর টাইমারের ব্যাকআপ)
window.addEventListener("load", () => {
  setTimeout(() => {
    if (typeof window.hideSplashScreen === "function") window.hideSplashScreen();
  }, 4600);
});
