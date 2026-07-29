# Sonic `.sonic` resolver extension

Minimal MV3 extension (`manifest.json`, `background.js`, `popup.html`, `popup.js`) for resolving Sonic name records in the browser.

**Operational context:** contract addresses and infra for the main apps come from `protocol` deployments and `npm run contracts:gen-env` (see [`protocol/docs/DAO_TIMELOCK_ZK_RELEASE_MASTER_PLAN.md`](../protocol/docs/DAO_TIMELOCK_ZK_RELEASE_MASTER_PLAN.md)). **`manifest.json` `host_permissions`** and **`background.js`** allowlists are kept aligned with **`frontend/src/utils/arweaveGateway.ts`** and Sonic RPC hosts used by the resolver. Monorepo map: [`docs/STACK_ALIGNMENT.md`](../docs/STACK_ALIGNMENT.md).

## Distribution strategy

This extension is currently distributed through GitHub Releases (source + zip + checksums), not the Chrome Web Store.
Tag a release (`v*`) in the standalone extension repository to trigger `.github/workflows/release.yml`.

## Load unpacked (Chromium)

1. Open `chrome://extensions` (or Edge equivalent).
2. Enable **Developer mode**.
3. **Load unpacked** → select this `sonic_extension/` directory.

## Related

- Domain helper scripts (CLI): [`../domain/README.md`](../domain/README.md)
