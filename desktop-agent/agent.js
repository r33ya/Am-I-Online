import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ------------------------------------------------------------- tiny .env load
try {
  const text = readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
} catch {
  // no .env file: rely on real environment variables
}

if (typeof WebSocket === 'undefined') {
  console.error('This agent needs Node.js 22 or newer (built-in WebSocket). Current: ' + process.version);
  process.exit(1);
}

const CFG = {
  wsUrl: process.env.STATUS_WS_URL || '',
  token: process.env.STATUS_TOKEN || '',
  deviceId: process.env.DEVICE_ID || 'desktop',
  deviceName: process.env.DEVICE_NAME || os.hostname(),
  foliaUrl: (process.env.FOLIA_STAGE_URL || 'http://127.0.0.1:32107').replace(/\/+$/, ''),
  foliaToken: process.env.FOLIA_STAGE_TOKEN || '',
  lyricUrl: (process.env.FOLIA_LYRIC_URL || 'http://127.0.0.1:32109/v1/lyric').replace(/\/+$/, ''),
  pollMs: Math.max(1000, Number(process.env.POLL_MS || 5000)),
  logRaw: process.env.LOG_RAW === '1',
};

const log = (...args) => console.log(new Date().toISOString(), ...args);

function wsUrl() {
  const url = new URL(CFG.wsUrl);
  url.searchParams.set('deviceId', CFG.deviceId);
  url.searchParams.set('kind', 'desktop');
  url.searchParams.set('name', CFG.deviceName);
  url.searchParams.set('token', CFG.token);
  return url.toString();
}

// -------------------------------------------------------------- folia reader
let loggedRaw = false;

async function getJson(url, headers = {}, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal, cache: 'no-store' });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function pickArtist(current) {
  if (!current) return '';
  if (Array.isArray(current.artists) && current.artists.length) {
    return current.artists.map((a) => (typeof a === 'string' ? a : a?.name)).filter(Boolean).join(' / ');
  }
  return current.artist || current.artistName || '';
}

function pickCover(current) {
  if (!current) return '';
  return (
    current.coverUrl ||
    current.coverArtUrl ||
    current.cover ||
    current.albumCoverUrl ||
    current.albumCover ||
    ''
  );
}

function pickNumber(current, ...keys) {
  if (!current) return null;
  for (const key of keys) {
    if (typeof current[key] === 'number' && isFinite(current[key])) return current[key];
  }
  return null;
}

function normalizePlayer(raw) {
  const current = raw?.current || raw?.track || null;
  const state = raw?.playerState ?? raw?.state ?? null;
  const stateStr = typeof state === 'string' ? state : state == null ? null : String(state);
  const playing =
    typeof raw?.playing === 'boolean'
      ? raw.playing
      : stateStr
        ? /play/i.test(stateStr) && !/pause/i.test(stateStr)
        : false;

  return {
    state: stateStr || (playing ? 'playing' : 'idle'),
    playing,
    title: current?.title || current?.name || '',
    artist: pickArtist(current),
    album: current?.album || current?.albumName || '',
    cover: pickCover(current),
    positionMs: pickNumber(raw, 'positionMs') ?? pickNumber(current, 'positionMs'),
    durationMs: pickNumber(raw, 'durationMs') ?? pickNumber(current, 'durationMs'),
    context: raw?.playbackContext ?? null,
  };
}

