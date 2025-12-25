const socket = io();

const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const statusBadge = document.getElementById('status-badge');

// Buttons
const startBtn = document.getElementById('start-btn');
const nextBtn = document.getElementById('next-btn');
const stopBtn = document.getElementById('stop-btn');
const activeControls = document.getElementById('active-controls');

// Chat
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatBox = document.getElementById('chat-box');

let localStream;
let peerConnection;
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// 1. Media Handling
async function startMedia() {
    try {
        if (localStream) return; // Already running
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
    } catch (err) {
        console.error("Media Error:", err);
        addSystemMessage("Error: Could not access camera.");
    }
}

function stopMedia() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
}

// 2. Start / Stop / Next Logic
startBtn.addEventListener('click', async () => {
    await startMedia();
    socket.emit('find-match');
    updateUI('searching');
});

nextBtn.addEventListener('click', () => {
    resetConnection();
    clearChat();
    socket.emit('find-match');
    updateUI('searching');
});

stopBtn.addEventListener('click', () => {
    stopCall();
});

// 3. New Feature: Auto-Stop on Minimize
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === 'hidden') {
        // If user leaves the tab/minimizes browser
        if (localStream) {
            stopCall();
            addSystemMessage("Call ended (App minimized)");
        }
    }
});

function stopCall() {
    resetConnection(); // Close WebRTC
    stopMedia();       // Turn off camera light
    socket.emit('disconnect-manual'); // Optional signal to server
    updateUI('idle');
    statusBadge.innerText = "Idle";
    statusBadge.style.background = "#333";
}

function resetConnection() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
}

// 4. Chat Logic
chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const msg = chatInput.value.trim();
    if (msg) {
        addMessage(msg, 'local');
        socket.emit('send-message', msg);
        chatInput.value = '';
    }
});

socket.on('receive-message', (msg) => {
    addMessage(msg, 'remote');
});

function addMessage(text, type) {
    const div = document.createElement('div');
    div.classList.add('msg', type);
    div.innerText = text;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function addSystemMessage(text) {
    const div = document.createElement('div');
    div.classList.add('system-msg');
    div.innerText = text;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function clearChat() {
    chatBox.innerHTML = '<div class="system-msg">New stranger found. Say hi!</div>';
}

// 5. Socket Events
socket.on('waiting', (msg) => {
    statusBadge.innerText = "Searching...";
    statusBadge.style.background = "#e1b12c";
    addSystemMessage(msg);
});

socket.on('match-found', async ({ role }) => {
    statusBadge.innerText = "Connected";
    statusBadge.style.background = "#2ed573";
    updateUI('connected');
    addSystemMessage("Stranger connected!");

    createPeerConnection();
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    if (role === 'initiator') {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('offer', offer);
    }
});

socket.on('offer', async (offer) => {
    if (!peerConnection) createPeerConnection();
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('answer', answer);
});

socket.on('answer', async (answer) => {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on('ice-candidate', async (candidate) => {
    if (peerConnection) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
});

socket.on('peer-disconnected', () => {
    resetConnection();
    remoteVideo.srcObject = null;
    statusBadge.innerText = "Disconnected";
    statusBadge.style.background = "#ff4757";
    addSystemMessage("Stranger left. Click Next.");
});

function createPeerConnection() {
    if (peerConnection) return;
    peerConnection = new RTCPeerConnection(rtcConfig);
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) socket.emit('ice-candidate', event.candidate);
    };
    peerConnection.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
    };
}

// 6. UI Manager
function updateUI(state) {
    if (state === 'idle') {
        startBtn.classList.remove('hidden');
        activeControls.classList.add('hidden');
        chatForm.classList.add('hidden');
    } else if (state === 'searching') {
        startBtn.classList.add('hidden');
        activeControls.classList.add('hidden');
        chatForm.classList.add('hidden');
    } else if (state === 'connected') {
        startBtn.classList.add('hidden');
        activeControls.classList.remove('hidden'); // Show Stop/Next
        chatForm.classList.remove('hidden');
        chatInput.focus();
    }
}
