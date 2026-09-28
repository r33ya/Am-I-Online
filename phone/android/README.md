# Am-I-Online phone app (Android)

Reports your phone's status to the Am-I-Online server over a persistent connection:

- **Screen on → Online**, **screen off → Offline**.
- **Current foreground app**: its name and its **real icon** (needs the *Usage access* special
  permission). The icon is rendered to a small PNG and sent inline, so the page needs no icon
  service.
- The icon is sent **once per app switch** (and once after every reconnect), not on every
  heartbeat. Heartbeats stay around 80 bytes instead of a few KB.

It keeps a foreground service with a WebSocket and reconnects automatically. There is no
accessibility service and no root; **Usage access** is a normal, user-granted setting.

## Build

You need **Android Studio** (or a Gradle + Android SDK install). Open the `phone/android` folder,
let it sync, then run/build:

- Debug APK: `./gradlew assembleDebug` → `app/build/outputs/apk/debug/app-debug.apk`
- Or press **Run** in Android Studio with your phone connected.

> The Gradle wrapper JAR isn't committed. Android Studio creates it automatically on first sync.
> From a terminal with Gradle installed, run `gradle wrapper` once first.

## Set up on the phone

1. Install the APK.
2. Open the app and fill in:
   - **Server URL**: `ws://YOUR-NAS-IP:8787/ws` (use `ws://` for LAN, `wss://` if behind TLS)
   - **Token**: the same `STATUS_TOKEN` as the server
   - **Device name**: anything, e.g. `My Phone`
3. Tap **Grant Usage access** and enable it for *Am-I-Online*.
4. Tap **Disable battery optimization** so the service isn't killed in the background.
5. Tap **Start sharing**. A low-priority notification stays visible. That is the service.

The phone appears on the page as its own card. It also restarts on boot if it was enabled.

## Permissions

| Permission | Why |
| --- | --- |
| `INTERNET` | Talk to the server. |
| `FOREGROUND_SERVICE` (+`SPECIAL_USE`) | Keep the connection alive. |
| `RECEIVE_BOOT_COMPLETED` | Restart after reboot. |
| `POST_NOTIFICATIONS` | Required foreground-service notification (Android 13+). |
| `PACKAGE_USAGE_STATS` | Read the current foreground app (**special access**, user-granted). |

## Notes

- **Android/iOS limits**: an app cannot see other apps' foreground state without Usage access.
  Without it, the phone still reports **screen on/off**, just not the app name.
- **Battery savers** (Xiaomi/Huawei/Samsung etc.) may still kill the service. Also set the app to
  *No restrictions* / *Autostart* in the vendor's battery settings.
- `usesCleartextTraffic` is enabled so plain `ws://` works on your LAN. For internet use, put the
  server behind HTTPS and switch to `wss://`.
