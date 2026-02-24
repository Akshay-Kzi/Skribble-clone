const { getRandomWords, isValidWord } = require('../words');
const RoomConfig = require('./RoomConfig');

// Game States
const STATE_WAITING = 'waiting';
const STATE_CHOOSING = 'choosing'; // Word selection
const STATE_DRAWING = 'drawing';
const STATE_ROUND_END = 'round_end';
const STATE_GAME_END = 'game_end';

class Room {
    constructor(id, io, configData = {}) {
        this.id = id;
        this.io = io;
        this.config = new RoomConfig(configData);

        this.players = []; // Array of player objects
        this.state = STATE_WAITING;

        // Game Progress
        this.round = 1;
        this.currentDrawerIndex = 0;
        this.currentWord = null;
        this.wordChoices = [];
        this.correctGuessers = new Set();

        // Drawing Data - Structured Storage
        // Array of strokes: { type: 'path', color, size, points: [{x,y}, ...] }
        this.strokes = [];
        this.redoStrokes = [];

        // Timer
        this.timer = null;
        this.timeLeft = 0;

        // Hint System
        this.hints = []; // Indices of revealed letters
        this.hintInterval = null;
    }

    handleUndo() {
        if (this.strokes.length === 0) return;
        const last = this.strokes.pop();
        this.redoStrokes.push(last);
        this.io.to(this.id).emit('drawing_history', this.strokes);
    }

    handleRedo() {
        if (this.redoStrokes.length === 0) return;
        const stroke = this.redoStrokes.pop();
        this.strokes.push(stroke);
        this.io.to(this.id).emit('drawing_history', this.strokes);
    }

    // --- Player Management ---

    addPlayer(socket, name) {
        if (this.players.length >= this.config.maxPlayers) {
            socket.emit('error_message', 'Room is full');
            return false;
        }

        const player = {
            id: socket.id,
            name: name.slice(0, 15), // Enforce name limit
            score: 0,
            socket: socket
        };

        this.players.push(player);
        socket.join(this.id);

        this.broadcastPlayerUpdate();

        // Sync state to new player
        this.syncState(socket);

        return true;
    }

    removePlayer(socketId) {
        const index = this.players.findIndex(p => p.id === socketId);
        if (index === -1) return;

        const wasDrawer = (index === this.currentDrawerIndex);
        this.players.splice(index, 1);

        // Adjust drawer index
        if (index < this.currentDrawerIndex) {
            this.currentDrawerIndex--;
        }

        this.broadcastPlayerUpdate();

        // Handle specific state interruptions
        if (this.players.length < 2 && this.state !== STATE_WAITING) {
            this.resetGame("Not enough players to continue.");
        } else if (wasDrawer && this.state === STATE_DRAWING) {
            this.broadcastSystemMessage('Drawer left! Ending turn.');
            this.endTurn();
        } else if (wasDrawer && this.state === STATE_CHOOSING) {
            this.broadcastSystemMessage('Drawer left! Skipping turn.');
            this.endTurn(); // Will move to next drawer
        }
    }

    // --- State Management ---

    transitionTo(newState) {
        console.log(`Room ${this.id}: ${this.state} -> ${newState}`);
        this.state = newState;

        // Clear specialized intervals
        if (this.hintInterval) clearInterval(this.hintInterval);
        this.hintInterval = null;

        this.broadcastStateUpdate();
    }

    startGame() {
        if (this.players.length < 2) return;
        this.round = 1;
        this.currentDrawerIndex = 0;
        this.triggerRoundStart();
    }

    triggerRoundStart() {
        // Prepare for turn
        if (this.currentDrawerIndex >= this.players.length) {
            this.currentDrawerIndex = 0;
            this.round++;
        }

        if (this.round > this.config.totalRounds) {
            this.endGame();
            return;
        }

        this.startTurn();
    }

