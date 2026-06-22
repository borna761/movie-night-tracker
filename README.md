# 🎬 Movie Night Tracker

A local-only Kanban tracker for home movie nights. No accounts, no cloud — it
runs on your machine and stores everything in a local SQLite file
(`movie-night.db`).

> **Local use only.** The app has no authentication. Do not expose it to the
> internet or run it on a shared/public server.

## Features

- **Kanban board** with six columns: To Invite → Invited → Declined →
  Confirmed → Did Not Show → Attended. Drag a child's card between columns.
- **Families** tab: add / remove a card per child (with family name + notes),
  group siblings under a shared family header.
- **Watchlist** tab: search TMDB for movies to watch later; the board modal
  lets you pick from unwatched entries.
- **Movie lookup** via [TMDB](https://www.themoviedb.org/) — search by title
  and pull the poster, release date, and synopsis.
- **Archive & reset** — when a movie night is over, one click archives the
  board (movie, date, and everyone's final status) to History and clears it
  for the next night.
- **History** tab: every past night with who attended/declined/no-showed.

## Requirements

Node.js 22+ (uses the built-in `node:sqlite` and global `fetch`).
Zero npm dependencies — no `npm install` needed.

## Setup

```bash
cp .env.example .env
# Edit .env and paste your TMDB Bearer token (see below)
```

## Run

```bash
node server.js
```

Then open <http://localhost:4321>.

To change the port: `PORT=5000 node server.js`.

## Getting a TMDB API key (free)

1. Make a free account at <https://www.themoviedb.org/signup>.
2. Go to Settings → API → request an API key (choose "Developer").
3. Copy the **API Read Access Token** (the long `eyJ...` v4 Bearer token).
4. Paste it into your `.env` file as `TMDB_API_KEY`.

Movie search is the only feature that needs the key. Without it, you can still
set a night up by typing a title manually; you just won't get posters or
auto-filled details.

## Data & backups

Everything lives in `movie-night.db` (plus WAL sidecar files) in this folder.
Back it up by copying that file. Delete it to start fresh.
