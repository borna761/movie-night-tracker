'use strict';

const STATUSES = [
  { key: 'to_invite', label: 'To Invite' },
  { key: 'invited', label: 'Invited' },
  { key: 'declined', label: 'Declined' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'did_not_show', label: 'Did Not Show' },
  { key: 'attended', label: 'Attended' },
];

const $ = (sel) => document.querySelector(sel);
const api = async (url, opts) => {
  const r = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  return r.json();
};
const esc = (s) => (s == null ? '' : String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));

let chosenMovie = null;
let eventTypes = [];

function updateFavicon(icon) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg'><text y='32' font-size='32'>${icon || '📅'}</text></svg>`;
  $('#favicon').setAttribute('href', `data:image/svg+xml,${encodeURIComponent(svg)}`);
}

// ---------- Tabs ----------
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    tab.classList.add('active');
    $('#' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'families') loadFamilies();
    if (tab.dataset.tab === 'history') loadHistory();
    if (tab.dataset.tab === 'watchlist') loadWatchlist();
    if (tab.dataset.tab === 'board') loadBoard();
    if (tab.dataset.tab === 'event-types') loadEventTypes();
  });
});

// ---------- Board ----------
let boardLoading = false;
let eventActive = false;

async function loadBoard() {
  if (boardLoading) return;
  boardLoading = true;
  const data = await api('/api/event/active');
  boardLoading = false;
  const header = $('#event-header');
  const columns = $('#columns');

  updateFavicon(data.event ? data.event.event_type.icon : null);

  if (!data.event) {
    eventActive = false;
    columns.innerHTML = '';
    header.innerHTML = `
      <div class="empty-board" style="width:100%">
        <p>No event is set up yet.</p>
        <button id="setup-btn">Set up an event</button>
      </div>`;
    $('#setup-btn').addEventListener('click', openModal);
    return;
  }
  eventActive = true;

  const e = data.event;
  const type = e.event_type;
  const fields = JSON.parse(e.fields || '{}');

  if (type.slug === 'movie_night') {
    const year = fields.release_date ? `(${fields.release_date.slice(0, 4)})` : '';
    header.innerHTML = `
      ${fields.poster_path ? `<img src="${esc(fields.poster_path)}" alt="">` : ''}
      <div class="meta">
        <h2>${type.icon} ${esc(e.name || 'Untitled movie')} ${year}</h2>
        <div class="sub">📅 ${esc(e.event_date || 'No date set')}</div>
        <div class="overview">${esc(fields.overview || '')}</div>
      </div>
      <div class="actions">
        <button id="reset-btn" class="ghost">Archive & reset</button>
      </div>`;
  } else {
    header.innerHTML = `
      <div class="meta">
        <h2>${type.icon} ${esc(e.name || 'Untitled event')}</h2>
        <div class="sub">📅 ${esc(e.event_date || 'No date set')}</div>
      </div>
      <div class="actions">
        <button id="reset-btn" class="ghost">Archive & reset</button>
      </div>`;
  }
  $('#reset-btn').addEventListener('click', resetEvent);

  columns.innerHTML = STATUSES.map((s) => {
    const cards = data.board.filter((c) => c.status === s.key);
    return `
      <div class="column" data-status="${s.key}">
        <div class="col-head">
          <span class="col-label"><span class="status-dot" style="background:var(--${s.key})"></span><span class="col-label-text">${s.label}</span></span>
          <span class="col-count">${cards.length}</span>
        </div>
        <div class="col-body" data-status="${s.key}">
          ${cards.map(cardHTML).join('')}
        </div>
      </div>`;
  }).join('');

  wireDragAndDrop();
}

function cardHTML(c) {
  return `
    <div class="card" draggable="true" data-family="${c.family_id}"
         style="border-left-color:var(--${c.status})">
      <div class="name">${esc(c.child_name)}</div>
      ${c.family_name ? `<div class="fam">${esc(c.family_name)}</div>` : ''}
      ${c.notes ? `<div class="note">${esc(c.notes)}</div>` : ''}
    </div>`;
}

