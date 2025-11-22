const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*', // Allow all for simplicity; restrict in production
        methods: ['GET', 'POST']
    }
});

const PORT = process.env.PORT || 3000;

const players = {};
const projectiles = {};
const PLAYER_SPEED = 5;
const PROJECTILE_SPEED = 5;
const PROJECTILE_RADIUS = 5;
const PLAYER_RADIUS = 10;
const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 576;

// Serve the frontend from /public
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    // Initialize new player
    players[socket.id] = {
        x: Math.random() * (CANVAS_WIDTH - 2 * PLAYER_RADIUS) + PLAYER_RADIUS,
        y: Math.random() * (CANVAS_HEIGHT - 2 * PLAYER_RADIUS) + PLAYER_RADIUS,
        radius: PLAYER_RADIUS,
        color: `hsl(${360 * Math.random()}, 100%, 50%)`,
        score: 0,
        keys: { w: false, a: false, s: false, d: false }
    };

    // Send initial state
    socket.emit('init', {
        id: socket.id,
        players,
        projectiles
    });

    // Handle key updates
    socket.on('updateKeys', (keys) => {
        if (players[socket.id]) {
            players[socket.id].keys = keys;
        }
    });

    // Handle shooting
    socket.on('shoot', ({ x, y, velocity }) => {
        const projectileId = Date.now() + Math.random();
        projectiles[projectileId] = {
            x,
            y,
            velocity,
            color: players[socket.id].color,
            playerId: socket.id,
            radius: PROJECTILE_RADIUS
        };
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        delete players[socket.id];
    });
});

// Game loop (runs at ~60 FPS)
setInterval(() => {
    // Update players
    Object.keys(players).forEach(id => {
        const player = players[id];
        const keys = player.keys;

        if (keys.w) player.y = Math.max(player.radius, player.y - PLAYER_SPEED);
        if (keys.a) player.x = Math.max(player.radius, player.x - PLAYER_SPEED);
        if (keys.s) player.y = Math.min(CANVAS_HEIGHT - player.radius, player.y + PLAYER_SPEED);
        if (keys.d) player.x = Math.min(CANVAS_WIDTH - player.radius, player.x + PLAYER_SPEED);
    });

    // Update projectiles and check collisions
    Object.keys(projectiles).forEach(id => {
        const proj = projectiles[id];
        proj.x += proj.velocity.x * PROJECTILE_SPEED;
        proj.y += proj.velocity.y * PROJECTILE_SPEED;

        // Check collisions with players
        Object.keys(players).forEach(playerId => {
            if (playerId === proj.playerId) return; // Can't hit yourself
            const player = players[playerId];
            const dx = proj.x - player.x;
            const dy = proj.y - player.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < proj.radius + player.radius) {
                // Hit: increase shooter's score, remove hit player and projectile
                if (players[proj.playerId]) players[proj.playerId].score += 1;
                delete players[playerId]; // Remove hit player (they can reconnect to respawn)
                delete projectiles[id];
            }
        });

        // Remove projectiles outside canvas
        if (proj.x < 0 || proj.x > CANVAS_WIDTH || proj.y < 0 || proj.y > CANVAS_HEIGHT) {
            delete projectiles[id];
        }
    });

    // Broadcast updated state to all clients
    io.emit('update', { players, projectiles });
}, 1000 / 60);

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