    startTurn() {
        this.currentWord = null;
        this.strokes = []; // Clear canvas server-side
        this.redoStrokes = [];
        this.correctGuessers.clear();
        this.hints = [];

        // Verify drawer still exists (edge case)
        if (!this.players[this.currentDrawerIndex]) {
            this.currentDrawerIndex = 0; // Wrap around safely
        }

        // Generate words
        const count = 3;
        if (this.config.customWords.length > 0) {
            const source = this.config.customWords.length >= 3 ? this.config.customWords : this.config.customWords.concat(getRandomWords(3));
            this.wordChoices = source.sort(() => 0.5 - Math.random()).slice(0, 3);
        } else {
            this.wordChoices = getRandomWords(3);
        }

        this.transitionTo(STATE_CHOOSING);

        const drawer = this.players[this.currentDrawerIndex];

        // Notify drawer
        drawer.socket.emit('word_choices', this.wordChoices);

        // Start decision timer
        this.startTimer(15, () => {
            if (this.state === STATE_CHOOSING) {
                // Auto-select random
                this.selectWord(this.wordChoices[0]);
            }
        });
    }

    selectWord(word) {
        if (!this.wordChoices.includes(word)) return; // Validation

        this.currentWord = word;
        this.transitionTo(STATE_DRAWING);

        // Signal clients to clear canvas
        this.io.to(this.id).emit('clear_canvas');

        // Start Hint System
        this.setupHintSystem();

        this.startTimer(this.config.roundTime, () => this.endTurn());
    }

    endTurn() {
    console.log("Ending turn...");
    this.stopTimer();
    this.transitionTo(STATE_ROUND_END);

    this.io.to(this.id).emit('round_end', { word: this.currentWord });

    setTimeout(() => {
        console.log("Starting next turn...");
        console.log("Drawer index before:", this.currentDrawerIndex);
        console.log("Players length:", this.players.length);

        if (this.usersCount() === 0) return;

        this.currentDrawerIndex++;
        this.triggerRoundStart();
    }, 5000);
}

    endGame() {
        console.log(`Room ${this.id}: Ending Game.`);
        this.stopTimer();
        this.transitionTo(STATE_GAME_END);

        // Send final scores
        try {
            const sorted = [...this.players]
                .sort((a, b) => b.score - a.score)
                .map(p => ({
                    id: p.id,
                    name: p.name,
                    score: p.score
                }));

        this.io.to(this.id).emit('game_over', { players: sorted });
            console.log(`Room ${this.id}: Sent game_over event.`);
        } catch (err) {
            console.error(`Room ${this.id}: Error in endGame:`, err);
        }
    }

    handleRestart(socketId) {
        console.log(`Room ${this.id}: Restart requested by ${socketId}`);
        // Validation: Must be host (index 0)
        if (!this.players[0]) {
            console.error(`Room ${this.id}: No players found for restart.`);
            return;
        }

        if (this.players[0].id !== socketId) {
            console.log(`Room ${this.id}: Restart denied. ${socketId} is not host.`);
            return;
        }

        if (this.state !== STATE_GAME_END) {
            console.log(`Room ${this.id}: Restart received in invalid state ${this.state}`);
            // return; // Allow restart from any state? No, strict.
            // Actually during dev, maybe loose? No, strict.
            return;
        }

        // Reset Game Data
        this.round = 1;
        this.currentDrawerIndex = 0;
        this.players.forEach(p => p.score = 0);
        this.strokes = [];
        this.redoStrokes = [];
        this.correctGuessers.clear();
        this.hints = [];
        this.wordChoices = [];
        this.currentWord = null;

        this.broadcastPlayerUpdate();
        this.io.to(this.id).emit('game_restarted');
        console.log(`Room ${this.id}: Game restarted.`);

        this.triggerRoundStart();
    }