function wireDragAndDrop() {
  let dragged = null;
  document.querySelectorAll('.card').forEach((card) => {
    card.addEventListener('dragstart', () => { dragged = card; card.classList.add('dragging'); });
    card.addEventListener('dragend', () => { card.classList.remove('dragging'); dragged = null; });
  });
  document.querySelectorAll('.column').forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      if (!dragged) return;
      const familyId = Number(dragged.dataset.family);
      const status = col.dataset.status;
      await api('/api/attendance', {
        method: 'PUT',
        body: JSON.stringify({ family_id: familyId, status }),
      });
      loadBoard();
    });
  });
}

async function resetEvent() {
  if (!confirm('Archive this event and clear the board? Attendance is saved to History.')) return;
  await api('/api/event/active/reset', { method: 'POST' });
  loadBoard();
}

// ---------- Watchlist (movie-specific) ----------
let wlSearchTimer = null;

async function loadWatchlist() {
  const movies = await api('/api/watchlist');
  const list = $('#wl-list');
  if (!movies.length) {
    list.innerHTML = '<p style="color:var(--muted)">No movies in the watchlist yet. Search above to add some.</p>';
    return;
  }
  const unwatched = movies.filter((m) => !m.last_watched);
  const watched = movies.filter((m) => m.last_watched);
  const watchedSection = watched.length
    ? `<div class="wl-section-header">Watched (${watched.length})</div>${watched.map(wlCardHTML).join('')}`
    : '';
  list.innerHTML = unwatched.map(wlCardHTML).join('') + watchedSection;
  list.querySelectorAll('.wl-remove').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.closest('[data-wl-id]').dataset.wlId;
      await api('/api/watchlist/' + id, { method: 'DELETE' });
      loadWatchlist();
    });
  });
}

function wlCardHTML(m) {
  const year = m.release_date ? m.release_date.slice(0, 4) : '';
  const watchedBadge = m.last_watched
    ? `<div class="wl-watched">✓ Watched ${esc(m.last_watched)}</div>`
    : '';
  return `
    <div class="wl-card${m.last_watched ? ' wl-card--watched' : ''}" data-wl-id="${m.id}">
      ${m.poster_path ? `<img src="${esc(m.poster_path)}" alt="">` : ''}
      <div class="wl-info">
        <div class="wl-title">${esc(m.title)}</div>
        <div class="wl-year">${year}</div>
        ${m.overview ? `<div class="wl-overview">${esc(m.overview)}</div>` : ''}
        ${watchedBadge}
      </div>
      <div class="wl-actions">
        <button class="ghost wl-remove" style="font-size:12px;padding:5px">Remove</button>
      </div>
    </div>`;
}

$('#wl-search').addEventListener('input', (e) => {
  clearTimeout(wlSearchTimer);
  const q = e.target.value.trim();
  if (!q) { $('#wl-search-results').innerHTML = ''; return; }
  wlSearchTimer = setTimeout(() => doWlSearch(q), 350);
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('#wl-search') && !e.target.closest('#wl-search-results')) {
    $('#wl-search-results').innerHTML = '';
  }
  if (!e.target.closest('#date-picker')) {
    $('#cal-dropdown')?.classList.add('hidden');
  }
  if (!e.target.closest('#icon-picker')) {
    $('#emoji-dropdown')?.classList.add('hidden');
  }
});

