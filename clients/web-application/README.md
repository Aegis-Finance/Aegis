# Aegis Web Application

> **Monorepo path:** `frontend/` · **Public standalone repo:** [aegis-web-application](https://github.com/Aegis-Finance/aegis-web-application) — publish overlay in `README.public.md`.

Static React (Vite + TypeScript) interface to **Aegis DAO** contracts. The product thesis is explicit:

- **ZK (Groth16)** — proofs only where a matching verifier is deployed on-chain; the UI does not claim universal anonymity.
- **Stealth-oriented rails** — shield / private paths only where the Solidity you deploy actually implements them.
- **Real DAO** — parameter and upgrade flows are supposed to run through **on-chain governance and timelocks**, not through a hidden “admin” inside this app (this bundle is static; it cannot silently change bytecode).
- **Networks** — **Sonic** is the primary settlement chain for the dApp. **Ethereum** appears for the official **Gateway bridge**, wrapped assets, and any modules that intentionally read or route L1 — check each screen and the env-injected addresses.

Branding in the header is **text-only** (no logo image). **No favicon** is declared in `index.html` (browser default tab icon).

**Circuit files (`public/circuits/**/*.wasm`, `*.zkey`):** intentionally kept under `public/` — they are prover artifacts, not images; serving them as static files is the standard Vite pattern (see `public/circuits/README.md`). Override paths via `VITE_*` env vars if you host bundles on a CDN instead.

## Features

- **Ecosystem modules**: Governance, treasury, allocation, staking, lending, insurance, crowdfunding, yield farming, swap/liquidity surfaces where deployed.
- **TGE Dutch auction (`AutomatedDutchAuction`)**: lives only in **`../frontend-token-distribution/`** (public repo: **aegis-token-sale**) — deploy that app for the ~30-day sale; this repo’s main UI stays useful after distribution without dead TGE surfaces.
- **Treasury & pools**: DAO liquidity views via allocator / AMM contracts when addresses are present.
- **Bridge visibility**: Cross-chain privacy bridge + Sonic Gateway flows where configured.
- **Wallet Connection**: [Sonic-compatible](https://docs.soniclabs.com/sonic/wallets) EIP-1193 wallets (EIP-6963 picker when several are installed); MetaMask, Rabby, OKX, Trust, and others. Read-only RPC from the header (including your custom URL) is merged into `wallet_addEthereumChain` when adding Sonic.
- **On-Chain Explorer**: Event reading and state reconstruction
- **Elegant Design**: Terminal-inspired dark theme with muted colors
- **Zero Dependencies on Backend**: All data fetched directly from blockchain
- **Comprehensive Security**: Rate limiting, gateway fallback, sovereign node integration, attack detection

## Tech Stack

- **React 18** with TypeScript
- **Vite** for fast development and optimized builds
- **Ethers.js v6** for blockchain interaction
- **Zustand** for state management
- **React Query** for data fetching
- **Tailwind CSS** for styling
- **React Router** for navigation

## Getting Started

### Prerequisites

- Node.js 18+ and npm/yarn
- Access to Sonic network RPC (or local node)

### Installation

```bash
cd frontend
npm install
```

### Configuration

1. **Create environment file**:
   ```bash
   # Copy the example template
   cp ENV_EXAMPLE.txt .env
   # Or manually create .env based on ENV_EXAMPLE.txt
   ```

2. **Update contract addresses** in `.env` after deployment:
   ```env
   # See ENV_EXAMPLE.txt for all required variables
   VITE_TOKEN_ADDRESS=0x...
   VITE_GOVERNANCE_ADDRESS=0x...
   VITE_GOVERNANCE_TREASURY_ADDRESS=0x...
   VITE_TREASURYLIQUIDITYALLOCATOR_ADDRESS=0x...
   VITE_TOKEN_ALLOCATION_ADDRESS=0x...
   VITE_CROSS_CHAIN_BRIDGE_ADDRESS=0x...
   # ... etc
   ```

3. **Copy contract ABIs**:
   ```bash
   # First, compile contracts in Aegis-contracts
   cd ../Aegis-contracts
   npx hardhat compile
   
   # Then copy ABIs to frontend
   cd ../frontend
   npm run copy-abis
   ```

See `ENV_SETUP.md` for detailed environment variable documentation.

**Sonic chain pack:** `public/config/sonic-chain-pack.json` is the canonical copy of network metadata (including bridge tokens and RPC hints) generated in `Aegis-contracts` and synced into this app. After updating the pack in contracts, run the repo’s chain-pack sync so the UI and RPC defaults stay consistent. On first load, if you are still on the static default Sonic public RPC profile, the app switches read-only traffic to the first trusted URL from that pack (see **Sonic official (chain pack)** in the RPC menu).

### Development

```bash
npm run dev
```

The app will be available at `http://localhost:3000`

### Build

```bash
npm run build
```

Output will be in the `dist` directory, ready for deployment to Arweave. A SHA-256 manifest (`dist/manifest.hash.json`) is generated automatically to help auditors verify the uploaded bundle.

### Security Checks

```bash
npm run security:scan
```

Runs `npm audit --production` and `depcheck` to highlight vulnerable or unused dependencies. Integrate this into CI alongside `npm run lint`.

## Security

The frontend implements comprehensive security measures to protect against DDoS attacks and abuse:

- **Rate Limiting**: Client-side rate limiting for all operations
- **Gateway Fallback**: Multiple Arweave gateways with automatic failover
- **Sovereign Nodes**: Protected nodes for critical operations
- **Input Validation**: Sanitization and attack pattern detection
- **Request Throttling**: Prevents rapid repeated calls

See [SECURITY.md](SECURITY.md) for detailed documentation.

## Deployment

### Arweave Deployment

1. Build the application:
   ```bash
   npm run build
   ```

2. Upload `dist` folder to Arweave using your preferred method (Arweave CLI, Bundlr, etc.) and include the generated `manifest.hash.json` in the governance proposal.

3. Update the DAO-owned `.sonic` domain (`https://aegiscoin.sonic`) to point to the Arweave transaction ID and mirror in the sovereign-node companion

### Security Configuration

Configure sovereign nodes in `.env`:
```env
VITE_SOVEREIGN_NODE_1=https://sovereign-node-1.example.com
VITE_SOVEREIGN_NODE_2=https://sovereign-node-2.example.com
VITE_SOVEREIGN_NODE_3=https://sovereign-node-3.example.com
```

### Local Testing

For local testing without Arweave:

```bash
npm run preview
```

## Architecture

### Project Structure

```
frontend/
├── src/
│   ├── components/      # Reusable UI components
│   ├── pages/          # Page components
│   ├── store/          # Zustand state stores
│   ├── config/         # Configuration files
│   ├── utils/          # Utility functions
│   ├── App.tsx         # Main app component
│   └── main.tsx        # Entry point
├── public/             # Static assets
├── index.html          # HTML template
└── package.json        # Dependencies
```

### Key Components

- **Layout**: Main layout with navigation sidebar
- **WalletButton**: Wallet connection UI
- **RpcSelector**: RPC node selection
- **Module Pages**: Individual pages for each ecosystem module

### State Management

- **walletStore**: Wallet connection and RPC configuration
- **React Query**: Data fetching and caching for blockchain data

## Features by Module

### Governance
- View proposals and timelock state
- Create proposals (requires ZK proof generation)
- Vote on proposals
- Execute proposals via timelock queue and monitor execution receipts

### Governance Treasury
- Inspect treasury balances and queued disbursements
- Monitor `GovernanceTreasury` execution timetables
- Verify compliance with on-chain withdrawal caps

### Token Allocation
- Track tranche streaming for ecosystem, treasury, and public allocations
- View cliff and unlock schedules enforced on-chain

### Staking
- Stake AEGIS tokens
- Unstake with delay period
- Claim rewards
- View epoch information

### Lending
- Supply liquidity
- Borrow with collateral
- View loan positions
- Repay loans

### Insurance
- Create insurance policies
- View active policies
- Submit claims
- Track claim status

### Crowdfunding
- Create campaigns
- Contribute to campaigns
- Track campaign progress
- Request refunds

### Yield Farming
- View farming pools
- Stake in pools
- Claim farming rewards
- View APY and pool stats

### Cross-Chain Privacy Bridge
- Observe validator set parameters and bridge queues
- Track merkle root activation delays and slash penalties

### Liquidity & Treasury
- Monitor Treasury Liquidity Allocator positions
- Surface public/private pool parity via `VITE_POOL_*` configuration

### Explorer
- Select contract to explore
- Filter events by block range
- View event logs
- Reconstruct state from events

### Wallet
- View balances
- Shield tokens and optional transparent exit to public balance (legacy compatibility)
- Manage commitments
- Transfer tokens

## Security Considerations

- **No Private Keys**: All signing happens in user's wallet
- **RPC Flexibility**: Users can choose their own RPC node or run the sovereign-node companion
- **On-Chain Verification**: All state verified on-chain
- **No Backend**: No server-side dependencies

## Notes

- ZK proof generation is not implemented in the frontend (requires off-chain computation)
- Contract ABIs should be imported from the contracts package or added manually
- Update contract addresses in `src/config/contracts.ts` after deployment and keep `.env` in sync with governance-approved manifests

## License

MIT

