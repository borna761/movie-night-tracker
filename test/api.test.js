'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
process.env.PORT = '0';

const server = require('../server.js');

function base() {
  return `http://localhost:${server.address().port}`;
}

test.before(() => new Promise((resolve) => {
  if (server.listening) return resolve();
  server.once('listening', resolve);
}));

test.after(() => new Promise((resolve) => server.close(resolve)));

// ---------- event types ----------
test('GET /api/event-types includes the two seeded builtin types', async () => {
  const res = await fetch(`${base()}/api/event-types`);
  assert.equal(res.status, 200);
  const types = await res.json();
  const slugs = types.map((t) => t.slug).sort();
  assert.deepEqual(slugs, ['movie_night', 'service_project']);
  const movie = types.find((t) => t.slug === 'movie_night');
  assert.equal(movie.icon, '🎬');
  assert.equal(movie.builtin, 1);
});

test('POST /api/event-types creates a custom type', async () => {
  const res = await fetch(`${base()}/api/event-types`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Potluck',
      icon: '🍲',
      fields: [{ key: 'dish_theme', label: 'Dish theme', type: 'text' }],
    }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.name, 'Potluck');
  assert.equal(body.icon, '🍲');
  assert.equal(body.builtin, 0);
  assert.deepEqual(JSON.parse(body.fields), [{ key: 'dish_theme', label: 'Dish theme', type: 'text' }]);
});

test('POST /api/event-types requires name and icon', async () => {
  const res = await fetch(`${base()}/api/event-types`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'No Icon' }),
  });
  assert.equal(res.status, 400);
});

test('DELETE /api/event-types/:id refuses to delete a builtin type', async () => {
  const types = await (await fetch(`${base()}/api/event-types`)).json();
  const movie = types.find((t) => t.slug === 'movie_night');
  const res = await fetch(`${base()}/api/event-types/${movie.id}`, { method: 'DELETE' });
  assert.equal(res.status, 403);
});

// ---------- families ----------
test('POST /api/families creates a family', async () => {
  const res = await fetch(`${base()}/api/families`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ child_name: 'Alice', family_name: 'Smith' }),
  });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).child_name, 'Alice');
});

// ---------- event lifecycle (generalized) ----------
test('GET /api/event/active is null when nothing is active', async () => {
  const res = await fetch(`${base()}/api/event/active`);
  const body = await res.json();
  assert.equal(body.event, null);
  assert.deepEqual(body.board, []);
});

test('POST /api/event creates an active service_project event and seeds attendance', async () => {
  const types = await (await fetch(`${base()}/api/event-types`)).json();
  const serviceType = types.find((t) => t.slug === 'service_project');
  const res = await fetch(`${base()}/api/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_type_id: serviceType.id, name: 'Park Cleanup', event_date: '2026-09-10' }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.event.name, 'Park Cleanup');
  assert.equal(body.event.event_type.slug, 'service_project');
  assert.equal(body.board.length, 1);
  assert.equal(body.board[0].status, 'to_invite');
});

test('POST /api/event fails when one is already active, regardless of type', async () => {
  const types = await (await fetch(`${base()}/api/event-types`)).json();
  const movieType = types.find((t) => t.slug === 'movie_night');
  const res = await fetch(`${base()}/api/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_type_id: movieType.id, name: 'Some Movie', event_date: '2026-09-11' }),
  });
  assert.equal(res.status, 409);
});

test('PUT /api/attendance updates status on the active event', async () => {
  const res = await fetch(`${base()}/api/attendance`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ family_id: 1, status: 'attended' }),
  });
  assert.equal(res.status, 200);
  const active = await (await fetch(`${base()}/api/event/active`)).json();
  assert.equal(active.board[0].status, 'attended');
});

test('POST /api/event/active/reset archives the active event', async () => {
  const res = await fetch(`${base()}/api/event/active/reset`, { method: 'POST' });
  assert.equal(res.status, 200);
  const active = await (await fetch(`${base()}/api/event/active`)).json();
  assert.equal(active.event, null);
});

