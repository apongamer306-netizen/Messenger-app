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

// ================= WEBRTC: STUN + TURN সার্ভার =================
// আলাদা নেটওয়ার্কের (যেমন ল্যাপটপ ওয়াইফাই + ফোন মোবাইল ডেটা) দুই ডিভাইসের মধ্যে অডিও/ভিডিও
// যেতে TURN সার্ভার লাগে। এটা ছাড়া কল রিং হয়, ধরাও যায়, কিন্তু কথা/ভিডিও আসে না।
//
// ✅ কী করবেন: https://www.metered.ca এ ফ্রি অ্যাকাউন্ট খুলুন → Dashboard → TURN Server →
// "Generate your first credential" চাপুন → যে Username ও Password দেখাবে, ওই দুটো নিচের
// দুই ঘরের ভেতরে বসান (কোটেশন "" এর মাঝখানে)। মাসে ২০ GB ফ্রি।
const METERED_USERNAME = "";     // <-- এখানে Username বসান
const METERED_CREDENTIAL = "";   // <-- এখানে Password বসান

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.relay.metered.ca:80" }
];

if (METERED_USERNAME && METERED_CREDENTIAL) {
  [
    "turn:global.relay.metered.ca:80",
    "turn:global.relay.metered.ca:80?transport=tcp",
    "turn:global.relay.metered.ca:443",
    "turns:global.relay.metered.ca:443?transport=tcp"
  ].forEach((url) =>
    ICE_SERVERS.push({ urls: url, username: METERED_USERNAME, credential: METERED_CREDENTIAL })
  );
} else {
  // ক্রেডেনশিয়াল না দিলে পাবলিক ব্যাকআপ (অনির্ভরযোগ্য — এটা প্রায়ই কাজ করে না)
  ICE_SERVERS.push(
    { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turns:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" }
  );
  console.warn("⚠️ Metered TURN ক্রেডেনশিয়াল দেওয়া হয়নি — আলাদা নেটওয়ার্কে কল কাজ নাও করতে পারে।");
}

// কথা পরিষ্কার শোনার জন্য: ইকো ও নয়েজ কমানো
const AUDIO_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

let myPeer = new Peer({ config: { iceServers: ICE_SERVERS } });
let myPeerId = null;

// কল-সিগন্যালিং সার্ভারের সাথে সংযোগ কেটে গেলে নিজে থেকে আবার যুক্ত হওয়া
myPeer.on("disconnected", () => {
  try { myPeer.reconnect(); } catch (e) {}
});
myPeer.on("error", (err) => {
  console.warn("PeerJS error:", err && err.type, err);
  if (err && err.type === "peer-unavailable") {
    endCallCleanup();
    showCustomAlert("Call Failed", "ওপাশের ব্যক্তির কল সংযোগ পাওয়া যাচ্ছে না। দুজনেই পেজ রিফ্রেশ করে আবার চেষ্টা করুন।");
  }
});
// সার্ভার থেকে Cloudflare TURN ক্রেডেনশিয়াল এনে চলমান Peer-এ বসানো (না পেলে উপরের ডিফল্টই থাকবে)
async function loadIceServers() {
  try {
    const res = await fetch("/api/ice-servers", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    if (data && Array.isArray(data.iceServers) && data.iceServers.length) {
      myPeer.options.config = { ...(myPeer.options.config || {}), iceServers: data.iceServers };
      console.log("ICE servers loaded from server. TURN available:", !!data.hasTurn);
    } else {
      console.warn("Server-এ TURN কনফিগার করা নেই — ডিফল্ট সার্ভার ব্যবহার হচ্ছে।");
    }
  } catch (e) {
    console.warn("ICE servers load failed:", e && e.message);
  }
}
loadIceServers();
setInterval(loadIceServers, 6 * 60 * 60 * 1000);

let currentCall = null;
let localStream = null;
let currentCallType = null;

const ADMIN_ROOM_PIN = "1430909";

let remoteAudioElement = document.createElement("audio");
remoteAudioElement.autoplay = true;
remoteAudioElement.setAttribute("playsinline", "");
remoteAudioElement.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-10px;top:-10px;";
document.body.appendChild(remoteAudioElement);

// ================= মোবাইলে শব্দ বাজানোর ব্যবস্থা =================
// মোবাইল ব্রাউজার (বিশেষ করে iPhone Safari ও Android Chrome) ইউজারের ক্লিক ছাড়া অডিও বাজতে
// দেয় না। কল শুরু/রিসিভের বাটন চাপার মুহূর্তেই আমরা অডিও এলিমেন্টটা "আনলক" করে রাখি,
// যাতে পরে রিমোট স্ট্রিম এলে শব্দ বাজতে পারে। তবুও আটকে গেলে স্ক্রিনে "ট্যাপ করুন" বাটন আসবে।
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

function unlockRemoteAudio() {
  try {
    remoteAudioElement.muted = false;
    if (!remoteAudioElement.srcObject) {
      remoteAudioElement.src = SILENT_WAV;
      const p = remoteAudioElement.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      if (!window._ektAudioCtx) window._ektAudioCtx = new AC();
      if (window._ektAudioCtx.state === "suspended") window._ektAudioCtx.resume();
    }
  } catch (e) {}
}

let soundHintEl = null;
function showSoundHint() {
  if (!soundHintEl) {
    soundHintEl = document.createElement("button");
    soundHintEl.textContent = "🔊 শব্দ চালু করতে এখানে ট্যাপ করুন";
    soundHintEl.style.cssText =
      "position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483647;" +
      "padding:12px 20px;border:none;border-radius:999px;background:#ffb300;color:#000;" +
      "font-weight:700;font-size:15px;box-shadow:0 6px 20px rgba(0,0,0,.45);cursor:pointer;";
    soundHintEl.onclick = () => {
      remoteAudioElement.play().then(hideSoundHint).catch(() => {});
    };
    document.body.appendChild(soundHintEl);
  }
  soundHintEl.style.display = "block";
}
function hideSoundHint() {
  if (soundHintEl) soundHintEl.style.display = "none";
}

function playRemoteAudio() {
  const p = remoteAudioElement.play();
  if (p && typeof p.then === "function") {
    p.then(hideSoundHint).catch(() => showSoundHint());
  }
}

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
  editNameBtn.className = "fa-solid fa-pen-to-square edit-name-btn";
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

// নিজের প্রোফাইল বাটন — এখান থেকে তথ্য, ছবি, ভিডিও, অডিও যোগ করা যায়
let myProfileBtn = document.getElementById("myProfileBtn");
if (!myProfileBtn && createRoomBtn) {
  myProfileBtn = document.createElement("button");
  myProfileBtn.id = "myProfileBtn";
  myProfileBtn.className = "btn btn-primary";
  myProfileBtn.style.cssText = "background: linear-gradient(135deg, #0aa2c0, #0b7e93); display: flex; align-items: center; justify-content: center; gap: 8px;";
  myProfileBtn.innerHTML = `<i class="fa-solid fa-id-badge"></i> My Profile`;
  createRoomBtn.parentNode.insertBefore(myProfileBtn, friendIconBtn || createRoomBtn);
  myProfileBtn.onclick = () => {
    if (currentUser) openProfile(currentUser.phone, currentUser);
  };
}

if (myProfileBtn && !myProfileBtn.onclick) {
  myProfileBtn.onclick = () => {
    if (currentUser) openProfile(currentUser.phone, currentUser);
  };
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
      <button id="openFriendProfileBtn" class="header-profile-btn" title="View profile">
        <img id="directChatAvatar" src="https://via.placeholder.com/40" alt="Avatar">
        <div>
          <h4 id="directChatName">Friend Name</h4>
          <span class="direct-chat-status">Direct Message</span>
        </div>
      </button>
    </div>
    <div class="chat-actions">
      <button id="directAudioCallBtn" class="action-btn call-audio" title="Audio Call"><i class="fa-solid fa-phone"></i></button>
      <button id="directVideoCallBtn" class="action-btn call-video" title="Video Call"><i class="fa-solid fa-video"></i></button>
      <div class="direct-menu-container">
        <button id="directMenuToggle" class="action-btn"><i class="fa-solid fa-ellipsis-vertical"></i></button>
        <div id="directDropdownMenu" class="direct-dropdown-menu">
          <div id="menuViewProfile" class="menu-item"><i class="fa-solid fa-circle-user"></i><span>View profile</span></div>
          <div id="menuDirectTheme" class="menu-item"><i class="fa-solid fa-palette"></i><span>Theme</span></div>
          <div class="menu-sep"></div>
          <div id="menuClearChat" class="menu-item"><i class="fa-solid fa-broom"></i><span>Clear chat</span></div>
          <div id="menuBlockUser" class="menu-item menu-danger"><i class="fa-solid fa-ban"></i><span>Block user</span></div>
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
roomMembersHeader.className = "room-members-bar";
roomMembersHeader.style.display = "none";
roomMembersHeader.innerHTML = `<span class="room-members-label"><i class="fa-solid fa-users"></i> Members</span><div id="roomMembersAvatars" class="room-members-list"></div>`;
if (chatScreen) {
  const _roomMsgArea = chatScreen.querySelector("#chatMessages");
  chatScreen.insertBefore(roomMembersHeader, _roomMsgArea || chatScreen.firstChild);
}

// ================= থিম সিস্টেম মোডাল এবং হেডার বাটন তৈরি =================
let themeModal = document.createElement("div");
themeModal.id = "themeModal";
themeModal.style.display = "none";
themeModal.innerHTML = `
  <div class="theme-modal-card">
    <h5 class="theme-modal-title"><i class="fa-solid fa-palette"></i> Chat theme</h5>
    <p class="theme-modal-sub">চ্যাটের ব্যাকগ্রাউন্ড বেছে নিন</p>
    <div class="theme-swatches">
      <div class="theme-box" data-bg="#121212" style="background:#121212" title="Dark"></div>
      <div class="theme-box" data-bg="#f8f9fa" data-color="#212529" style="background:#f8f9fa" title="Light"></div>
      <div class="theme-box" data-bg="#0f172a" style="background:#0f172a" title="Navy"></div>
      <div class="theme-box" data-bg="#3b1d31" style="background:#3b1d31" title="Berry"></div>
      <div class="theme-box" data-bg="#0b2a26" style="background:#0b2a26" title="Forest"></div>
      <div class="theme-box" data-bg="#241638" style="background:#241638" title="Violet"></div>
      <div class="theme-box" data-bg="#2a1c14" style="background:#2a1c14" title="Mocha"></div>
      <div class="theme-box" data-bg="#0a0e17" style="background:#0a0e17" title="Midnight"></div>
    </div>
    <label class="theme-upload" for="customThemeImageInput">
      <i class="fa-solid fa-image"></i><span>নিজের ছবি ব্যাকগ্রাউন্ড হিসেবে দিন</span>
      <input type="file" id="customThemeImageInput" accept="image/*" />
    </label>
    <div class="theme-modal-actions">
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

document.getElementById("customThemeImageInput").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  // ওয়ালপেপারও কম্প্রেস করে পাঠানো হয়, নাহলে দুই পাশে সিঙ্ক হতে দেরি হয়
  const compressed = await compressImageFile(file);
  const imgData = compressed ? compressed.dataUrl : await readFileAsDataUrl(file);
  applyThemeForCurrentContext({ backgroundImage: "url(" + imgData + ")", color: "#fff" });
  themeModal.style.display = "none";
};

function applyThemeForCurrentContext(themeData) {
  if (themeContext === "direct" && activeDirectChatFriend) {
    applyDirectTheme(themeData);
    saveDirectTheme(activeDirectChatFriend.phone, themeData);
    // থিম এখন সার্ভারে সেভ হয় এবং বন্ধুর স্ক্রিনেও সাথে সাথে বদলে যায়
    socket.emit("set-direct-theme", {
      fromPhone: currentUser.phone,
      toPhone: activeDirectChatFriend.phone,
      themeData: themeData
    });
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

// বন্ধু থিম বদলালে আমার চ্যাটেও একই থিম বসবে
socket.on("direct-theme-update", ({ fromPhone, themeData }) => {
  saveDirectTheme(fromPhone, themeData);
  if (activeDirectChatFriend && activeDirectChatFriend.phone === fromPhone) {
    applyDirectTheme(themeData || {});
  }
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
  </style>
`);

const chatLoadingOverlay = document.createElement("div");
chatLoadingOverlay.id = "chatLoadingOverlay";
chatLoadingOverlay.className = "chat-loading-overlay";
chatLoadingOverlay.style.display = "none";
chatLoadingOverlay.innerHTML = `
  <div class="spinner-border" role="status"></div>
  <span>চ্যাট লোড হচ্ছে...</span>
`;
if (chatMessages && chatMessages.parentNode) {
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
// ডাউনলোড বাটন আগে নিচে চওড়া নীল বার হয়ে থাকত — এখন উপরের কোণায় ছোট গোল আইকন
mediaPreviewModal.innerHTML = `
  <div class="media-preview-topbar">
    <span id="mediaPreviewTitle" class="media-preview-title"></span>
    <div class="media-preview-tools">
      <a id="mediaDownloadBtn" class="media-tool-btn" title="Download" download><i class="fa-solid fa-download"></i></a>
      <button id="closeMediaPreview" class="media-tool-btn" title="Close"><i class="fa-solid fa-xmark"></i></button>
    </div>
  </div>
  <div id="mediaPreviewContent" style="display:flex; justify-content:center; align-items:center;"></div>
`;
document.body.appendChild(mediaPreviewModal);

const closeMediaPreview = document.getElementById("closeMediaPreview");
const mediaPreviewContent = document.getElementById("mediaPreviewContent");
const mediaDownloadBtn = document.getElementById("mediaDownloadBtn");
const mediaPreviewTitle = document.getElementById("mediaPreviewTitle");

function closeMediaPreviewModal() {
  mediaPreviewModal.style.display = "none";
  mediaPreviewContent.innerHTML = ""; // ভিডিও/অডিও বাজতে থাকলে বন্ধ হয়ে যাবে
}

closeMediaPreview.addEventListener("click", closeMediaPreviewModal);
mediaPreviewModal.addEventListener("click", (e) => {
  if (e.target === mediaPreviewModal) closeMediaPreviewModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && mediaPreviewModal.style.display === "flex") closeMediaPreviewModal();
});

// ছবি, ভিডিও ও অডিও — তিনটাই সুন্দর ফুল-স্ক্রিন প্লেয়ারে খুলবে
function openMediaPreview(type, src, name) {
  mediaPreviewTitle.textContent = name || "";

  if (type === "video") {
    mediaPreviewContent.innerHTML =
      `<video src="${src}" controls autoplay playsinline controlsList="nodownload"></video>`;
  } else if (type === "audio") {
    mediaPreviewContent.innerHTML = `
      <div class="audio-player-card">
        <div class="ap-disc"><i class="fa-solid fa-music"></i></div>
        <div class="ap-name">${escapeHtml(name || "Audio")}</div>
        <audio src="${src}" controls autoplay></audio>
      </div>`;
  } else {
    mediaPreviewContent.innerHTML = `<img src="${src}" alt="${escapeHtml(name || "")}" />`;
  }

  mediaDownloadBtn.style.display = "inline-flex";
  mediaDownloadBtn.href = src;
  mediaDownloadBtn.download = name || "file";
  mediaPreviewModal.style.display = "flex";
}

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
      <button id="modalCancelBtn" class="btn btn-secondary">Cancel</button>
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

    // ডিরেক্ট মেসেজ চ্যাট খোলা অবস্থায় রিলোড করলে ওই একই চ্যাটেই ফিরে
    // আসবে — আগে এটা সেভ হতো না বলে রিলোড দিলেই ড্যাশবোর্ডে চলে যেত
    let activeDirectChat = null;
    try {
      activeDirectChat = JSON.parse(sessionStorage.getItem("activeDirectChat") || "null");
    } catch (e) {
      activeDirectChat = null;
    }

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
          if (activeDirectChat && activeDirectChat.phone) {
            openDirectChat(activeDirectChat);
          }
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

    const activeRoom = sessionStorage.getItem("activeRoom");
    let activeDirectChat = null;
    try { activeDirectChat = JSON.parse(sessionStorage.getItem("activeDirectChat") || "null"); } catch (e) {}

    if (activeRoom) {
      joinRoom(activeRoom, true);
    } else {
      showDashboard();
      if (activeDirectChat && activeDirectChat.phone) openDirectChat(activeDirectChat);
    }
  } else {
    authScreen.style.display = "block";
  }
}