async function sampleFolia() {
  try {
    const health = await getJson(`${CFG.foliaUrl}/stage/health`, {}, 3000);
    if (!health.ok) return null;
  } catch {
    return null; // Folia not running -> "Nothing Playing"
  }
  if (!CFG.foliaToken) return null;
  try {
    const res = await getJson(
      `${CFG.foliaUrl}/stage/player/status`,
      { Authorization: `Bearer ${CFG.foliaToken}` },
      4000,
    );
    if (!res.ok) return null;
    if (CFG.logRaw && !loggedRaw) {
      loggedRaw = true;
      log('raw /stage/player/status =', JSON.stringify(res.body, null, 2));
    }
    return normalizePlayer(res.body);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ lyric reader
// Folia desktop exposes the loaded lyrics on a fixed local port. Lines carry
// word timings, so the page can highlight the exact word being sung. Lyrics do
// not change while a track plays, so they are sent once per revision and the
// server keeps the last copy between heartbeats.
let lastLyricsRev = null;

function revisionOf(value) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${text.length}:${(hash >>> 0).toString(36)}`;
}

/** Keep the payload small: if it is huge, drop word timings and keep lines. */
function fitLyrics(data) {
  try {
    if (JSON.stringify(data).length <= 300000) return data;
  } catch {
    return null;
  }
  return {
    offset: data.offset,
    wordByWord: data.wordByWord,
    lines: data.lines.map((line) => ({
      text: line.text,
      startTime: line.startTime,
      endTime: line.endTime,
      translation: line.translation,
    })),
  };
}

async function sampleLyrics() {
  try {
    const res = await getJson(CFG.lyricUrl, {}, 4000);
    if (!res.ok) return { rev: null, data: null };
    const data = res.body;
    if (!data || !Array.isArray(data.lines) || data.lines.length === 0) {
      return { rev: 'empty', data: null };
    }
    return { rev: revisionOf(data), data: fitLyrics(data) };
  } catch {
    return { rev: null, data: null };
  }
}

// ------------------------------------------------------------- ws connection
let socket = null;
let connected = false;
let stopped = false;
let backoff = 1000;
let heartbeat = null;

function scheduleReconnect() {
  if (stopped) return;
  const delay = backoff;
  backoff = Math.min(backoff * 2, 30000);
  log(`reconnecting in ${Math.round(delay / 1000)}s…`);
  setTimeout(connect, delay);
}

function connect() {
  if (stopped) return;
  if (!CFG.wsUrl) {
    log('error: STATUS_WS_URL is not set');
    return;
  }

  let ws;
  try {
    ws = new WebSocket(wsUrl());
  } catch (err) {
    log('connect failed:', err.message);
    return scheduleReconnect();
  }
  socket = ws;

  ws.addEventListener('open', () => {
    connected = true;
    backoff = 1000;
    log(`connected to ${CFG.wsUrl} as "${CFG.deviceName}"`);
    sendState();
    if (!heartbeat) heartbeat = setInterval(sendState, CFG.pollMs);
  });

  ws.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'hello') log(`server ack (offline after ${msg.offlineAfterMs} ms)`);
    } catch {
      // ignore non-JSON
    }
  });

  ws.addEventListener('close', () => {
    if (connected) log('connection closed');
    connected = false;
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    scheduleReconnect();
  });

  ws.addEventListener('error', () => {
    try {
      ws.close();
    } catch {}
  });
}

async function sendState() {
  const player = await sampleFolia();

  if (player) {
    const { rev, data } = await sampleLyrics();
    player.lyricsRev = rev;
    // Send the full lyrics only when they change; otherwise the server keeps
    // the copy it already has.
    if (rev && rev !== lastLyricsRev) {
      lastLyricsRev = rev;
      player.lyrics = data;
    }
    if (!rev) lastLyricsRev = null;
  } else {
    lastLyricsRev = null;
  }

  if (!socket || socket.readyState !== 1) return; // 1 = OPEN
  const state = { playing: !!player, player };
  try {
    socket.send(JSON.stringify({ type: 'state', state }));
  } catch (err) {
    log('send failed:', err.message);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
function shutdown() {
  stopped = true;
  if (heartbeat) clearInterval(heartbeat);
  try {
    socket?.close();
  } catch {}
  log('agent stopped');
  process.exit(0);
}

log(`Folia: ${CFG.foliaUrl} | server: ${CFG.wsUrl || '(unset)'} | every ${CFG.pollMs}ms`);
if (!CFG.token) log('warning: STATUS_TOKEN is empty; the server will reject the connection.');
connect();