    resetGame(reason = "Game reset") {
        this.stopTimer();
        this.state = STATE_WAITING;
        if (this.hintInterval) clearInterval(this.hintInterval);
        this.hintInterval = null;

        this.players.forEach(p => p.score = 0);
        this.round = 1;
        this.currentDrawerIndex = 0;
        this.strokes = [];
        this.redoStrokes = [];
        this.hints = [];

        this.broadcastPlayerUpdate();
        this.broadcastStateUpdate();

        if (reason) {
            this.broadcastSystemMessage(reason);
        }
    }

    // --- Logic & Helpers ---

    processGuess(socketId, text) {
        if (this.state !== STATE_DRAWING) return;

        const player = this.players.find(p => p.id === socketId);
        if (!player) return;

        if (this.isDrawer(socketId)) return;
        if (this.correctGuessers.has(socketId)) return; // Already guessed

        if (text.trim().toLowerCase() === this.currentWord.toLowerCase()) {
            // Correct Guess
            this.correctGuessers.add(socketId);

            // Scoring
            const baseScore = 100;
            const decay = (this.correctGuessers.size - 1) * 10;
            const points = Math.max(10, baseScore - decay);

            player.score += points;

            // Drawer points (fraction of success)
            const drawer = this.players[this.currentDrawerIndex];
            drawer.score += 20; // Simplified drawer scoring

            this.broadcastSystemMessage(`${player.name} guessed the word!`);
            player.socket.emit('system_message', `You guessed it! (+${points})`);

            this.broadcastPlayerUpdate();

            // Check if everyone guessed
            // Total players - 1 (drawer)
            if (this.correctGuessers.size >= this.players.length - 1) {
                this.endTurn();
            }

        } else {
            // Just chat
            this.io.to(this.id).emit('chat_message', { name: player.name, text: text });
        }
    }

    handleDrawingEvent(socketId, data) {
        if (this.state !== STATE_DRAWING) return;
        if (!this.isDrawer(socketId)) return;

        // Any new drawing action invalidates redo history
        if (data && (data.type === 'start' || data.type === 'bucket' || data.type === 'clear')) {
            this.redoStrokes = [];
        }

        // Validate color
        if (data.color && !this.config.isValidColor(data.color)) {
            // Silently correct or ignore? Let's ignore or default.
            // data.color = '#000000'; 
        }

        // Store stroke for history
        // Data format expected: 
        // START: { type: 'start', x, y, color, size }
        // DRAW:  { type: 'line', x, y }
        // END:   { type: 'end' }

        // We want to store entire strokes as objects for restartability
        // But we receive events. 
        // So we append to a "current stroke" or list of events.
        // Let's store events linearly for simplicity of replay, 
        // OR reconstruct strokes. The prompt asked for "Strokes are stored as structured stroke objects".

        if (data.type === 'start') {
            this.currentStroke = {
                type: 'path',
                color: data.color,
                size: data.size,
                tool: data.tool || 'pencil',
                points: [{ x: data.x, y: data.y }]
            };
            this.strokes.push(this.currentStroke);
        } else if (data.type === 'line' && this.currentStroke) {
            this.currentStroke.points.push({ x: data.x, y: data.y });
        } else if (data.type === 'end') {
            this.currentStroke = null;
        } else if (data.type === 'bucket') {
            this.strokes.push({
                type: 'bucket',
                x: data.x,
                y: data.y,
                color: data.color,
            });
        } else if (data.type === 'clear') {
            this.strokes = [];
            this.redoStrokes = [];
            this.currentStroke = null;
        }

        // Broadcast to others
        this.players.forEach(p => {
            if (p.id !== socketId) {
                p.socket.emit('draw_event', data);
            }
        });
    }

    setupHintSystem() {
        if (this.config.hintLetterCount <= 0) return;

        const wordLength = this.currentWord.length;
        const revealIndices = Array.from({ length: wordLength }, (_, i) => i)
            .filter(i => this.currentWord[i] !== ' ') // Don't hint spaces
            .sort(() => 0.5 - Math.random());

        let hintsGiven = 0;
        const totalHints = Math.min(this.config.hintLetterCount, wordLength - 1); // Keep at least 1 hidden
        const intervalTime = Math.floor((this.config.roundTime * 1000) / (totalHints + 1));

        // First hint at 50% or distributed? Prompt said "At fixed intervals"
        // Let's do distributed.

        this.hintInterval = setInterval(() => {
            if (hintsGiven >= totalHints) {
                clearInterval(this.hintInterval);
                return;
            }

            const index = revealIndices.pop();
            this.hints.push(index);
            hintsGiven++;

            this.broadcastStateUpdate(); // Will re-send masked word with new hints

        }, intervalTime);
    }