async function doWlSearch(q) {
  const res = await api('/api/movies/search?q=' + encodeURIComponent(q));
  const box = $('#wl-search-results');
  if (res.error === 'no_api_key') {
    box.innerHTML = '<p style="color:var(--muted);font-size:13px">No TMDB API key — set TMDB_API_KEY in .env to enable search.</p>';
    return;
  }
  if (!Array.isArray(res) || !res.length) {
    box.innerHTML = '<p style="color:var(--muted);font-size:13px">No results.</p>';
    return;
  }
  box.innerHTML = res.map((m, i) => `
    <div class="result" data-i="${i}" style="cursor:pointer">
      ${m.poster_path ? `<img src="${esc(m.poster_path)}" alt="">` : ''}
      <div>
        <div class="r-title">${esc(m.title)}</div>
        <div class="r-year">${esc(m.release_date || '')}</div>
      </div>
      <span class="wl-add-status" data-i="${i}" style="margin-left:auto;flex-shrink:0;font-size:13px;color:var(--muted)">+ Add</span>
    </div>`).join('');
  box.querySelectorAll('.result').forEach((el) => {
    el.addEventListener('click', async () => {
      if (el.dataset.added) return;
      el.dataset.added = '1';
      const m = res[Number(el.dataset.i)];
      await api('/api/watchlist', { method: 'POST', body: JSON.stringify(m) });
      $('#wl-search').value = '';
      $('#wl-search-results').innerHTML = '';
      loadWatchlist();
    });
  });
}

