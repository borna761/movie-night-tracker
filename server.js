'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// Load .env (if present) into process.env. Built in since Node 20.6.
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* no .env, that's fine */ }

const db = require('./db');

const PORT = process.env.PORT || 4321;
const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w300';

const STATUSES = ['to_invite', 'invited', 'declined', 'confirmed', 'did_not_show', 'attended'];

// ---------- helpers ----------
function send(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e6) {
        reject(Object.assign(new Error('body too large'), { statusCode: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function activeNight() {
  return db.prepare('SELECT * FROM nights WHERE is_active = 1 ORDER BY id DESC LIMIT 1').get();
}

function parseId(s) {
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function attendanceForNight(nightId) {
  return db.prepare(`
    SELECT a.id, a.family_id, a.status, f.child_name, f.family_name, f.notes
    FROM attendance a
    JOIN families f ON f.id = a.family_id
    WHERE a.night_id = ? AND f.archived = 0
    ORDER BY f.child_name COLLATE NOCASE
  `).all(nightId);
}

// Ensure every active family has an attendance row for the active night.
function seedAttendance(nightId) {
  const families = db.prepare('SELECT id FROM families WHERE archived = 0').all();
  const ins = db.prepare(
    'INSERT OR IGNORE INTO attendance (night_id, family_id, status) VALUES (?, ?, ?)'
  );
  for (const f of families) ins.run(nightId, f.id, 'to_invite');
}

// ---------- API ----------
async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const seg = parts.slice(1); // drop 'api'
  const method = req.method;

  // --- families ---
  if (seg[0] === 'families') {
    if (method === 'GET' && seg.length === 1) {
      return send(res, 200, db.prepare(
        'SELECT * FROM families WHERE archived = 0 ORDER BY child_name COLLATE NOCASE'
      ).all());
    }
    if (method === 'POST' && seg.length === 1) {
      const b = await readBody(req);
      if (!b.child_name || !b.child_name.trim()) return send(res, 400, { error: 'child_name required' });
      const info = db.prepare(
        'INSERT INTO families (child_name, family_name, notes) VALUES (?, ?, ?)'
      ).run(b.child_name.trim(), b.family_name || null, b.notes || null);
      // If a night is active, add this child to the board.
      const night = activeNight();
      if (night) {
        db.prepare('INSERT OR IGNORE INTO attendance (night_id, family_id, status) VALUES (?, ?, ?)')
          .run(night.id, info.lastInsertRowid, 'to_invite');
      }
      return send(res, 201, db.prepare('SELECT * FROM families WHERE id = ?').get(info.lastInsertRowid));
    }
    if (method === 'PUT' && seg.length === 2) {
      const id = parseId(seg[1]);
      if (!id) return send(res, 400, { error: 'invalid id' });
      const b = await readBody(req);
      if (!b.child_name || !b.child_name.trim()) return send(res, 400, { error: 'child_name required' });
      db.prepare('UPDATE families SET child_name = ?, family_name = ?, notes = ? WHERE id = ?')
        .run(b.child_name.trim(), b.family_name || null, b.notes || null, id);
      return send(res, 200, db.prepare('SELECT * FROM families WHERE id = ?').get(id));
    }
    if (method === 'DELETE' && seg.length === 2) {
      const id = parseId(seg[1]);
      if (!id) return send(res, 400, { error: 'invalid id' });
      db.prepare('UPDATE families SET archived = 1 WHERE id = ?').run(id);
      return send(res, 200, { ok: true });
    }
  }

  // --- watchlist ---
  if (seg[0] === 'watchlist') {
    if (method === 'GET' && seg.length === 1) {
      return send(res, 200, db.prepare(`
        SELECT w.*,
          (SELECT n.movie_date FROM nights n
           WHERE (n.tmdb_id IS NOT NULL AND n.tmdb_id = w.tmdb_id
                  OR n.tmdb_id IS NULL AND w.tmdb_id IS NULL AND n.title = w.title)
             AND n.is_active = 0
           ORDER BY n.movie_date DESC LIMIT 1) AS last_watched
        FROM watchlist w
        ORDER BY w.title COLLATE NOCASE
      `).all());
    }
    if (method === 'POST' && seg.length === 1) {
      const b = await readBody(req);
      if (!b.title) return send(res, 400, { error: 'title required' });
      if (b.tmdb_id) {
        const dup = db.prepare('SELECT id FROM watchlist WHERE tmdb_id = ?').get(b.tmdb_id);
        if (dup) return send(res, 409, { error: 'already_in_watchlist' });
      }
      const info = db.prepare(
        'INSERT INTO watchlist (title, tmdb_id, poster_path, release_date, overview) VALUES (?, ?, ?, ?, ?)'
      ).run(b.title, b.tmdb_id || null, b.poster_path || null, b.release_date || null, b.overview || null);
      return send(res, 201, db.prepare('SELECT * FROM watchlist WHERE id = ?').get(info.lastInsertRowid));
    }
    if (method === 'DELETE' && seg.length === 2) {
      const id = parseId(seg[1]);
      if (!id) return send(res, 400, { error: 'invalid id' });
      db.prepare('DELETE FROM watchlist WHERE id = ?').run(id);
      return send(res, 200, { ok: true });
    }
  }

  // --- active night / board ---
  if (seg[0] === 'night') {
    if (method === 'GET' && seg[1] === 'active') {
      const night = activeNight();
      if (!night) return send(res, 200, { night: null, board: [] });
      return send(res, 200, { night, board: attendanceForNight(night.id) });
    }
    if (method === 'POST' && seg.length === 1) {
      // Create a new active night (only one active at a time).
      const b = await readBody(req);
      const existing = activeNight();
      if (existing) return send(res, 409, { error: 'A night is already active. Reset it first.' });
      const info = db.prepare(`
        INSERT INTO nights (title, movie_date, tmdb_id, poster_path, release_date, overview)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        b.title || null, b.movie_date || null, b.tmdb_id || null,
        b.poster_path || null, b.release_date || null, b.overview || null
      );
      seedAttendance(info.lastInsertRowid);
      if (b.title) {
        const dupCheck = b.tmdb_id
          ? db.prepare('SELECT id FROM watchlist WHERE tmdb_id = ?').get(b.tmdb_id)
          : db.prepare('SELECT id FROM watchlist WHERE title = ? AND tmdb_id IS NULL').get(b.title);
        if (!dupCheck) {
          db.prepare('INSERT INTO watchlist (title, tmdb_id, poster_path, release_date, overview) VALUES (?, ?, ?, ?, ?)')
            .run(b.title, b.tmdb_id || null, b.poster_path || null, b.release_date || null, b.overview || null);
        }
      }
      const night = db.prepare('SELECT * FROM nights WHERE id = ?').get(info.lastInsertRowid);
      return send(res, 201, { night, board: attendanceForNight(night.id) });
    }
    if (method === 'PUT' && seg[1] === 'active') {
      const night = activeNight();
      if (!night) return send(res, 404, { error: 'No active night' });
      const b = await readBody(req);
      db.prepare(`
        UPDATE nights SET title = ?, movie_date = ?, tmdb_id = ?, poster_path = ?, release_date = ?, overview = ?
        WHERE id = ?
      `).run(
        b.title ?? night.title, b.movie_date ?? night.movie_date, b.tmdb_id ?? night.tmdb_id,
        b.poster_path ?? night.poster_path, b.release_date ?? night.release_date,
        b.overview ?? night.overview, night.id
      );
      return send(res, 200, db.prepare('SELECT * FROM nights WHERE id = ?').get(night.id));
    }
    if (method === 'POST' && seg[1] === 'active' && seg[2] === 'reset') {
      const night = activeNight();
      if (!night) return send(res, 404, { error: 'No active night' });
      db.prepare("UPDATE nights SET is_active = 0, archived_at = datetime('now') WHERE id = ?").run(night.id);
      return send(res, 200, { ok: true });
    }
  }

  // --- attendance status change ---
  if (seg[0] === 'attendance' && method === 'PUT') {
    const b = await readBody(req);
    if (!STATUSES.includes(b.status)) return send(res, 400, { error: 'bad status' });
    if (!Number.isInteger(b.family_id) || b.family_id < 1) return send(res, 400, { error: 'family_id required' });
    const night = activeNight();
    if (!night) return send(res, 404, { error: 'No active night' });
    db.prepare("UPDATE attendance SET status = ?, updated_at = datetime('now') WHERE night_id = ? AND family_id = ?")
      .run(b.status, night.id, b.family_id);
    return send(res, 200, { ok: true });
  }

  // --- history ---
  if (seg[0] === 'history') {
    if (method === 'GET' && seg.length === 1) {
      const rows = db.prepare(`
        SELECT n.id, n.title, n.movie_date, n.tmdb_id, n.poster_path, n.release_date, n.overview,
          n.is_active, n.archived_at, n.created_at,
          (SELECT COUNT(*) FROM attendance ac WHERE ac.night_id = n.id AND ac.status = 'attended') AS attended_count,
          f.child_name, f.family_name, a.status AS attendee_status
        FROM nights n
        LEFT JOIN attendance a ON a.night_id = n.id
        LEFT JOIN families f ON f.id = a.family_id
        WHERE n.is_active = 0
        ORDER BY COALESCE(n.movie_date, n.archived_at) DESC, n.id DESC, f.child_name COLLATE NOCASE
      `).all();
      const nightMap = new Map();
      for (const row of rows) {
        if (!nightMap.has(row.id)) {
          nightMap.set(row.id, {
            id: row.id, title: row.title, movie_date: row.movie_date, tmdb_id: row.tmdb_id,
            poster_path: row.poster_path, release_date: row.release_date, overview: row.overview,
            is_active: row.is_active, archived_at: row.archived_at, created_at: row.created_at,
            attended_count: row.attended_count, attendees: [],
          });
        }
        if (row.child_name != null) {
          nightMap.get(row.id).attendees.push({ child_name: row.child_name, family_name: row.family_name, status: row.attendee_status });
        }
      }
      return send(res, 200, [...nightMap.values()]);
    }
    if (method === 'GET' && seg[1] === 'family') {
      const id = parseId(seg[2]);
      if (!id) return send(res, 400, { error: 'invalid id' });
      const rows = db.prepare(`
        SELECT n.title, n.movie_date, n.poster_path, n.release_date, a.status
        FROM attendance a JOIN nights n ON n.id = a.night_id
        WHERE a.family_id = ? AND n.is_active = 0
        ORDER BY COALESCE(n.movie_date, n.archived_at) DESC
      `).all(id);
      return send(res, 200, rows);
    }
  }

  // --- TMDB movie search proxy ---
  if (seg[0] === 'movies' && seg[1] === 'search' && method === 'GET') {
    const q = url.searchParams.get('q');
    if (!q) return send(res, 200, []);
    if (!TMDB_API_KEY) return send(res, 200, { error: 'no_api_key' });
    try {
      const r = await fetch(
        `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(q)}&include_adult=false`,
        { headers: { Authorization: `Bearer ${TMDB_API_KEY}`, Accept: 'application/json' } }
      );
      const data = await r.json();
      const results = (data.results || []).slice(0, 12).map((m) => ({
        tmdb_id: m.id,
        title: m.title,
        release_date: m.release_date,
        overview: m.overview,
        poster_path: m.poster_path ? TMDB_IMG + m.poster_path : null,
      }));
      return send(res, 200, results);
    } catch (e) {
      return send(res, 502, { error: 'tmdb_failed' });
    }
  }

  return send(res, 404, { error: 'not found' });
}

// ---------- static files ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
function serveStatic(res, url) {
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  const full = path.join(__dirname, 'public', path.normalize(file));
  if (!full.startsWith(path.join(__dirname, 'public'))) return send(res, 403, { error: 'no' });
  fs.readFile(full, (err, buf) => {
    if (err) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return serveStatic(res, url);
  } catch (e) {
    if (!res.headersSent) send(res, e.statusCode || 500, { error: e.message || 'internal error' });
  }
});

server.listen(PORT, () => {
  console.log(`🎬 Movie Night Tracker running at http://localhost:${PORT}`);
  if (!TMDB_API_KEY) console.log('⚠  No TMDB_API_KEY set — movie search disabled. See README.');
});