    getMaskedWord() {
        if (!this.currentWord) return null;
        return this.currentWord.split('').map((char, i) => {
            if (char === ' ') return ' '; // Space is always space
            if (this.hints.includes(i)) return char; // Revealed
            return '_';
        }).join('');
    }

    // --- Utilities ---

    broadcastStateUpdate() {
        // We customize the update for each player (drawer sees word, others see mask)
        const drawerId = this.players[this.currentDrawerIndex]?.id;

        const baseState = {
            state: this.state,
            round: this.round,
            totalRounds: this.config.totalRounds,
            timeLeft: this.state === 'waiting' ? 0 : this.timeLeft,
            drawer: drawerId,
        };

        if (this.state === STATE_GAME_END) {
            baseState.leaderboard = [...this.players]
                .sort((a, b) => b.score - a.score)
                .map(p => ({
                    id: p.id,
                    name: p.name,
                    score: p.score
                }));
        }

        this.players.forEach(p => {
            const isDrawer = p.id === drawerId;
            const update = { ...baseState };

            if (this.state === STATE_DRAWING) {
                update.word = isDrawer ? this.currentWord : this.getMaskedWord();
            } else if (this.state === STATE_ROUND_END) {
                update.word = this.currentWord;
            }

            p.socket.emit('game_state_update', update);
        });
    }

    broadcastPlayerUpdate() {
        const list = this.players.map(p => ({
            id: p.id,
            name: p.name,
            score: p.score,
            isDrawer: (this.players.indexOf(p) === this.currentDrawerIndex),
            hasGuessed: this.correctGuessers.has(p.id)
        }));
        this.io.to(this.id).emit('player_update', list);
    }

    broadcastSystemMessage(text) {
        this.io.to(this.id).emit('chat_message', { system: true, text });
    }

    syncState(socket) {
        // Send players
        const list = this.players.map(p => ({
            id: p.id,
            name: p.name,
            score: p.score,
            isDrawer: (this.players.indexOf(p) === this.currentDrawerIndex),
            hasGuessed: this.correctGuessers.has(p.id)
        }));
        socket.emit('player_update', list);

        // Send state
        const drawerId = this.players[this.currentDrawerIndex]?.id;
        const isDrawer = socket.id === drawerId;

        const update = {
            state: this.state,
            round: this.round,
            totalRounds: this.config.totalRounds,
            timeLeft: this.timeLeft,
            drawer: drawerId,
        };
        if (this.state === STATE_DRAWING) {
            update.word = isDrawer ? this.currentWord : this.getMaskedWord();
        }
        if (this.state === STATE_GAME_END) {
            update.leaderboard = [...this.players].sort((a, b) => b.score - a.score);
        }

        socket.emit('game_state_update', update);

        // Send history
        socket.emit('drawing_history', this.strokes);
    }

    startTimer(seconds, callback) {
        this.stopTimer();
        this.timeLeft = seconds;
        this.io.to(this.id).emit('timer_update', this.timeLeft);

        this.timer = setInterval(() => {
            this.timeLeft--;
            this.io.to(this.id).emit('timer_update', this.timeLeft);
            if (this.timeLeft <= 0) {
                this.stopTimer();
                if (callback) callback();
            }
        }, 1000);
    }

    stopTimer() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }

    usersCount() {
        return this.players.length;
    }

    isDrawer(socketId) {
        return this.players[this.currentDrawerIndex]?.id === socketId;
    }
}

module.exports = Room;
