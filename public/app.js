const socket = io();

// Element References
const loginScreen = document.getElementById('login-screen');
const gameScreen = document.getElementById('game-screen');
const usernameInput = document.getElementById('username');

// Tabs
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

// Join
const roomInput = document.getElementById('room-input');
const joinBtn = document.getElementById('join-btn');

// Create
const createBtn = document.getElementById('create-btn');
const configMaxPlayers = document.getElementById('config-max-players');
const configRoundTime = document.getElementById('config-round-time');
const configRounds = document.getElementById('config-rounds');
const configWords = document.getElementById('config-words');

const canvas = document.getElementById('drawing-board');
const ctx = canvas.getContext('2d');
const toolbox = document.getElementById('toolbox');
const colorSwatches = document.querySelectorAll('.color-swatch');
const brushSizes = document.querySelectorAll('.brush-size');
const clearBtn = document.getElementById('clear-btn');

const playerList = document.getElementById('player-list');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const timeDisplay = document.getElementById('time-display');
const wordDisplay = document.getElementById('word-display');
const roundDisplay = document.getElementById('round-display');
const roomDisplay = document.getElementById('room-display');
const overlayMessage = document.getElementById('overlay-message');
const overlayText = document.getElementById('overlay-text');
const wordChoicesContainer = document.getElementById('word-choices');
const startGameBtn = document.getElementById('start-game-btn');

const pencilBtn = document.getElementById("pencil-btn");
const bucketBtn = document.getElementById("bucket-btn");
const eraserBtn = document.getElementById("eraser-btn");

pencilBtn.onclick = () => {
    currentTool = "pencil";
    setActiveTool(pencilBtn);
};

bucketBtn.onclick = () => {
    currentTool = "bucket";
    setActiveTool(bucketBtn);
};

eraserBtn.onclick = () => {
    currentTool = "eraser";
    setActiveTool(eraserBtn);
};

function setActiveTool(activeBtn) {
    document.querySelectorAll(".tool-btn").forEach(btn => {
        btn.classList.remove("active");
    });
    activeBtn.classList.add("active");
}



// Game State
let isDrawer = false;
let isDrawing = false;
let currentColor = '#000000';
let currentSize = 5;
let myId = null;
let currentTool = "pencil";  // default

// --- Tab Logic ---
tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        // Remove active class
        tabBtns.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));

        // Add active class
        btn.classList.add('active');
        document.getElementById(`${btn.dataset.tab}-tab`).classList.add('active');
    });
});

// --- Auth Logic ---

createBtn.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (!username) return alert('Please enter a username');

    const config = {
        maxPlayers: parseInt(configMaxPlayers.value),
        roundTime: parseInt(configRoundTime.value),
        totalRounds: parseInt(configRounds.value),
        customWords: configWords.value,
        // allowedColors: ... (Not implementing UI for this yet as per plan, server has default)
    };

    const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
    joinGame(roomId, username, config);
});

joinBtn.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    const roomId = roomInput.value.trim().toUpperCase();
    if (!username || !roomId) return alert('Please enter username and room ID');
    joinGame(roomId, username, null);
});

let currentRoomId = null;

function joinGame(roomId, username, config) {
    currentRoomId = roomId;
    socket.emit('join_room', { roomId, username, config });

    // Optimistic UI update, usually we wait for 'joined' ack but this is fine
    // On error socket will send 'error_message'
}

socket.on('error_message', (msg) => {
    alert(msg);
    currentRoomId = null;
});

// Used to switch screen only on successful join implied by player_update/room state
let joinedRoom = false;

// --- Game Logic ---

startGameBtn.addEventListener('click', () => {
    socket.emit('start_game');
    startGameBtn.classList.add('hidden');
});

