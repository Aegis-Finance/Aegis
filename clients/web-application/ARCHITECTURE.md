# Aegis DAO Frontend Architecture

## Overview

The Aegis DAO frontend is a complete, one-time release React application that provides full access to the Aegis ecosystem. It's designed to be elegant, professional, and geeky with a terminal-inspired aesthetic.

## Design Philosophy

### Visual Design
- **Color Palette**: Muted, elegant colors - no sharp purple/blue
  - Background: Deep black (#0a0a0a)
  - Surfaces: Dark gray (#111111)
  - Accent: Muted green (#4a9e5f)
  - Warning: Muted amber (#d4a574)
  - Error: Muted red (#c85a5a)
- **Typography**: JetBrains Mono for that terminal/geeky feel
- **Layout**: Clean, minimal, focused on functionality

### User Experience
- **Simple Navigation**: Sidebar with clear module access
- **Intuitive Flow**: Each module follows consistent patterns
- **Real-time Updates**: React Query for fresh blockchain data
- **Error Handling**: Toast notifications for user feedback

## Technical Architecture

### Deployment and trust model (browser → Sonic)

- **Static hosting** (e.g. Arweave): the app is files + assets. There is no mandatory Aegis backend for users to sign or read chain state.
- **Wallet + RPC**: Ethers talks to **Sonic** using env-configured RPC. **On-chain contracts** are the source of truth for balances, rules, and verification.
- **ZK / privacy**: witness material should stay in the **browser** when flows implement local proving (`wasm`/`zkey` under `public/circuits/`, manifest under `public/config/`). A remote prover URL is **optional** and must be clearly disclosed if ever used.
- **Environment**: contract addresses and infra defaults are generated from **`Aegis-contracts`** via `npm run gen:frontend-env` (see `scripts/generate-frontend-env.js`). Re-run after deployments; commit refreshed `.env` for reproducible builds.

### Core Technologies

1. **React 18** - UI framework
2. **TypeScript** - Type safety
3. **Vite** - Fast build tool
4. **Ethers.js v6** - Blockchain interaction
5. **Zustand** - State management
6. **React Query** - Data fetching
7. **Tailwind CSS** - Styling
8. **React Router** - Navigation

### Project Structure

```
frontend/
├── src/
│   ├── components/          # Reusable UI components
│   │   ├── Layout.tsx      # Main layout with sidebar
│   │   ├── WalletButton.tsx # Wallet connection UI
│   │   └── RpcSelector.tsx # RPC node selection
│   ├── pages/              # Page components
│   │   ├── Home.tsx        # Landing page
│   │   ├── Governance.tsx  # Governance module
│   │   ├── Staking.tsx     # Staking module
│   │   ├── Lending.tsx     # Lending module
│   │   ├── Insurance.tsx   # Insurance module
│   │   ├── Crowdfunding.tsx # Crowdfunding module
│   │   ├── YieldFarming.tsx # Yield farming module
│   │   ├── Explorer.tsx    # Event explorer
│   │   └── Wallet.tsx      # Wallet management
│   ├── store/              # State management
│   │   └── walletStore.ts  # Wallet and RPC state
│   ├── config/             # Configuration
│   │   └── contracts.ts    # Contract addresses and network config
│   ├── utils/               # Utility functions
│   │   └── format.ts       # Formatting helpers
│   ├── App.tsx             # Main app component
│   └── main.tsx            # Entry point
├── public/                 # Static assets
├── index.html             # HTML template
└── package.json           # Dependencies
```

## Module Integration

### Governance Module
- **Features**: View proposals, create proposals, vote, execute, inspect timelock queue
- **Data**: Fetches from `PrivateGovernance` and shows execution ETA sourced from timelock events
- **Events**: `ProposalCreated`, `VoteCast`, `ProposalExecuted`, `ProposalQueued`
- **Note**: Proposal creation requires ZK proof (not implemented in frontend)

### Governance Treasury Module
- **Features**: Display treasury balances, queued withdrawals, and execution windows
- **Data**: Pulls from `GovernanceTreasury` and `GovernanceControlledEmergency`
- **Events**: `WithdrawalQueued`, `WithdrawalExecuted`, `WithdrawalCancelled`
- **Safety**: Surfaces timelock durations so operators can verify invariants before execution

### Token Allocation Module
- **Features**: Track tranche streaming (ecosystem, treasury, public), cliffs, and remaining allocations
- **Data**: Fetches from `TokenAllocation`
- **Events**: `TrancheStarted`, `TrancheStreamed`, `TrancheRevoked`
- **Usage**: Aligns UI charts with DAO-approved allocation manifests

### Staking Module
- **Features**: Stake, unstake, claim rewards
- **Data**: Fetches from PrivateStakingContract
- **Events**: Staked, Unstaked, RewardsClaimed
- **Epochs**: Displays current epoch information

### Lending Module
- **Features**: Supply liquidity, borrow, repay, view loans
- **Data**: Fetches from PrivateLendingContract
- **Events**: LiquidityProvided, LoanIssued, LoanRepaid
- **Stats**: Pool utilization, total liquidity

### Insurance Module
- **Features**: Create policies, view policies, submit claims
- **Data**: Fetches from DecentralizedInsurance contract
- **Events**: PolicyCreated, ClaimSubmitted, ClaimPaid
- **Pool**: Insurance pool statistics

### Crowdfunding Module
- **Features**: Create campaigns, contribute, track progress
- **Data**: Fetches from AegisCrowdShield contract
- **Events**: CampaignCreated, ContributionMade
- **Austrian Economics**: Implements sovereignty principles

### Yield Farming Module
- **Features**: View pools, stake, claim rewards
- **Data**: Fetches from PrivateYieldFarming contract
- **Events**: PoolCreated, Staked, RewardsClaimed
- **APY**: Calculates and displays annual percentage yield

### Treasury Liquidity Module
- **Features**: Mirror DAO liquidity manifests and allocations
- **Data**: Consumes `TreasuryLiquidityAllocator`, `PrivateAMMContract`, and optional `VITE_POOL_*` environment entries
- **Events**: `LiquiditySeeded`, `LiquidityWithdrawn`, `LiquidityRebalanced`
- **Parity**: Highlights mismatches between public and shielded pools

### Explorer Module
- **Features**: Browse events, filter by contract/block range
- **Data**: Uses `eth_getLogs` RPC call
- **Reconstruction**: Can reconstruct state from events
- **Flexibility**: Works with any contract address

### Wallet Module
- **Features**: View balances, shield, transparent exit (on-chain `unshield`) when needed, manage commitments
- **Data**: Fetches from PrivateTokenContract
- **Privacy**: Handles both transparent and shielded balances

### Cross-Chain Privacy Bridge Module
- **Features**: Inspect validator set size, slash penalties, activation delays, pending transfers
- **Data**: Pulls from `CrossChainPrivacyBridge`
- **Events**: `ValidatorAdded`, `ValidatorRemoved`, `TransferQueued`, `TransferFinalized`
- **Interop**: Connects Sonic Gateway Wrapper settlements to shielded commitments

## State Management

### Wallet Store (Zustand)
- **Provider**: BrowserProvider (MetaMask) or JsonRpcProvider
- **State**: Address, chain ID, connection status, RPC URL
- **Actions**: Connect, disconnect, switch network, set RPC

### React Query
- **Caching**: Automatic caching of blockchain data
- **Refetching**: Configurable refetch intervals
- **Optimistic Updates**: Better UX for transactions

## Blockchain Interaction

### Contract Interaction Pattern

```typescript
// 1. Get provider/signer
const { provider, signer } = useWalletStore()

// 2. Create contract instance
const contract = new Contract(address, ABI, signer || provider)

// 3. Call contract function
const result = await contract.functionName(...params)

// 4. Handle result
toast.success('Transaction successful')
```

### Event Reading Pattern

```typescript
// 1. Use eth_getLogs
const logs = await provider.send('eth_getLogs', [{
  address: contractAddress,
  fromBlock: '0x0',
  toBlock: 'latest',
  topics: []
}])

// 2. Decode events (requires ABI)
const events = logs.map(log => decodeEvent(log, ABI))
```

## Security Considerations

### Client-Side Security
- **No Private Keys**: All signing via wallet
- **RPC Selection**: Users choose their own RPC node
- **On-Chain Verification**: All state verified on-chain
- **No Backend**: No server-side attack surface

### User Control
- **Wallet Choice**: MetaMask or any Web3 wallet
- **RPC Flexibility**: Can use local node or public RPC
- **Data Verification**: Users can verify all data on-chain

## Deployment Architecture

### Arweave Deployment
1. **Build**: `npm run build` creates optimized `dist/` folder
2. **Upload**: Deploy `dist/` to Arweave
3. **Domain**: Update `aegiscoin.sonic` (and any staging subdomains) to the new Arweave transaction ID
4. **Immutable**: Frontend is permanent and unchangeable

### Access Methods
- **Arweave Gateway**: `https://arweave.net/{tx-id}`
- **.sonic Domain**: `https://your-domain.sonic`
- **IPFS Mirror**: Optional redundancy

## Performance Optimizations

### Build Optimizations
- **Code Splitting**: Separate bundles for React and Ethers
- **Tree Shaking**: Remove unused code
- **Minification**: Terser for JavaScript minification
- **Asset Optimization**: Optimized images and fonts

### Runtime Optimizations
- **React Query Caching**: Reduces redundant RPC calls
- **Lazy Loading**: Components loaded on demand
- **Memoization**: Prevents unnecessary re-renders

## Future Considerations

### ZK Proof Integration
Currently, ZK proof generation is not implemented. For production:
1. Integrate with ZK proof generation service
2. Generate proofs client-side or via service
3. Include proofs in contract transactions

### Contract ABI Management
Currently uses placeholder ABIs. For production:
1. Import actual ABIs from contract artifacts
2. Type-safe contract interactions
3. Better error handling

### Enhanced Features
Potential enhancements (not in one-time release):
- Transaction history
- Advanced filtering
- Export functionality
- Mobile app version

## Maintenance

Since this is a one-time release:
- **No Updates**: Frontend is immutable
- **Contract Changes**: Only via governance
- **User Forks**: Users can fork and customize
- **Community**: Community can maintain forks

## Conclusion

The Aegis DAO frontend provides a complete, elegant interface to the entire ecosystem. It's designed to be:
- **Complete**: All modules accessible
- **Secure**: No backend, all on-chain
- **Elegant**: Professional, geeky design
- **Functional**: Full ecosystem integration
- **Immutable**: One-time release, permanent