// ---------- Families ----------
async function loadFamilies() {
  const families = await api('/api/families');
  const list = $('#family-list');
  if (!families.length) {
    list.innerHTML = '<p style="color:var(--muted)">No children added yet.</p>';
    return;
  }

  const groups = {};
  for (const f of families) {
    const key = f.family_name || '\x00';
    if (!groups[key]) groups[key] = [];
    groups[key].push(f);
  }

  list.innerHTML = Object.entries(groups).map(([key, members]) => {
    const hasFamily = key !== '\x00';
    return `
      <div class="family-group">
        ${hasFamily ? `<div class="family-group-header">
          <span class="family-group-name">${esc(key)}</span>
          <button class="ghost add-sibling-btn" data-family="${esc(key)}" style="font-size:12px;padding:4px 10px">+ Add sibling</button>
        </div>` : ''}
        <div class="family-group-cards">
          ${members.map((f) => familyCardHTML(f)).join('')}
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.remove-fam').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.closest('.family-card').dataset.id;
      if (!confirm('Remove this child? Their past attendance stays in History.')) return;
      await api('/api/families/' + id, { method: 'DELETE' });
      loadFamilies();
    });
  });

  list.querySelectorAll('.edit-fam').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const card = e.target.closest('.family-card');
      const id = card.dataset.id;
      const f = families.find((x) => String(x.id) === id);
      card.innerHTML = `
        <input class="edit-child" value="${esc(f.child_name)}" placeholder="Child's name *" />
        <input class="edit-family" value="${esc(f.family_name || '')}" placeholder="Family / last name" style="margin-top:6px" />
        <input class="edit-notes" value="${esc(f.notes || '')}" placeholder="Notes" style="margin-top:6px" />
        <div class="fam-actions" style="margin-top:10px">
          <button class="save-fam">Save</button>
          <button class="ghost cancel-fam">Cancel</button>
        </div>`;
      card.querySelector('.cancel-fam').addEventListener('click', () => loadFamilies());
      card.querySelector('.save-fam').addEventListener('click', async () => {
        const child_name = card.querySelector('.edit-child').value.trim();
        if (!child_name) return;
        await api('/api/families/' + id, {
          method: 'PUT',
          body: JSON.stringify({
            child_name,
            family_name: card.querySelector('.edit-family').value.trim() || null,
            notes: card.querySelector('.edit-notes').value.trim() || null,
          }),
        });
        loadFamilies();
      });
    });
  });

  list.querySelectorAll('.add-sibling-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const familyInput = document.querySelector('#family-form [name="family_name"]');
      const childInput = document.querySelector('#family-form [name="child_name"]');
      familyInput.value = btn.dataset.family;
      childInput.focus();
      document.querySelector('#family-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
}

function familyCardHTML(f) {
  return `
    <div class="family-card" data-id="${f.id}">
      <div class="name">${esc(f.child_name)}</div>
      ${f.notes ? `<div class="note">${esc(f.notes)}</div>` : ''}
      <div class="fam-actions">
        <button class="ghost edit-fam">Edit</button>
        <button class="ghost remove-fam">Remove</button>
      </div>
    </div>`;
}

$('#family-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  await api('/api/families', {
    method: 'POST',
    body: JSON.stringify({
      child_name: fd.get('child_name'),
      family_name: fd.get('family_name'),
      notes: fd.get('notes'),
    }),
  });
  e.target.reset();
  loadFamilies();
});

// ---------- History ----------
async function loadHistory() {
  const events = await api('/api/history');
  const list = $('#history-list');
  if (!events.length) {
    list.innerHTML = '<p style="color:var(--muted)">No archived events yet.</p>';
    return;
  }
  const historyStatusRank = { attended: 0, confirmed: 1, invited: 2, did_not_show: 3, declined: 4 };
  list.innerHTML = events.map((e) => {
    const type = e.event_type;
    const fields = JSON.parse(e.fields || '{}');
    const attendees = (e.attendees || []).filter((a) => a.status === 'attended');
    const chips = (e.attendees || [])
      .filter((a) => a.status !== 'to_invite')
      .sort((a, b) => historyStatusRank[a.status] - historyStatusRank[b.status])
      .map((a) => `<span class="chip" style="border-color:var(--${a.status});color:var(--${a.status})">${esc(a.child_name)}</span>`)
      .join('');
    const year = fields.release_date ? `(${fields.release_date.slice(0, 4)})` : '';
    const poster = type.slug === 'movie_night' && fields.poster_path ? `<img src="${esc(fields.poster_path)}" alt="">` : '';
    return `
      <div class="history-card">
        ${poster}
        <div>
          <h3>${type.icon} ${esc(e.name || 'Untitled')} ${year}</h3>
          <div class="sub">📅 ${esc(e.event_date || '—')} · ✅ ${attendees.length} attended</div>
          <div class="attendee-chips">${chips}</div>
        </div>
      </div>`;
  }).join('');
}

// ---------- Event Types ----------
let pickedIcon = '';
let cfbRows = [];

async function loadEventTypes() {
  eventTypes = await api('/api/event-types');
  const list = $('#event-type-list');
  list.innerHTML = eventTypes.map((t) => {
    const fields = JSON.parse(t.fields || '[]');
    return `
      <div class="event-type-card" data-id="${t.id}">
        <div class="etc-icon">${t.icon}</div>
        <div class="etc-info">
          <div class="etc-name">${esc(t.name)}</div>
          ${fields.length ? `<div class="etc-fields">${fields.map((f) => esc(f.label)).join(', ')}</div>` : ''}
        </div>
        ${t.builtin ? '<span class="etc-builtin">Built-in</span>' : '<button class="ghost etc-delete" style="font-size:12px;padding:5px 10px">Delete</button>'}
      </div>`;
  }).join('');
  list.querySelectorAll('.etc-delete').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.closest('.event-type-card').dataset.id;
      if (!confirm('Delete this event type?')) return;
      const r = await api('/api/event-types/' + id, { method: 'DELETE' });
      if (r.error) { alert(r.error); return; }
      loadEventTypes();
    });
  });
}

function renderCfbRows() {
  $('#cfb-rows').innerHTML = cfbRows.map((r, i) => `
    <div class="cfb-row" data-i="${i}">
      <input class="cfb-label" placeholder="Field label" value="${esc(r.label)}" />
      <select class="cfb-type">
        <option value="text" ${r.type === 'text' ? 'selected' : ''}>Text</option>
        <option value="textarea" ${r.type === 'textarea' ? 'selected' : ''}>Long text</option>
        <option value="date" ${r.type === 'date' ? 'selected' : ''}>Date</option>
        <option value="number" ${r.type === 'number' ? 'selected' : ''}>Number</option>
      </select>
      <button type="button" class="ghost cfb-remove" style="font-size:12px;padding:5px 8px">✕</button>
    </div>`).join('');
  $('#cfb-rows').querySelectorAll('.cfb-row').forEach((row) => {
    const i = Number(row.dataset.i);
    row.querySelector('.cfb-label').addEventListener('input', (e) => { cfbRows[i].label = e.target.value; });
    row.querySelector('.cfb-type').addEventListener('change', (e) => { cfbRows[i].type = e.target.value; });
    row.querySelector('.cfb-remove').addEventListener('click', () => { cfbRows.splice(i, 1); renderCfbRows(); });
  });
}
$('#cfb-add').addEventListener('click', () => { cfbRows.push({ label: '', type: 'text' }); renderCfbRows(); });

$('#icon-picker-btn').addEventListener('click', () => {
  const dropdown = $('#emoji-dropdown');
  if (!dropdown.classList.contains('hidden')) { dropdown.classList.add('hidden'); return; }
  if (!dropdown.dataset.built) {
    dropdown.innerHTML = Object.entries(EMOJI_LIBRARY).map(([cat, emojis]) => `
      <div class="emoji-cat-label">${esc(cat)}</div>
      <div class="emoji-grid">
        ${emojis.map((em) => `<button type="button" class="emoji-opt" data-emoji="${em}">${em}</button>`).join('')}
      </div>`).join('');
    dropdown.dataset.built = '1';
    dropdown.querySelectorAll('.emoji-opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        pickedIcon = btn.dataset.emoji;
        $('#icon-picker-btn').textContent = pickedIcon;
        dropdown.classList.add('hidden');
      });
    });
  }
  const rect = $('#icon-picker-btn').getBoundingClientRect();
  dropdown.style.top = `${rect.bottom + 6}px`;
  dropdown.style.left = `${rect.left}px`;
  dropdown.classList.remove('hidden');
});

$('#event-type-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const name = fd.get('name').trim();
  if (!name || !pickedIcon) { alert('Name and icon are required.'); return; }
  const fields = cfbRows.filter((r) => r.label.trim()).map((r) => ({
    key: r.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    label: r.label.trim(),
    type: r.type,
  }));
  await api('/api/event-types', { method: 'POST', body: JSON.stringify({ name, icon: pickedIcon, fields }) });
  e.target.reset();
  pickedIcon = '';
  $('#icon-picker-btn').textContent = 'Pick icon 🙂';
  cfbRows = [];
  renderCfbRows();
  loadEventTypes();
});

// ---------- Custom Monday-first calendar ----------
const cal = { year: 0, month: 0, selected: null };
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function calOpen(date) {
  cal.selected = date;
  cal.year = date.getFullYear();
  cal.month = date.getMonth();
  calRender();
  const rect = $('#event-date-display').getBoundingClientRect();
  const dropdown = $('#cal-dropdown');
  dropdown.style.top = `${rect.bottom + 6}px`;
  dropdown.style.left = `${rect.left}px`;
  dropdown.classList.remove('hidden');
}

function calSetSelected(date) {
  cal.selected = date;
  const iso = dateToIso(date);
  $('#event-date').value = iso;
  $('#event-date-display').value = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function dateToIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function calRender() {
  $('#cal-month-label').textContent = `${MONTHS[cal.month]} ${cal.year}`;
  const firstDow = new Date(cal.year, cal.month, 1).getDay();
  const offset = (firstDow + 6) % 7;
  const daysInMonth = new Date(cal.year, cal.month + 1, 0).getDate();
  const today = new Date();
  const cells = offset + daysInMonth;
  const total = Math.ceil(cells / 7) * 7;
  let html = '';
  for (let i = 0; i < total; i++) {
    const day = i - offset + 1;
    if (day < 1 || day > daysInMonth) { html += '<div class="cal-cell cal-empty"></div>'; continue; }
    const d = new Date(cal.year, cal.month, day);
    const isToday = d.toDateString() === today.toDateString();
    const isSel = cal.selected && d.toDateString() === cal.selected.toDateString();
    html += `<div class="cal-cell${isToday?' cal-today':''}${isSel?' cal-selected':''}" data-day="${day}">${day}</div>`;
  }
  $('#cal-days').innerHTML = html;
  $('#cal-days').querySelectorAll('.cal-cell[data-day]').forEach((el) => {
    el.addEventListener('click', () => {
      calSetSelected(new Date(cal.year, cal.month, Number(el.dataset.day)));
      $('#cal-dropdown').classList.add('hidden');
    });
  });
}

$('#event-date-display').addEventListener('click', () => {
  if (!$('#cal-dropdown').classList.contains('hidden')) {
    $('#cal-dropdown').classList.add('hidden');
    return;
  }
  calOpen(cal.selected || new Date());
});

$('#cal-prev').addEventListener('click', (e) => {
  e.stopPropagation();
  cal.month--; if (cal.month < 0) { cal.month = 11; cal.year--; }
  calRender();
});
$('#cal-next').addEventListener('click', (e) => {
  e.stopPropagation();
  cal.month++; if (cal.month > 11) { cal.month = 0; cal.year++; }
  calRender();
});

// ---------- Modal (set up event) ----------
function currentModalType() {
  return eventTypes.find((t) => String(t.id) === $('#event-type-select').value);
}

async function openModal() {
  chosenMovie = null;
  calSetSelected(new Date());
  if (!eventTypes.length) eventTypes = await api('/api/event-types');
  const select = $('#event-type-select');
  select.innerHTML = eventTypes.map((t) => `<option value="${t.id}">${t.icon} ${esc(t.name)}</option>`).join('');
  await renderModalTypeExtra();
  $('#modal').classList.remove('hidden');
}
function closeModal() { $('#modal').classList.add('hidden'); }

$('#modal-cancel').addEventListener('click', closeModal);
$('#event-type-select').addEventListener('change', renderModalTypeExtra);

async function renderModalTypeExtra() {
  const type = currentModalType();
  const box = $('#modal-type-extra');
  if (!type) { box.innerHTML = ''; return; }

  if (type.slug === 'movie_night') {
    chosenMovie = null;
    box.innerHTML = `
      <div id="modal-watchlist-section"></div>
      <label>Search TMDB for a movie
        <input type="text" id="movie-search" placeholder="Type a title…" autocomplete="off" />
      </label>
      <div id="search-results" class="search-results"></div>
      <div id="chosen-movie" class="chosen-movie"></div>`;
    wireMovieSearch();
    await renderWatchlistPicker();
    return;
  }

  const fields = JSON.parse(type.fields || '[]');
  box.innerHTML = `
    <label>Name
      <input type="text" id="event-name" placeholder="e.g. ${esc(type.name)}" />
    </label>
    ${fields.map((f) => customFieldInputHTML(f)).join('')}`;
}

function customFieldInputHTML(f) {
  const id = `cf-${f.key}`;
  if (f.type === 'textarea') return `<label>${esc(f.label)}<textarea id="${id}" rows="3"></textarea></label>`;
  const inputType = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text';
  return `<label>${esc(f.label)}<input type="${inputType}" id="${id}" /></label>`;
}

let searchTimer = null;
function wireMovieSearch() {
  $('#movie-search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    document.querySelectorAll('.modal-wl-item').forEach((x) => x.classList.remove('selected'));
    const q = e.target.value.trim();
    if (!q) { $('#search-results').innerHTML = ''; return; }
    searchTimer = setTimeout(() => doSearch(q), 350);
  });
}

async function renderWatchlistPicker() {
  const wl = (await api('/api/watchlist')).filter((m) => !m.last_watched);
  const sec = $('#modal-watchlist-section');
  if (!sec) return;
  if (wl.length) {
    sec.innerHTML = `
      <div class="modal-watchlist-section">
        <h3>Pick from your watchlist</h3>
        <div class="modal-wl-scroll">
          ${wl.map((m) => `
            <div class="modal-wl-item" data-wl='${JSON.stringify(m).replace(/'/g, '&#39;')}'>
              ${m.poster_path ? `<img src="${esc(m.poster_path)}" alt="">` : ''}
              <div class="mwl-title">${esc(m.title)}</div>
            </div>`).join('')}
        </div>
      </div>`;
    sec.querySelectorAll('.modal-wl-item').forEach((el) => {
      el.addEventListener('click', () => {
        sec.querySelectorAll('.modal-wl-item').forEach((x) => x.classList.remove('selected'));
        el.classList.add('selected');
        const m = JSON.parse(el.dataset.wl);
        pickMovie(m);
      });
    });
  } else {
    sec.innerHTML = '';
  }
}

async function doSearch(q) {
  const res = await api('/api/movies/search?q=' + encodeURIComponent(q));
  const box = $('#search-results');
  if (!box) return;
  if (res.error === 'no_api_key') {
    box.innerHTML = '<p style="color:var(--muted);font-size:13px">No TMDB API key set — see README.</p>';
    return;
  }
  if (!Array.isArray(res) || !res.length) {
    box.innerHTML = '<p style="color:var(--muted);font-size:13px">No results.</p>';
    return;
  }
  box.innerHTML = res.map((m, i) => `
    <div class="result" data-i="${i}">
      ${m.poster_path ? `<img src="${esc(m.poster_path)}" alt="">` : ''}
      <div>
        <div class="r-title">${esc(m.title)}</div>
        <div class="r-year">${esc(m.release_date || '')}</div>
      </div>
    </div>`).join('');
  box.querySelectorAll('.result').forEach((el) => {
    el.addEventListener('click', () => pickMovie(res[Number(el.dataset.i)]));
  });
}

function pickMovie(m) {
  chosenMovie = m;
  $('#search-results').innerHTML = '';
  $('#movie-search').value = m.title;
  $('#chosen-movie').innerHTML = `
    <div class="picked">
      ${m.poster_path ? `<img src="${esc(m.poster_path)}" alt="">` : ''}
      <div>
        <div class="r-title">${esc(m.title)}</div>
        <div class="r-year">${esc(m.release_date || '')}</div>
      </div>
    </div>`;
}

$('#modal-start').addEventListener('click', async () => {
  const type = currentModalType();
  if (!type) { alert('Pick an event type.'); return; }
  const event_date = $('#event-date').value;
  let name = null;
  let fields = {};

  if (type.slug === 'movie_night') {
    name = chosenMovie ? chosenMovie.title : ($('#movie-search').value.trim() || null);
    fields = {
      tmdb_id: chosenMovie ? chosenMovie.tmdb_id : null,
      poster_path: chosenMovie ? chosenMovie.poster_path : null,
      release_date: chosenMovie ? chosenMovie.release_date : null,
      overview: chosenMovie ? chosenMovie.overview : null,
    };
  } else {
    const nameEl = $('#event-name');
    name = nameEl ? nameEl.value.trim() || null : null;
    for (const f of JSON.parse(type.fields || '[]')) {
      const el = document.getElementById(`cf-${f.key}`);
      if (el) fields[f.key] = el.value || null;
    }
  }

  const res = await api('/api/event', {
    method: 'POST',
    body: JSON.stringify({ event_type_id: type.id, name, event_date, fields }),
  });
  if (res.error) { alert(res.error); return; }
  closeModal();
  loadBoard();
});

// ---------- init ----------
loadBoard();
api('/api/event-types').then((types) => { eventTypes = types; });

// Reload the board every 60 s, but only when the board tab is visible and the
// document isn't hidden (e.g. phone screen off or tab in background).
setInterval(() => {
  const boardActive = document.getElementById('board').classList.contains('active');
  if (boardActive && !document.hidden && eventActive) loadBoard();
}, 60_000);