// Canvas Drawing Logic
function startPosition(e) {
    if (!isDrawer) return;

    const { x, y } = getPos(e);

    // 🪣 BUCKET TOOL
    if (currentTool === "bucket") {
        bucketFill(x, y, currentColor);
        socket.emit('draw_event', { type: 'bucket', x, y, color: currentColor });
        return;
    }

    // ✏️ PENCIL TOOL
    isDrawing = true;

    ctx.beginPath();
    ctx.moveTo(x, y);

    if (currentTool === "eraser") {
        ctx.globalCompositeOperation = "destination-out";
    } else {
        ctx.globalCompositeOperation = "source-over";
    }

    socket.emit('draw_event', { type: 'start', x, y, color: currentColor, size: currentSize, tool: currentTool });
}

function stopPosition() {
    if (!isDrawing) return;
    isDrawing = false;
    ctx.beginPath(); // Reset path locally

    // Emit END
    if (isDrawer) {
        socket.emit('draw_event', { type: 'end' });
    }
}

function draw(e) {
    if (!isDrawing || !isDrawer) return;

    const { x, y } = getPos(e);

    // Local draw
    ctx.lineWidth = currentSize;
    ctx.lineCap = 'round';
    ctx.strokeStyle = currentColor;

    ctx.lineTo(x, y);
    ctx.stroke();

    // Emit LINE (Throttled)
    throttleEmit('line', x, y);
}

function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    if (e.touches) {
        return {
            x: e.touches[0].clientX - rect.left,
            y: e.touches[0].clientY - rect.top
        };
    }
    return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
}

// 🪣 Bucket Fill Logic
function bucketFill(startX, startY, fillColor) {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    const width = canvas.width;
    const height = canvas.height;

    const stack = [[Math.floor(startX), Math.floor(startY)]];
    const startPos = (Math.floor(startY) * width + Math.floor(startX)) * 4;

    const targetColor = [
        data[startPos],
        data[startPos + 1],
        data[startPos + 2],
        data[startPos + 3]
    ];

    const fillRGBA = hexToRgba(fillColor);

    if (colorsMatch(targetColor, fillRGBA)) return;

    while (stack.length) {
        const [x, y] = stack.pop();
        const pos = (y * width + x) * 4;

        const currentColor = [
            data[pos],
            data[pos + 1],
            data[pos + 2],
            data[pos + 3]
        ];

        if (!colorsMatch(currentColor, targetColor)) continue;

        data[pos] = fillRGBA[0];
        data[pos + 1] = fillRGBA[1];
        data[pos + 2] = fillRGBA[2];
        data[pos + 3] = 255;

        if (x > 0) stack.push([x - 1, y]);
        if (x < width - 1) stack.push([x + 1, y]);
        if (y > 0) stack.push([x, y - 1]);
        if (y < height - 1) stack.push([x, y + 1]);
    }

    ctx.putImageData(imageData, 0, 0);
}

function hexToRgba(hex) {
    const bigint = parseInt(hex.slice(1), 16);
    return [
        (bigint >> 16) & 255,
        (bigint >> 8) & 255,
        bigint & 255,
        255
    ];
}

function colorsMatch(a, b) {
    return a[0] === b[0] &&
           a[1] === b[1] &&
           a[2] === b[2] &&
           a[3] === b[3];
}

// Throttling
let lastEmit = 0;
function throttleEmit(type, x, y) {
    const now = Date.now();
    if (now - lastEmit > 20) {
        socket.emit('draw_event', { type, x, y });
        lastEmit = now;
    }
}

canvas.addEventListener('mousedown', startPosition);
canvas.addEventListener('mouseup', stopPosition);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseleave', stopPosition);

canvas.addEventListener('touchstart', startPosition);
canvas.addEventListener('touchend', stopPosition);
canvas.addEventListener('touchmove', draw);


// Tools
colorSwatches.forEach(swatch => {
    swatch.addEventListener('click', () => {
        document.querySelector('.color-swatch.active').classList.remove('active');
        swatch.classList.add('active');
        currentColor = swatch.dataset.color;
    });
});

