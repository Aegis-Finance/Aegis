# Deployment & Operations Manual

> **Redeploy note:** Treat Arweave URLs, domain lines, and any wallet addresses in this file as **historical** when you cut a new Sonic testnet/mainnet stack. Regenerate app env from `Aegis-contracts` (`NETWORK=sonicTestnet` or `sonic`) and refresh this doc only after the new cut is live.

**Last Updated**: 2026-02-13
**Project**: Aegis Token Distribution Frontend

## 1. Live System Status
| Component | Value | Status |
|-----------|-------|--------|
| **Live URL** | [https://arweave.net/kCjLofdpwSgFLE-c96kt6HW32jHw5nM6x3_XioCQGps](https://arweave.net/kCjLofdpwSgFLE-c96kt6HW32jHw5nM6x3_XioCQGps) | 🟢 Active |
| **Manifest ID** | `kCjLofdpwSgFLE-c96kt6HW32jHw5nM6x3_XioCQGps` | 🟢 Verified |
| **Domain** | `agscoin.sonic` | 🟢 Linked |
| **Blockchain** | Sonic Mainnet (Domain Registry) | 🟢 Synced |
| **ZK Proving** | Deterministic (via Multi-Gateway TXIDs) | 🟢 Ready |

---

## 2. Deployment Strategy (Critical Info)

### A. Granular Upload Method (Why & How)
We DO NOT use the standard Bundlr CLI or `uploadFolder` commands because they hang on large files (ZK circuits >2MB) and lack proper error recovery.

**The Solution**: Custom Script `scripts/deploy-granular.mjs`
- **Mechanism**: Uploads files one-by-one.
- **Persistence**: Saves progress to `upload-state.json`. If deployment is interrupted, simply run it again—it resumes exactly where it left off (Zero Waste).
- **Timeout Handling**: Increased timeout to 5 minutes to handle slow Arweave confirmations for large WASM/ZKEY files.
- **Optimization (2026-02-13)**: Explicitly excluded `crowdfunding` circuits from distribution build to ensure successful upload of core `auction` and `claim` artifacts.

### B. Frontend Separation Strategy
This repository (`frontend-token-distribution`) is intentionally **ISOLATED** from the main Aegis platform.
- **Purpose**: To provide a lightweight, high-security interface specifically for the Token Generation Event (TGE) / Auction.
- **Benefit**: Reduced attack surface. Even if the main platform code is being updated, this distribution interface remains immutable and accessible on Arweave.

### C. ZK Circuit Resolution
To ensure ZK proving never fails due to missing local files:
- **Primary**: Loads from relative `circuits/` path.
- **Fallback**: Automatically attempts resolution from Arweave/IPFS gateways using deterministic TXIDs injected into the `.env` during build.
- **Manifest Mapping**: The granular deploy captures all file TXIDs in `dist-manifest.json` for secondary fallback.

---

## 3. How to Deploy Updates

### Prerequisites
- **Node.js**: v18+
- **Wallet**: An EVM private key with ETH on **Arbitrum** (for Bundlr payment).
- **Domain Owner**: The wallet `0x7e8D...d38` owns `agscoin.sonic`.

### Step-by-Step Guide

1.  **Generate Environment**
    ```bash
    cd ../Aegis-contracts
    node scripts/generate-frontend-env.js
    ```
    *This syncs contract addresses and ZK circuit TXIDs from the latest deployments.*

2.  **Build the Frontend**
    ```bash
    cd ../frontend-token-distribution
    npm run build
    ```

3.  **Run Granular Deployment**
    Ensure `temp_deploy_key.txt` exists in the root with your private key.
    ```bash
    node scripts/deploy-granular.mjs
    ```
    *Outputs the new Manifest ID.*

4.  **Update Domain Record**
    ```bash
    node ..\domain\manage-sonic-domain.js set agscoin.sonic arweave.html.value <NEW_MANIFEST_ID> <PRIVATE_KEY> sonic
    ```

---

## 4. Key Files & Locations

| File/Path | Description |
|-----------|-------------|
| `scripts/deploy-granular.mjs` | **The Master Deploy Script**. Handles uploads, retries, and state. |
| `upload-state.json` | **State Database**. Tracks which files are already uploaded to avoid paying twice. |
| `dist/` | The production build output (files actually sent to Arweave). |
| `../domain/manage-sonic-domain.js` | Utility to update the `.sonic` domain records. |

## 5. Wallet & Funding
- **Deployer Address**: `0x7e8DB922Be5ccE776afC1F27b4F960dc5f519d38`
- **Funding Source**: Arbitrum ETH (bridged to Bundlr).
- **Bundlr Node**: `https://node2.bundlr.network`

---

## 6. Troubleshooting
- **Hang during upload?** Stop the script (Ctrl+C) and run `node scripts/deploy-granular.mjs` again. It will auto-resume.
- **"Not enough funds"?** Check the Bundlr balance printed at the start of the script. Send more ETH (Arbitrum) if needed.
- **Domain not resolving?** Check `https://sonicscan.org` to verify the `arweave.html.value` record matches the current Manifest ID.

---

## 7. How to Access .sonic Domains
**Important**: `.sonic` is a **Blockchain Domain** (like .eth), not a traditional website (like .com). 
- **Google cannot find it** because it exists on the blockchain, not the standard DNS.
- **Standard Browsers (Chrome/Edge)** cannot open it natively yet.

### Access Methods:
1.  **Direct Arweave Link (Universal)**: 
    > [https://arweave.net/kCjLofdpwSgFLE-c96kt6HW32jHw5nM6x3_XioCQGps](https://arweave.net/kCjLofdpwSgFLE-c96kt6HW32jHw5nM6x3_XioCQGps)
    *Always works for everyone, everywhere.*

2.  **Browser Resolution (Web3 Users)**:
    Users need a **Resolver Extension** (like Unstoppable Domains extension) or a Web3-native browser (like Brave/Opera) configured to read the Sonic network registry.

