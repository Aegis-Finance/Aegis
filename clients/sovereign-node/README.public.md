# Aegis Sovereign Node

Native **Aegis** shell — desktop and mobile. Local loopback RPC and circuit server; the full dApp UI runs inside the app instead of a browser tab.

| | |
|--|--|
| Protocol | [github.com/Aegis-Finance/Aegis](https://github.com/Aegis-Finance/Aegis) |
| Web application source | [aegis-web-application](https://github.com/Aegis-Finance/aegis-web-application) |
| Releases | [GitHub Releases](https://github.com/Aegis-Finance/aegis-sovereign-node-app/releases) |

## Install (users)

Download the installer for your platform from **GitHub Releases**:

- Windows — `.msi` / `.exe`
- macOS — `.dmg`
- Linux — `.AppImage` / `.deb`

Verify checksums attached to the release before installing.

## Build from source (developers)

Requires a built web application bundle (`aegis-web-application` `dist/`).

```bash
# 1. Build the web client (sibling checkout or clone)
cd ../aegis-web-application
npm ci && npm run build

# 2. Bundle into desktop and run
cd ../aegis-sovereign-node-app/desktop
npm ci
AEGIS_FRONTEND_DIST=../../aegis-web-application/dist npm run bundle
npm run dev
```

Ship installers:

```bash
npm run build
```

Artifacts: `desktop/src-tauri/target/release/bundle/`

## Layout

```
├── desktop/    Tauri app (Windows, macOS, Linux, Android, iOS)
├── cli/        Operator tooling
├── shared/     Runtime config
├── mobile/     Mobile build notes
└── docs/       Release checklist
```

## License

MIT
