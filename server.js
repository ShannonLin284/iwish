const express = require('express');
const http    = require('http');
const { WebSocketServer } = require('ws');
const Database = require('better-sqlite3');
const path = require('path');
const fs   = require('fs');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

// ── DB path: use /data volume on Railway, local fallback ──
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'wishes.db'));

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

  const msg = JSON.stringify({ event: 'wish', data: saved });
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });

  res.status(201).json(saved);
});

// ── Admin page ──
app.get('/admin', (req, res) => {
  const wishes = db.prepare('SELECT * FROM wishes ORDER BY born DESC').all();
  const rows = wishes.map(w => `
    <tr>
      <td>${w.id}</td>
      <td>${esc(w.name)}</td>
      <td>${esc(w.text)}</td>
      <td>${new Date(w.born).toLocaleString()}</td>
    </tr>`).join('');

  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <title>Big Red Wishes — Admin</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0e0000; color: #ffd0d0; padding: 32px; }
    h1 { color: #e03030; margin-bottom: 6px; }
    .sub { color: rgba(255,160,160,.45); font-size: .85rem; margin-bottom: 28px; }
    table { width: 100%; border-collapse: collapse; font-size: .9rem; }
    th { text-align: left; padding: 10px 14px; background: rgba(179,27,27,.25);
         color: #e03030; font-weight: 600; letter-spacing: .05em; border-bottom: 1px solid rgba(179,27,27,.3); }
    td { padding: 10px 14px; border-bottom: 1px solid rgba(179,27,27,.12); vertical-align: top; }
    tr:hover td { background: rgba(179,27,27,.07); }
    .count { font-size: 1.1rem; font-weight: 700; color: #e03030; }
  </style>
</head>
<body>
  <h1>🔴 Big Red Wishes</h1>
  <div class="sub">Admin — all wishes in the database</div>
  <p class="count">${wishes.length.toLocaleString()} total wishes</p><br/>
  <table>
    <thead><tr><th>#</th><th>Name</th><th>Wish</th><th>Time</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4" style="opacity:.4;padding:20px">No wishes yet</td></tr>'}</tbody>
  </table>
</body>
</html>`);
});

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── WebSocket ──
wss.on('connection', ws => {
  ws.on('error', err => console.error('ws error:', err));
});

// ── Listen ──
const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`\n✦  Big Red Wishes  →  http://localhost:${PORT}\n✦  Admin           →  http://localhost:${PORT}/admin\n`)
);
