const express = require('express');
const http    = require('http');
const { WebSocketServer } = require('ws');
const Database = require('better-sqlite3');
const path = require('path');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });
const db     = new Database(path.join(__dirname, 'wishes.db'));

// ── Schema ──
db.exec(`
  CREATE TABLE IF NOT EXISTS wishes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL DEFAULT 'Anonymous',
    text        TEXT    NOT NULL,
    type_idx    INTEGER NOT NULL DEFAULT 0,
    size        REAL    NOT NULL DEFAULT 16,
    wobble_off  REAL    NOT NULL DEFAULT 0,
    wobble_amp  REAL    NOT NULL DEFAULT 0.05,
    twinkle_off REAL    NOT NULL DEFAULT 0,
    wx          REAL    NOT NULL DEFAULT 0,
    wy          REAL    NOT NULL DEFAULT 0,
    vx          REAL    NOT NULL DEFAULT 0,
    vy          REAL    NOT NULL DEFAULT -0.2,
    born        INTEGER NOT NULL
  )
`);

// ── Middleware ──
app.use(express.json());
app.use(express.static(__dirname));

// ── REST ──
app.get('/api/wishes', (req, res) => {
  res.json(db.prepare('SELECT * FROM wishes ORDER BY born ASC').all());
});

app.post('/api/wishes', (req, res) => {
  const { name, text, type_idx } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'wish text required' });

  // Server assigns position so it's consistent for all clients
  const SPREAD_X = 4200, SPREAD_Y = 2400;
  const row = {
    name:        (name  || 'Anonymous').trim().slice(0, 40),
    text:        text.trim().slice(0, 200),
    type_idx:    Number.isInteger(type_idx) ? type_idx % 6 : Math.floor(Math.random() * 6),
    size:        14 + Math.random() * 10,
    wobble_off:  Math.random() * Math.PI * 2,
    wobble_amp:  0.04 + Math.random() * 0.06,
    twinkle_off: Math.random() * Math.PI * 2,
    wx:          (Math.random() - 0.5) * SPREAD_X,
    wy:          (Math.random() - 0.5) * SPREAD_Y,
    vx:          (Math.random() - 0.5) * 0.14,
    vy:          -(0.18 + Math.random() * 0.18),
    born:        Date.now(),
  };

  const { lastInsertRowid } = db.prepare(`
    INSERT INTO wishes (name,text,type_idx,size,wobble_off,wobble_amp,twinkle_off,wx,wy,vx,vy,born)
    VALUES (@name,@text,@type_idx,@size,@wobble_off,@wobble_amp,@twinkle_off,@wx,@wy,@vx,@vy,@born)
  `).run(row);

  const saved = db.prepare('SELECT * FROM wishes WHERE id=?').get(lastInsertRowid);

  // Broadcast to every connected client
  const msg = JSON.stringify({ event: 'wish', data: saved });
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });

  res.status(201).json(saved);
});

// ── WebSocket ──
wss.on('connection', ws => {
  ws.on('error', err => console.error('ws error:', err));
});

// ── Listen ──
const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`\n✦  Galaxy Wishes  →  http://localhost:${PORT}\n`)
);
