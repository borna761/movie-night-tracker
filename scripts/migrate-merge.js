'use strict';

// One-time migration: merges a movie-night-tracker DB and a
// service-project-tracker DB into a single event-tracker DB.
//
// Usage:
//   node scripts/migrate-merge.js <movie-night.db> <service-projects.db> <output.db>

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const [, , movieDbPath, serviceDbPath, outputDbPath] = process.argv;
if (!movieDbPath || !serviceDbPath || !outputDbPath) {
  console.error('Usage: node scripts/migrate-merge.js <movie-night.db> <service-projects.db> <output.db>');
  process.exit(1);
}

// Known spelling mismatch between the two source databases, confirmed by the
// user: "Adrianne" (service-project-tracker's spelling) is correct.
const FAMILY_NAME_CORRECTIONS = { adrienne: 'Adrianne' };

function normalizeKey(childName, familyName) {
  const fam = (familyName || '').trim().toLowerCase();
  const correctedFam = FAMILY_NAME_CORRECTIONS[fam] ? FAMILY_NAME_CORRECTIONS[fam].toLowerCase() : fam;
  return `${childName.trim().toLowerCase()}|${correctedFam}`;
}

function canonicalFamilyName(familyName) {
  const fam = (familyName || '').trim();
  const corrected = FAMILY_NAME_CORRECTIONS[fam.toLowerCase()];
  return corrected || familyName;
}

const movieDb = new DatabaseSync(movieDbPath, { readOnly: true });
const serviceDb = new DatabaseSync(serviceDbPath, { readOnly: true });
const db = new DatabaseSync(outputDbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE event_types (
    id         INTEGER PRIMARY KEY,
    slug       TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    icon       TEXT NOT NULL,
    fields     TEXT NOT NULL DEFAULT '[]',
    builtin    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE families (
    id          INTEGER PRIMARY KEY,
    child_name  TEXT NOT NULL,
    family_name TEXT,
    notes       TEXT,
    archived    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE events (
    id            INTEGER PRIMARY KEY,
    event_type_id INTEGER NOT NULL REFERENCES event_types(id),
    name          TEXT,
    event_date    TEXT,
    fields        TEXT NOT NULL DEFAULT '{}',
    is_active     INTEGER NOT NULL DEFAULT 1,
    archived_at   TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE watchlist (
    id           INTEGER PRIMARY KEY,
    title        TEXT NOT NULL,
    tmdb_id      INTEGER,
    poster_path  TEXT,
    release_date TEXT,
    overview     TEXT,
    added_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE attendance (
    id         INTEGER PRIMARY KEY,
    event_id   INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    family_id  INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    status     TEXT NOT NULL DEFAULT 'invited',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(event_id, family_id)
  );
`);

const movieTypeId = db.prepare(
  "INSERT INTO event_types (slug, name, icon, builtin) VALUES ('movie_night', 'Movie Night', '🎬', 1)"
).run().lastInsertRowid;
const serviceTypeId = db.prepare(
  "INSERT INTO event_types (slug, name, icon, builtin) VALUES ('service_project', 'Service Project', '🤝', 1)"
).run().lastInsertRowid;

// ---------- families ----------
const movieFamilies = movieDb.prepare('SELECT * FROM families').all();
const serviceFamilies = serviceDb.prepare('SELECT * FROM families').all();

const insertFamily = db.prepare(
  'INSERT INTO families (child_name, family_name, notes, archived, created_at) VALUES (?, ?, ?, ?, ?)'
);

const byKey = new Map(); // normalized key -> new family id
const movieFamilyIdMap = new Map(); // old movie family id -> new id
const serviceFamilyIdMap = new Map(); // old service family id -> new id

// Insert service families first — their spelling is the confirmed-correct source for name conflicts.
for (const f of serviceFamilies) {
  const key = normalizeKey(f.child_name, f.family_name);
  const info = insertFamily.run(
    f.child_name, canonicalFamilyName(f.family_name), f.notes, f.archived, f.created_at
  );
  byKey.set(key, info.lastInsertRowid);
  serviceFamilyIdMap.set(f.id, info.lastInsertRowid);
}

for (const f of movieFamilies) {
  const key = normalizeKey(f.child_name, f.family_name);
  if (byKey.has(key)) {
    movieFamilyIdMap.set(f.id, byKey.get(key));
    continue;
  }
  const info = insertFamily.run(
    f.child_name, canonicalFamilyName(f.family_name), f.notes, f.archived, f.created_at
  );
  byKey.set(key, info.lastInsertRowid);
  movieFamilyIdMap.set(f.id, info.lastInsertRowid);
}

// ---------- events (from movie nights) ----------
const insertEvent = db.prepare(
  'INSERT INTO events (event_type_id, name, event_date, fields, is_active, archived_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
const nightIdMap = new Map();
for (const n of movieDb.prepare('SELECT * FROM nights').all()) {
  const fields = JSON.stringify({
    tmdb_id: n.tmdb_id, poster_path: n.poster_path, release_date: n.release_date, overview: n.overview,
  });
  const info = insertEvent.run(movieTypeId, n.title, n.movie_date, fields, n.is_active, n.archived_at, n.created_at);
  nightIdMap.set(n.id, info.lastInsertRowid);
}

// ---------- events (from service projects) ----------
const projectIdMap = new Map();
for (const p of serviceDb.prepare('SELECT * FROM projects').all()) {
  const info = insertEvent.run(serviceTypeId, p.name, p.project_date, '{}', p.is_active, p.archived_at, p.created_at);
  projectIdMap.set(p.id, info.lastInsertRowid);
}

// ---------- attendance ----------
const insertAttendance = db.prepare(
  'INSERT OR IGNORE INTO attendance (event_id, family_id, status, updated_at) VALUES (?, ?, ?, ?)'
);
for (const a of movieDb.prepare('SELECT * FROM attendance').all()) {
  const eventId = nightIdMap.get(a.night_id);
  const familyId = movieFamilyIdMap.get(a.family_id);
  if (eventId && familyId) insertAttendance.run(eventId, familyId, a.status, a.updated_at);
}
for (const a of serviceDb.prepare('SELECT * FROM attendance').all()) {
  const eventId = projectIdMap.get(a.project_id);
  const familyId = serviceFamilyIdMap.get(a.family_id);
  if (eventId && familyId) insertAttendance.run(eventId, familyId, a.status, a.updated_at);
}

// ---------- watchlist ----------
const insertWatchlist = db.prepare(
  'INSERT INTO watchlist (title, tmdb_id, poster_path, release_date, overview, added_at) VALUES (?, ?, ?, ?, ?, ?)'
);
for (const w of movieDb.prepare('SELECT * FROM watchlist').all()) {
  insertWatchlist.run(w.title, w.tmdb_id, w.poster_path, w.release_date, w.overview, w.added_at);
}

// ---------- summary ----------
console.log('Migration complete:');
console.log(`  families:   ${db.prepare('SELECT COUNT(*) AS n FROM families').get().n} (movie: ${movieFamilies.length}, service: ${serviceFamilies.length})`);
console.log(`  events:     ${db.prepare('SELECT COUNT(*) AS n FROM events').get().n}`);
console.log(`  attendance: ${db.prepare('SELECT COUNT(*) AS n FROM attendance').get().n}`);
console.log(`  watchlist:  ${db.prepare('SELECT COUNT(*) AS n FROM watchlist').get().n}`);
console.log(`  active event: ${JSON.stringify(db.prepare('SELECT id, name FROM events WHERE is_active = 1').all())}`);
