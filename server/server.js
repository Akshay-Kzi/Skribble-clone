const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const Room = require('./game/Room');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

function sanitizeUsername(username) {
    return String(username || '')
        .replace(/[\r\n\t]/g, ' ')
        .trim()
        .slice(0, 15);
}

function sanitizeRoomId(roomId) {
    const id = String(roomId || '').trim().toUpperCase();
    // Keep it simple: A-Z/0-9, 3-10 chars
    if (!/^[A-Z0-9]{3,10}$/.test(id)) return null;
    return id;
}

function isValidDrawingPayload(data) {
    if (!data || typeof data !== 'object') return false;
    if (typeof data.type !== 'string') return false;
    const allowed = new Set(['start', 'line', 'end', 'bucket', 'clear']);
    if (!allowed.has(data.type)) return false;

    if (data.type === 'start' || data.type === 'line' || data.type === 'bucket') {
        if (typeof data.x !== 'number' || !Number.isFinite(data.x)) return false;
        if (typeof data.y !== 'number' || !Number.isFinite(data.y)) return false;
    }

    if (data.type === 'start') {
        if (typeof data.size !== 'number' || !Number.isFinite(data.size)) return false;
        // Allow reasonable brush sizes only
        if (data.size < 1 || data.size > 50) return false;
        if (typeof data.color !== 'string') return false;
        if (data.tool && typeof data.tool !== 'string') return false;
    }

    if (data.type === 'bucket') {
        if (typeof data.color !== 'string') return false;
    }

    return true;
}

function createFixedWindowLimiter({ windowMs, max }) {
    let windowStart = Date.now();
    let count = 0;
    return () => {
        const now = Date.now();
        if (now - windowStart >= windowMs) {
            windowStart = now;
            count = 0;
        }
        count++;
        return count <= max;
    };
}

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Room Management
const rooms = new Map();

function getRoom(id) {
    return rooms.get(id);
}

io.on('connection', (socket) => {
    let currentRoomId = null;

    // Lightweight per-socket rate limiting (prevents obvious spam / lag attacks)
    const allowDrawEvent = createFixedWindowLimiter({ windowMs: 1000, max: 500 });
    const allowChatMessage = createFixedWindowLimiter({ windowMs: 2000, max: 6 });

    socket.on('join_room', ({ roomId, username, config }) => {
        try {
            const safeRoomId = sanitizeRoomId(roomId);
            const safeUsername = sanitizeUsername(username);

            if (!safeRoomId || !safeUsername) {
                socket.emit('error_message', 'Invalid Room ID or Username');
                return;
            }

            let room = getRoom(safeRoomId);

            if (!room) {
                console.log(`Creating new room: ${safeRoomId}`);
                // Create new room with config if provided
                room = new Room(safeRoomId, io, config);
                rooms.set(safeRoomId, room);
            }

            const joined = room.addPlayer(socket, safeUsername);
            if (joined) {
                currentRoomId = safeRoomId;
                console.log(`User ${safeUsername} joined ${safeRoomId}`);
            }
        } catch (err) {
            console.error('Error in join_room:', err);
            socket.emit('error_message', 'Internal Server Error');
        }
    });

    socket.on('start_game', () => {
        try {
            if (!currentRoomId) return;
            const room = getRoom(currentRoomId);
            // host check is done inside startGame ideally mostly dependent on logic, 
            // but here we just call it. Room logic checks player count.
            // We really should check if sender is host (index 0).
            if (room && room.players[0]?.id === socket.id) {
                room.startGame();
            }
        } catch (err) { console.error('Error in start_game:', err); }
    });

    socket.on('restart_game', () => {
        if (!currentRoomId) return;
        const room = getRoom(currentRoomId);
        if (room) {
            room.handleRestart(socket.id);
        }
    });

    socket.on('select_word', (word) => {
        if (!currentRoomId) return;
        const room = getRoom(currentRoomId);
        if (room && room.isDrawer(socket.id)) {
            room.selectWord(word);
        }
    });

    socket.on('draw_event', (data) => {
        if (!currentRoomId) return;
        const room = getRoom(currentRoomId);
        if (!room) return;
        if (!allowDrawEvent()) return;
        if (!isValidDrawingPayload(data)) return;

        {
            room.handleDrawingEvent(socket.id, data);
        }
    });

    socket.on('undo', () => {
        if (!currentRoomId) return;
        const room = getRoom(currentRoomId);
        if (!room) return;
        if (!room.isDrawer(socket.id)) return;
        room.handleUndo();
    });

    socket.on('redo', () => {
        if (!currentRoomId) return;
        const room = getRoom(currentRoomId);
        if (!room) return;
        if (!room.isDrawer(socket.id)) return;
        room.handleRedo();
    });

     socket.on('canvas_state_update', (data) => {
         if (!currentRoomId) return;
         const room = getRoom(currentRoomId);
         if (!room) return;
         if (!room.isDrawer(socket.id)) return;
         if (!data || !data.buffer || !data.width || !data.height) return;

         // Normalize to Buffer so socket.io treats it as binary across all clients.
         const buf = Buffer.isBuffer(data.buffer)
             ? data.buffer
             : Buffer.from(new Uint8Array(data.buffer));

         io.to(currentRoomId).emit('canvas_state_update', {
             buffer: buf,
             width: data.width,
             height: data.height,
             historyStep: data.historyStep,
         });
     });

    socket.on('clear_canvas', () => {
        if (!currentRoomId) return;
        const room = getRoom(currentRoomId);
        // Only drawer
        if (room && room.isDrawer(socket.id) && room.state === 'drawing') {
            room.strokes = [];
            room.redoStrokes = [];
            io.to(currentRoomId).emit('clear_canvas');
            io.to(currentRoomId).emit('drawing_history', []);
        }
    });

    socket.on('chat_message', (msg) => {
        if (!currentRoomId) return;
        const room = getRoom(currentRoomId);
        if (!room) return;
        if (!allowChatMessage()) return;

        const text = String(msg || '').replace(/[\r\n]/g, ' ').trim();
        if (!text) return;
        if (text.length > 120) return;

        room.processGuess(socket.id, text);
    });

    socket.on('disconnect', () => {
        if (currentRoomId) {
            const room = getRoom(currentRoomId);
            if (room) {
                room.removePlayer(socket.id);
                if (room.usersCount() === 0) {
                    rooms.delete(currentRoomId);
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
