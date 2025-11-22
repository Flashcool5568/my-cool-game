const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;
const players = {};
const projectiles = {};
const bots = {}; // ← NEW: our bots live here

const PLAYER_SPEED = 5;
const PROJECTILE_SPEED = 5;
const PROJECTILE_RADIUS = 5;
const PLAYER_RADIUS = 10;
const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 576;

// Serve frontend
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ──────────────────────────────
// BOT SPAWNER (runs once on start)
// ──────────────────────────────
function spawnBot() {
    const id = `bot_${Date.now()}_${Math.random()}`;
    bots[id] = {
        x: Math.random() * (CANVAS_WIDTH - 60) + 30,
        y: Math.random() * (CANVAS_HEIGHT - 60) + 30,
        radius: PLAYER_RADIUS,
        color: 'red',           // bots are red
        score: 0,
        isBot: true,
        last fired: 0
    };
}
for (let i = 0; i < 10; i++) spawnBot(); // spawn 10 bots

// ──────────────────────────────
// CONNECTIONS
// ──────────────────────────────
io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    // Create real player
    players[socket.id] = {
        x: Math.random() * (CANVAS_WIDTH - 60) + 30,
        y: Math.random() * (CANVAS_HEIGHT - 60) + 30,
        radius: PLAYER_RADIUS,
        color: `hsl(${360 * Math.random()}, 100%, 50%)`,
        score: 0,
        keys: { w: false, a: false, s: false, d: false }
    };

    socket.emit('init', { id: socket.id, players, projectiles, bots });

    socket.on('updateKeys', (keys) => {
        if (players[socket.id]) players[socket.id].keys = keys;
    });

    socket.on('shoot', ({ x, y, velocity }) => {
        const projectileId = Date.now() + Math.random();
        projectiles[projectileId] = {
            x, y, velocity,
            color: players[socket.id].color,
            playerId: socket.id,
            radius: PROJECTILE_RADIUS
        };
    });

    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        delete players[socket.id];
    });
});

// ──────────────────────────────
// GAME LOOP (~60 FPS)
// ──────────────────────────────
setInterval(() => {
    const now = Date.now();

    // ── Move real players
    Object.keys(players).forEach(id => {
        const p = players[id];
        if (p.keys.w) p.y = Math.max(p.radius, p.y - PLAYER_SPEED);
        if (p.keys.a) p.x = Math.max(p.radius, p.x - PLAYER_SPEED);
        if (p.keys.s) p.y = Math.min(CANVAS_HEIGHT - p.radius, p.y + PLAYER_SPEED);
        if (p.keys.d) p.x = Math.min(CANVAS_WIDTH - p.radius, p.x + PLAYER_SPEED);
    });

    // ── Bot AI: chase closest player + shoot
    Object.keys(bots).forEach(botId => {
        const bot = bots[botId];
        let closest = null;
        let closestDist = Infinity;

        // Find closest player
        Object.keys(players).forEach(pid => {
            const pl = players[pid];
            const dx = pl.x - bot.x;
            const dy = pl.y - bot.y;
            const dist = dx*dx + dy*dy;
            if (dist < closestDist) {
                closestDist = dist;
                closest = pl;
            }
        });

        if (closest) {
            const dx = closest.x - bot.x;
            const dy = closest.y - bot.y;
            const angle = Math.atan2(dy, dx);
            const speed = 2.2; // bot speed
            bot.x += Math.cos(angle) * speed;
            bot.y += Math.sin(angle) * speed;

            // Shoot every ~1.5 seconds
            if (now - bot.lastFired > 1500) {
                const projId = `botproj_${now}_${Math.random()}`;
                projectiles[projId] = {
                    x: bot.x,
                    y: bot.y,
                    velocity: { x: Math.cos(angle) * 1.2, y: Math.sin(angle) * 1.2 },
                    color: 'red',
                    playerId: botId,
                    radius: PROJECTILE_RADIUS
                };
                bot.lastFired = now;
            }
        }
    });

    // ── Move projectiles + collisions
    Object.keys(projectiles).forEach(id => {
        const proj = projectiles[id];
        proj.x += proj.velocity.x * PROJECTILE_SPEED;
        proj.y += proj.velocity.y * PROJECTILE_SPEED;

        // Hit players
        Object.keys(players).forEach(pid => {
            if (pid === proj.playerId) return;
            const pl = players[pid];
            const dist = Math.hypot(proj.x - pl.x, proj.y - pl.y);
            if (dist < proj.radius + pl.radius) {
                if (players[proj.playerId]) players[proj.playerId].score += 1;
                else if (bots[proj.playerId]) bots[proj.playerId].score += 1;
                delete players[pid];
                delete projectiles[id];
            }
        });

        // Hit bots
        Object.keys(bots).forEach(botId => {
            if (botId === proj.playerId) return;
            const bot = bots[botId];
            const dist = Math.hypot(proj.x - bot.x, proj.y - bot.y);
            if (dist < proj.radius + bot.radius) {
                if (players[proj.playerId]) players[proj.playerId].score += 1;
                delete bots[botId];
                setTimeout(() => spawnBot(), 3000); // respawn after 3s
                delete projectiles[id];
            }
        });

        // Out of bounds
        if (proj.x < -50 || proj.x > CANVAS_WIDTH + 50 || proj.y < -50 || proj.y > CANVAS_HEIGHT + 50) {
            delete projectiles[id];
        }
    });

    // ── Send everything to clients
    io.emit('update', { players, projectiles, bots });
}, 1000 / 60);

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
