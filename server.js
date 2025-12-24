const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// State management
let waitingQueue = []; // Array of socket IDs waiting for a match
let activePeers = {};  // Map: socketId -> peerSocketId

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // User clicks "Start" or "Next"
    socket.on('find-match', () => {
        // If user is already in a call or queue, clean up first
        handleDisconnect(socket);

        if (waitingQueue.length > 0) {
            // Someone is waiting, pair them up!
            const partnerId = waitingQueue.shift();
            
            // Check if partner is still connected
            const partnerSocket = io.sockets.sockets.get(partnerId);
            
            if (partnerSocket) {
                // Store the relationship
                activePeers[socket.id] = partnerId;
                activePeers[partnerId] = socket.id;

                // Notify both users. We designate 'socket' as the initiator (caller)
                socket.emit('match-found', { role: 'initiator', partnerId });
                partnerSocket.emit('match-found', { role: 'receiver', partnerId: socket.id });
                
                console.log(`Matched ${socket.id} with ${partnerId}`);
            } else {
                // Partner disconnected while in queue, retry
                waitingQueue.push(socket.id);
            }
        } else {
            // No one waiting, add to queue
            waitingQueue.push(socket.id);
            socket.emit('waiting', 'Searching for a partner...');
        }
    });

    // WebRTC Signaling: Relay Offer
    socket.on('offer', (payload) => {
        const partnerId = activePeers[socket.id];
        if (partnerId) {
            io.to(partnerId).emit('offer', payload);
        }
    });

    // WebRTC Signaling: Relay Answer
    socket.on('answer', (payload) => {
        const partnerId = activePeers[socket.id];
        if (partnerId) {
            io.to(partnerId).emit('answer', payload);
        }
    });

    // WebRTC Signaling: Relay ICE Candidate
    socket.on('ice-candidate', (payload) => {
        const partnerId = activePeers[socket.id];
        if (partnerId) {
            io.to(partnerId).emit('ice-candidate', payload);
        }
    });

    // Handle user disconnect (tab close or network loss)
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        handleDisconnect(socket);
    });

    function handleDisconnect(socket) {
        // Remove from waiting queue if present
        waitingQueue = waitingQueue.filter(id => id !== socket.id);

        // If in an active call, notify partner
        const partnerId = activePeers[socket.id];
        if (partnerId) {
            const partnerSocket = io.sockets.sockets.get(partnerId);
            if (partnerSocket) {
                partnerSocket.emit('peer-disconnected');
            }
            delete activePeers[partnerId];
            delete activePeers[socket.id];
        }
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});