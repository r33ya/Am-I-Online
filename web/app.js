// Am-I-Online status board.
// Polls GET {API}/api/status and renders one pane per online device.
// Visual direction and token rationale live in /DESIGN.md.

const API_BASE = (() => {
  const fromQuery = new URLSearchParams(location.search).get('api');
  if (fromQuery) return fromQuery.replace(/\/+$/, '');
  if (typeof window.AMI_ONLINE_API === 'string' && window.AMI_ONLINE_API) {
    return window.AMI_ONLINE_API.replace(/\/+$/, '');
  }
  return '';
})();

const STATUS_URL = `${API_BASE}/api/status`;
const STATUS_URL_DISPLAY = new URL(STATUS_URL, location.href).href;
const POLL_MS = 3000;
const THEME_KEY = 'amionline-theme';

const el = (id) => document.getElementById(id);
const stage = el('stage');
const statusPane = el('statusPane');
const themeToggle = el('themeToggle');

/** id -> pane element, reused so the width transition can animate. */
const panes = new Map();
/** id -> time first seen online, so the newest device stays on the right. */
const onlineSince = new Map();
let chipWasOnline = null;

// ------------------------------------------------------------------- theme

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const dark = theme === 'dark';
  themeToggle.setAttribute('aria-pressed', String(!dark));
  themeToggle.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
}

function initTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  applyTheme(stored === 'light' ? 'light' : 'dark');
}

themeToggle.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
});

