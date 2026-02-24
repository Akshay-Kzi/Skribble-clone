# SClone - Multiplayer Drawing Game

A real-time multiplayer drawing and guessing game inspired by Skribbl.io.

## Features
- **Multiplayer**: Create or join rooms with friends.
- **Real-time Drawing**: Smooth drawing synchronization using Socket.IO.
- **Drawing Tools**: 
  - ✏️ Pencil for drawing
  - 🪣 Bucket/fill tool for coloring areas
  - 🧽 Eraser for corrections
- **Game Logic**: Turn-based system with word selection, drawing, and guessing phases.
- **Enhanced Leaderboard**: Podium-style results with gold/silver/bronze medals.
- **Room Configuration**: Customize round time, max players, total rounds, and custom words.
- **Chat**: Real-time chat for guessing words and talking to other players.

## Prerequisites
- Node.js installed.

## Installation
1.  Open a terminal in the project directory.
2.  Install dependencies:
    ```bash
    npm install express socket.io
    ```

## Running the Game
1.  Start the server:
    ```bash
    node server/server.js
    ```
2.  Open your web browser and navigate to:
    ```
    http://localhost:3000
    ```
3.  Create a room or join an existing one!

## How to Play
1.  **Host**: Create a room, configure settings (optional), and share the **Room ID** or just wait for friends to join if local.
2.  **Join**: Enter your name and the Room ID to join.
3.  **Start**: Once at least 2 players are in, the host can start the game.
4.  **Game Loop**:
    - **Pick**: The artist picks a word.
    - **Draw**: The artist draws the word using pencil, bucket fill, or eraser tools.
    - **Guess**: Others guess the word in the chat.
    - **Score**: Points are awarded for speed and accuracy.
    - **Results**: View the enhanced leaderboard with podium medals at game end.

## Screenshots

<!-- Add your screenshots here! Place images in assets/screenshots/ folder -->

### Game Interface
![Game Interface](assets/screenshots/game-interface.png)

### Drawing Tools
![Drawing Tools](assets/screenshots/drawing-tools.png)

### Leaderboard Results
![Leaderboard](assets/screenshots/leaderboard.png)

### Room Creation
![Room Creation](assets/screenshots/room-creation.png)
