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
  });
});

// ---------- Board ----------
let boardLoading = false;
let nightActive = false;

async function loadBoard() {
  if (boardLoading) return;
  boardLoading = true;
  const data = await api('/api/night/active');
  boardLoading = false;
  const header = $('#movie-header');
  const columns = $('#columns');

  if (!data.night) {
    nightActive = false;
    columns.innerHTML = '';
    header.innerHTML = `
      <div class="empty-board" style="width:100%">
        <p>No movie night is set up yet.</p>
        <button id="setup-btn">Set up a movie night</button>
      </div>`;
    $('#setup-btn').addEventListener('click', openModal);
    return;
  }
  nightActive = true;

  const n = data.night;
  const year = n.release_date ? `(${n.release_date.slice(0, 4)})` : '';
  header.innerHTML = `
    ${n.poster_path ? `<img src="${esc(n.poster_path)}" alt="">` : ''}
    <div class="meta">
      <h2>${esc(n.title || 'Untitled movie')} ${year}</h2>
      <div class="sub">📅 ${esc(n.movie_date || 'No date set')}</div>
      <div class="overview">${esc(n.overview || '')}</div>
    </div>
    <div class="actions">
      <button id="reset-btn" class="ghost">Archive & reset</button>
    </div>`;
  $('#reset-btn').addEventListener('click', resetNight);

  columns.innerHTML = STATUSES.map((s) => {
    const cards = data.board.filter((c) => c.status === s.key);
    return `
      <div class="column" data-status="${s.key}">
        <div class="col-head">
          <span class="col-label"><span class="dot" style="background:var(--${s.key})"></span><span class="col-label-text">${s.label}</span></span>
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

async function resetNight() {
  if (!confirm('Archive this movie night and clear the board? Attendance is saved to History.')) return;
  await api('/api/night/active/reset', { method: 'POST' });
  loadBoard();
}

// ---------- Watchlist ----------
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
      const status = el.querySelector('.wl-add-status');
      if (el.dataset.added) return;
      el.dataset.added = '1';
      const m = res[Number(el.dataset.i)];
      const r = await api('/api/watchlist', { method: 'POST', body: JSON.stringify(m) });
      if (r.error === 'already_in_watchlist') {
        $('#wl-search').value = '';
        $('#wl-search-results').innerHTML = '';
        loadWatchlist();
      } else {
        $('#wl-search').value = '';
        $('#wl-search-results').innerHTML = '';
        loadWatchlist();
      }
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

  // Group by family_name (null = no family grouping)
  const groups = {};
  for (const f of families) {
    const key = f.family_name || '\x00'; // null-family last
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

  // Pre-fill the add form with the family name when "+ Add sibling" is clicked
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
  const nights = await api('/api/history');
  const list = $('#history-list');
  if (!nights.length) {
    list.innerHTML = '<p style="color:var(--muted)">No archived movie nights yet.</p>';
    return;
  }
  list.innerHTML = nights.map((n) => {
    const attendees = (n.attendees || []).filter((a) => a.status === 'attended');
    const chips = (n.attendees || []).map((a) =>
      `<span class="chip" style="border-color:var(--${a.status});color:var(--${a.status})">${esc(a.child_name)}</span>`
    ).join('');
    const year = n.release_date ? `(${n.release_date.slice(0, 4)})` : '';
    return `
      <div class="history-card">
        ${n.poster_path ? `<img src="${esc(n.poster_path)}" alt="">` : ''}
        <div>
          <h3>${esc(n.title || 'Untitled')} ${year}</h3>
          <div class="sub">📅 ${esc(n.movie_date || '—')} · ✅ ${attendees.length} attended</div>
          <div class="attendee-chips">${chips}</div>
        </div>
      </div>`;
  }).join('');
}

// ---------- Custom Monday-first calendar ----------
const cal = { year: 0, month: 0, selected: null };
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function calOpen(date) {
  cal.selected = date;
  cal.year = date.getFullYear();
  cal.month = date.getMonth();
  calRender();
  $('#cal-dropdown').classList.remove('hidden');
}

function calSetSelected(date) {
  cal.selected = date;
  const iso = dateToIso(date);
  $('#night-date').value = iso;
  $('#night-date-display').value = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function dateToIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function calRender() {
  $('#cal-month-label').textContent = `${MONTHS[cal.month]} ${cal.year}`;
  const firstDow = new Date(cal.year, cal.month, 1).getDay(); // 0=Sun
  const offset = (firstDow + 6) % 7; // Mon=0
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

$('#night-date-display').addEventListener('click', () => {
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

// ---------- Modal (set up night) ----------
async function openModal() {
  chosenMovie = null;
  calSetSelected(new Date()); // default to today
  $('#movie-search').value = '';
  $('#search-results').innerHTML = '';
  $('#chosen-movie').innerHTML = '';

  // Show only unwatched watchlist movies at the top of the modal
  const wl = (await api('/api/watchlist')).filter((m) => !m.last_watched);
  const sec = $('#modal-watchlist-section');
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

  $('#modal').classList.remove('hidden');
}
function closeModal() { $('#modal').classList.add('hidden'); }

$('#modal-cancel').addEventListener('click', closeModal);

let searchTimer = null;
$('#movie-search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  // Deselect watchlist item if user starts typing
  document.querySelectorAll('.modal-wl-item').forEach((x) => x.classList.remove('selected'));
  const q = e.target.value.trim();
  if (!q) { $('#search-results').innerHTML = ''; return; }
  searchTimer = setTimeout(() => doSearch(q), 350);
});

async function doSearch(q) {
  const res = await api('/api/movies/search?q=' + encodeURIComponent(q));
  const box = $('#search-results');
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
  const date = $('#night-date').value;
  const body = {
    movie_date: date,
    title: chosenMovie ? chosenMovie.title : ($('#movie-search').value.trim() || null),
    tmdb_id: chosenMovie ? chosenMovie.tmdb_id : null,
    poster_path: chosenMovie ? chosenMovie.poster_path : null,
    release_date: chosenMovie ? chosenMovie.release_date : null,
    overview: chosenMovie ? chosenMovie.overview : null,
  };
  const res = await api('/api/night', { method: 'POST', body: JSON.stringify(body) });
  if (res.error) { alert(res.error); return; }
  closeModal();
  loadBoard();
});

// ---------- init ----------
loadBoard();

// Reload the board every 60 s, but only when the board tab is visible and the
// document isn't hidden (e.g. phone screen off or tab in background).
setInterval(() => {
  const boardActive = document.getElementById('board').classList.contains('active');
  if (boardActive && !document.hidden && nightActive) loadBoard();
}, 60_000);