test('GET /api/history shows the archived event with its type and attendees', async () => {
  const res = await fetch(`${base()}/api/history`);
  assert.equal(res.status, 200);
  const history = await res.json();
  assert.equal(history.length, 1);
  assert.equal(history[0].name, 'Park Cleanup');
  assert.equal(history[0].event_type.slug, 'service_project');
  const alice = history[0].attendees.find((a) => a.child_name === 'Alice');
  assert.equal(alice.status, 'attended');
});

// ---------- movie-specific behavior ----------
test('POST /api/event with movie_night type stores movie fields and adds to watchlist', async () => {
  const types = await (await fetch(`${base()}/api/event-types`)).json();
  const movieType = types.find((t) => t.slug === 'movie_night');
  const res = await fetch(`${base()}/api/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event_type_id: movieType.id,
      name: 'Back to the Future',
      event_date: '2026-09-12',
      fields: { tmdb_id: 105, poster_path: '/x.jpg', release_date: '1985-07-03', overview: 'Time travel.' },
    }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  const fields = JSON.parse(body.event.fields);
  assert.equal(fields.tmdb_id, 105);

  const watchlist = await (await fetch(`${base()}/api/watchlist`)).json();
  assert.ok(watchlist.some((w) => w.title === 'Back to the Future'));
});

test('GET /api/watchlist shows last_watched after the movie event is archived', async () => {
  await fetch(`${base()}/api/event/active/reset`, { method: 'POST' });
  const watchlist = await (await fetch(`${base()}/api/watchlist`)).json();
  const btf = watchlist.find((w) => w.title === 'Back to the Future');
  assert.equal(btf.last_watched, '2026-09-12');
});

// ---------- ideas (generic per-event-type picklist) ----------
test('GET /api/ideas includes Park Cleanup, auto-added when the event was created, marked used', async () => {
  const res = await fetch(`${base()}/api/ideas`);
  assert.equal(res.status, 200);
  const ideas = await res.json();
  const parkCleanup = ideas.find((i) => i.name === 'Park Cleanup');
  assert.ok(parkCleanup, 'Park Cleanup should have been auto-added as an idea');
  assert.equal(parkCleanup.event_type.slug, 'service_project');
  assert.equal(parkCleanup.last_used, '2026-09-10');
});

test('movie_night events are not auto-added to the generic ideas list (they use watchlist)', async () => {
  const ideas = await (await fetch(`${base()}/api/ideas`)).json();
  assert.ok(!ideas.some((i) => i.name === 'Back to the Future'));
});

test('POST /api/ideas creates a new idea for a type', async () => {
  const types = await (await fetch(`${base()}/api/event-types`)).json();
  const serviceType = types.find((t) => t.slug === 'service_project');
  const res = await fetch(`${base()}/api/ideas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_type_id: serviceType.id, name: 'Food Bank Sorting', notes: 'Bring gloves' }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.name, 'Food Bank Sorting');
  assert.equal(body.notes, 'Bring gloves');
});

test('POST /api/ideas requires name and event_type_id', async () => {
  const res = await fetch(`${base()}/api/ideas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'No type' }),
  });
  assert.equal(res.status, 400);
});

test('DELETE /api/ideas/:id removes an idea', async () => {
  const ideas = await (await fetch(`${base()}/api/ideas`)).json();
  const foodBank = ideas.find((i) => i.name === 'Food Bank Sorting');
  const res = await fetch(`${base()}/api/ideas/${foodBank.id}`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  const remaining = await (await fetch(`${base()}/api/ideas`)).json();
  assert.ok(!remaining.some((i) => i.id === foodBank.id));
});

test('creating an event for a custom type also auto-adds an idea', async () => {
  const typeRes = await fetch(`${base()}/api/event-types`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Bake Sale', icon: '🧁', fields: [] }),
  });
  const bakeSale = await typeRes.json();
  await fetch(`${base()}/api/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_type_id: bakeSale.id, name: 'Fall Feast', event_date: '2026-10-01' }),
  });
  const ideas = await (await fetch(`${base()}/api/ideas`)).json();
  assert.ok(ideas.some((i) => i.name === 'Fall Feast' && i.event_type.slug === 'bake_sale'));
});
