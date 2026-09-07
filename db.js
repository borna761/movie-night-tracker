'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'event-tracker.db');
const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS event_types (
    id         INTEGER PRIMARY KEY,
    slug       TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    icon       TEXT NOT NULL,
    fields     TEXT NOT NULL DEFAULT '[]',
    builtin    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS families (
    id          INTEGER PRIMARY KEY,
    child_name  TEXT NOT NULL,
    family_name TEXT,
    notes       TEXT,
    archived    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS events (
    id            INTEGER PRIMARY KEY,
    event_type_id INTEGER NOT NULL REFERENCES event_types(id),
    name          TEXT,
    event_date    TEXT,
    fields        TEXT NOT NULL DEFAULT '{}',
    is_active     INTEGER NOT NULL DEFAULT 1,
    archived_at   TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS event_ideas (
    id            INTEGER PRIMARY KEY,
    event_type_id INTEGER NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    notes         TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS watchlist (
    id           INTEGER PRIMARY KEY,
    title        TEXT NOT NULL,
    tmdb_id      INTEGER,
    poster_path  TEXT,
    release_date TEXT,
    overview     TEXT,
    added_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id         INTEGER PRIMARY KEY,
    event_id   INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    family_id  INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    status     TEXT NOT NULL DEFAULT 'invited',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(event_id, family_id)
  );

  INSERT OR IGNORE INTO event_types (slug, name, icon, builtin) VALUES ('movie_night', 'Movie Night', '🎬', 1);
  INSERT OR IGNORE INTO event_types (slug, name, icon, builtin) VALUES ('service_project', 'Service Project', '🤝', 1);
`);

module.exports = db;
