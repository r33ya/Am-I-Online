import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const STATUS_TOKEN = process.env.STATUS_TOKEN || '';
const OFFLINE_AFTER_MS = Number(process.env.OFFLINE_AFTER_MS || 15000);
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'status.json');
const WEB_DIR = process.env.WEB_DIR || path.resolve(__dirname, '..', 'web');
const MAX_BODY = 256 * 1024;
const PING_INTERVAL_MS = 20000;
const CONN_TIMEOUT_MS = 60000;

if (!STATUS_TOKEN) {
  console.error('[server] STATUS_TOKEN is not set. Refusing to accept device connections.');
}

/**
 * Device registry. id -> {
 *   id, kind: 'desktop'|'phone', name,
 *   connected: boolean, lastSeen: number,
 *   screen: 'on'|'off'|null,
 *   activity: { package, label }|null,
 *   player: {...}|null
 * }
 */
const devices = new Map();

/** Live WebSocket connections, for the keepalive sweeper. */
const connections = new Set();

// ------------------------------------------------------------------ websocket

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class WsConnection {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentOpcode = 0;
    this.closed = false;
    this.lastPong = Date.now();
    this.onMessage = () => {};
    this.onClose = () => {};
    socket.on('data', (chunk) => this.#onData(chunk));
    socket.on('close', () => this.#finish());
    socket.on('error', () => this.#finish());
  }

  #onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (this.buffer.length < 2) return;
      const b0 = this.buffer[0];
      const b1 = this.buffer[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;

      if (len === 126) {
        if (this.buffer.length < 4) return;
        len = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (this.buffer.length < 10) return;
        const big = this.buffer.readBigUInt64BE(2);
        if (big > 10_000_000n) return this.close(1009);
        len = Number(big);
        offset = 10;
      }

      let maskKey = null;
      if (masked) {
        if (this.buffer.length < offset + 4) return;
        maskKey = this.buffer.subarray(offset, offset + 4);
        offset += 4;
      }

      if (this.buffer.length < offset + len) return;

      let payload = Buffer.from(this.buffer.subarray(offset, offset + len));
      if (maskKey) {
        for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i & 3];
      }
      this.buffer = this.buffer.subarray(offset + len);
      this.#handleFrame(fin, opcode, payload);
    }
  }

  #handleFrame(fin, opcode, payload) {
    if (opcode === 0x8) return this.close();
    if (opcode === 0x9) return this.#send(0xa, payload); // ping -> pong
    if (opcode === 0xa) {
      this.lastPong = Date.now();
      return;
    }
    if (opcode === 0x1 || opcode === 0x2) {
      if (fin) return this.onMessage(payload);
      this.fragmentOpcode = opcode;
      this.fragments = [payload];
      return;
    }
    if (opcode === 0x0) {
      this.fragments.push(payload);
      if (fin) {
        const full = Buffer.concat(this.fragments);
        this.fragments = [];
        this.onMessage(full);
      }
    }
  }

  #send(opcode, payload) {
    if (this.closed || this.socket.destroyed) return;
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || '');
    const len = body.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x80 | opcode;
    try {
      this.socket.write(Buffer.concat([header, body]));
    } catch {
      this.#finish();
    }
  }

  sendJson(obj) {
    this.#send(0x1, Buffer.from(JSON.stringify(obj)));
  }

  ping() {
    this.#send(0x9, Buffer.alloc(0));
  }

  close(code = 1000) {
    if (this.closed) return;
    try {
      const b = Buffer.alloc(2);
      b.writeUInt16BE(code, 0);
      this.#send(0x8, b);
    } catch {}
    this.closed = true;
    try {
      this.socket.end();
    } catch {}
    this.onClose();
  }

  #finish() {
    if (this.closed) return;
    this.closed = true;
    this.onClose();
  }
}

function verifyToken(candidate) {
  if (!STATUS_TOKEN || !candidate) return false;
  const a = Buffer.from(String(candidate));
  const b = Buffer.from(STATUS_TOKEN);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ------------------------------------------------------------------ devices

function sanitizeId(raw) {
  return String(raw || '')
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, '')
    .slice(0, 64);
}

function deviceFor(id, kind, name) {
  let d = devices.get(id);
  if (!d) {
    d = {
      id,
      kind: kind === 'phone' ? 'phone' : 'desktop',
      name: name || (kind === 'phone' ? 'Phone' : 'Computer'),
      connected: false,
      lastSeen: 0,
      screen: null,
      activity: null,
      player: null,
    };
    devices.set(id, d);
  }
  if (name) d.name = name;
  if (kind) d.kind = kind === 'phone' ? 'phone' : 'desktop';
  return d;
}