brushSizes.forEach(size => {
    size.addEventListener('click', () => {
        document.querySelector('.brush-size.active').classList.remove('active');
        size.classList.add('active');
        currentSize = parseInt(size.dataset.size);
    });
});

clearBtn.addEventListener('click', () => {
    if (!isDrawer) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    socket.emit('clear_canvas');
});

// Chat
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const msg = chatInput.value.trim();
        if (msg) {
            socket.emit('chat_message', msg);
            chatInput.value = '';
        }
    }
});

// --- Socket Events ---

socket.on('player_update', (players) => {
    if (!joinedRoom) {
        joinedRoom = true;
        loginScreen.classList.remove('active');
        gameScreen.classList.add('active');
        roomDisplay.innerText = currentRoomId || '---';
    }

    playerList.innerHTML = '';
    const isHost = players.length > 0 && players[0].id === socket.id;

    if (isHost && players.length >= 2) {
        startGameBtn.classList.remove('hidden');
    } else {
        startGameBtn.classList.add('hidden');
    }

    players.forEach(p => {
        const div = document.createElement('div');
        div.className = `player-item ${p.isDrawer ? 'drawer' : ''} ${p.hasGuessed ? 'correct' : ''}`;
        div.innerHTML = `
            <span>${p.name} ${p.isDrawer ? '✏️' : ''}</span>
            <span>pts: ${p.score}</span>
        `;
        playerList.appendChild(div);

        if (p.id === socket.id) {
            myId = p.id;
        }
    });
});

socket.on('draw_event', (data) => {
    if (isDrawer) return;

    if (data.type === 'start') {
        ctx.beginPath();
        ctx.lineCap = 'round';
        ctx.lineWidth = data.size;

        if (data.tool === "eraser") {
            ctx.globalCompositeOperation = "destination-out";
        } else {
            ctx.globalCompositeOperation = "source-over";
            ctx.strokeStyle = data.color;
        }

        ctx.moveTo(data.x, data.y);

    } else if (data.type === 'line') {
        ctx.lineTo(data.x, data.y);
        ctx.stroke();

    } else if (data.type === 'end') {
        ctx.beginPath();
        ctx.globalCompositeOperation = "source-over";

    } else if (data.type === 'bucket') {
        bucketFill(data.x, data.y, data.color);
    }
});

socket.on('drawing_history', (strokes) => {
    // Replay complete history
    ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear first

    strokes.forEach(stroke => {
        ctx.beginPath();
        ctx.lineCap = 'round';
        ctx.lineWidth = stroke.size;
        ctx.strokeStyle = stroke.color;

        if (stroke.points && stroke.points.length > 0) {
            ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
            for (let i = 1; i < stroke.points.length; i++) {
                ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
            }
            ctx.stroke();
        }
    });
    ctx.beginPath(); // Reset
});

socket.on('clear_canvas', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
});

