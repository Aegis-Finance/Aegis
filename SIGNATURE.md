# Release authenticity

Published files are listed in **`CHECKSUMS.sha256`** and signed with **Ed25519**.

| File | Purpose |
|------|---------|
| `RELEASE_SIGNING_KEY.pem` | Public key (SPKI PEM) — commit this with the release |
| `CHECKSUMS.sha256` | SHA-256 of every file in this repository (manifest) |
| `CHECKSUMS.sha256.sig` | Detached signature over the manifest bytes |

## Verify (Node.js)

From this repository root:

```bash
node verify-release.mjs
```

When cloning from the monorepo instead, run `node scripts/sign-public-release.mjs verify` from the repo root above `Aegis/`.

### OpenSSL (optional)

```bash
sha256sum -c CHECKSUMS.sha256
SIG=$(grep -E '^[A-Za-z0-9+/]+=*$' CHECKSUMS.sha256.sig | tail -1)
openssl pkeyutl -verify -pubin -inkey RELEASE_SIGNING_KEY.pem -rawin -in CHECKSUMS.sha256 -sigfile <(echo "$SIG" | base64 -d)
```

## Maintainer (monorepo)

```bash
node scripts/sign-public-release.mjs generate-key   # once
node scripts/sign-public-release.mjs prepare      # after bootstrap or file changes
```

Private key: `.aegis-signing/private.pem` (never committed). Set `AEGIS_SIGNING_KEY_PATH` to override.
