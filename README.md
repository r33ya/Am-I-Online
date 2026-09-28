# Am-I-Online

A self-hosted status page that answers two questions at a glance: **is my computer on, and is my
phone on**, and **what is Folia playing right now**, including the current lyric line with the
word being sung.

Every device holds a persistent WebSocket to a small server on your NAS. When a socket drops, the
page shows that device as offline immediately.

- **Desktop**: online/offline plus now playing and lyrics, read from Folia's local APIs.
- **Android phone**: online while the screen is on, offline while it is off, plus the currently
  open app and its real icon.
- **Server**: one Docker container, no external services, no cloud account, no telemetry.
- **Web page**: plain HTML/CSS/JS, served by the same container from `/`.

## Contents

- [Quick start](#quick-start)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Requirements](#requirements)
- [Part 1: server on the NAS](#part-1-server-on-the-nas)
- [Part 2: desktop agent](#part-2-desktop-agent)
- [Part 3: Android app](#part-3-android-app)
- [Part 4: using the page](#part-4-using-the-page)
- [Configuration reference](#configuration-reference)
- [HTTP and WebSocket API](#http-and-websocket-api)
- [Updating](#updating)
- [Troubleshooting](#troubleshooting)
- [Security](#security)
- [Development](#development)

## Quick start

Three pieces, about fifteen minutes.

```bash
# 1. Server, on the NAS
cd Am-I-Online
cp .env.example .env          # set STATUS_TOKEN to a long random string
docker compose up -d --build
# page is now at http://YOUR-NAS-IP:8787/
```

```bash
# 2. Desktop agent, on the Folia machine (Node.js 22 or newer)
cd desktop-agent
cp .env.example .env          # STATUS_WS_URL, STATUS_TOKEN, FOLIA_STAGE_TOKEN
node agent.js
```

```text
# 3. Android app
Open phone/android in Android Studio, build, install.
In the app: ws://YOUR-NAS-IP:8787/ws, the same token, then grant Usage access.
```

## Architecture

```text
  Folia desktop app
    Stage API  127.0.0.1:32107   (player state, bearer token)
    Lyric API  127.0.0.1:32109   (lyrics with word timings, read only)
          |
          v
  desktop-agent  (Node.js, runs on the Folia PC)
          |
          |   WebSocket, long lived, auto reconnect
          v
  server  (Docker on the NAS)              GET /api/status  (public, JSON)
          |                                         ^
          |                                         |
          +-----------------------------------------+
          |                       browser polls every 3s
          v
  web page  (served by the same container)

  Android app  ---------------------------------^  WebSocket, foreground service
```

Nothing inbound is exposed on the Folia PC. The agent only makes outbound connections.

## Repository layout

| Path | What it is |
| --- | --- |
| `web/` | The status page: `index.html`, `styles.css`, `app.js`. No build step. |
| `server/` | `server.js` (the whole server, zero npm dependencies) and `Dockerfile`. |
| `desktop-agent/` | `agent.js`, plus Windows autostart scripts. |
| `phone/android/` | Android app source (Kotlin, Gradle). |
| `docker-compose.yml` | Runs the server on the NAS. |
| `.env.example` | Environment template for the server. |
| `DESIGN.md` | The visual design system and the reasoning behind it. |

## Requirements

| Piece | Needs |
| --- | --- |
| Server | Docker and Docker Compose, or Node.js 18 or newer if you run it bare |
| Desktop agent | Node.js **22 or newer** (it uses the built-in WebSocket), Folia desktop |
| Android app | Android Studio, or a Gradle 8.x install and JDK 17 or newer |
| Network | All devices on the same LAN, or reachable over your own VPN |

---

## Part 1: server on the NAS

### 1.1 Get the code

```bash
git clone <your-repo-url> Am-I-Online
cd Am-I-Online
```

Or copy the folder to the NAS by any means you prefer. Nothing outside this folder is needed.

### 1.2 Configure

```bash
cp .env.example .env
```

Edit `.env` and set `STATUS_TOKEN`. Generate one:

```bash
# any one of these
node -e "console.log(crypto.randomBytes(24).toString('hex'))"
openssl rand -hex 24
```

`STATUS_TOKEN` is the shared secret. Every device must present the same value, and `POST
/api/status` is the only write path that checks it.

```env
STATUS_TOKEN=put-a-long-random-string-here
OFFLINE_AFTER_MS=15000
PORT=8787
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `STATUS_TOKEN` | required | Shared secret. The container refuses to start without it. |
| `OFFLINE_AFTER_MS` | `15000` | No heartbeat for this long means offline. Must be larger than the agent's `POLL_MS`. |
| `PORT` | `8787` | Host port. Change it here if 8787 is taken. |

`server/data/` is created at runtime and is gitignored. It holds `status.json`, the last known
device state, so a restart does not blank the page.

### 1.3 Start

```bash
docker compose up -d --build
```

Watch the logs:

```bash
docker compose logs -f
```

You should see:

```text
[server] listening on http://0.0.0.0:8787
[server] web dir: /app/web
[server] data file: /app/data/status.json
[server] offline after 15000 ms
[server] restored 2 device(s) from /app/data/status.json
[server] device connected: desktop/My Computer (desktop)
```

### 1.4 Verify

```bash
curl http://127.0.0.1:8787/api/health
# {"ok":true}

curl http://127.0.0.1:8787/api/status
# {"online":false,"updatedAt":null,"ageMs":null,"offlineAfterMs":15000,"devices":[]}
```

Then open `http://YOUR-NAS-IP:8787/` in a browser. Until a device connects you should see **No
devices connected yet**.

### 1.5 Without Docker (bare Node)

Any machine on the LAN works, including the Folia PC itself:

```bash
cd server
STATUS_TOKEN=your-token PORT=8787 WEB_DIR=../web node server.js
```

On Windows PowerShell:

```powershell
$env:STATUS_TOKEN='your-token'; $env:PORT='8787'; $env:WEB_DIR='../web'; node server.js
```

To keep it running, use `systemd`, `pm2`, or `nssm`. The server has no dependencies, so there is
nothing to install.

### 1.6 HTTPS and reverse proxy (only if you leave the LAN)

The page and `GET /api/status` are plain HTTP. If you want to reach it from outside your network:

1. Put the container behind Nginx, Caddy, or Cloudflare Tunnel and terminate TLS there.
2. Use `wss://` in the agent's `STATUS_WS_URL` and in the Android app.
3. Add authentication at the proxy. The read API is public by design and has no login.
4. Do **not** port forward Folia's `32107` or `32109`. They are loopback only and must stay that
   way. Only the agent talks to them, and only outbound.

---

## Part 2: desktop agent

The agent runs on the same computer as Folia. It reads Folia's local APIs and pushes state to the
NAS.

### 2.1 Install Node.js

Node.js **22 or newer** is required. Check with:

```bash
node --version
```

The agent has no npm dependencies, so there is nothing to `npm install`.

### 2.2 Enable Folia's local APIs

In Folia desktop, open **Settings → Connections & Integrations**:

| Setting | Value | Why |
| --- | --- | --- |
| **Stage Mode** | on, source = **Stage API** | Gives the agent the player state. Copy the address and the **Token**. |
| **Lyric API** | on | Gives the agent the lyrics with word timings. Optional: without it the page simply shows no lyrics. |

The Stage API listens on `http://127.0.0.1:32107` and needs its bearer token. The Lyric API
listens on `http://127.0.0.1:32109/v1/lyric` and needs no token.

### 2.3 Configure

```bash
cd desktop-agent
cp .env.example .env
```

```env
STATUS_WS_URL=ws://YOUR-NAS-IP:8787/ws
STATUS_TOKEN=same-value-as-the-server

DEVICE_ID=desktop
DEVICE_NAME=My Computer

FOLIA_STAGE_URL=http://127.0.0.1:32107
FOLIA_STAGE_TOKEN=paste-the-token-from-folia
FOLIA_LYRIC_URL=http://127.0.0.1:32109/v1/lyric

POLL_MS=5000
LOG_RAW=0
```

### 2.4 Run

```bash
node agent.js
```

Expected output:

```text
2026-01-01T00:00:00.000Z Folia: http://127.0.0.1:32107 | server: ws://192.168.1.10:8787/ws | every 5000ms
2026-01-01T00:00:00.100Z connected to ws://192.168.1.10:8787/ws as "My Computer"
2026-01-01T00:00:00.120Z server ack (offline after 15000 ms)
```

Reload the page. The computer should appear as its own pane.

Behaviour worth knowing:

- If Folia is closed, the agent still stays connected and reports no track. The page shows
  **Nothing Playing**.
- If the server is unreachable, the agent retries with exponential backoff, 1s up to 30s.
- With `LOG_RAW=1` the agent prints the raw `/stage/player/status` payload once, which is the
  fastest way to check field names if something shows blank.

### 2.5 Autostart on Windows

From `desktop-agent/`:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-autostart.ps1
```

This registers a scheduled task named `AmIOnlineAgent` that runs at logon, hidden, and restarts
on failure. Output goes to `desktop-agent/agent.log`.

Remove it with:

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall-autostart.ps1
```

### 2.6 Autostart on Linux or macOS

Create a systemd user unit at `~/.config/systemd/user/am-i-online.service`:

```ini
[Unit]
Description=Am-I-Online desktop agent
After=network-online.target

[Service]
WorkingDirectory=%h/Am-I-Online/desktop-agent
ExecStart=/usr/bin/node agent.js
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now am-i-online
loginctl enable-linger "$USER"    # keep it running when logged out
```

On macOS, use a `launchd` plist with `RunAtLoad` and `KeepAlive` set to true, pointing
`ProgramArguments` at `node` and the absolute path to `agent.js`.

### 2.7 Verify

```bash
curl http://YOUR-NAS-IP:8787/api/status
```

Look for a `devices` entry with `"kind":"desktop"`.

---

## Part 3: Android app

The app is a foreground service that holds a WebSocket and reports the screen state and the
currently open app, with its real icon.

### 3.1 Requirements

- Android Studio (Ladybug or newer recommended), which bundles a compatible JDK
- JDK 17 or newer if you build from the command line
- An Android device running Android 7.0 (API 24) or newer

### 3.2 Build with Android Studio

1. Open the `phone/android` folder. Do not open the repository root, or Gradle will not find the
   Android project.
2. Let Gradle sync. Android Studio generates the Gradle wrapper on first sync if it is missing.
3. Build and install with **Run**, or build an APK with **Build → Build Bundle(s) / APK(s) →
   Build APK(s)**.
4. The debug APK lands in `phone/android/app/build/outputs/apk/debug/app-debug.apk`.

### 3.3 Build from the command line

The Gradle wrapper JAR is not committed. Create it once, then build:

```bash
cd phone/android
gradle wrapper            # needs a Gradle 8.x install
./gradlew assembleDebug   # Windows: .\gradlew.bat assembleDebug
```

The APK is written to `app/build/outputs/apk/debug/app-debug.apk`. Install it:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Toolchain versions, for reference: Android Gradle Plugin 8.5.2, Kotlin 1.9.24, `compileSdk` and
`targetSdk` 34, `minSdk` 24, Java 17.

### 3.4 Release build

Use **Build → Generate Signed Bundle / APK** in Android Studio and let it create or select a
keystore. That wizard needs no edits to `app/build.gradle.kts`. If you prefer to sign from the
command line, add a `signingConfigs` block with your keystore path and run
`./gradlew assembleRelease`.

Plain `ws://` on your LAN works because the manifest sets `android:usesCleartextTraffic="true"`.
If you move the server behind HTTPS, use `wss://` and you can drop that attribute.

### 3.5 Configure the app

1. Open the app and fill in:
   - **Server URL**: `ws://YOUR-NAS-IP:8787/ws`
   - **Token**: the same `STATUS_TOKEN` as the server
   - **Device name**: anything, for example `My Phone`
2. Tap **Save**.
3. Tap **Grant Usage access** and enable it for Am-I-Online in the system list. This is what
   allows reading the current app.
4. Tap **Disable battery optimization** and confirm.
5. Tap **Start sharing**. A low priority notification stays visible. That notification is the
   foreground service, and Android requires it.

The app restarts after a reboot if it was enabled, and it reconnects automatically.

### 3.6 Permissions explained

| Permission | Why |
| --- | --- |
| `INTERNET`, `ACCESS_NETWORK_STATE` | Reach the server. |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SPECIAL_USE` | Keep the connection alive while the app is in the background. |
| `RECEIVE_BOOT_COMPLETED` | Restart the service after a reboot. |
| `POST_NOTIFICATIONS` | Required for the foreground service notification on Android 13 and newer. |
| `PACKAGE_USAGE_STATS` | Read the current foreground app. This is **special access**, granted by the user in Settings. It is not an accessibility service and not a runtime permission. |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | Ask to be exempt so the service is not killed. |

### 3.7 Battery savers

Many OEM builds (Xiaomi, Huawei, Samsung, Oppo, Vivo) kill background services aggressively. In
addition to disabling battery optimization, set the app to **No restrictions** and enable
**Autostart** in the vendor's battery settings.

---

## Part 4: using the page

Open `http://YOUR-NAS-IP:8787/`.

- The header shows **Online** when any device is online, and **Offline** otherwise.
- Each online device gets a pane. The first device fills the card. When a second comes online, the
  first compresses to the left half and the new one slides in on the right.
- The computer pane shows the cover art, title, artist, album, a progress bar, and the lyrics:
  the previous line muted, the current line large with a light that sweeps across the word being
  sung, the next line muted, and the translation under the current line.
- The phone pane shows the app in the foreground with its real icon, or a neutral tile with the
  first letter if the icon is unavailable.
- The button in the top right switches between the dark and light themes. The choice is stored in
  the browser.

If you host the page and the API on different origins, point the page at the API with either a
query parameter or a global:

```html
<script>window.AMI_ONLINE_API = 'https://status.example.com';</script>
```

```text
https://status.example.com/  and page loaded from elsewhere:
https://page.example.com/?api=https://status.example.com
```

## Configuration reference

### Server

| Variable | Default | Meaning |
| --- | --- | --- |
| `STATUS_TOKEN` | none, required | Shared secret for device connections and `POST /api/status`. |
| `OFFLINE_AFTER_MS` | `15000` | Age at which a device counts as offline. Keep it larger than `POLL_MS`. |
| `PORT` | `8787` | Listen port inside the container. The compose file maps `PORT` from `.env` to it. |
| `HOST` | `0.0.0.0` | Bind address. |
| `DATA_FILE` | `server/data/status.json` | Where the last device state is persisted. |
| `WEB_DIR` | `../web` relative to `server/` | Directory served at `/`. |

### Desktop agent

| Variable | Default | Meaning |
| --- | --- | --- |
| `STATUS_WS_URL` | required | For example `ws://192.168.1.10:8787/ws`. |
| `STATUS_TOKEN` | required | Must match the server. |
| `DEVICE_ID` | `desktop` | Stable id. Changing it makes a new device appear. |
| `DEVICE_NAME` | hostname | Label shown on the page. |
| `FOLIA_STAGE_URL` | `http://127.0.0.1:32107` | Folia Stage API base. |
| `FOLIA_STAGE_TOKEN` | required for player data | Token copied from Folia. |
| `FOLIA_LYRIC_URL` | `http://127.0.0.1:32109/v1/lyric` | Folia lyric API. |
| `POLL_MS` | `5000` | Sample interval. |
| `LOG_RAW` | `0` | Set to `1` to print the raw player payload once. |

## HTTP and WebSocket API

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/` and static files | none | The page. |
| `GET` | `/api/health` | none | `{"ok":true}`. Liveness only. |
| `GET` | `/api/status` | none | Aggregate state for all devices. |
| `POST` | `/api/status` | `Bearer STATUS_TOKEN` | Legacy one shot heartbeat, for simple scripts. |
| `WS` | `/ws` | token in query | Device long connection. |

### GET /api/status

```json
{
  "online": true,
  "updatedAt": 1790000000000,
  "ageMs": 1200,
  "offlineAfterMs": 15000,
  "devices": [
    {
      "id": "desktop",
      "kind": "desktop",
      "name": "My Computer",
      "online": true,
      "connected": true,
      "updatedAt": 1790000000000,
      "ageMs": 1200,
      "screen": null,
      "activity": null,
      "player": {
        "playing": true,
        "state": "playing",
        "title": "Clair de Lune",
        "artist": "Claude Debussy",
        "album": "Suite bergamasque",
        "cover": "https://...",
        "positionMs": 95000,
        "durationMs": 300000,
        "lyricsRev": "3182:13nvq7x",
        "lyrics": {
          "offset": 0,
          "wordByWord": true,
          "lines": [
            {
              "text": "The moon drifts over quiet water",
              "startTime": 0,
              "endTime": 6,
              "translation": "月光洒在寂静的水面",
              "words": [
                { "text": "The", "startTime": 0, "endTime": 1.2 }
              ]
            }
          ]
        }
      }
    },
    {
      "id": "phone-1a2b3c4d",
      "kind": "phone",
      "name": "My Phone",
      "online": true,
      "screen": "on",
      "activity": { "package": "com.android.chrome", "label": "Chrome", "icon": "data:image/png;base64,..." },
      "player": null
    }
  ]
}
```

A phone counts as offline when `screen` is `"off"`, even while its socket is up. A desktop counts
as offline when its socket drops.

### WebSocket /ws

Connect with query parameters:

```text
ws://YOUR-NAS-IP:8787/ws?deviceId=desktop&kind=desktop&name=My%20Computer&token=STATUS_TOKEN
```

`kind` is `desktop` or `phone`. On connect the server sends:

```json
{ "type": "hello", "ok": true, "device": { "id": "desktop", "kind": "desktop", "name": "My Computer" }, "offlineAfterMs": 15000 }
```

The device then sends state frames. Desktop:

```json
{ "type": "state", "state": { "playing": true, "player": { "playing": true, "title": "Song", "positionMs": 1000 } } }
```

Phone:

```json
{ "type": "state", "state": { "screen": "on", "activity": { "package": "com.x", "label": "X", "icon": "data:image/png;base64,..." } } }
```

The server also answers `{ "type": "ping" }` with a pong, and sends its own WebSocket pings to
detect dead sockets.

Two payloads are sent only when they change, and the server keeps the last copy in between, so
heartbeats stay around 80 bytes:

- `player.lyrics`, keyed by `player.lyricsRev`. Include the lyrics whenever `lyricsRev` changes.
  If `lyricsRev` is present and unchanged, omit `lyrics` and the server keeps what it has. If
  `lyricsRev` is `null`, the server drops the lyrics.
- `activity.icon`, a `data:image/...` URI at most 60 kB. Omit it while the package name stays the
  same.

## Updating

```bash
git pull
docker compose up -d --build    # server and web
```

The agent and the phone app only need updating when their own files change. Restart the agent, or
let the autostart task do it, and reinstall the APK.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Container exits immediately | `STATUS_TOKEN` is missing or empty. The server refuses to start without it. |
| Page says **Cannot reach the server** | The container is down, or the port mapping is wrong. `docker compose ps` and `curl http://NAS-IP:8787/api/health`. |
| Device shows offline while running | `STATUS_WS_URL` uses the wrong host or port, or `STATUS_TOKEN` does not match the server. Watch the agent log for `Unauthorized`, which is the server rejecting the token. |
| Computer online but no track | Folia Stage Mode is off, or `FOLIA_STAGE_TOKEN` is wrong. Run the agent with `LOG_RAW=1` to see the raw payload. |
| No lyrics, everything else fine | Folia's Lyric API is off, or the track has no lyrics. Enable it in Folia, and confirm `curl http://127.0.0.1:32109/v1/lyric` returns JSON on the Folia PC. |
| Page keeps flickering online/offline | `OFFLINE_AFTER_MS` is too small relative to the network. Raise it, and keep it above `POLL_MS`. |
| Blank fields in the player pane | The Stage API field names differ from what the agent reads. Run with `LOG_RAW=1` and compare with `GET /stage/player/status`. |
| Phone never appears | The app's service was killed. Check the notification is still present, disable battery optimization, and set the app to unrestricted. |
| Phone online but no app name | Usage access is not granted. Tap **Grant Usage access** in the app and enable it. |
| Phone shows the letter tile instead of the icon | The app sends its icon only on app switch. Switching apps once refreshes it. |
| `ws://` fails from the phone | Cleartext traffic is blocked, or the server URL uses `http://` instead of `ws://`. The URL must start with `ws://` or `wss://`. |
| Port 8787 already in use | Change `PORT` in `.env` and run `docker compose up -d` again. |

## Security

- `STATUS_TOKEN` is a shared secret. Treat it like a password and do not commit `.env`.
- Folia's `32107` and `32109` are loopback only. Never expose them, and never port forward them.
- The read side, meaning the page and `GET /api/status`, is public by design. If you expose the
  container beyond your LAN, put authentication in front of it.
- The network is the only authentication for readers. Anyone who can reach the server can see your
  status.
- `.env` files and `server/data/` are gitignored. Keep it that way.

## Development

The whole project runs without a build step except for the Android app.

**Server and web**: edit `web/` and `server/server.js`, then restart the server. Because
`WEB_DIR` points at the `web` folder, page changes are picked up on refresh.

```bash
cd server
STATUS_TOKEN=dev PORT=8787 WEB_DIR=../web node server.js
```

**Send fake state** to test the page without Folia. Any WebSocket client works, for example:

```bash
node --input-type=module -e "
const ws = new WebSocket('ws://127.0.0.1:8787/ws?deviceId=test&kind=desktop&name=Test&token=dev');
ws.onopen = () => ws.send(JSON.stringify({ type: 'state', state: { playing: true, player: {
  playing: true, title: 'Test Song', artist: 'Artist', album: 'Album',
  positionMs: 1000, durationMs: 200000 } } }));
"
```

**Android**: open `phone/android` in Android Studio and use Run. Logcat tag is `AmIOnline`.

**Design**: `DESIGN.md` is the source of truth for the visual language. The antislop skills that
shaped it live in `.opencode/skills/`.
