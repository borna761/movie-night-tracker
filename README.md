# 📅 Event Tracker

A local-only Kanban tracker for family/community events. No accounts, no
cloud — it runs on your machine and stores everything in a local SQLite file
(`event-tracker.db`).

> **Local use only.** The app has no authentication. Do not expose it to the
> internet or run it on a shared/public server.

## Features

- **Kanban board** with six columns: To Invite → Invited → Declined →
  Confirmed → Did Not Show → Attended. Drag a child's card between columns.
- **Event types**: two built in (Movie Night 🎬, Service Project 🤝) plus any
  custom types you create — pick an emoji icon and define your own extra
  fields per type. Only one event can be active at a time, and creating an
  event means picking its type first; the relevant fields show up
  automatically.
- **Dynamic favicon**: the browser tab icon reflects whichever event type is
  currently active.
- **Families** tab: add / remove a card per child (with family name + notes),
  group siblings under a shared family header. Shared across all event types.
- **Watchlist** tab (Movie Night specific): search TMDB for movies to watch
  later; the setup modal lets you pick from unwatched entries.
- **Archive & reset** — when an event is over, one click archives the board
  (name, date, custom fields, and everyone's final status) to History and
  clears it for the next event.
- **History** tab: every past event with who attended/declined/no-showed.

## Requirements

Node.js 22+ (uses the built-in `node:sqlite` and global `fetch`).
Zero npm dependencies — no `npm install` needed.

## Setup

```bash
cp .env.example .env
# Edit .env and paste your TMDB Bearer token (see below) — only needed for
# the Movie Night event type's search feature.
```

## Run

```bash
node server.js
```

Then open <http://localhost:4321>.

To change the port: `PORT=5000 node server.js`.

## Tests

```bash
npm test
```

Runs the API test suite against an in-memory database via Node's built-in
test runner.

## Getting a TMDB API key (free)

1. Make a free account at <https://www.themoviedb.org/signup>.
2. Go to Settings → API → request an API key (choose "Developer").
3. Copy the **API Read Access Token** (the long `eyJ...` v4 Bearer token).
4. Paste it into your `.env` file as `TMDB_API_KEY`.

Movie search is only used by the Movie Night event type. Without a key, you
can still set up a movie night by typing a title manually; you just won't get
posters or auto-filled details.

## Data & backups

Everything lives in `event-tracker.db` (plus WAL sidecar files) in this
folder. Back it up by copying that file. Delete it to start fresh.