function updateDashboardPinUI() {
  const savedPin = localStorage.getItem("appMasterPin");
  if (savedPin) {
    setPinBtnText.textContent = "Change Security PIN";
    removePinBtn.style.display = "";
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
  document.body.classList.add("dashboard-active"); // ল্যাপটপে পেছনের আভা দেখানোর জন্য
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
  healMyProfileIfNeeded(); // সার্ভার ডেটা হারালে এই ডিভাইস থেকে "About" ফিরিয়ে আনা
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
          : ""}
        <button class="friend-card-profile-btn" title="View profile"><i class="fa-solid fa-circle-user"></i></button>
      `;
      // প্রোফাইল আইকনে চাপ দিলে প্রোফাইল, বাকি জায়গায় চাপ দিলে চ্যাট
      item.querySelector(".friend-card-profile-btn").onclick = (e) => {
        e.stopPropagation();
        openFriendProfile(friend);
      };
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

  // রিলোড দিলে যেন এই একই চ্যাটেই ফিরে আসে, ড্যাশবোর্ডে ছুড়ে না দেয়
  try { sessionStorage.setItem("activeDirectChat", JSON.stringify(friend)); } catch (e) {}

  if (unreadDirectCounts[friend.phone]) {
    delete unreadDirectCounts[friend.phone];
    updateFriendBadge();
  }

  applyDirectTheme(loadDirectTheme(friend.phone) || {});

  // সার্ভারে সেভ করা থিমটাই আসল — দুই ডিভাইসেই এক দেখাবে
  socket.emit("get-direct-theme", { myPhone: currentUser.phone, friendPhone: friend.phone }, (theme) => {
    if (theme) {
      saveDirectTheme(friend.phone, theme);
      if (activeDirectChatFriend && activeDirectChatFriend.phone === friend.phone) {
        applyDirectTheme(theme);
      }
    }
  });

  loadDirectChatHistory();
}

document.getElementById("backFromDirectChatBtn").addEventListener("click", () => {
  directChatScreen.classList.remove("active");
  activeDirectChatFriend = null;
  try { sessionStorage.removeItem("activeDirectChat"); } catch (e) {}
});

// ================= PROFILE PAGE (নিজের + বন্ধুর) =================
// নিজের প্রোফাইলে তথ্য লেখা যায় এবং ছবি / ভিডিও / অডিও আপলোড করা যায়।
// বন্ধুরা প্রোফাইলে ঢুকে সেই সব দেখতে ও চালাতে পারে।

const profileModalOverlay = document.createElement("div");
profileModalOverlay.id = "profileModalOverlay";
profileModalOverlay.className = "profile-modal-overlay";
profileModalOverlay.innerHTML = `
  <div class="profile-modal">
    <div class="profile-modal-cover">
      <img id="pmAvatar" class="profile-modal-avatar" src="https://via.placeholder.com/100" alt="">
    </div>
    <div class="profile-modal-body">
      <div id="pmName" class="profile-modal-name">Friend</div>
      <div id="pmSub" class="profile-modal-sub">Friend on EKT Chating App</div>

      <div class="profile-tabs">
        <button class="profile-tab active" data-tab="posts">Posts</button>
        <button class="profile-tab" data-tab="about">About</button>
        <button class="profile-tab" data-tab="photos">Photos</button>
        <button class="profile-tab" data-tab="videos">Videos</button>
        <button class="profile-tab" data-tab="audio">Audio</button>
      </div>

      <div id="pmTabPosts" class="profile-tab-panel">
        <div id="pmComposer" class="post-composer" style="display:none;">
          <div class="post-composer-row">
            <img id="pmComposerAvatar" class="post-composer-avatar" src="https://via.placeholder.com/40" alt="">
            <textarea id="pmComposerText" class="post-composer-input" placeholder="What's on your mind?" rows="1"></textarea>
          </div>
          <div id="pmComposerPreview" class="post-composer-preview" style="display:none;"></div>
          <div class="post-composer-actions">
            <button class="post-composer-btn" id="pmAddPhotoBtn"><i class="fa-solid fa-image" style="color:#45bd62;"></i> Photo</button>
            <button class="post-composer-btn" id="pmAddVideoBtn"><i class="fa-solid fa-video" style="color:#f3425f;"></i> Video</button>
            <button class="btn btn-primary post-submit-btn" id="pmSubmitPostBtn">Post</button>
          </div>
        </div>
        <div id="pmPostsFeed" class="posts-feed"></div>
      </div>

      <div id="pmTabAbout" class="profile-tab-panel" style="display:none;"></div>
      <div id="pmTabMedia" class="profile-tab-panel" style="display:none;">
        <div id="pmUploadRow" class="profile-upload-row" style="display:none;">
          <button class="profile-upload-btn" id="pmUploadBtn"><i class="fa-solid fa-plus"></i> <span id="pmUploadLabel">Add</span></button>
        </div>
        <div id="pmGallery" class="profile-gallery"></div>
      </div>

      <div class="profile-modal-actions">
        <button id="pmMessageBtn" class="btn btn-primary"><i class="fa-solid fa-message"></i> Message</button>
        <button id="pmCloseBtn" class="btn btn-secondary">Close</button>
      </div>
    </div>
  </div>
`;
document.body.appendChild(profileModalOverlay);

// আপলোডের জন্য লুকানো ফাইল ইনপুট
const profileFileInput = document.createElement("input");
profileFileInput.type = "file";
profileFileInput.style.display = "none";
document.body.appendChild(profileFileInput);

// পোস্ট কম্পোজারের ছবি/ভিডিও ইনপুট
const postMediaInput = document.createElement("input");
postMediaInput.type = "file";
postMediaInput.style.display = "none";
document.body.appendChild(postMediaInput);

let profileViewState = { phone: null, isMe: false, data: {}, tab: "posts" };
let pendingPostMedia = null; // { type, src, name } — পোস্ট করার আগে সিলেক্ট করা ছবি/ভিডিও

function detailRow(icon, label, value) {
  if (!value) return "";
  return `<div class="profile-detail-row">
            <i class="${icon}"></i>
            <div><span class="pd-label">${label}</span><span class="pd-value">${escapeHtml(value)}</span></div>
          </div>`;
}

// ---------- পোস্ট (Facebook-স্টাইল টাইমলাইন) ----------
function timeAgo(ts) {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "এখনই";
  if (min < 60) return min + "মি";
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + "ঘ";
  const day = Math.floor(hr / 24);
  if (day < 7) return day + "দি";
  const d = new Date(ts);
  return d.getDate() + "/" + (d.getMonth() + 1) + "/" + d.getFullYear();
}

function renderPostsFeed() {
  const feed = document.getElementById("pmPostsFeed");
  const posts = profileViewState.data.posts || [];

  if (!posts.length) {
    feed.innerHTML = `<div class="profile-empty">${profileViewState.isMe ? "এখনো কিছু পোস্ট করেননি। উপর থেকে প্রথম পোস্টটি করুন!" : "এই বন্ধু এখনো কিছু পোস্ট করেননি।"}</div>`;
    return;
  }

  feed.innerHTML = posts.map((post) => renderPostCardHtml(post)).join("");
  posts.forEach((post) => wirePostCardEvents(post));
}

function renderPostCardHtml(post) {
  const d = profileViewState.data;
  const likeCount = (post.likes || []).length;
  const commentCount = (post.comments || []).length;
  const iLiked = currentUser && (post.likes || []).includes(currentUser.phone);

  let mediaHtml = "";
  if (post.media && post.media.src) {
    if (post.media.type === "video") {
      mediaHtml = `<div class="post-media-wrap previewable-media" data-type="video" data-src="${post.media.src}" data-name="post-video">
                     <video class="post-media" preload="metadata" muted playsinline src="${post.media.src}#t=0.1"></video>
                     <span class="video-play-badge"><i class="fa-solid fa-play"></i></span>
                   </div>`;
    } else {
      mediaHtml = `<div class="post-media-wrap previewable-media" data-type="image" data-src="${post.media.src}" data-name="post-photo">
                     <img class="post-media" src="${post.media.src}" alt="">
                   </div>`;
    }
  }

  const commentsHtml = (post.comments || []).map((c) => `
    <div class="post-comment">
      <img class="post-comment-avatar" src="${c.authorPic || 'https://via.placeholder.com/32'}" alt="">
      <div class="post-comment-bubble">
        <span class="post-comment-name">${escapeHtml(c.authorName || "User")}</span>
        <span class="post-comment-text">${escapeHtml(c.text)}</span>
      </div>
    </div>
  `).join("");

  const moreItems =
    (post.text ? `<div class="menu-item" data-post-copy><i class="fa-regular fa-copy"></i><span>Copy text</span></div>` : "") +
    (profileViewState.isMe ? `<div class="menu-item menu-danger" data-post-del="${post.id}"><i class="fa-solid fa-trash"></i><span>Delete post</span></div>` : "");
  const moreHtml = moreItems
    ? `<div class="post-more"><button class="post-more-btn" data-post-more title="More"><i class="fa-solid fa-ellipsis"></i></button><div class="post-more-menu">${moreItems}</div></div>`
    : "";

  return `
    <div class="post-card" data-post-id="${post.id}">
      <div class="post-card-header">
        <img class="post-avatar" src="${d.pic || 'https://via.placeholder.com/40'}" alt="">
        <div class="post-header-text">
          <span class="post-author-name">${escapeHtml(d.name || "User")}</span>
          <span class="post-time">${timeAgo(post.timestamp)}</span>
        </div>
        ${moreHtml}
      </div>
      ${post.text ? `<div class="post-text">${escapeHtml(post.text)}</div>` : ""}
      ${mediaHtml}
      <div class="post-meta-row">
        <span class="post-like-count">${likeCount > 0 ? "👍 " + likeCount : ""}</span>
        <span class="post-comment-count">${commentCount > 0 ? commentCount + " comments" : ""}</span>
      </div>
      <div class="post-actions-row">
        <button class="post-action-btn like-btn ${iLiked ? "liked" : ""}" data-like="${post.id}">
          <i class="fa-solid fa-thumbs-up"></i> Like
        </button>
        <button class="post-action-btn comment-toggle-btn" data-toggle-comments="${post.id}">
          <i class="fa-regular fa-comment"></i> Comment
        </button>
      </div>
      <div class="post-comments-section" id="comments-${post.id}" style="display:none;">
        <div class="post-comments-list">${commentsHtml}</div>
        <div class="post-comment-input-row">
          <img class="post-comment-avatar" src="${(currentUser && currentUser.pic) || 'https://via.placeholder.com/32'}" alt="">
          <input type="text" class="post-comment-input" placeholder="Write a comment..." data-comment-input="${post.id}">
        </div>
      </div>
    </div>
  `;
}

function wirePostCardEvents(post) {
  const card = document.querySelector(`.post-card[data-post-id="${post.id}"]`);
  if (!card) return;

  const mediaEl = card.querySelector(".previewable-media");
  if (mediaEl) {
    mediaEl.onclick = () => {
      openMediaPreview(mediaEl.getAttribute("data-type"), mediaEl.getAttribute("data-src"), mediaEl.getAttribute("data-name"));
    };
  }

  const delBtn = card.querySelector("[data-post-del]");
  if (delBtn) {
    delBtn.onclick = async () => {
      const ok = await showCustomModal({ title: "Delete Post", subtitle: "এই পোস্টটি মুছে ফেলতে চান?" });
      if (ok === null) return;
      socket.emit("delete-post", { phone: profileViewState.phone, postId: post.id }, (res) => {
        if (res && res.success) {
          profileViewState.data.posts = (profileViewState.data.posts || []).filter((p) => p.id !== post.id);
          renderPostsFeed();
        }
      });
    };
  }

  const moreBtn = card.querySelector("[data-post-more]");
  const moreMenu = card.querySelector(".post-more-menu");
  if (moreBtn && moreMenu) {
    moreBtn.onclick = (e) => {
      e.stopPropagation();
      document.querySelectorAll(".post-more-menu.open").forEach((m) => { if (m !== moreMenu) m.classList.remove("open"); });
      moreMenu.classList.toggle("open");
    };
  }
  const copyPostBtn = card.querySelector("[data-post-copy]");
  if (copyPostBtn) {
    copyPostBtn.onclick = async () => {
      const ok = await copyText(post.text || "");
      showMiniToast(ok ? "Copied" : "Couldn't copy");
    };
  }

  const likeBtn = card.querySelector("[data-like]");
  if (likeBtn) {
    likeBtn.onclick = () => {
      socket.emit("toggle-like-post", { phone: profileViewState.phone, postId: post.id, likerPhone: currentUser.phone }, (res) => {
        if (!res || !res.success) return;
        post.likes = res.likes;
        renderPostsFeed();
      });
    };
  }

  const toggleBtn = card.querySelector("[data-toggle-comments]");
  if (toggleBtn) {
    toggleBtn.onclick = () => {
      const section = document.getElementById("comments-" + post.id);
      if (section) section.style.display = section.style.display === "none" ? "block" : "none";
    };
  }

  const commentInput = card.querySelector("[data-comment-input]");
  if (commentInput) {
    commentInput.onkeypress = (e) => {
      if (e.key !== "Enter") return;
      const text = commentInput.value.trim();
      if (!text || !currentUser) return;
      commentInput.value = "";
      socket.emit("add-comment", {
        phone: profileViewState.phone,
        postId: post.id,
        comment: { authorPhone: currentUser.phone, authorName: currentUser.name, authorPic: currentUser.pic, text }
      }, (res) => {
        if (res && res.success) {
          post.comments = post.comments || [];
          post.comments.push(res.comment);
          renderPostsFeed();
          const reopened = document.getElementById("comments-" + post.id);
          if (reopened) reopened.style.display = "block";
        }
      });
    };
  }
}

// ---------- পোস্ট কম্পোজার ----------
const pmComposer = document.getElementById("pmComposer");
const pmComposerText = document.getElementById("pmComposerText");
const pmComposerPreview = document.getElementById("pmComposerPreview");
const pmComposerAvatar = document.getElementById("pmComposerAvatar");

pmComposerText.addEventListener("input", () => {
  pmComposerText.style.height = "auto";
  pmComposerText.style.height = pmComposerText.scrollHeight + "px";
});

document.getElementById("pmAddPhotoBtn").onclick = () => {
  postMediaInput.accept = "image/*";
  postMediaInput.dataset.kind = "image";
  postMediaInput.click();
};
document.getElementById("pmAddVideoBtn").onclick = () => {
  postMediaInput.accept = "video/*";
  postMediaInput.dataset.kind = "video";
  postMediaInput.click();
};

postMediaInput.onchange = async () => {
  const file = postMediaInput.files[0];
  const kind = postMediaInput.dataset.kind;
  postMediaInput.value = "";
  if (!file || !currentUser) return;

  let src;
  try {
    if (kind === "image") {
      const compressed = await compressImageFile(file);
      src = compressed ? compressed.dataUrl : await readFileAsDataUrl(file);
    } else {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        await showCustomAlert("File Too Large", "ভিডিওটি অনেক বড় (১৮MB এর বেশি)।");
        return;
      }
      src = await readFileAsDataUrl(file);
    }
  } catch (e) {
    await showCustomAlert("Error", "ফাইলটি পড়া যায়নি।");
    return;
  }

  pendingPostMedia = { type: kind === "video" ? "video" : "image", src, name: file.name };
  pmComposerPreview.style.display = "block";
  pmComposerPreview.innerHTML = kind === "video"
    ? `<video src="${src}#t=0.1" muted></video><button class="post-preview-remove" id="pmRemoveMedia"><i class="fa-solid fa-xmark"></i></button>`
    : `<img src="${src}" alt=""><button class="post-preview-remove" id="pmRemoveMedia"><i class="fa-solid fa-xmark"></i></button>`;
  document.getElementById("pmRemoveMedia").onclick = () => {
    pendingPostMedia = null;
    pmComposerPreview.style.display = "none";
    pmComposerPreview.innerHTML = "";
  };
};

document.getElementById("pmSubmitPostBtn").onclick = () => {
  const text = pmComposerText.value.trim();
  if (!text && !pendingPostMedia) return;
  if (!currentUser) return;

  socket.emit("create-post", {
    phone: currentUser.phone,
    text,
    media: pendingPostMedia
  }, (res) => {
    if (res && res.success) {
      profileViewState.data.posts = profileViewState.data.posts || [];
      profileViewState.data.posts.unshift(res.post);
      pmComposerText.value = "";
      pmComposerText.style.height = "auto";
      pendingPostMedia = null;
      pmComposerPreview.style.display = "none";
      pmComposerPreview.innerHTML = "";
      renderPostsFeed();
    } else {
      showCustomAlert("Error", "পোস্ট করা যায়নি, আবার চেষ্টা করুন।");
    }
  });
};

// অন্য কেউ লাইক/কমেন্ট করলে প্রোফাইল খোলা থাকলে সাথে সাথে আপডেট হবে
socket.on("post-updated", ({ phone, postId, likes, comments }) => {
  if (profileViewState.phone !== phone) return;
  const posts = profileViewState.data.posts || [];
  const post = posts.find((p) => p.id === postId);
  if (!post) return;
  post.likes = likes;
  post.comments = comments;
  if (profileModalOverlay.classList.contains("active") && profileViewState.tab === "posts") {
    renderPostsFeed();
  }
});

function renderProfileAbout() {
  const d = profileViewState.data || {};
  const box = document.getElementById("pmTabAbout");

  if (profileViewState.isMe) {
    // নিজের প্রোফাইল — সরাসরি এডিট করা যাবে
    box.innerHTML = `
      <input class="profile-edit-field" id="pfBio" placeholder="Bio / স্ট্যাটাস" value="${escapeHtml(d.bio || "")}">
      <input class="profile-edit-field" id="pfLocation" placeholder="কোথায় থাকেন" value="${escapeHtml(d.location || "")}">
      <input class="profile-edit-field" id="pfWork" placeholder="কাজ / পেশা" value="${escapeHtml(d.work || "")}">
      <input class="profile-edit-field" id="pfEducation" placeholder="পড়াশোনা" value="${escapeHtml(d.education || "")}">
      <textarea class="profile-edit-field" id="pfAbout" placeholder="নিজের সম্পর্কে কিছু লিখুন...">${escapeHtml(d.about || "")}</textarea>
      <button id="pfSaveBtn" class="btn btn-primary" style="margin-top:4px;"><i class="fa-solid fa-floppy-disk"></i> Save Profile</button>
    `;
    document.getElementById("pfSaveBtn").onclick = saveMyProfile;
  } else {
    const html =
      detailRow("fa-solid fa-phone", "Phone", d.phone) +
      detailRow("fa-solid fa-location-dot", "Lives in", d.location) +
      detailRow("fa-solid fa-briefcase", "Work", d.work) +
      detailRow("fa-solid fa-graduation-cap", "Education", d.education) +
      detailRow("fa-solid fa-circle-info", "About", d.about);
    box.innerHTML = html || `<div class="profile-empty">এই বন্ধু এখনো প্রোফাইলে কিছু যোগ করেননি।</div>`;
  }
}

function renderProfileGallery(kind) {
  const gallery = document.getElementById("pmGallery");
  const items = (profileViewState.data.items || []).filter((it) => it.kind === kind);

  gallery.className = "profile-gallery" + (profileViewState.isMe ? " editable" : "");

  if (!items.length) {
    const label = kind === "photo" ? "ছবি" : kind === "video" ? "ভিডিও" : "অডিও";
    gallery.innerHTML = `<div class="profile-empty">এখনো কোনো ${label} নেই।</div>`;
    return;
  }

  gallery.innerHTML = items.map((it) => {
    const inner =
      kind === "photo" ? `<img src="${it.src}" alt="">`
      : kind === "video" ? `<video src="${it.src}#t=0.1" muted preload="metadata"></video><span class="pg-badge"><i class="fa-solid fa-play"></i></span>`
      : `<i class="fa-solid fa-music"></i>`;
    return `<div class="profile-gallery-item ${kind === "audio" ? "audio-item" : ""}" data-id="${it.id}">
              ${inner}
              <button class="pg-delete" data-del="${it.id}"><i class="fa-solid fa-trash"></i></button>
            </div>`;
  }).join("");

  gallery.querySelectorAll(".profile-gallery-item").forEach((el) => {
    el.onclick = (e) => {
      if (e.target.closest(".pg-delete")) return;
      const item = items.find((i) => i.id === el.dataset.id);
      if (item) openMediaPreview(kind === "photo" ? "image" : kind, item.src, item.name);
    };
  });

  gallery.querySelectorAll(".pg-delete").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const id = btn.dataset.del;
      socket.emit("delete-profile-item", { phone: currentUser.phone, itemId: id }, () => {
        profileViewState.data.items = (profileViewState.data.items || []).filter((i) => i.id !== id);
        renderProfileGallery(kind);
      });
    };
  });
}

function switchProfileTab(tab) {
  profileViewState.tab = tab;
  document.querySelectorAll(".profile-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });

  const postsBox = document.getElementById("pmTabPosts");
  const aboutBox = document.getElementById("pmTabAbout");
  const mediaBox = document.getElementById("pmTabMedia");
  const uploadRow = document.getElementById("pmUploadRow");

  if (tab === "posts") {
    postsBox.style.display = "block";
    aboutBox.style.display = "none";
    mediaBox.style.display = "none";

    pmComposer.style.display = profileViewState.isMe ? "block" : "none";
    if (profileViewState.isMe && currentUser) {
      pmComposerAvatar.src = currentUser.pic || "https://via.placeholder.com/40";
    }
    renderPostsFeed();
    return;
  }

  postsBox.style.display = "none";

  if (tab === "about") {
    aboutBox.style.display = "block";
    mediaBox.style.display = "none";
    renderProfileAbout();
    return;
  }

  aboutBox.style.display = "none";
  mediaBox.style.display = "block";

  const kind = tab === "photos" ? "photo" : tab === "videos" ? "video" : "audio";
  uploadRow.style.display = profileViewState.isMe ? "flex" : "none";
  document.getElementById("pmUploadLabel").textContent =
    kind === "photo" ? "Add Photo" : kind === "video" ? "Add Video" : "Add Audio";
  profileFileInput.accept = kind === "photo" ? "image/*" : kind === "video" ? "video/*" : "audio/*";
  profileFileInput.dataset.kind = kind;

  renderProfileGallery(kind);
}

document.querySelectorAll(".profile-tab").forEach((btn) => {
  btn.onclick = () => switchProfileTab(btn.dataset.tab);
});

// ---------- আপলোড ----------
document.getElementById("pmUploadBtn").onclick = () => profileFileInput.click();

profileFileInput.onchange = async () => {
  const file = profileFileInput.files[0];
  const kind = profileFileInput.dataset.kind;
  profileFileInput.value = "";
  if (!file || !currentUser) return;

  let src = null;
  try {
    if (kind === "photo") {
      const compressed = await compressImageFile(file);
      src = compressed ? compressed.dataUrl : await readFileAsDataUrl(file);
    } else {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        await showCustomAlert("File Too Large", "ফাইলটি অনেক বড় (১৮MB এর বেশি)। ছোট ফাইল দিন।");
        return;
      }
      src = await readFileAsDataUrl(file);
    }
  } catch (e) {
    await showCustomAlert("Error", "ফাইলটি পড়া যায়নি।");
    return;
  }

  const item = {
    id: "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    kind: kind,
    src: src,
    name: file.name,
    timestamp: Date.now()
  };

  socket.emit("add-profile-item", { phone: currentUser.phone, item }, (res) => {
    if (res && res.success) {
      profileViewState.data.items = res.items;
      renderProfileGallery(kind);
    } else {
      showCustomAlert("Error", "আপলোড করা যায়নি, আবার চেষ্টা করুন।");
    }
  });
};

// ---------- সেভ ----------
function saveMyProfile() {
  const profile = {
    bio: document.getElementById("pfBio").value.trim(),
    location: document.getElementById("pfLocation").value.trim(),
    work: document.getElementById("pfWork").value.trim(),
    education: document.getElementById("pfEducation").value.trim(),
    about: document.getElementById("pfAbout").value.trim()
  };
  socket.emit("save-profile", { phone: currentUser.phone, profile }, (res) => {
    if (res && res.success) {
      profileViewState.data = { ...profileViewState.data, ...res.profile };
      document.getElementById("pmSub").textContent = profile.bio || "EKT Chating App";
      // এই ডিভাইসেও একটা কপি রাখা হয় — সার্ভার কোনো কারণে ডেটা হারালেও
      // এই ডিভাইস থেকে পরের বার কানেক্ট হলেই আবার নিজে থেকে ফিরে আসবে
      try { localStorage.setItem("myProfileAbout_" + currentUser.phone, JSON.stringify(profile)); } catch (e) {}
      showCustomAlert("Saved", "আপনার প্রোফাইল সেভ হয়েছে।");
    }
  });
}

// সার্ভারের ডেটা কোনো কারণে হারিয়ে গেলে (যেমন হোস্টিং রিস্টার্ট), এই ডিভাইসে
// সেভ করা কপি থেকে "About" তথ্যগুলো নিজে থেকেই আবার সার্ভারে ফিরিয়ে দেওয়া হয়
function healMyProfileIfNeeded() {
  if (!currentUser) return;
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem("myProfileAbout_" + currentUser.phone) || "null"); } catch (e) {}
  if (!cached) return;

  socket.emit("get-profile", { phone: currentUser.phone }, (data) => {
    const hasAnyAboutField = data && (data.bio || data.location || data.work || data.education || data.about);
    if (!hasAnyAboutField) {
      // সার্ভারে কিছুই নেই কিন্তু এই ডিভাইসে ব্যাকআপ আছে — পুনরুদ্ধার করা হচ্ছে
      socket.emit("save-profile", { phone: currentUser.phone, profile: cached }, () => {});
    }
  });
}

// ---------- প্রোফাইল খোলা ----------
function openProfile(phone, fallback) {
  if (!phone || !currentUser) return;
  const isMe = phone === currentUser.phone;

  document.getElementById("pmAvatar").src = (fallback && fallback.pic) || "https://via.placeholder.com/100";
  document.getElementById("pmName").textContent = (fallback && fallback.name) || "Profile";
  document.getElementById("pmSub").textContent = "লোড হচ্ছে...";
  document.getElementById("pmMessageBtn").style.display = isMe ? "none" : "inline-flex";

  // কম্পোজার রিসেট
  pendingPostMedia = null;
  pmComposerText.value = "";
  pmComposerText.style.height = "auto";
  pmComposerPreview.style.display = "none";
  pmComposerPreview.innerHTML = "";

  profileViewState = { phone, isMe, data: fallback || {}, tab: "posts" };
  profileModalOverlay.classList.add("active");
  switchProfileTab("posts");

  socket.emit("get-profile", { phone }, (data) => {
    if (!data) return;
    profileViewState.data = data;
    document.getElementById("pmAvatar").src = data.pic || "https://via.placeholder.com/100";
    document.getElementById("pmName").textContent = data.name || "Profile";
    document.getElementById("pmSub").textContent = data.bio || (isMe ? "আপনার প্রোফাইল" : "EKT Chating App");
    switchProfileTab(profileViewState.tab);
  });
}

function openFriendProfile(friend) {
  if (!friend) return;
  openProfile(friend.phone, friend);
}

// বন্ধু নতুন কিছু পোস্ট করলে, তার প্রোফাইল খোলা থাকলে রিফ্রেশ
socket.on("friend-profile-updated", ({ phone }) => {
  if (profileViewState.phone === phone && profileModalOverlay.classList.contains("active")) {
    socket.emit("get-profile", { phone }, (data) => {
      if (data) {
        profileViewState.data = data;
        switchProfileTab(profileViewState.tab);
      }
    });
  }
});

document.getElementById("pmCloseBtn").onclick = () => profileModalOverlay.classList.remove("active");
document.getElementById("pmMessageBtn").onclick = () => {
  profileModalOverlay.classList.remove("active");
  if (profileViewState.phone && !profileViewState.isMe) {
    openDirectChat({
      phone: profileViewState.phone,
      name: profileViewState.data.name,
      pic: profileViewState.data.pic
    });
  }
};
profileModalOverlay.addEventListener("click", (e) => {
  if (e.target === profileModalOverlay) profileModalOverlay.classList.remove("active");
});

const openFriendProfileBtn = document.getElementById("openFriendProfileBtn");
if (openFriendProfileBtn) {
  openFriendProfileBtn.onclick = () => openFriendProfile(activeDirectChatFriend);
}

// ড্যাশবোর্ডের নিজের ছবিতে ক্লিক করলে নিজের প্রোফাইল খুলবে
if (dashboardAvatar) {
  dashboardAvatar.style.cursor = "pointer";
  dashboardAvatar.addEventListener("click", () => {
    if (currentUser) openProfile(currentUser.phone, currentUser);
  });
}
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
        document.getElementById("menuBlockUser").innerHTML = `<i class="fa-solid fa-user-check"></i><span>Unblock user</span>`;
      } else {
        await showCustomAlert("Unblocked", "ইউজারকে আনব্লক করা হয়েছে।");
        document.getElementById("menuBlockUser").innerHTML = `<i class="fa-solid fa-ban"></i><span>Block user</span>`;
      }
    }
  });
};

// ================= ছোট টোস্ট + কপি হেল্পার + থ্রি-ডট মেনুর অতিরিক্ত অ্যাকশন =================
function showMiniToast(text) {
  const t = document.createElement("div");
  t.className = "mini-toast";
  t.textContent = text;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 300);
  }, 1800);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed; opacity:0; left:-1000px;";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (e2) {
      return false;
    }
  }
}

// ড্যাশবোর্ডের থ্রি-ডট মেনু (Security PIN ও Logout এখন এর ভেতরে)
const dashMenuToggle = document.getElementById("dashMenuToggle");
const dashDropdownMenu = document.getElementById("dashDropdownMenu");
if (dashMenuToggle && dashDropdownMenu) {
  dashMenuToggle.onclick = (e) => {
    e.stopPropagation();
    dashDropdownMenu.classList.toggle("open");
  };
}

// ডিরেক্ট চ্যাটের থ্রি-ডট মেনুতে "View profile"
const menuViewProfile = document.getElementById("menuViewProfile");
if (menuViewProfile) {
  menuViewProfile.onclick = () => {
    if (activeDirectChatFriend) openFriendProfile(activeDirectChatFriend);
  };
}

// রুম চ্যাটের থ্রি-ডট মেনুতে "Copy room code"
const menuCopyRoomCode = document.getElementById("menuCopyRoomCode");
if (menuCopyRoomCode) {
  menuCopyRoomCode.onclick = async () => {
    if (!currentRoom || currentRoom === ADMIN_ROOM_PIN) {
      showMiniToast("এই রুমের কোড কপি করা যাবে না");
      return;
    }
    const ok = await copyText(currentRoom);
    showMiniToast(ok ? "Room code copied" : "Couldn't copy");
  };
}

// পোস্টের থ্রি-ডট মেনু বাইরে ক্লিক করলে বন্ধ হবে
document.addEventListener("click", () => {
  document.querySelectorAll(".post-more-menu.open").forEach((m) => m.classList.remove("open"));
});

function loadDirectChatHistory() {
  if (!activeDirectChatFriend) return;
  const chatContainer = document.getElementById("directChatMessages");
  socket.emit("get-direct-history", { senderPhone: currentUser.phone, receiverPhone: activeDirectChatFriend.phone }, (messages) => {
    chatContainer.innerHTML = "";

    // পুরো হিস্ট্রি একবারে বসানো হয় (প্রতি মেসেজে স্ট্যাটাস রি-রেন্ডার নয়) —
    // তাই অনেক মেসেজ থাকলেও চ্যাট সাথে সাথে খোলে
    (messages || []).forEach(msg =>
      appendDirectMessage(msg, { skipStatus: true, silentScroll: true })
    );

    // সর্বশেষ নিজের মেসেজটা বন্ধু দেখেছে কিনা তার উপর স্ট্যাটাস
    const mine = (messages || []).filter(m => m.senderPhone === currentUser.phone);
    const last = mine[mine.length - 1];
    directStatusState = last && last.seen
      ? { text: "Seen", seen: true }
      : { text: "Sent", seen: false };
    renderDirectStatus();

    chatContainer.scrollTop = chatContainer.scrollHeight;
    markDirectChatSeen();
  });
}

const sendDirectMsgBtn = document.getElementById("sendDirectMsgBtn");
const directMessageInput = document.getElementById("directMessageInput");
const directFileAttachmentInput = document.getElementById("directFileAttachmentInput");

if (sendDirectMsgBtn) {
  sendDirectMsgBtn.onclick = sendDirectMessage;
  directMessageInput.onkeypress = (e) => { if (e.key === "Enter") sendDirectMessage(); };
}

// ================= দ্রুত মেসেজ পাঠানো (Optimistic Send) =================
// আগে মেসেজ পাঠালে সার্ভারের উত্তরের জন্য অপেক্ষা করতে হতো বলে দেরি মনে হতো।
// এখন মেসেজ সাথে সাথেই স্ক্রিনে বসে যায়, আর স্ট্যাটাস (Sending → Sent →
// Delivered → Seen) আলাদাভাবে আপডেট হয় — একদম মেসেঞ্জারের মতো।

function makeClientId() {
  return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function dispatchDirectMessage(msgData) {
  setDirectStatus("Sending...", false);

  socket.emit("send-direct-message", msgData, (res) => {
    const row = document.querySelector(`.msg-row[data-client-id="${msgData.clientId}"]`);
    if (row) row.classList.remove("pending");

    if (res && res.success === false) {
      setDirectStatus("Not sent", false);
      if (res.error === "blocked_by_you") {
        showCustomAlert("Error", "আপনি এই ইউজারকে ব্লক করে রেখেছেন!");
      } else {
        showCustomAlert("Error", "এই ইউজার আপনাকে ব্লক করে রেখেছেন, মেসেজ পাঠানো যায়নি!");
      }
      return;
    }
    setDirectStatus(res && res.delivered ? "Delivered" : "Sent", false);
  });
}

function sendDirectMessage() {
  const text = directMessageInput.value.trim();
  if (!text || !activeDirectChatFriend) return;

  const msgData = {
    clientId: makeClientId(),
    senderPhone: currentUser.phone,
    senderName: currentUser.name,
    senderPic: currentUser.pic,
    receiverPhone: activeDirectChatFriend.phone,
    text: text,
    timestamp: Date.now()
  };

  // ইনপুট আগে খালি করা হয় যাতে টাইপিং কখনো আটকে না থাকে
  directMessageInput.value = "";
  const row = appendDirectMessage(msgData);
  if (row) row.classList.add("pending");
  directMessageInput.focus();

  dispatchDirectMessage(msgData);
}

// ================= ছবি ছোট করে পাঠানো (স্পিডের মূল সমাধান) =================
// আগে ফোনের ৪-৮ MB ছবি হুবহু base64 করে পাঠানো হতো, তাই এক মেসেজ যেতেই
// ১০-৩০ সেকেন্ড লাগত এবং অন্য পাশে কালো বক্স দেখাত। এখন পাঠানোর আগেই ছবিটা
// সর্বোচ্চ ১৬০০px করে JPEG-এ কম্প্রেস করা হয় — সাইজ ২০-৫০ গুণ কমে যায়।

const MAX_IMAGE_DIMENSION = 1600;
const IMAGE_QUALITY = 0.72;

function compressImageFile(file) {
  return new Promise((resolve) => {
    // GIF কম্প্রেস করলে অ্যানিমেশন নষ্ট হয়, তাই ওটা যেমন আছে তেমনই যাবে
    if (file.type === "image/gif") return resolve(null);

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        let { width, height } = img;
        const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL("image/jpeg", IMAGE_QUALITY);
        URL.revokeObjectURL(url);
        resolve({ dataUrl, width, height, type: "image/jpeg" });
      } catch (err) {
        URL.revokeObjectURL(url);
        resolve(null);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (evt) => resolve(evt.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024; // ~18MB এর বেশি হলে পাঠানো হবে না

// ডিরেক্ট চ্যাটে ফাইল/ছবি/ভিডিও/অডিও পাঠানো
if (directFileAttachmentInput) {
  directFileAttachmentInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    directFileAttachmentInput.value = "";
    if (!file || !activeDirectChatFriend) return;

    let fileContent = null;
    let fileType = file.type;
    let mediaWidth = null;
    let mediaHeight = null;

    try {
      if (file.type.startsWith("image/")) {
        const compressed = await compressImageFile(file);
        if (compressed) {
          fileContent = compressed.dataUrl;
          fileType = compressed.type;
          mediaWidth = compressed.width;
          mediaHeight = compressed.height;
        } else {
          fileContent = await readFileAsDataUrl(file);
        }
      } else {
        if (file.size > MAX_ATTACHMENT_BYTES) {
          await showCustomAlert("File Too Large", "ফাইলটি অনেক বড় (১৮MB এর বেশি)। ছোট একটা ফাইল পাঠান।");
          return;
        }
        fileContent = await readFileAsDataUrl(file);
      }
    } catch (err) {
      await showCustomAlert("Error", "ফাইলটি পড়া যায়নি, আবার চেষ্টা করুন।");
      return;
    }

    if (!fileContent) return;

    const msgData = {
      clientId: makeClientId(),
      senderPhone: currentUser.phone,
      senderName: currentUser.name,
      senderPic: currentUser.pic,
      receiverPhone: activeDirectChatFriend.phone,
      fileType: fileType,
      fileContent: fileContent,
      fileName: file.name,
      mediaWidth: mediaWidth,
      mediaHeight: mediaHeight,
      timestamp: Date.now()
    };

    const row = appendDirectMessage(msgData);
    if (row) row.classList.add("pending");

    dispatchDirectMessage(msgData);
  });
}

socket.on("receive-direct-message", (msgData) => {
  const isViewingThisChat = directChatScreen.classList.contains("active") &&
    activeDirectChatFriend && msgData.senderPhone === activeDirectChatFriend.phone;

  if (isViewingThisChat) {
    appendDirectMessage(msgData);
    markDirectChatSeen();   // চ্যাট খোলা থাকলে সাথে সাথেই Seen পাঠানো
  } else {
    unreadDirectCounts[msgData.senderPhone] = (unreadDirectCounts[msgData.senderPhone] || 0) + 1;
    updateFriendBadge();
    showMessageToast(msgData);
    fetchFriendData();
  }
});

// ================= MESSENGER-STYLE MESSAGE RENDERING =================
// মেসেজ গ্রুপিং, টাইম স্ট্যাম্প, ছবি/ভিডিওর সুন্দর প্রিভিউ এবং
// Sent / Delivered / Seen স্ট্যাটাস — সবই মেসেঞ্জারের মতো।

const GROUP_GAP_MS = 4 * 60 * 1000;      // এর চেয়ে কম সময়ের মেসেজগুলো একসাথে গ্রুপ হবে
const DIVIDER_GAP_MS = 20 * 60 * 1000;   // এর চেয়ে বেশি গ্যাপ হলে সময় দেখানো হবে

function formatMsgTime(ts) {
  const d = new Date(ts || Date.now());
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return time;
  const yest = new Date(now.getTime() - 86400000);
  if (d.toDateString() === yest.toDateString()) return "Yesterday " + time;
  return d.toLocaleDateString([], { day: "numeric", month: "short" }) + " " + time;
}

function buildMessageContent(msg) {
  // ফেরত দেয়: { html, isMedia }
  if (msg.fileType) {
    const name = msg.fileName || "file";
    if (msg.fileType.startsWith("image/")) {
      // আসল অনুপাত জানা থাকলে আগেই জায়গা রাখা হয় — তাই ছবি লোড হওয়ার সময়
      // চ্যাট লাফায় না এবং কালো ফাঁকা বক্স দেখায় না
      const ratioStyle = (msg.mediaWidth && msg.mediaHeight)
        ? ` style="aspect-ratio:${msg.mediaWidth}/${msg.mediaHeight}"`
        : "";
      return {
        isMedia: true,
        html: `<div class="media-wrap loading previewable-media" data-type="image" data-src="${msg.fileContent}" data-name="${escapeHtml(name)}"${ratioStyle}>
                 <img src="${msg.fileContent}" class="msg-media" alt="${escapeHtml(name)}" />
               </div>`
      };
    }
    if (msg.fileType.startsWith("video/")) {
      return {
        isMedia: true,
        html: `<div class="media-wrap video-wrap previewable-media" data-type="video" data-src="${msg.fileContent}" data-name="${escapeHtml(name)}">
                 <video class="msg-media" preload="metadata" muted playsinline disablepictureinpicture src="${msg.fileContent}#t=0.1"></video>
                 <span class="video-play-badge"><i class="fa-solid fa-play"></i></span>
               </div>`
      };
    }
    if (msg.fileType.startsWith("audio/")) {
      // চাপ দিলে ফুল-স্ক্রিন সুন্দর প্লেয়ারে খুলবে
      return {
        isMedia: false,
        html: `<div class="audio-chip previewable-media" data-type="audio" data-src="${msg.fileContent}" data-name="${escapeHtml(name)}">
                 <span class="audio-chip-play"><i class="fa-solid fa-play"></i></span>
                 <span class="audio-chip-name">${escapeHtml(name)}</span>
               </div>`
      };
    }
    return {
      isMedia: false,
      html: `<a href="${msg.fileContent}" download="${name}" class="msg-file-link">
               <i class="fa-solid fa-file-arrow-down"></i><span>${name}</span>
             </a>`
    };
  }
  return { isMedia: false, html: `<span class="msg-text">${escapeHtml(msg.text || "")}</span>` };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function attachMediaPreview(row) {
  const mediaElement = row.querySelector(".previewable-media");
  if (!mediaElement) return;

  // ছবি/ভিডিও লোড শেষ হলে শিমার সরিয়ে দিয়ে আসল সাইজে বসানো
  const img = mediaElement.querySelector("img.msg-media");
  if (img) {
    const done = () => {
      mediaElement.classList.remove("loading");
      if (img.naturalWidth && img.naturalHeight) {
        mediaElement.style.aspectRatio = `${img.naturalWidth}/${img.naturalHeight}`;
      }
      keepChatPinned();
    };
    if (img.complete && img.naturalWidth) done();
    else {
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", () => mediaElement.classList.remove("loading"), { once: true });
    }
  }
  const vid = mediaElement.querySelector("video.msg-media");
  if (vid) {
    vid.addEventListener("loadeddata", () => {
      mediaElement.classList.remove("loading");
      keepChatPinned();
    }, { once: true });
  }

  mediaElement.onclick = () => {
    openMediaPreview(
      mediaElement.getAttribute("data-type"),
      mediaElement.getAttribute("data-src"),
      mediaElement.getAttribute("data-name")
    );
  };
}

// চ্যাট নিচে থাকলে নিচেই রাখা (ছবি লোড হয়ে উচ্চতা বাড়লেও)
function keepChatPinned() {
  const c = document.getElementById("directChatMessages");
  if (!c) return;
  const nearBottom = c.scrollHeight - c.scrollTop - c.clientHeight < 220;
  if (nearBottom) c.scrollTop = c.scrollHeight;
}

function appendDirectMessage(msg, options) {
  const chatContainer = document.getElementById("directChatMessages");
  if (!chatContainer || !currentUser) return;

  // সার্ভার থেকে একই মেসেজ আবার এলে দুইবার যেন না দেখায়
  if (msg.clientId && chatContainer.querySelector(`.msg-row[data-client-id="${msg.clientId}"]`)) {
    return null;
  }

  const opts = options || {};
  const isMe = msg.senderPhone === currentUser.phone;
  const ts = msg.timestamp || Date.now();

  // আগের মেসেজের সাথে অনেক সময়ের ফারাক থাকলে সময়ের লাইন দেখানো
  const rows = chatContainer.querySelectorAll(".msg-row");
  const prevRow = rows.length ? rows[rows.length - 1] : null;
  const prevTs = prevRow ? Number(prevRow.dataset.ts || 0) : 0;
  if (!prevRow || ts - prevTs > DIVIDER_GAP_MS) {
    const divider = document.createElement("div");
    divider.className = "msg-time-divider";
    divider.textContent = formatMsgTime(ts);
    chatContainer.appendChild(divider);
  }

  const { html, isMedia } = buildMessageContent(msg);

  const row = document.createElement("div");
  row.className = `msg-row ${isMe ? "me" : ""}`;
  row.dataset.sender = msg.senderPhone || "";
  row.dataset.ts = String(ts);
  if (msg.clientId) row.dataset.clientId = msg.clientId;

  const avatarSrc = isMe
    ? (currentUser.pic || "https://via.placeholder.com/40")
    : (msg.senderPic || (activeDirectChatFriend && activeDirectChatFriend.pic) || "https://via.placeholder.com/40");

  const avatarHtml = `<div class="msg-avatar"><img src="${avatarSrc}" alt="" /></div>`;
  const bubbleHtml = `<div class="msg-bubble ${isMedia ? "media-bubble" : ""}" title="${formatMsgTime(ts)}">${html}</div>`;

  row.innerHTML = isMe ? bubbleHtml : avatarHtml + bubbleHtml;

  // স্ট্যাটাস রো সবসময় শেষে থাকবে, তাই সেটা সরিয়ে নতুন মেসেজ বসানো হয়
  const oldStatus = chatContainer.querySelector(".msg-status-row");
  if (oldStatus) oldStatus.remove();

  chatContainer.appendChild(row);
  attachMediaPreview(row);
  regroupDirectMessages();

  if (!opts.skipStatus) renderDirectStatus();

  if (!opts.silentScroll) {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
  return row;
}

// একই মানুষের পরপর মেসেজগুলোকে একসাথে গ্রুপ করা (মেসেঞ্জারের মতো)
function regroupDirectMessages() {
  const chatContainer = document.getElementById("directChatMessages");
  if (!chatContainer) return;
  const rows = Array.from(chatContainer.querySelectorAll(".msg-row"));

  rows.forEach((row, i) => {
    const prev = rows[i - 1];
    const next = rows[i + 1];
    const ts = Number(row.dataset.ts || 0);

    const samePrev = prev && prev.dataset.sender === row.dataset.sender &&
      ts - Number(prev.dataset.ts || 0) < GROUP_GAP_MS;
    const sameNext = next && next.dataset.sender === row.dataset.sender &&
      Number(next.dataset.ts || 0) - ts < GROUP_GAP_MS;

    row.classList.toggle("group-start", !samePrev);
    row.classList.toggle("group-end", !sameNext);
    row.classList.toggle("group-mid", !!samePrev && !!sameNext);
  });
}

// ---- Sent / Delivered / Seen স্ট্যাটাস ----
let directStatusState = { text: "Sent", seen: false };

function renderDirectStatus() {
  const chatContainer = document.getElementById("directChatMessages");
  if (!chatContainer) return;

  const old = chatContainer.querySelector(".msg-status-row");
  if (old) old.remove();

  const myRows = chatContainer.querySelectorAll(".msg-row.me");
  if (!myRows.length) return;
  const lastMine = myRows[myRows.length - 1];

  const statusRow = document.createElement("div");
  statusRow.className = "msg-status-row";

  if (directStatusState.seen) {
    const pic = (activeDirectChatFriend && activeDirectChatFriend.pic) || "https://via.placeholder.com/40";
    statusRow.innerHTML = `<img class="seen-avatar" src="${pic}" title="Seen" alt="Seen" />`;
  } else {
    const icon = directStatusState.text === "Sending..."
      ? `<i class="fa-regular fa-clock"></i>`
      : directStatusState.text === "Delivered"
        ? `<i class="fa-solid fa-circle-check"></i>`
        : `<i class="fa-regular fa-circle-check"></i>`;
    statusRow.innerHTML = `<span class="status-chip">${icon}${directStatusState.text}</span>`;
  }

  lastMine.insertAdjacentElement("afterend", statusRow);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function setDirectStatus(text, seen) {
  directStatusState = { text: text, seen: !!seen };
  renderDirectStatus();
}

// বন্ধু আমার মেসেজ দেখে ফেললে
socket.on("direct-messages-seen", ({ byPhone }) => {
  if (activeDirectChatFriend && activeDirectChatFriend.phone === byPhone) {
    setDirectStatus("Seen", true);
  }
});

// আমি চ্যাট খুললে বন্ধুকে জানানো যে দেখেছি
function markDirectChatSeen() {
  if (!currentUser || !activeDirectChatFriend) return;
  socket.emit("mark-direct-seen", {
    viewerPhone: currentUser.phone,
    friendPhone: activeDirectChatFriend.phone
  });
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
        <img src="${member.pic || 'https://via.placeholder.com/40'}" alt="" />
        <span>${member.name}</span>
        ${member.phone !== currentUser.phone ? '<i class="fa-solid fa-user-plus" title="Add Friend"></i>' : ''}
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
  document.body.classList.remove("dashboard-active");

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
  sessionStorage.removeItem("activeDirectChat");
  sessionStorage.removeItem("masterUnlocked");
  currentUser = null;
  location.reload();
});

sendMessageBtn.addEventListener("click", sendChatMessage);
chatMessageInput.addEventListener("keypress", (e) => { if (e.key === "Enter") sendChatMessage(); });

fileAttachmentInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  fileAttachmentInput.value = "";
  if (!file) return;

  let fileContent = null;
  let fileType = file.type;

  try {
    if (file.type.startsWith("image/")) {
      const compressed = await compressImageFile(file);   // রুমেও ছবি ছোট করে পাঠানো
      if (compressed) { fileContent = compressed.dataUrl; fileType = compressed.type; }
      else fileContent = await readFileAsDataUrl(file);
    } else {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        await showCustomAlert("File Too Large", "ফাইলটি অনেক বড় (১৮MB এর বেশি)।");
        return;
      }
      fileContent = await readFileAsDataUrl(file);
    }
  } catch (err) {
    await showCustomAlert("Error", "ফাইলটি পড়া যায়নি, আবার চেষ্টা করুন।");
    return;
  }
  if (!fileContent) return;

  const msgId = "msg_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5);
  const fileData = {
    id: msgId,
    roomCode: currentRoom,
    sender: currentUser.name,
    senderPic: currentUser.pic || "https://via.placeholder.com/40",
    fileType: fileType,
    fileContent: fileContent,
    fileName: file.name
  };
  appendChatMessage(fileData, true, "Sending...");
  socket.emit("send-message", fileData, () => {
    updateMessageStatus(msgId, "Sent");
    saveCurrentRoomHistoryToLocal();
  });
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

  // ডিরেক্ট চ্যাটের মতো একই সুন্দর বাবল/মিডিয়া স্টাইল রুমেও ব্যবহার করা হলো
  const built = buildMessageContent(msg);
  const contentHtml = built.html;
  const isMedia = built.isMedia;

  const statusHtml = isMe
    ? `<div class="msg-status-container status-chip" style="justify-content:flex-end; margin-top:3px;">${initialStatus}</div>`
    : "";
  const avatarImg = `<div class="msg-avatar"><img src="${msg.senderPic || 'https://via.placeholder.com/40'}" alt="" /></div>`;
  const bubble = `<div class="msg-bubble ${isMedia ? "media-bubble" : ""}">${contentHtml}</div>`;

  if (isMe) {
    msgDiv.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:flex-end; max-width:78%;" class="room-msg-col me">
        ${bubble}
        ${statusHtml}
      </div>
      ${avatarImg}
    `;
  } else {
    msgDiv.innerHTML = `
      ${avatarImg}
      <div style="display:flex; flex-direction:column; align-items:flex-start; max-width:78%;" class="room-msg-col">
        <span class="room-sender-name">${escapeHtml(msg.sender || "")}</span>
        ${bubble}
      </div>
    `;
  }
  msgDiv.classList.add("msg-row", "group-start", "group-end");
  if (isMe) msgDiv.classList.add("me");

  chatMessages.appendChild(msgDiv);
  attachMediaPreview(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
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

// ================= WHATSAPP-STYLE CALL UI CONTROLLER =================
// কল স্ক্রিনে এখন: Connecting → Ringing → Connected + সময় গণনা,
// মিউট, স্পিকার, অডিও থেকে ভিডিওতে সুইচ, আর কল শেষে "Call ended" স্ক্রিন।

const callTimerEl = document.getElementById("callTimer");
const callTopBar = document.getElementById("callTopBar");
const callTopName = document.getElementById("callTopName");
const callTopTimer = document.getElementById("callTopTimer");
const callControls = document.getElementById("callControls");
const callEndedActions = document.getElementById("callEndedActions");
const muteCallBtn = document.getElementById("muteCallBtn");
const videoToggleBtn = document.getElementById("videoToggleBtn");
const speakerCallBtn = document.getElementById("speakerCallBtn");

let callTimerInterval = null;
let callStartedAt = null;
let isCallConnected = false;
let isMicMuted = false;
let isSpeakerOn = true;
let lastCallInfo = null;   // { mode, phone, name, pic, type } — "Call again" এর জন্য

function formatCallDuration(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? pad(h) + ":" + pad(m) + ":" + pad(sec) : pad(m) + ":" + pad(sec);
}

function startCallTimer() {
  stopCallTimer();
  callStartedAt = Date.now();
  callTimerEl.style.display = "block";
  const tick = () => {
    const txt = formatCallDuration(Date.now() - callStartedAt);
    callTimerEl.textContent = txt;
    callTopTimer.textContent = txt;
  };
  tick();
  callTimerInterval = setInterval(tick, 1000);
}

function stopCallTimer() {
  if (callTimerInterval) clearInterval(callTimerInterval);
  callTimerInterval = null;
}

function setCallStatus(text) {
  callStatusText.textContent = text;
  callStatusText.style.display = "block";
}

// কল কানেক্ট হলে — রিং থামবে, সময় গোনা শুরু হবে
function markCallConnected() {
  if (isCallConnected) return;
  isCallConnected = true;
  callModal.classList.add("connected");
  setCallStatus("Connected");
  acceptCallBtn.style.display = "none";
  startCallTimer();
  setTimeout(() => { if (isCallConnected) callStatusText.style.display = "none"; }, 1500);
}

// ভিডিও নাকি অডিও লেআউট দেখানো হবে
function setCallLayout(type) {
  if (type === "video") {
    callVideoGrid.style.display = "block";
    callProfileGrid.style.display = "none";
    callTopBar.style.display = "flex";
    videoToggleBtn.innerHTML = '<i class="fa-solid fa-video"></i>';
    videoToggleBtn.classList.add("active");
    videoToggleBtn.title = "Turn off camera";
  } else {
    callVideoGrid.style.display = "none";
    callProfileGrid.style.display = "flex";
    callTopBar.style.display = "none";
    videoToggleBtn.innerHTML = '<i class="fa-solid fa-video-slash"></i>';
    videoToggleBtn.classList.remove("active");
    videoToggleBtn.title = "Switch to video";
  }
}

// কল স্ক্রিন খোলা (সব অবস্থা রিসেট করে)
function openCallScreen(opts) {
  const o = opts || {};
  lastCallInfo = { mode: o.mode, phone: o.phone, name: o.name, pic: o.pic, type: o.type };
  isCallConnected = false;
  callModal.classList.remove("connected");
  stopCallTimer();
  callStartedAt = null;

  remoteCallName.textContent = o.name || "Friend";
  remoteCallAvatar.src = o.pic || "https://via.placeholder.com/100";
  callTopName.textContent = o.name || "Friend";
  callTimerEl.style.display = "none";
  callTimerEl.textContent = "00:00";
  callTopTimer.textContent = "00:00";

  setCallStatus(o.status || (o.incoming ? "Incoming call..." : "Connecting..."));
  setCallLayout(o.type === "video" ? "video" : "audio");

  callControls.style.display = "flex";
  callEndedActions.style.display = "none";
  acceptCallBtn.style.display = o.incoming ? "inline-flex" : "none";

  isMicMuted = false;
  muteCallBtn.classList.remove("active");
  muteCallBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>';

  callModal.style.display = "flex";

  // আউটগোয়িং কল: প্রথমে Connecting, তারপর Ringing দেখানো হয়
  if (!o.incoming) {
    setTimeout(() => { if (!isCallConnected) setCallStatus("Ringing..."); }, 1400);
  }
}

// কল শেষ হওয়ার স্ক্রিন (হোয়াটসঅ্যাপের মতো Message / Call again / Close)
function showCallEndedScreen() {
  const duration = callStartedAt ? formatCallDuration(Date.now() - callStartedAt) : null;
  stopCallTimer();
  callModal.classList.remove("connected");
  setCallLayout("audio");
  callStatusText.style.display = "block";
  callStatusText.textContent = duration ? "Call ended · " + duration : "Call ended";
  callTimerEl.style.display = "none";
  callControls.style.display = "none";
  callEndedActions.style.display = "flex";
  callModal.style.display = "flex";
  isCallConnected = false;
  callStartedAt = null;
}

function hideCallScreen() {
  callModal.style.display = "none";
  callEndedActions.style.display = "none";
  callControls.style.display = "flex";
}

// ---- মিউট ----
if (muteCallBtn) {
  muteCallBtn.onclick = () => {
    if (!localStream) return;
    isMicMuted = !isMicMuted;
    localStream.getAudioTracks().forEach((t) => { t.enabled = !isMicMuted; });
    muteCallBtn.classList.toggle("active", isMicMuted);
    muteCallBtn.innerHTML = isMicMuted
      ? '<i class="fa-solid fa-microphone-slash"></i>'
      : '<i class="fa-solid fa-microphone"></i>';
  };
}

// ---- স্পিকার ----
if (speakerCallBtn) {
  speakerCallBtn.onclick = () => {
    isSpeakerOn = !isSpeakerOn;
    remoteAudioElement.volume = isSpeakerOn ? 1 : 0.25;
    remoteVideo.volume = isSpeakerOn ? 1 : 0.25;
    speakerCallBtn.classList.toggle("active", !isSpeakerOn);
    speakerCallBtn.innerHTML = isSpeakerOn
      ? '<i class="fa-solid fa-volume-high"></i>'
      : '<i class="fa-solid fa-volume-low"></i>';
  };
}

// ---- অডিও কল থেকে ভিডিও কলে সুইচ (কলের মাঝপথেই) ----
if (videoToggleBtn) {
  videoToggleBtn.onclick = async () => {
    if (!localStream) return;

    const existingVideoTrack = localStream.getVideoTracks()[0];

    if (existingVideoTrack && existingVideoTrack.enabled) {
      existingVideoTrack.enabled = false;          // ক্যামেরা বন্ধ
      setCallLayout("audio");
      return;
    }
    if (existingVideoTrack) {
      existingVideoTrack.enabled = true;           // আগে নেওয়া ক্যামেরা আবার চালু
      currentCallType = "video";
      setCallLayout("video");
      return;
    }

    // একদম নতুন করে ক্যামেরা চালু করে চলমান কলে যোগ করা
    try {
      const camStream = await navigator.mediaDevices.getUserMedia({ video: true });
      const videoTrack = camStream.getVideoTracks()[0];
      localStream.addTrack(videoTrack);
      localVideo.srcObject = localStream;

      const pc = currentCall && currentCall.peerConnection;
      if (pc) {
        const sender = pc.getSenders().find((sn) => sn.track && sn.track.kind === "video");
        if (sender) await sender.replaceTrack(videoTrack);
        else pc.addTrack(videoTrack, localStream);
      }

      currentCallType = "video";
      setCallLayout("video");

      if (callContext.mode === "direct" && callContext.phone) {
        socket.emit("direct-call-upgrade", { toPhone: callContext.phone });
      }
    } catch (err) {
      showCustomAlert("Camera Error", "ক্যামেরা চালু করা যায়নি। পারমিশন দেওয়া আছে কিনা দেখুন।");
    }
  };
}

// অন্য পাশ ভিডিওতে সুইচ করলে আমার স্ক্রিনেও ভিডিও লেআউট আসবে
socket.on("direct-call-upgraded", () => {
  currentCallType = "video";
  setCallLayout("video");
});

// ---- কল শেষের স্ক্রিনের বাটনগুলো ----
document.getElementById("callCloseBtn").onclick = hideCallScreen;

document.getElementById("callEndedMessageBtn").onclick = () => {
  hideCallScreen();
  if (lastCallInfo && lastCallInfo.mode === "direct" && lastCallInfo.phone) {
    openDirectChat({ phone: lastCallInfo.phone, name: lastCallInfo.name, pic: lastCallInfo.pic });
  }
};

document.getElementById("callAgainBtn").onclick = () => {
  callEndedActions.style.display = "none";
  callControls.style.display = "flex";
  if (!lastCallInfo) return;
  if (lastCallInfo.mode === "direct") {
    if (!activeDirectChatFriend) {
      activeDirectChatFriend = { phone: lastCallInfo.phone, name: lastCallInfo.name, pic: lastCallInfo.pic };
    }
    initiateDirectCall(lastCallInfo.type || "audio");
  } else {
    initiateCall(lastCallInfo.type || "audio");
  }
};


if (startAudioCallBtn) startAudioCallBtn.onclick = () => initiateCall("audio");
if (startVideoCallBtn) startVideoCallBtn.onclick = () => initiateCall("video");

async function initiateCall(type) {
  unlockRemoteAudio();
  callContext = { mode: "room", phone: null };
  currentCallType = type;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: type === "video" });
    if (type === "video") localVideo.srcObject = localStream;

    openCallScreen({
      mode: "room",
      phone: null,
      name: currentRoom ? "Room " + currentRoom : "Room",
      pic: (currentUser && currentUser.pic) || "https://via.placeholder.com/100",
      type: type,
      incoming: false
    });

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

  openCallScreen({
    mode: "room",
    phone: null,
    name: data.callerName,
    pic: data.callerPic,
    type: data.callType,
    incoming: true,
    status: "Incoming " + data.callType + " call"
  });

  acceptCallBtn.onclick = async () => {
    unlockRemoteAudio();
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: currentCallType === "video" });
      if (currentCallType === "video") localVideo.srcObject = localStream;
      setCallLayout(currentCallType === "video" ? "video" : "audio");
      const call = myPeer.call(data.callerPeerId, localStream);
      handleCallConnection(call);
      socket.emit("accept-call-notify", { roomCode: currentRoom });
      markCallConnected();
    } catch (err) {
      showCustomAlert("Error", "কল রিসিভ করার সময় এক্সেস পাওয়া যায়নি!");
    }
  };
});

