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

function parseId(s) {
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function eventTypeById(id) {
  return db.prepare('SELECT * FROM event_types WHERE id = ?').get(id);
}

function withType(event) {
  if (!event) return event;
  return { ...event, event_type: eventTypeById(event.event_type_id) };
}

function activeEvent() {
  return db.prepare('SELECT * FROM events WHERE is_active = 1 ORDER BY id DESC LIMIT 1').get();
}

function attendanceForEvent(eventId) {
  return db.prepare(`
    SELECT a.id, a.family_id, a.status, f.child_name, f.family_name, f.notes
    FROM attendance a
    JOIN families f ON f.id = a.family_id
    WHERE a.event_id = ? AND f.archived = 0
    ORDER BY f.child_name COLLATE NOCASE
  `).all(eventId);
}

// Ensure every active family has an attendance row for the active event.
function seedAttendance(eventId) {
  const families = db.prepare('SELECT id FROM families WHERE archived = 0').all();
  const ins = db.prepare(
    'INSERT OR IGNORE INTO attendance (event_id, family_id, status) VALUES (?, ?, ?)'
  );
  for (const f of families) ins.run(eventId, f.id, 'to_invite');
}

// ---------- API ----------
async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const seg = parts.slice(1); // drop 'api'
  const method = req.method;

  // --- event types ---
  if (seg[0] === 'event-types') {
    if (method === 'GET' && seg.length === 1) {
      return send(res, 200, db.prepare('SELECT * FROM event_types ORDER BY builtin DESC, name COLLATE NOCASE').all());
    }
    if (method === 'POST' && seg.length === 1) {
      const b = await readBody(req);
      if (!b.name || !b.name.trim() || !b.icon) return send(res, 400, { error: 'name and icon required' });
      const slug = b.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const info = db.prepare(
        'INSERT INTO event_types (slug, name, icon, fields, builtin) VALUES (?, ?, ?, ?, 0)'
      ).run(slug || `type_${Date.now()}`, b.name.trim(), b.icon, JSON.stringify(b.fields || []));
      return send(res, 201, eventTypeById(info.lastInsertRowid));
    }
    if (method === 'PUT' && seg.length === 2) {
      const id = parseId(seg[1]);
      if (!id) return send(res, 400, { error: 'invalid id' });
      const type = eventTypeById(id);
      if (!type) return send(res, 404, { error: 'not found' });
      const b = await readBody(req);
      db.prepare('UPDATE event_types SET name = ?, icon = ?, fields = ? WHERE id = ?').run(
        b.name ?? type.name, b.icon ?? type.icon,
        type.builtin ? type.fields : JSON.stringify(b.fields ?? JSON.parse(type.fields)),
        id
      );
      return send(res, 200, eventTypeById(id));
    }
    if (method === 'DELETE' && seg.length === 2) {
      const id = parseId(seg[1]);
      if (!id) return send(res, 400, { error: 'invalid id' });
      const type = eventTypeById(id);
      if (!type) return send(res, 404, { error: 'not found' });
      if (type.builtin) return send(res, 403, { error: 'cannot delete a builtin event type' });
      const inUse = db.prepare('SELECT COUNT(*) AS n FROM events WHERE event_type_id = ?').get(id);
      if (inUse.n > 0) return send(res, 409, { error: 'event type has events, cannot delete' });
      db.prepare('DELETE FROM event_types WHERE id = ?').run(id);
      return send(res, 200, { ok: true });
    }
  }

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
      const event = activeEvent();
      if (event) {
        db.prepare('INSERT OR IGNORE INTO attendance (event_id, family_id, status) VALUES (?, ?, ?)')
          .run(event.id, info.lastInsertRowid, 'to_invite');
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

  // --- watchlist (movie_night-specific) ---
  if (seg[0] === 'watchlist') {
    if (method === 'GET' && seg.length === 1) {
      return send(res, 200, db.prepare(`
        SELECT w.*,
          (SELECT e.event_date FROM events e
           JOIN event_types et ON et.id = e.event_type_id
           WHERE et.slug = 'movie_night' AND e.is_active = 0
             AND (
               (w.tmdb_id IS NOT NULL AND json_extract(e.fields, '$.tmdb_id') = w.tmdb_id)
               OR (w.tmdb_id IS NULL AND json_extract(e.fields, '$.tmdb_id') IS NULL AND e.name = w.title)
             )
           ORDER BY e.event_date DESC LIMIT 1) AS last_watched
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

  // --- ideas (generic per-event-type picklist, all types except movie_night) ---
  if (seg[0] === 'ideas') {
    if (method === 'GET' && seg.length === 1) {
      const rows = db.prepare(`
        SELECT i.*,
          (SELECT e.event_date FROM events e
           WHERE e.event_type_id = i.event_type_id AND e.name = i.name AND e.is_active = 0
           ORDER BY e.event_date DESC LIMIT 1) AS last_used
        FROM event_ideas i
        ORDER BY i.name COLLATE NOCASE
      `).all();
      return send(res, 200, rows.map((r) => withType(r)));
    }
    if (method === 'POST' && seg.length === 1) {
      const b = await readBody(req);
      if (!b.name || !b.name.trim() || !b.event_type_id) return send(res, 400, { error: 'name and event_type_id required' });
      const type = eventTypeById(b.event_type_id);
      if (!type) return send(res, 400, { error: 'invalid event_type_id' });
      const info = db.prepare(
        'INSERT INTO event_ideas (event_type_id, name, notes) VALUES (?, ?, ?)'
      ).run(type.id, b.name.trim(), b.notes || null);
      return send(res, 201, db.prepare('SELECT * FROM event_ideas WHERE id = ?').get(info.lastInsertRowid));
    }
    if (method === 'DELETE' && seg.length === 2) {
      const id = parseId(seg[1]);
      if (!id) return send(res, 400, { error: 'invalid id' });
      db.prepare('DELETE FROM event_ideas WHERE id = ?').run(id);
      return send(res, 200, { ok: true });
    }
  }

  // --- active event / board ---
  if (seg[0] === 'event') {
    if (method === 'GET' && seg[1] === 'active') {
      const event = activeEvent();
      if (!event) return send(res, 200, { event: null, board: [] });
      return send(res, 200, { event: withType(event), board: attendanceForEvent(event.id) });
    }
    if (method === 'POST' && seg.length === 1) {
      const b = await readBody(req);
      const existing = activeEvent();
      if (existing) return send(res, 409, { error: 'An event is already active. Reset it first.' });
      const type = eventTypeById(b.event_type_id);
      if (!type) return send(res, 400, { error: 'invalid event_type_id' });
      const fields = b.fields || {};
      const info = db.prepare(
        'INSERT INTO events (event_type_id, name, event_date, fields) VALUES (?, ?, ?, ?)'
      ).run(type.id, b.name || null, b.event_date || null, JSON.stringify(fields));
      seedAttendance(info.lastInsertRowid);

      if (type.slug === 'movie_night' && b.name) {
        const tmdbId = fields.tmdb_id || null;
        const dupCheck = tmdbId
          ? db.prepare('SELECT id FROM watchlist WHERE tmdb_id = ?').get(tmdbId)
          : db.prepare('SELECT id FROM watchlist WHERE title = ? AND tmdb_id IS NULL').get(b.name);
        if (!dupCheck) {
          db.prepare('INSERT INTO watchlist (title, tmdb_id, poster_path, release_date, overview) VALUES (?, ?, ?, ?, ?)')
            .run(b.name, tmdbId, fields.poster_path || null, fields.release_date || null, fields.overview || null);
        }
      } else if (type.slug !== 'movie_night' && b.name) {
        const dupCheck = db.prepare(
          'SELECT id FROM event_ideas WHERE event_type_id = ? AND name = ? COLLATE NOCASE'
        ).get(type.id, b.name);
        if (!dupCheck) {
          db.prepare('INSERT INTO event_ideas (event_type_id, name) VALUES (?, ?)').run(type.id, b.name);
        }
      }

      const event = db.prepare('SELECT * FROM events WHERE id = ?').get(info.lastInsertRowid);
      return send(res, 201, { event: withType(event), board: attendanceForEvent(event.id) });
    }
    if (method === 'PUT' && seg[1] === 'active') {
      const event = activeEvent();
      if (!event) return send(res, 404, { error: 'No active event' });
      const b = await readBody(req);
      db.prepare('UPDATE events SET name = ?, event_date = ?, fields = ? WHERE id = ?').run(
        b.name ?? event.name, b.event_date ?? event.event_date,
        b.fields ? JSON.stringify(b.fields) : event.fields, event.id
      );
      return send(res, 200, withType(db.prepare('SELECT * FROM events WHERE id = ?').get(event.id)));
    }
    if (method === 'POST' && seg[1] === 'active' && seg[2] === 'reset') {
      const event = activeEvent();
      if (!event) return send(res, 404, { error: 'No active event' });
      db.prepare("UPDATE events SET is_active = 0, archived_at = datetime('now') WHERE id = ?").run(event.id);
      return send(res, 200, { ok: true });
    }
  }

  // --- attendance status change ---
  if (seg[0] === 'attendance' && method === 'PUT') {
    const b = await readBody(req);
    if (!STATUSES.includes(b.status)) return send(res, 400, { error: 'bad status' });
    if (!Number.isInteger(b.family_id) || b.family_id < 1) return send(res, 400, { error: 'family_id required' });
    const event = activeEvent();
    if (!event) return send(res, 404, { error: 'No active event' });
    db.prepare("UPDATE attendance SET status = ?, updated_at = datetime('now') WHERE event_id = ? AND family_id = ?")
      .run(b.status, event.id, b.family_id);
    return send(res, 200, { ok: true });
  }

  // --- history ---
  if (seg[0] === 'history') {
    if (method === 'GET' && seg.length === 1) {
      const rows = db.prepare(`
        SELECT e.id, e.name, e.event_date, e.fields, e.event_type_id,
          e.is_active, e.archived_at, e.created_at,
          (SELECT COUNT(*) FROM attendance ac WHERE ac.event_id = e.id AND ac.status = 'attended') AS attended_count,
          f.child_name, f.family_name, a.status AS attendee_status
        FROM events e
        LEFT JOIN attendance a ON a.event_id = e.id
        LEFT JOIN families f ON f.id = a.family_id
        WHERE e.is_active = 0
        ORDER BY COALESCE(e.event_date, e.archived_at) DESC, e.id DESC, f.child_name COLLATE NOCASE
      `).all();
      const eventMap = new Map();
      for (const row of rows) {
        if (!eventMap.has(row.id)) {
          eventMap.set(row.id, {
            id: row.id, name: row.name, event_date: row.event_date, fields: row.fields,
            event_type: eventTypeById(row.event_type_id),
            is_active: row.is_active, archived_at: row.archived_at, created_at: row.created_at,
            attended_count: row.attended_count, attendees: [],
          });
        }
        if (row.child_name != null) {
          eventMap.get(row.id).attendees.push({ child_name: row.child_name, family_name: row.family_name, status: row.attendee_status });
        }
      }
      return send(res, 200, [...eventMap.values()]);
    }
    if (method === 'GET' && seg[1] === 'family') {
      const id = parseId(seg[2]);
      if (!id) return send(res, 400, { error: 'invalid id' });
      const rows = db.prepare(`
        SELECT e.name, e.event_date, e.event_type_id, a.status
        FROM attendance a JOIN events e ON e.id = a.event_id
        WHERE a.family_id = ? AND e.is_active = 0
        ORDER BY COALESCE(e.event_date, e.archived_at) DESC
      `).all(id).map((r) => ({ ...r, event_type: eventTypeById(r.event_type_id) }));
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
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };
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

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`📅 Event Tracker running at http://localhost:${PORT}`);
    if (!TMDB_API_KEY) console.log('⚠  No TMDB_API_KEY set — movie search disabled. See README.');
  });
} else {
  server.listen(PORT);
}

module.exports = server;
