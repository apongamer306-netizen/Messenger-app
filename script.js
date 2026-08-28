const socket = io();
let currentUser = "";
let localStream;
let peerConnection;

const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

function login() {
  const username = document.getElementById("username-input").value.trim();
  if (!username) return alert("Enter your name");
  currentUser = username;
  socket.emit("register-user", username);
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("chat-screen").classList.remove("hidden");
}

function sendMessage() {
  const input = document.getElementById("message-input");
  const text = input.value.trim();
  if (text) {
    socket.emit("send-message", { sender: currentUser, text });
    input.value = "";
  }
}

function handleKeyPress(e) { 
  if (e.key === "Enter") sendMessage(); 
}

async function sendFile() {
  const fileInput = document.getElementById("file-input");
  const file = fileInput.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch("/upload", { method: "POST", body: formData });
  const data = await res.json();

  if (data.fileUrl) {
    socket.emit("send-message", { sender: currentUser, fileUrl: data.fileUrl, fileType: data.type });
  }
  fileInput.value = "";
}

socket.on("receive-message", (data) => {
  const box = document.getElementById("messages-box");
  const msgDiv = document.createElement("div");
  msgDiv.className = `message ${data.sender === currentUser ? "sent" : "received"}`;
  
  let content = `<b>${data.sender}:</b><br>`;
  if (data.text) content += data.text;
  if (data.fileUrl) {
    if (data.fileType.startsWith("image/")) content += `<img src="${data.fileUrl}">`;
    else if (data.fileType.startsWith("video/")) content += `<video src="${data.fileUrl}" controls></video>`;
    else content += `<a href="${data.fileUrl}" target="_blank">Download File</a>`;
  }
  
  msgDiv.innerHTML = content;
  box.appendChild(msgDiv);
  box.scrollTop = box.scrollHeight;
});

// RTC Helper
function createPeerConnection() {
  peerConnection = new RTCPeerConnection(rtcConfig);

  peerConnection.ontrack = (event) => {
    const remoteVideo = document.getElementById("remote-video");
    if (remoteVideo) remoteVideo.srcObject = event.streams[0];
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("ice-candidate", { candidate: event.candidate });
    }
  };
}

async function startCall(type) {
  document.getElementById("video-area").classList.remove("hidden");
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: type === 'video', audio: true });
    document.getElementById("local-video").srcObject = localStream;

    createPeerConnection();
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit("call-user", { offer, from: currentUser });
  } catch (err) {
    alert("Camera/Microphone access failed or already in use.");
  }
}

socket.on("call-made", async (data) => {
  if (confirm(`${data.from} is calling you. Accept?`)) {
    document.getElementById("video-area").classList.remove("hidden");
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      document.getElementById("local-video").srcObject = localStream;

      createPeerConnection();
      localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      socket.emit("make-answer", { answer, to: data.from });
    } catch (err) {
      alert("Camera access failed.");
    }
  }
});

socket.on("answer-made", async (data) => {
  if (peerConnection) {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
  }
});

socket.on("ice-candidate", async (data) => {
  if (peerConnection && data.candidate) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (e) {}
  }
});

function endCall() {
  if (peerConnection) peerConnection.close();
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  document.getElementById("video-area").classList.add("hidden");
}