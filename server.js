const express = require('express');
const http    = require('http');
const { WebSocketServer } = require('ws');
const { Pool } = require('pg');
const path = require('path');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

// ── Database ──
// On Railway: DATABASE_URL is auto-set when you add a Postgres service.
// Locally: set DATABASE_URL in a .env file or environment.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : false,
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wishes (
      id          SERIAL PRIMARY KEY,
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
      born        BIGINT  NOT NULL
    )
  `);
  console.log('✦  Database ready');
}

// ── Middleware ──
app.use(express.json());
app.use(express.static(__dirname));

// ── GET all wishes ──
app.get('/api/wishes', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM wishes ORDER BY born ASC');
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'db error' });
  }
});

// ── POST new wish ──
app.post('/api/wishes', async (req, res) => {
  const { name, text, type_idx } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'wish text required' });

  const SPREAD_X = 4200, SPREAD_Y = 2400;
  const row = {
    name:        (name || 'Anonymous').trim().slice(0, 40),
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

  try {
    const { rows } = await pool.query(
      `INSERT INTO wishes (name,text,type_idx,size,wobble_off,wobble_amp,twinkle_off,wx,wy,vx,vy,born)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [row.name,row.text,row.type_idx,row.size,row.wobble_off,row.wobble_amp,
       row.twinkle_off,row.wx,row.wy,row.vx,row.vy,row.born]
    );
    const saved = rows[0];

    const msg = JSON.stringify({ event: 'wish', data: saved });
    wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });

    res.status(201).json(saved);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'db error' });
  }
});

// ── Admin page ──
app.get('/admin', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM wishes ORDER BY born DESC');
    const tableRows = rows.map(w => `
      <tr>
        <td>${w.id}</td>
        <td>${esc(w.name)}</td>
        <td>${esc(w.text)}</td>
        <td>${new Date(Number(w.born)).toLocaleString()}</td>
      </tr>`).join('');

    res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <title>Big Red Wishes — Admin</title>
  <style>
    body{font-family:system-ui,sans-serif;background:#0e0000;color:#ffd0d0;padding:32px;}
    h1{color:#e03030;margin-bottom:6px;}
    .sub{color:rgba(255,160,160,.45);font-size:.85rem;margin-bottom:28px;}
    table{width:100%;border-collapse:collapse;font-size:.9rem;}
    th{text-align:left;padding:10px 14px;background:rgba(179,27,27,.25);
       color:#e03030;font-weight:600;letter-spacing:.05em;border-bottom:1px solid rgba(179,27,27,.3);}
    td{padding:10px 14px;border-bottom:1px solid rgba(179,27,27,.12);vertical-align:top;}
    tr:hover td{background:rgba(179,27,27,.07);}
    .count{font-size:1.1rem;font-weight:700;color:#e03030;}
  </style>
</head>
<body>
  <h1>🔴 Big Red Wishes</h1>
  <div class="sub">Admin — all wishes in the database</div>
  <p class="count">${rows.length.toLocaleString()} total wishes</p><br/>
  <table>
    <thead><tr><th>#</th><th>Name</th><th>Wish</th><th>Time</th></tr></thead>
    <tbody>${tableRows || '<tr><td colspan="4" style="opacity:.4;padding:20px">No wishes yet</td></tr>'}</tbody>
  </table>
</body>
</html>`);
  } catch (e) {
    res.status(500).send('DB error: ' + e.message);
  }
});

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── WebSocket ──
wss.on('connection', ws => {
  ws.on('error', err => console.error('ws error:', err));
});

// ── Start ──
const PORT = process.env.PORT || 3000;
initDB().then(() => {
  server.listen(PORT, () =>
    console.log(`\n✦  Big Red Wishes  →  http://localhost:${PORT}\n✦  Admin           →  http://localhost:${PORT}/admin\n`)
  );
}).catch(err => {
  console.error('Failed to connect to database:', err.message || err);
  if (!process.env.DATABASE_URL) {
    console.error('→ DATABASE_URL is not set. In Railway: add variable DATABASE_URL = ${{Postgres.DATABASE_URL}}');
  }
  process.exit(1);
});