function applyState(device, state) {
  if (!state || typeof state !== 'object') return;
  device.lastSeen = Date.now();
  if ('screen' in state) {
    device.screen = state.screen === 'on' || state.screen === 'off' ? state.screen : null;
  }
  if ('activity' in state) {
    const a = state.activity;
    if (a && typeof a === 'object' && a.package) {
      const pkg = String(a.package);
      const incomingIcon =
        typeof a.icon === 'string' && a.icon.startsWith('data:image/') && a.icon.length <= 60000
          ? a.icon
          : null;
      const previous = device.activity;
      // Clients send the icon only when the app changes (and once per reconnect),
      // so keep the last icon while the package stays the same.
      const icon =
        incomingIcon !== null
          ? incomingIcon
          : previous && previous.package === pkg
            ? previous.icon ?? null
            : null;
      device.activity = { package: pkg, label: a.label ? String(a.label) : null, icon };
    } else {
      device.activity = null;
    }
  }
  if ('player' in state) {
    const incoming = state.player && typeof state.player === 'object' ? state.player : null;
    if (!incoming) {
      device.player = null;
    } else {
      const previous = device.player;
      const rev = incoming.lyricsRev ?? null;
      // The agent sends lyrics only when they change, so keep the last copy
      // while the revision is unchanged, and drop it when the track changes.
      let lyrics = null;
      if (incoming.lyrics && typeof incoming.lyrics === 'object') {
        lyrics = incoming.lyrics;
      } else if (previous && rev !== null && (previous.lyricsRev ?? null) === rev) {
        lyrics = previous.lyrics ?? null;
      }
      const merged = { ...incoming };
      if (lyrics) merged.lyrics = lyrics;
      else delete merged.lyrics;
      device.player = merged;
    }
  }
}

function isStale(device) {
  return device.lastSeen > 0 && Date.now() - device.lastSeen > OFFLINE_AFTER_MS;
}

function isOnline(device) {
  if (!device.connected || isStale(device)) return false;
  if (device.kind === 'phone' && device.screen === 'off') return false;
  return true;
}

function normalizeDevice(device) {
  const online = isOnline(device);
  return {
    id: device.id,
    kind: device.kind,
    name: device.name,
    online,
    connected: device.connected,
    updatedAt: device.lastSeen || null,
    ageMs: device.lastSeen ? Date.now() - device.lastSeen : null,
    screen: device.kind === 'phone' ? device.screen : null,
    activity: device.kind === 'phone' ? device.activity : null,
    player: device.kind === 'desktop' ? device.player : null,
  };
}

function computeStatus() {
  const list = [...devices.values()].map(normalizeDevice);
  list.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'desktop' ? -1 : 1));
  const updatedAt = list.reduce((m, d) => Math.max(m, d.updatedAt || 0), 0) || null;
  return {
    online: list.some((d) => d.online),
    updatedAt,
    ageMs: updatedAt ? Date.now() - updatedAt : null,
    offlineAfterMs: OFFLINE_AFTER_MS,
    devices: list,
  };
}

// --------------------------------------------------------------- persistence

async function loadState() {
  try {
    const raw = await readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.devices)) {
      for (const d of parsed.devices) {
        if (!d || !d.id) continue;
        const device = deviceFor(d.id, d.kind, d.name);
        device.screen = d.screen ?? null;
        device.activity = d.activity ?? null;
        device.player = d.player ?? null;
        device.lastSeen = typeof d.lastSeen === 'number' ? d.lastSeen : 0;
        device.connected = false;
      }
      console.log(`[server] restored ${parsed.devices.length} device(s) from ${DATA_FILE}`);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[server] could not read state:', err.message);
  }
}

async function saveState() {
  try {
    await mkdir(path.dirname(DATA_FILE), { recursive: true });
    const data = { devices: [...devices.values()] };
    await writeFile(DATA_FILE, JSON.stringify(data), 'utf8');
  } catch (err) {
    console.warn('[server] could not persist state:', err.message);
  }
}

// ------------------------------------------------------------------ helpers

function sendJson(res, status, body, extraHeaders = {}) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    ...extraHeaders,
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