// ----------------------------------------------------------------- helpers

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function fmtTime(ms) {
  if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return '0:00';
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function since(ms) {
  if (typeof ms !== 'number') return 'no data yet';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
}

function message(title, note, noteIsCode) {
  const wrap = make('div', 'message');
  wrap.append(make('p', 'message-title', title));
  if (note) {
    const line = make('p', 'message-note');
    if (noteIsCode) line.append(make('code', null, note));
    else line.textContent = note;
    wrap.append(line);
  }
  return wrap;
}

function firstLetter(text) {
  return (text || '').trim().charAt(0).toUpperCase();
}

/** Flat fallback tile, used when there is no album art or no app icon. */
function fallbackTile(className, letter) {
  const tile = make('span', `${className} tile`);
  tile.append(make('span', 'monogram', letter));
  return tile;
}

// --------------------------------------------------------------- pane pieces

function playingBlock(device) {
  const player = device.player;
  const wrap = make('div', 'playing');

  if (player.cover) {
    const cover = make('img', 'cover');
    cover.alt = '';
    cover.loading = 'lazy';
    cover.src = player.cover;
    const reveal = () => cover.classList.add('is-loaded');
    cover.addEventListener('load', reveal);
    if (cover.complete) reveal();
    wrap.append(cover);
  } else {
    wrap.append(fallbackTile('cover', firstLetter(player.title) || '\u266A'));
  }

  const meta = make('div', 'playing-meta');
  meta.append(make('p', 'track', player.title || 'Unknown track'));
  if (player.artist) meta.append(make('p', 'track-artist', player.artist));
  if (player.album) meta.append(make('p', 'track-album', player.album));

  const position = typeof player.positionMs === 'number' ? player.positionMs : 0;
  const duration = typeof player.durationMs === 'number' ? player.durationMs : 0;
  if (duration > 0) {
    const progress = make('div', 'progress');
    const track = make('div', 'progress-track');
    const fill = make('div', 'progress-fill');
    fill.style.width = `${Math.min(100, Math.max(0, (position / duration) * 100))}%`;
    track.append(fill);
    const times = make('div', 'progress-times');
    const posEl = make('span', 'progress-pos', fmtTime(position));
    times.append(posEl, make('span', 'progress-dur', fmtTime(duration)));
    progress.append(track, times);
    meta.append(progress);
  }

  wrap.append(meta);
  return wrap;
}

// ----------------------------------------------------------------- lyrics

/** Build the lyrics block. Lines carry word timings, so the page can light up
    the exact word being sung. */
function buildLyrics(lyrics) {
  if (!lyrics || !Array.isArray(lyrics.lines) || lyrics.lines.length === 0) return null;

  const box = make('div', 'lyrics');
  box.dataset.offset = String(lyrics.offset ?? 0);

  for (const line of lyrics.lines) {
    const row = make('p', 'lyric-line');
    row.dataset.start = String(line.startTime ?? 0);
    row.dataset.end = String(line.endTime ?? 0);

    const words = make('span', 'lyric-words');
    if (Array.isArray(line.words) && line.words.length) {
      for (const word of line.words) {
        const el = make('span', 'lyric-word', word.text ?? '');
        el.dataset.start = String(word.startTime ?? 0);
        el.dataset.end = String(word.endTime ?? 0);
        words.append(el);
      }
    } else {
      words.textContent = line.text ?? '';
    }
    row.append(words);
    if (line.translation) row.append(make('span', 'lyric-translation', line.translation));
    box.append(row);
  }
  return box;
}

// ------------------------------------------------- smooth playback clock

/** pane -> { basePosMs, durationMs, playing, receivedAt } */
const syncPanes = new Map();

function updateClock(pane, device) {
  const p = device.player;
  const usable =
    device.kind !== 'phone' && device.online && p && typeof p.positionMs === 'number' && p.title;
  if (!usable) {
    syncPanes.delete(pane);
    return;
  }
  syncPanes.set(pane, {
    basePosMs: p.positionMs,
    durationMs: typeof p.durationMs === 'number' ? p.durationMs : 0,
    playing: !!p.playing,
    receivedAt: Date.now(),
  });
}

/** The server polls every few seconds; extrapolate locally so the progress bar
    and the lyric highlight move continuously instead of stepping. */
function estimatedMs(clock) {
  const elapsed = clock.playing ? Date.now() - clock.receivedAt : 0;
  let ms = clock.basePosMs + elapsed;
  if (clock.durationMs > 0) ms = Math.min(ms, clock.durationMs);
  return Math.max(0, ms);
}

function applyClock(pane, clock) {
  const ms = estimatedMs(clock);

  if (clock.durationMs > 0) {
    const fill = pane.querySelector('.progress-fill');
    if (fill) fill.style.width = `${Math.min(100, Math.max(0, (ms / clock.durationMs) * 100))}%`;
  }

  const posEl = pane.querySelector('.progress-pos');
  if (posEl) {
    const text = fmtTime(ms);
    if (posEl.textContent !== text) posEl.textContent = text;
  }

  updateLyricHighlight(pane, ms);
}

function updateLyricHighlight(pane, positionMs) {
  const box = pane.querySelector('.lyrics');
  if (!box) return;

  const offsetMs = Number(box.dataset.offset) || 0;
  const t = positionMs / 1000 - offsetMs / 1000;
  const lines = box.querySelectorAll('.lyric-line');
  if (!lines.length) return;

  let index = -1;
  for (let i = 0; i < lines.length; i++) {
    if ((Number(lines[i].dataset.start) || 0) <= t) index = i;
    else break;
  }
  if (index < 0) index = 0; // before the first line: show it as upcoming

  if (box.dataset.index !== String(index)) {
    box.dataset.index = String(index);
    for (const line of lines) {
      line.classList.remove('is-prev', 'is-current', 'is-next', 'is-fresh');
      const lit = line.querySelector('.lyric-words-lit');
      if (lit) lit.remove();
      line.__measure = null;
    }    const prev = lines[index - 1];
    const current = lines[index];
    const next = lines[index + 1];
    if (prev) prev.classList.add('is-prev');
    if (next) next.classList.add('is-next');
    if (current) {
      current.classList.add('is-current');
      ensureLitOverlay(current);
      void current.offsetWidth; // restart the entrance animation
      current.classList.add('is-fresh');
      setTimeout(() => current.classList.remove('is-fresh'), 320);
    }
  }

  const active = lines[index];
  if (active) updateWipe(active, t);
}

/** Duplicate the current line's words so the sung copy can be clipped over it. */
function ensureLitOverlay(line) {
  const existing = line.querySelector('.lyric-words-lit');
  if (existing) return existing;
  const dim = line.querySelector('.lyric-words');
  if (!dim) return null;

  const lit = make('span', 'lyric-words lyric-words-lit');
  lit.setAttribute('aria-hidden', 'true');
  if (dim.children.length) {
    for (const word of dim.children) lit.append(make('span', 'lyric-word', word.textContent));
  } else {
    lit.textContent = dim.textContent;
  }
  line.append(lit);
  return lit;
}

function measureLine(line) {
  if (line.__measure) return line.__measure;
  const dim = line.querySelector('.lyric-words');
  const words = [];
  for (const el of line.querySelectorAll('.lyric-words > .lyric-word')) {
    words.push({
      left: el.offsetLeft,
      width: el.offsetWidth,
      start: Number(el.dataset.start) || 0,
      end: Number(el.dataset.end) || 0,
    });
  }
  line.__measure = { words, width: dim ? dim.offsetWidth : 0 };
  return line.__measure;
}

/** Pixel position of the wipe for time t, interpolated inside the sung word. */
function wipeX(line, t) {
  const { words, width } = measureLine(line);
  if (!words.length) {
    const start = Number(line.dataset.start) || 0;
    const end = Number(line.dataset.end) || start;
    const f = end > start ? Math.max(0, Math.min(1, (t - start) / (end - start))) : 1;
    return f * width;
  }
  for (const word of words) {
    if (t < word.start) return word.left;
    if (t < word.end) {
      const f = word.end > word.start ? (t - word.start) / (word.end - word.start) : 1;
      return word.left + f * word.width;
    }
  }
  const last = words[words.length - 1];
  return last.left + last.width;
}

function updateWipe(line, t) {
  const lit = line.querySelector('.lyric-words-lit');
  if (!lit) return;
  const { width } = measureLine(line);
  const x = Math.max(0, Math.min(width, wipeX(line, t)));
  lit.style.clipPath = `inset(0 ${Math.max(0, width - x)}px 0 0)`;
}

function syncTick() {
  for (const [pane, clock] of syncPanes) {
    if (!pane.isConnected) {
      syncPanes.delete(pane);
      continue;
    }
    applyClock(pane, clock);
  }
}

function desktopBody(device) {
  if (!device.online) return message('Nothing Playing', 'This computer is not connected.');
  if (!device.player || !device.player.title) {
    return message('No music playing', 'Folia is open but idle.');
  }
  const wrap = make('div', 'now-block');
  wrap.append(playingBlock(device));
  const lyrics = buildLyrics(device.player.lyrics);
  if (lyrics) wrap.append(lyrics);
  return wrap;
}

function phoneBody(device) {
  if (!device.online) {
    return message('Screen off', 'This phone is not in use.');
  }
  const wrap = make('div', 'activity');

  const icon = make('span', 'app-icon');
  if (device.activity?.icon) {
    const img = make('img');
    img.alt = '';
    img.src = device.activity.icon;
    icon.append(img);
  } else {
    icon.classList.add('tile');
    icon.append(make('span', 'monogram', firstLetter(device.activity?.label) || '?'));
  }

  const info = make('div', 'activity-info');
  info.append(make('p', 'activity-value', device.activity?.label || 'Screen on'));
  if (device.activity?.package) info.append(make('p', 'activity-package', device.activity.package));

  wrap.append(icon, info);
  return wrap;
}

function deviceBody(device) {
  return device.kind === 'phone' ? phoneBody(device) : desktopBody(device);
}

function bodySignature(device) {
  if (device.kind === 'phone') {
    const icon = device.activity?.icon || '';
    return `phone|${device.online}|${device.activity?.label || ''}|${device.activity?.package || ''}|${icon.length}`;
  }
  const p = device.player;
  return `desktop|${device.online}|${p?.title || ''}|${p?.artist || ''}|${p?.album || ''}|${p?.cover || ''}|${p?.lyricsRev || ''}`;
}

function statusLabel(device) {
  if (device.online) return 'Online';
  return device.kind === 'phone' && device.screen === 'off' ? 'Screen off' : 'Offline';
}

function createPane() {
  const pane = make('div', 'pane');
  const head = make('div', 'pane-head');
  const name = make('h2', 'device-name');
  const state = make('p', 'device-state');
  state.append(make('span', 'state-mark'), make('span', 'state-text'));
  head.append(name, state);
  pane.append(head, make('span', 'device-kind'), make('div', 'pane-body'));
  return pane;
}

function updatePane(pane, device) {
  const previousOnline = pane.dataset.online;
  const stateEl = pane.querySelector('.device-state');
  const previousLabel = stateEl.querySelector('.state-text').textContent;
  const label = statusLabel(device);

  pane.dataset.online = String(!!device.online);
  pane.dataset.kind = device.kind;
  pane.querySelector('.device-name').textContent =
    device.name || (device.kind === 'phone' ? 'Phone' : 'Computer');
  pane.querySelector('.device-kind').textContent = device.kind === 'phone' ? 'phone' : 'computer';
  stateEl.querySelector('.state-text').textContent = label;

  if (previousOnline !== undefined && (previousOnline !== String(!!device.online) || previousLabel !== label)) {
    stateEl.classList.remove('is-changed');
    void stateEl.offsetWidth;
    stateEl.classList.add('is-changed');
    setTimeout(() => stateEl.classList.remove('is-changed'), 340);
  }

  // Equalizer appears only while audio is actually playing.
  const head = pane.querySelector('.pane-head');
  const wantEqualizer = device.kind !== 'phone' && device.online && !!device.player?.playing;
  let equalizer = head.querySelector('.equalizer');
  if (wantEqualizer && !equalizer) {
    equalizer = make('span', 'equalizer');
    equalizer.setAttribute('aria-hidden', 'true');
    equalizer.append(make('span'), make('span'), make('span'));
    head.insertBefore(equalizer, stateEl);
  } else if (!wantEqualizer && equalizer) {
    equalizer.remove();
  }

  const signature = bodySignature(device);
  if (pane.dataset.signature !== signature) {
    pane.dataset.signature = signature;
    pane.querySelector('.pane-body').replaceChildren(deviceBody(device));
  }
  updateClock(pane, device);
}

function markNew(pane) {
  pane.classList.remove('is-new');
  void pane.offsetWidth;
  pane.classList.add('is-new');
  const delay = parseInt(pane.style.getPropertyValue('--enter-delay'), 10) || 0;
  setTimeout(() => pane.classList.remove('is-new'), 1000 + delay);
}

// ------------------------------------------------------------- status pane

function showStatus(tone, title, note, noteIsCode, action) {
  statusPane.hidden = false;
  statusPane.dataset.tone = tone;
  const wrap = make('div', 'message');
  wrap.append(make('p', 'message-title', title));
  if (note) {
    const line = make('p', 'message-note');
    if (noteIsCode) line.append(make('code', null, note));
    else line.textContent = note;
    wrap.append(line);
  }
  if (action) wrap.append(make('p', 'message-note', action));
  statusPane.replaceChildren(wrap);
}

// ------------------------------------------------------------------ render

function render(data) {
  const devices = Array.isArray(data.devices) ? data.devices : [];
  const online = devices.filter((d) => d.online);
  const now = Date.now();

  for (const device of online) {
    if (!onlineSince.has(device.id)) onlineSince.set(device.id, now);
  }
  const onlineIds = new Set(online.map((d) => d.id));
  for (const id of [...onlineSince.keys()]) {
    if (!onlineIds.has(id)) onlineSince.delete(id);
  }
  online.sort((a, b) => (onlineSince.get(a.id) || 0) - (onlineSince.get(b.id) || 0));

  for (const [id, pane] of panes) {
    if (!onlineIds.has(id)) {
      pane.remove();
      panes.delete(id);
      syncPanes.delete(pane);
    }
  }

  let stagger = 0;
  for (const device of online) {
    if (panes.has(device.id)) continue;
    const pane = createPane();
    panes.set(device.id, pane);
    stage.append(pane);
    pane.style.setProperty('--enter-delay', `${stagger * 70}ms`);
    markNew(pane);
    stagger += 1;
  }

  for (const device of online) updatePane(panes.get(device.id), device);

  const onlineCount = online.length;
  if (onlineCount === 0) {
    statusPane.hidden = false;
    if (devices.length === 0) {
      showStatus(
        'empty',
        'No devices connected yet',
        'Start the desktop agent next to Folia, or the phone app, and they will appear here.',
      );
    } else {
      showStatus('offline', 'Everything is offline', 'Waiting for a device to come back online.');
    }
  } else {
    statusPane.hidden = true;
  }

  stage.dataset.count = String(onlineCount);
  stage.dataset.wrap = onlineCount > 3 ? 'true' : 'false';
  stage.setAttribute('aria-busy', 'false');

  const offlineNames = devices.filter((d) => !d.online).map((d) => d.name);
  el('footNote').textContent = offlineNames.length ? `offline: ${offlineNames.join(', ')}` : '';
  el('updated').textContent = `Updated ${since(data.ageMs)}`;

  el('summary').textContent = onlineCount
    ? `${onlineCount} of ${devices.length} online`
    : devices.length
      ? 'All devices offline'
      : 'No devices connected';

  const chip = el('stateChip');
  const onlineAny = data.online === true;
  if (chipWasOnline !== null && chipWasOnline !== onlineAny) {
    chip.classList.remove('is-changed');
    void chip.offsetWidth;
    chip.classList.add('is-changed');
    setTimeout(() => chip.classList.remove('is-changed'), 800);
  }
  chipWasOnline = onlineAny;
  chip.dataset.state = onlineAny ? 'online' : 'offline';
  el('stateText').textContent = onlineAny ? 'Online' : 'Offline';
}

async function tick() {
  try {
    const res = await fetch(STATUS_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    render(await res.json());
  } catch (err) {
    // Drop stale device panes so nothing is shown as current when it is not.
    for (const pane of panes.values()) pane.remove();
    panes.clear();
    onlineSince.clear();
    syncPanes.clear();
    stage.dataset.count = '0';
    stage.dataset.wrap = 'false';

    el('stateChip').dataset.state = 'error';
    el('stateText').textContent = 'No connection';
    el('summary').textContent = 'Cannot reach the server';
    el('footNote').textContent = '';
    el('updated').textContent = 'No data yet';
    stage.setAttribute('aria-busy', 'false');
    showStatus(
      'error',
      'Cannot reach the server',
      STATUS_URL_DISPLAY,
      true,
      'Check that the Docker container on the NAS is running. This page retries every few seconds.',
    );
    console.warn('[am-i-online] poll failed:', err.message);
  }
}

initTheme();
stage.setAttribute('aria-busy', 'true');
tick();
setInterval(tick, POLL_MS);
setInterval(syncTick, 120);
window.addEventListener('resize', () => {
  for (const line of document.querySelectorAll('.lyric-line')) line.__measure = null;
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) tick();
});
