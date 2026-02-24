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

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Room Management
const rooms = new Map();

function getRoom(id) {
    return rooms.get(id);
}

io.on('connection', (socket) => {
    let currentRoomId = null;

    socket.on('join_room', ({ roomId, username, config }) => {
        try {
            if (!roomId || !username) {
                socket.emit('error_message', 'Invalid Room ID or Username');
                return;
            }

            let room = getRoom(roomId);

            if (!room) {
                console.log(`Creating new room: ${roomId}`);
                // Create new room with config if provided
                room = new Room(roomId, io, config);
                rooms.set(roomId, room);
            }

            const joined = room.addPlayer(socket, username);
            if (joined) {
                currentRoomId = roomId;
                console.log(`User ${username} joined ${roomId}`);
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
        if (room) {
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
        if (room) {
            room.processGuess(socket.id, msg);
        }
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
