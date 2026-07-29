# Aegis App (native)

This folder is the **user-facing Aegis application** — not a developer CLI. One install, one window, direct connection to Sonic through your machine. No browser tab, no third-party RPC in the default path. The same full experience as the web dApp (`frontend/`), packaged like early Bitcoin: open the app, see your balance, trade, shield, govern.

## What users get

- **Full Aegis dApp** — wallet, swap, lending, governance, privacy flows, everything `frontend` ships.
- **Local Sonic connection** — JSON-RPC on `127.0.0.1:8547` (proxy to your node or Sonic upstream you configure).
- **Local circuits** — proving artifacts served on `127.0.0.1:8080` so ZK flows stay on-device.
- **Sovereign when you want it** — point `shared/config.json` upstreams at your own Sonic node (`127.0.0.1:8545`) and you never touch a public RPC.

The CLI under `cli/` is an **internal engine** (operators never need a terminal). **Tauri** (`desktop/`) is the product — desktop and mobile.

## Build the app (developers)

```powershell
cd Aegis-contracts
npm run gen:frontend-env -- --network sonic

cd ..\frontend
# VITE_RPC_URL=http://127.0.0.1:8547
npm run build

cd ..\sovereign-node-app\desktop
npm install
npm run bundle
npm run dev
```

## Ship installers

```powershell
cd sovereign-node-app\desktop
npm run build
```

Installers: `desktop/src-tauri/target/release/bundle/`. Sign before publishing (see whitepaper § Publication).

## Mobile

Same Tauri codebase — see `mobile/README.md`.

```powershell
npm run android:init
npm run android:patch
npm run build:android
```

## Layout

```
sovereign-node-app/
├── README.md           # this file
├── desktop/            # Tauri app (desktop + Android/iOS)
├── cli/                # legacy Node engine (superseded by Rust in Tauri)
├── shared/             # config
├── circuits/           # populated by `npm run bundle` (gitignored)
└── mobile/             # mobile build docs (same Tauri project)
```

## Status

| Piece | Status |
|-------|--------|
| Desktop (Tauri, full UI + local RPC) | **Shipped** — MSI/NSIS/AppImage via `npm run build` |
| Android (Tauri) | **Scaffold + Rust** — APK after Gradle/Maven resolves |
| iOS (Tauri) | Init on macOS |
| Packaged signed release on GitLab | Planned with public repo |
| CLI as user product | **Retired** — engine only |

## Configuration

Copy `shared/config.example.json` → `shared/config.json` (**operational** profile: local Sonic node only).

For local dev with public RPC fallback: copy `config.convenience.json` instead.

See `docs/OPERATIONAL_SECURITY.md` for the full hardening model.

---

*Privacy-first finance on Sonic. Download. Open. Connect.*
