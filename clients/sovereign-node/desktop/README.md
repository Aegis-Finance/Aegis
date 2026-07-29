# Aegis Desktop & Mobile (Tauri)

Native shell for the full Aegis dApp. Users do not run terminals or paste RPC URLs into a browser.

**Stack:** Tauri 2 + Rust (`server.rs`) for loopback RPC/circuits; bundled `frontend/dist` in the WebView. Replaces the earlier Electron prototype (smaller binary, same UX).

## Quick start (desktop)

```powershell
cd ../../frontend
npm run build

cd ../sovereign-node-app/desktop
npm install
npm run bundle
npm run dev
```

Build installers (Windows MSI/NSIS, macOS, Linux):

```powershell
npm run build
```

Output: `src-tauri/target/release/bundle/` (e.g. `Aegis_0.3.0_x64-setup.exe` on Windows).

## What happens at launch

1. **Rust engine** binds loopback: RPC `8547`, circuits `8080`.
2. **UI** loads bundled `frontend/dist` inside the Tauri window.
3. User sees the same app as the website — inside Aegis, not Chrome.

## Mobile (same repo)

Android and iOS use this Tauri project. See `../mobile/README.md`.

```powershell
npm run android:init
npm run android:patch
npm run build:android
```

## Configuration

- Build `frontend` with `VITE_RPC_URL=http://127.0.0.1:8547` for correct defaults.
- `npm run bundle` copies `frontend/dist` and circuits into `bundle/app` and `../circuits`.
- Runtime config: `../shared/config.json` (copy from `config.example.json`).

## Scripts

| Script | Purpose |
|--------|---------|
| `bundle` | Sync `frontend/dist` → `bundle/app` |
| `dev` | `tauri dev` |
| `build` | Bundle + desktop installer |
| `android:init` | `tauri android init` (once) |
| `android:patch` | Pin Gradle + write `local.properties` |
| `build:android` | Release APK/AAB |
| `android:dev` | Device/emulator dev loop |

## Icons

Canonical logo: `../logo.png` (native app only — not bundled in on-chain frontends).

Regenerate installer / store icons after logo changes:

```powershell
npm run icons
```