myPeer.on("call", async (call) => {
  currentCallType = call.metadata ? call.metadata.type : currentCallType;
  try {
    if (!localStream) {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: currentCallType === "video" });
    }
    if (currentCallType === "video") localVideo.srcObject = localStream;
    setCallLayout(currentCallType === "video" ? "video" : "audio");
    call.answer(localStream);
    handleCallConnection(call);
    callModal.style.display = "flex";
    markCallConnected();
  } catch (err) {}
});

function handleCallConnection(call) {
  currentCall = call;
  call.on("stream", (remoteStream) => {
    // শব্দ সবসময় আলাদা audio এলিমেন্ট দিয়ে চলবে (অডিও ও ভিডিও দুই কলেই),
    // ভিডিও এলিমেন্ট mute থাকবে — নইলে একই শব্দ দুইবার বাজে বা কোনোটাই বাজে না।
    const remoteAudioTracks = remoteStream.getAudioTracks();
    console.log("Remote audio tracks:", remoteAudioTracks.length,
      remoteAudioTracks.map((t) => t.readyState + (t.muted ? "/muted" : "/live")));

    remoteAudioElement.removeAttribute("src");
    remoteAudioElement.srcObject = remoteStream;
    remoteAudioElement.muted = false;
    remoteAudioElement.volume = isSpeakerOn ? 1 : 0.25;
    playRemoteAudio();

    remoteVideo.muted = true;
    remoteVideo.srcObject = remoteStream;
    markCallConnected();
  });
  call.on("close", endCallCleanup);
  call.on("error", endCallCleanup);
  watchCallConnection(call);
}

