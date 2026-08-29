// --- Master Key Validation & Dynamic Routing ---
function handleMasterKeySubmit(enteredKey) {
    // ১. মাস্টার কি চেক করা
    if (enteredKey === CORRECT_MASTER_KEY) {
        sessionStorage.setItem('master_key_verified', 'true');
        
        // ২. ইউজার লগইন অবস্থায় আছে কি না চেক করা (e.g., Auth Token / LocalStorage)
        const currentUser = localStorage.getItem('chat_user');
        
        if (currentUser) {
            // লগইন করা থাকলে সরাসরি মূল ইন্টারফেসে নিয়ে যাবে
            showMainDashboard();
            
            // রিফ্রেশ করার পর যদি কোনো রুমে যুক্ত ছিল, তবে সেখানে Rejoin করবে
            checkAndRejoinRoom();
        } else {
            // লগইন করা না থাকলে Login/Signup স্ক্রিন দেখাবে
            showAuthScreen();
        }
    } else {
        alert("ভুল মাস্টার কি! আবার চেষ্টা করুন।");
    }
}

// --- Refresh করলে রুম ধরে রাখার লজিক ---
function joinRoom(roomId) {
    // বর্তমান রুমের আইডি সেশন বা ইউআরএল-এ সেভ রাখা
    sessionStorage.setItem('active_room_id', roomId);
    window.location.hash = `room=${roomId}`;
    
    socket.emit('join-room', { roomId, userId: currentUserId });
    showRoomUI(roomId);
}

function checkAndRejoinRoom() {
    const activeRoom = sessionStorage.getItem('active_room_id');
    if (activeRoom) {
        joinRoom(activeRoom);
    }
}

// পেজ লোড হওয়ার পর সবসময় মাস্টার কি স্ক্রিন দেখাবে
window.addEventListener('DOMContentLoaded', () => {
    // আগের মাস্টার কি ভেরিফিকেশন স্টেট মুছে ফেলা যাতে রিফ্রেশে সবসময় আগে Master Key চায়
    sessionStorage.removeItem('master_key_verified');
    showMasterKeyModal(); 
});
