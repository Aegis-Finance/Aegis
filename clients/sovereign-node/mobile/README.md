# Aegis Mobile

Same product as desktop: **one app, local connection**. The full `frontend` dApp runs in a native WebView; a Rust engine on-device serves loopback RPC (`127.0.0.1:8547`) and circuits (`127.0.0.1:8080`). No browser tab, no third-party RPC in the default path.

Mobile shares the **Tauri 2** project under `../desktop/` — not a separate Flutter/Capacitor tree.

## Prerequisites

| Platform | Requirements |
|----------|----------------|
| **Android** | Android Studio, SDK 24+, NDK (installed via SDK Manager), `ANDROID_HOME` set |
| **iOS** | macOS, Xcode, `tauri ios init` (cannot run on Windows) |

## Build (Android)

```powershell
cd frontend
npm run build

cd ..\sovereign-node-app\desktop
npm install
npm run bundle
npm run android:init      # once
npm run android:patch     # pins Gradle + local.properties
npm run build:android     # APK / AAB
```

Dev on device/emulator:

```powershell
npm run android:dev
```

## Build (iOS, macOS only)

```bash
cd sovereign-node-app/desktop
npm run bundle
npx tauri ios init
npm run build:ios
```

## UX

Identical to desktop: open Aegis, see wallet/swap/lending/governance, ZK flows use on-device circuits. Point `shared/config.json` upstreams at your own Sonic node for full sovereignty.

## Status

| Piece | Status |
|-------|--------|
| Rust engine (RPC + circuits) | **Shipped** — same `server.rs` as desktop |
| Android project scaffold | **Initialized** (`src-tauri/gen/android`) |
| Android APK in CI | Requires Maven access to `dl.google.com` |
| iOS | Init on macOS when ready |

## Notes

- Release builds allow cleartext HTTP to loopback (required for local RPC).
- `local.properties` is machine-specific; `android:patch` generates it from `ANDROID_HOME`.
- Re-run `android:patch` after `tauri android init` regenerates Gradle files.
