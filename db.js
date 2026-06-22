'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const dbPath = path.join(__dirname, 'movie-night.db');
const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS families (
    id          INTEGER PRIMARY KEY,
    child_name  TEXT NOT NULL,
    family_name TEXT,
    notes       TEXT,
    archived    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS nights (
    id           INTEGER PRIMARY KEY,
    title        TEXT,
    movie_date   TEXT,
    tmdb_id      INTEGER,
    poster_path  TEXT,
    release_date TEXT,
    overview     TEXT,
    is_active    INTEGER NOT NULL DEFAULT 1,
    archived_at  TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
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
    night_id   INTEGER NOT NULL REFERENCES nights(id) ON DELETE CASCADE,
    family_id  INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    status     TEXT NOT NULL DEFAULT 'invited',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(night_id, family_id)
  );
`);

module.exports = db;