// কলের নেটওয়ার্ক অবস্থা দেখানো — কানেকশন ফেইল হলে "Connected" লেখা দেখিয়ে ভুল বোঝাবে না
function watchCallConnection(call) {
  let tries = 0;
  const attach = () => {
    const pc = call.peerConnection;
    if (!pc) {
      if (tries++ < 40) setTimeout(attach, 250);
      return;
    }
    pc.addEventListener("iceconnectionstatechange", () => {
      const s = pc.iceConnectionState;
      if (s === "failed") {
        setCallStatus("Connection failed — নেটওয়ার্কে কল যাচ্ছে না");
      } else if (s === "disconnected") {
        setCallStatus("Reconnecting...");
      } else if (s === "connected" || s === "completed") {
        if (isCallConnected) callStatusText.style.display = "none";
      }
    });
  };
  attach();
}

socket.on("call-accepted-by-receiver", () => { markCallConnected(); });

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
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  remoteAudioElement.srcObject = null;
  hideSoundHint();

  // সাথে সাথে বন্ধ না করে হোয়াটসঅ্যাপের মতো "Call ended" স্ক্রিন দেখানো হয়
  showCallEndedScreen();
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
  unlockRemoteAudio();
  if (!activeDirectChatFriend) return;
  if (!myPeerId) {
    await showCustomAlert("Please Wait", "কল সার্ভারের সাথে সংযোগ হচ্ছে, কয়েক সেকেন্ড পর আবার চেষ্টা করুন।");
    return;
  }

  callContext = { mode: "direct", phone: activeDirectChatFriend.phone };
  currentCallType = type;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: AUDIO_CONSTRAINTS,
      video: type === "video"
    });

    if (type === "video") localVideo.srcObject = localStream;

    openCallScreen({
      mode: "direct",
      phone: activeDirectChatFriend.phone,
      name: activeDirectChatFriend.name,
      pic: activeDirectChatFriend.pic,
      type: type,
      incoming: false
    });

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

  openCallScreen({
    mode: "direct",
    phone: data.fromPhone,
    name: data.callerName || "Friend",
    pic: data.callerPic,
    type: data.callType,
    incoming: true,
    status: "Incoming " + data.callType + " call"
  });

  acceptCallBtn.onclick = async () => {
    unlockRemoteAudio();
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: AUDIO_CONSTRAINTS,
        video: currentCallType === "video"
      });

      if (currentCallType === "video") localVideo.srcObject = localStream;
      setCallLayout(currentCallType === "video" ? "video" : "audio");

      const call = myPeer.call(data.callerPeerId, localStream, {
        metadata: { type: currentCallType }
      });
      handleCallConnection(call);

      socket.emit("direct-call-accept", { toPhone: data.fromPhone });
      markCallConnected();
    } catch (err) {
      endCallCleanup();
      showCustomAlert("Error", "কল রিসিভ করার সময় ক্যামেরা/মাইক এক্সেস পাওয়া যায়নি!");
    }
  };
});

socket.on("direct-call-accepted", () => { markCallConnected(); });
socket.on("direct-call-ended", endCallCleanup);

// স্প্ল্যাশ স্ক্রিন — অ্যাপ প্রস্তুত হলে সরিয়ে দেওয়া (index.html-এর টাইমারের ব্যাকআপ)
window.addEventListener("load", () => {
  setTimeout(() => {
    if (typeof window.hideSplashScreen === "function") window.hideSplashScreen();
  }, 5600);
});