async function serveStatic(res, urlPath) {
  let rel;
  try {
    rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '');
  } catch {
    return sendJson(res, 400, { error: 'Bad request path' });
  }
  const target = path.resolve(WEB_DIR, rel);
  if (target !== WEB_DIR && !target.startsWith(WEB_DIR + path.sep)) {
    return sendJson(res, 403, { error: 'Forbidden' });
  }
  if (!existsSync(target)) {
    return sendJson(res, 404, { error: 'Not found' });
  }
  try {
    const file = await readFile(target);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Content-Length': file.length,
      'Cache-Control': 'no-cache',
    });
    res.end(file);
  } catch (err) {
    console.warn('[server] static error:', err.message);
    sendJson(res, 500, { error: 'Internal error' });
  }
}

// -------------------------------------------------------------------- server

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') return sendJson(res, 204, {});

  if (pathname === '/api/health') return sendJson(res, 200, { ok: true });

  if (pathname === '/api/status' && req.method === 'GET') {
    return sendJson(res, 200, computeStatus());
  }

  // Legacy one-shot heartbeat (kept for simple setups / scripts).
  if (pathname === '/api/status' && req.method === 'POST') {
    const header = req.headers['authorization'] || '';
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!match || !verifyToken(match[1])) return sendJson(res, 401, { error: 'Unauthorized' });
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      return sendJson(res, err.statusCode || 400, { error: 'Invalid JSON body' });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return sendJson(res, 400, { error: 'Body must be an object' });
    }
    const id = sanitizeId(body.bridge?.host) || 'legacy';
    const device = deviceFor(id, 'desktop', body.bridge?.host || 'Computer');
    device.connected = true;
    applyState(device, { player: body.folia ?? null });
    await saveState();
    return sendJson(res, 200, { ok: true, receivedAt: device.lastSeen });
  }

  if (pathname.startsWith('/api/')) {
    return sendJson(res, 404, { error: 'Unknown API route' });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  return serveStatic(res, pathname);
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error('[server] unhandled request error:', err);
    if (!res.headersSent) sendJson(res, 500, { error: 'Internal error' });
    else res.end();
  });
});

// WebSocket upgrade for persistent device connections: /ws
server.on('upgrade', (req, socket) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    return socket.destroy();
  }
  if (url.pathname !== '/ws') return socket.destroy();

  const header = req.headers['authorization'] || '';
  const headerMatch = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = url.searchParams.get('token') || (headerMatch ? headerMatch[1] : '');
  if (!verifyToken(token)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    return socket.destroy();
  }

  const key = req.headers['sec-websocket-key'];
  if (!key) return socket.destroy();

  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );

  const conn = new WsConnection(socket);
  connections.add(conn);
  const id = sanitizeId(url.searchParams.get('deviceId')) || `device-${crypto.randomUUID().slice(0, 8)}`;
  const kind = url.searchParams.get('kind') === 'phone' ? 'phone' : 'desktop';
  const name = url.searchParams.get('name') || '';
  const device = deviceFor(id, kind, name);
  device.connected = true;
  device.lastSeen = Date.now();
  saveState();

  conn.sendJson({
    type: 'hello',
    ok: true,
    device: { id: device.id, kind: device.kind, name: device.name },
    offlineAfterMs: OFFLINE_AFTER_MS,
  });
  console.log(`[server] device connected: ${kind}/${device.name} (${id})`);

  conn.onMessage = (payload) => {
    let msg;
    try {
      msg = JSON.parse(payload.toString('utf8'));
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'state') {
      applyState(device, msg.state || msg);
    } else if (msg.type === 'ping') {
      conn.sendJson({ type: 'pong', t: Date.now() });
    }
  };

  conn.onClose = () => {
    connections.delete(conn);
    device.connected = false;
    device.lastSeen = Date.now();
    saveState();
    console.log(`[server] device disconnected: ${device.kind}/${device.name} (${id})`);
  };
});

// Detect dead/half-open sockets.
setInterval(() => {
  const now = Date.now();
  for (const client of connections) {
    if (now - client.lastPong > CONN_TIMEOUT_MS) client.close(1001);
    else client.ping();
  }
}, PING_INTERVAL_MS);

await loadState();
server.listen(PORT, HOST, () => {
  console.log(`[server] listening on http://${HOST}:${PORT}`);
  console.log(`[server] web dir: ${WEB_DIR}`);
  console.log(`[server] data file: ${DATA_FILE}`);
  console.log(`[server] offline after ${OFFLINE_AFTER_MS} ms`);
});
