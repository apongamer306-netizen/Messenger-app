<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EKT CHATING APP</title>
  <link rel="stylesheet" href="style.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  
  <script src="https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.7.2/socket.io.js"></script>
  <script src="https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js"></script>
</head>
<body class="dark-theme">

  <header class="navbar">
    <div class="logo">EKT CHATING APP</div>
    <div class="nav-controls">
      <button id="themeToggleBtn" class="icon-btn"><i class="fa-solid fa-moon"></i></button>
    </div>
  </header>

  <main class="main-container">

    <!-- Screen 1: Security / Access Screen -->
    <div id="masterKeyScreen" class="card-screen">
      <h2 id="masterTitle">Welcome</h2>
      <p id="masterSubtitle" style="font-size: 13px; opacity: 0.8; margin-bottom: 15px;">You can enter directly or set a security password</p>

      <div class="input-wrapper" id="passInputGroup" style="display: none;">
        <input type="password" id="masterKeyInput" placeholder="Enter Security PIN">
        <i class="fa-solid fa-eye toggle-eye" onclick="togglePasswordVisibility('masterKeyInput', this)"></i>
      </div>

      <div style="display: flex; gap: 10px; width: 100%; justify-content: center; margin-top: 10px;">
        <button id="unlockBtn" class="btn btn-primary" style="display: none;">Submit</button>
        <button id="directOpenBtn" class="btn btn-primary">Direct Open</button>
      </div>

      <p class="auth-toggle-text" style="margin-top: 15px;">
        <span id="masterToggleMsg">Want extra security?</span>
        <a href="#" id="masterToggleLink">Create Password</a>
      </p>

      <p class="footer-text">DEVELOPED BY EYAMIN</p>
    </div>

    <!-- Screen 2: Auth Screen -->
    <div id="authScreen" class="card-screen" style="display: none;">
      <h2 id="authTitle">Login Account</h2>
      
      <div id="signupFields" style="display: none;">
        <div class="input-wrapper">
          <input type="text" id="fullNameInput" placeholder="Full Name">
        </div>
      </div>

      <div class="input-wrapper">
        <input type="text" id="phoneInput" placeholder="Phone Number">
      </div>

      <div class="input-wrapper">
        <input type="password" id="authPasswordInput" placeholder="Password">
        <i class="fa-solid fa-eye toggle-eye" onclick="togglePasswordVisibility('authPasswordInput', this)"></i>
      </div>

      <button id="authSubmitBtn" class="btn btn-primary">Login</button>

      <p class="auth-toggle-text">
        <span id="authToggleMsg">Don't have an account?</span>
        <a href="#" id="authToggleLink">Sign Up</a>
      </p>
      <p class="footer-text">DEVELOPED BY EYAMIN</p>
    </div>

    <!-- Screen 3: Dashboard -->
    <div id="dashboardScreen" class="card-screen" style="display: none;">
      <div class="profile-header">
        <div class="avatar-container">
          <img id="dashboardAvatar" src="https://via.placeholder.com/100" alt="Profile Picture">
          <label for="avatarUpload" class="avatar-edit-badge"><i class="fa-solid fa-camera"></i></label>
          <input type="file" id="avatarUpload" accept="image/*" style="display: none;">
        </div>
        <h3 id="dashboardUserName">User Name</h3>
      </div>

      <button id="createRoomBtn" class="btn btn-primary">Create Room</button>

      <div class="input-wrapper" style="margin-top: 15px;">
        <input type="text" id="roomCodeInput" placeholder="Enter Room Code">
      </div>

      <button id="joinRoomBtn" class="btn btn-primary">Join Room</button>
      
      <!-- Dynamic Set/Change Security PIN Button -->
      <button id="setPinBtn" class="btn btn-secondary" style="margin-top: 10px; background-color: #0d6efd; color: #fff;">
        <i class="fa-solid fa-key" style="margin-right: 6px;"></i><span id="setPinBtnText">Set Security PIN</span>
      </button>
      
      <!-- Remove Security PIN Button -->
      <button id="removePinBtn" class="btn btn-secondary" style="margin-top: 10px; background-color: #6c757d; color: #fff;">
        <i class="fa-solid fa-trash-can" style="margin-right: 6px;"></i>Remove Security PIN
      </button>

      <button id="logoutBtn" class="btn btn-danger" style="margin-top: 10px;">Logout</button>
      <p class="footer-text">DEVELOPED BY EYAMIN</p>
    </div>

    <!-- Screen 4: Chat Room -->
    <div id="chatScreen" class="chat-container" style="display: none;">
      <div class="chat-header">
        <div class="user-info">
          <img id="chatUserAvatar" src="https://via.placeholder.com/40" alt="Avatar">
          <div>
            <h4 id="chatUserName">User Name</h4>
            <span id="chatRoomCode">Code: ------</span>
          </div>
        </div>
        <div class="chat-actions">
          <button id="startAudioCallBtn" class="action-btn call-audio"><i class="fa-solid fa-phone"></i></button>
          <button id="startVideoCallBtn" class="action-btn call-video"><i class="fa-solid fa-video"></i></button>
          <button id="leaveRoomBtn" class="action-btn leave-room"><i class="fa-solid fa-right-from-bracket"></i></button>
        </div>
      </div>

      <div id="chatMessages" class="chat-messages"></div>

      <div class="chat-input-area">
        <label for="fileAttachmentInput" class="attach-btn"><i class="fa-solid fa-paperclip"></i></label>
        <input type="file" id="fileAttachmentInput" accept="image/*,video/*,audio/*" style="display: none;">
        
        <input type="text" id="chatMessageInput" placeholder="Type a message...">
        <button id="sendMessageBtn" class="send-btn"><i class="fa-solid fa-paper-plane"></i></button>
      </div>
    </div>

    <!-- Call Overlay Modal -->
    <div id="callModal" class="call-modal" style="display: none;">
      <div class="call-box">
        <h3 id="callStatusText">Incoming Call...</h3>
        
        <div id="callVideoGrid" class="video-grid" style="display: none;">
          <video id="localVideo" autoplay muted playsinline></video>
          <video id="remoteVideo" autoplay playsinline></video>
        </div>

        <div id="callProfileGrid" class="call-profile-grid">
          <div class="call-profile-item">
            <img id="localCallAvatar" src="https://via.placeholder.com/100" class="call-avatar" alt="My Profile">
            <span id="localCallName" class="call-username">Me</span>
          </div>
          <div class="call-profile-item">
            <img id="remoteCallAvatar" src="https://via.placeholder.com/100" class="call-avatar" alt="Other Profile">
            <span id="remoteCallName" class="call-username">Other</span>
          </div>
        </div>

        <div class="call-controls">
          <button id="acceptCallBtn" class="btn-call accept"><i class="fa-solid fa-phone"></i> Receive</button>
          <button id="rejectCallBtn" class="btn-call reject"><i class="fa-solid fa-phone-slash"></i> End</button>
        </div>
      </div>
    </div>

    <!-- Master-Style Custom Modal Interface -->
    <div id="customModalOverlay" class="call-modal" style="display: none; z-index: 99999;">
      <div class="card-screen" style="max-width: 360px; margin: auto;">
        <h2 id="modalTitle">Security Check</h2>
        <p id="modalSubtitle" style="font-size: 13px; opacity: 0.8; margin-bottom: 15px;">Please confirm your action</p>

        <div class="input-wrapper" id="modalInputGroup" style="display: none;">
          <input type="password" id="modalInput" placeholder="Enter Security PIN">
          <i class="fa-solid fa-eye toggle-eye" onclick="togglePasswordVisibility('modalInput', this)"></i>
        </div>

        <div style="display: flex; gap: 10px; width: 100%; justify-content: center; margin-top: 15px;">
          <button id="modalConfirmBtn" class="btn btn-primary">Confirm</button>
          <button id="modalCancelBtn" class="btn btn-secondary" style="background-color: #6c757d; color: #fff;">Cancel</button>
        </div>
      </div>
    </div>

  </main>

  <script src="app.js"></script>
</body>
</html>
