# Am-I-Online desktop agent

Runs next to Folia, keeps a **persistent WebSocket** to your NAS server, and reports playback.

- Reconnects automatically with exponential backoff (1s → 30s).
- If Folia isn't running, it still stays online and reports "no track" → the page shows
  **Nothing Playing**.
- If the server is unreachable, the device goes offline on the page.
- Reads Folia's lyric API too, so the page shows the current line with the word being sung
  highlighted, plus the translation.

## Setup

1. In Folia: **Settings → Connections & Integrations → Stage Mode → source = Stage API**.
   Copy the local address and token.
2. In Folia: **Settings → Connections & Integrations → Lyric API → enable**. This is the
   read-only local port the agent reads lyrics from. Without it the page shows no lyrics, and
   everything else still works.
3. Copy `.env.example` to `.env` and fill it in.
4. Run:

```bash
node agent.js
```

Requires **Node.js 22+** (uses the built-in WebSocket).

## Autostart (Windows)

```powershell
powershell -ExecutionPolicy Bypass -File .\install-autostart.ps1
```

Registers a scheduled task that runs at logon, hidden, and restarts on failure.
Logs go to `desktop-agent/agent.log`. To remove:

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall-autostart.ps1
```

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `STATUS_WS_URL` | _(required)_ | e.g. `ws://YOUR-NAS-IP:8787/ws` |
| `STATUS_TOKEN` | _(required)_ | Same as the server's `STATUS_TOKEN`. |
| `DEVICE_ID` | `desktop` | Stable id for this computer. |
| `DEVICE_NAME` | hostname | Shown on the page. |
| `FOLIA_STAGE_URL` | `http://127.0.0.1:32107` | Folia Stage API. |
| `FOLIA_STAGE_TOKEN` | _(required for player data)_ | Token from Folia. |
| `FOLIA_LYRIC_URL` | `http://127.0.0.1:32109/v1/lyric` | Folia lyric API. Lines carry word timings. |
| `POLL_MS` | `5000` | Sample interval. |
| `LOG_RAW` | `0` | Set to `1` to print the raw player JSON once. |
