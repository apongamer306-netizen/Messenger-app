// আপনার অ্যাডমিন সিকিউরিটি পিন
const ADMIN_SECURITY_PIN = "1234";

// UI Elements
const dashboardScreen = document.getElementById('dashboardScreen');
const chatScreen = document.getElementById('chatScreen');

const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const leaveRoomBtn = document.getElementById('leaveRoomBtn');

const createRoomModal = document.getElementById('createRoomModal');
const cancelCreateModalBtn = document.getElementById('cancelCreateModalBtn');
const adminRoomOptionBtn = document.getElementById('adminRoomOptionBtn');

// ১. Create Room বাটনে ক্লিক করলে পপ-আপ স্ক্রিন আসবে (ড্যাশবোর্ডের উপরে সেন্টারে)
if (createRoomBtn) {
  createRoomBtn.addEventListener('click', () => {
    createRoomModal.style.display = 'flex';
  });
}

// ২. Cancel বাটনে ক্লিক করলে পপ-আপ বন্ধ হবে
if (cancelCreateModalBtn) {
  cancelCreateModalBtn.addEventListener('click', () => {
    createRoomModal.style.display = 'none';
  });
}

// ৩. পপ-আপ থেকে Admin Room সিলেক্ট করলে পাসওয়ার্ড চাইবে
if (adminRoomOptionBtn) {
  adminRoomOptionBtn.addEventListener('click', () => {
    const inputPin = prompt("Enter Security PIN to CREATE Admin Room:");
    if (inputPin === ADMIN_SECURITY_PIN) {
      alert("Access Granted! Opening Admin Room...");
      createRoomModal.style.display = 'none';
      openChatRoom();
    } else if (inputPin !== null) {
      alert("Incorrect Security PIN!");
    }
  });
}

// ৪. Direct Join Room বাটনে ক্লিক করলেও পাসওয়ার্ড চাইবে
if (joinRoomBtn) {
  joinRoomBtn.addEventListener('click', () => {
    const inputPin = prompt("Enter Security PIN to JOIN Admin Room:");
    if (inputPin === ADMIN_SECURITY_PIN) {
      alert("Access Granted! Joining Admin Room...");
      openChatRoom();
    } else if (inputPin !== null) {
      alert("Incorrect Security PIN!");
    }
  });
}

// ৫. Leave Room বাটনে ক্লিক করলে ড্যাশবোর্ডে ফিরে যাবে
if (leaveRoomBtn) {
  leaveRoomBtn.addEventListener('click', () => {
    chatScreen.style.display = 'none';
    dashboardScreen.style.display = 'block';
  });
}

// চ্যাট বক্স দেখানোর ফাংশন
function openChatRoom() {
  dashboardScreen.style.display = 'none';
  chatScreen.style.display = 'flex';
}