socket.on('game_state_update', (state) => {
    // Handle state transitions
    if (state.state === 'choosing') {
        overlayMessage.classList.remove('hidden');
        overlayText.innerText = state.drawer === myId ? 'Choose a word!' : 'Drawer is choosing a word...';
        // Clear old game over button if present
        const oldBtn = document.getElementById('restart-btn');
        if (oldBtn) oldBtn.remove();

        wordChoicesContainer.innerHTML = '';
        isDrawer = state.drawer === myId;

        if (isDrawer) {
            toolbox.style.display = 'flex';
        } else {
            toolbox.style.display = 'none';
        }
    } else if (state.state === 'drawing') {
        overlayMessage.classList.add('hidden');
        wordChoicesContainer.classList.add('hidden');
        if (state.word) wordDisplay.innerText = state.word;
    } else if (state.state === 'waiting') {
        overlayMessage.classList.add('hidden');
        wordDisplay.innerText = 'WAITING FOR PLAYERS...';
        startGameBtn.classList.remove('hidden');
    } else if (state.state === 'round_end') {
        overlayMessage.classList.remove('hidden');
        overlayText.innerText = `Round Over! The word was: ${state.word}`;
        wordChoicesContainer.innerHTML = '';
        ctx.beginPath();
        isDrawing = false;
    } else if (state.state === 'game_end') {
        overlayMessage.classList.remove('hidden');
        wordChoicesContainer.innerHTML = '';
        ctx.beginPath();
        isDrawing = false;

        if (state.leaderboard) {
            let html = '<h2>Game Over!</h2><ul class="leaderboard">';
            state.leaderboard.forEach(p => {
                html += `<li><span>${p.name}</span> <span>${p.score} pts</span></li>`;
            });
            html += '</ul>';
            overlayText.innerHTML = html;

            // Re-add restart button availability (client side check for now)
            // Ideally we check if WE are the host which is players[0]
            // We can get players from playerList elements or just assume if we see the button it's valid
            // But we need to add the button again since we overwrote innerHTML

            const restartBtn = document.createElement('button');
            restartBtn.id = 'restart-btn';
            restartBtn.className = 'btn primary';
            restartBtn.innerText = 'Play Again (Host Only)';
            restartBtn.onclick = () => {
                socket.emit('restart_game');
            };
            overlayText.appendChild(restartBtn);

        } else {
            overlayText.innerText = 'Game Over! Calculating scores...';
        }
    }

    if (state.round) {
        if (state.totalRounds && state.round > state.totalRounds) {
            roundDisplay.innerText = `Round: ${state.totalRounds}/${state.totalRounds}`;
        } else if (state.totalRounds) {
            roundDisplay.innerText = `Round: ${state.round}/${state.totalRounds}`;
        } else {
            roundDisplay.innerText = state.round;
        }
    }
});

socket.on('word_choices', (words) => {
    wordChoicesContainer.innerHTML = '';
    wordChoicesContainer.classList.remove('hidden');
    words.forEach(word => {
        const btn = document.createElement('div');
        btn.className = 'word-choice';
        btn.innerText = word;
        btn.onclick = () => {
            socket.emit('select_word', word);
            overlayMessage.classList.add('hidden');
        };
        wordChoicesContainer.appendChild(btn);
    });
});

socket.on('timer_update', (time) => {
    timeDisplay.innerText = time;
});

socket.on('chat_message', (msg) => {
    const div = document.createElement('div');
    if (msg.system) {
        div.className = 'message system';
        div.innerText = msg.text;
    } else {
        div.className = 'message chat';
        div.innerHTML = `<strong>${msg.name}:</strong> ${msg.text}`;
    }
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
});

socket.on('game_restarted', () => {
    overlayMessage.classList.add('hidden');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
});

socket.on('game_over', (data) => {
    overlayMessage.classList.remove('hidden');
    const leaderboard = data.players;

    let html = `<h2>🏁 Final Results</h2>`;

    // Top 3 podium
    if (leaderboard.length > 0) {
        html += `<div class="podium gold">🥇 ${leaderboard[0].name} - ${leaderboard[0].score} pts</div>`;
    }
    if (leaderboard.length > 1) {
        html += `<div class="podium silver">🥈 ${leaderboard[1].name} - ${leaderboard[1].score} pts</div>`;
    }
    if (leaderboard.length > 2) {
        html += `<div class="podium bronze">🥉 ${leaderboard[2].name} - ${leaderboard[2].score} pts</div>`;
    }

    html += `<h3>Full Leaderboard</h3><ul class="leaderboard">`;

    leaderboard.forEach(p => {
        html += `<li><span>${p.name}</span> <span>${p.score} pts</span></li>`;
    });

    html += `</ul>`;

    overlayText.innerHTML = html;

    // Restart button INSIDE
    const restartBtn = document.createElement('button');
    restartBtn.id = 'restart-btn';
    restartBtn.className = 'btn primary';
    restartBtn.innerText = 'Play Again (Host Only)';
    restartBtn.onclick = () => {
        socket.emit('restart_game');
    };

    overlayText.appendChild(restartBtn);
});