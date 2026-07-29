/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPERATIONAL_PROFILE?: string
  readonly VITE_SECURITY_PROFILE?: string
  readonly VITE_RPC_URL?: string
  readonly VITE_DAO_RPC_URL?: string
  readonly VITE_TRUSTED_RPC_HOSTS?: string
  readonly VITE_CHAIN_ID?: string
  readonly VITE_AUCTION_ADDRESS: string
  readonly VITE_EXPLORER_URL?: string
  readonly VITE_PROVER_URL?: string
  readonly VITE_SALE_DOCS_URL?: string
  /**
   * Optional HTTPS base URL for `Aegis-contracts/docs` (no trailing slash), e.g.
   * `https://github.com/your-org/your-repo/blob/main/Aegis-contracts/docs` — enables footer links to economics framing,
   * Dutch market risk note, and FLOW-M5 specs.
   */
  readonly VITE_REPO_DOCS_BASE_URL?: string
  /** Optional — `PrivacyEntryRouter` for EIP-712 relay tab when deployed. */
  readonly VITE_PRIVACY_ENTRY_ROUTER_ADDRESS?: string
  readonly VITE_TOKEN_ADDRESS?: string
  readonly VITE_PRIVACY_RELAY_HTTP_URL?: string
  readonly VITE_PRIVACY_RELAY_API_KEY?: string
  readonly VITE_DEFAULT_GASLESS_RELAY?: string
  /** Optional — `StagedCapitalVault` for the Staged capital tab (TGE microsite + main app). */
  readonly VITE_STAGED_CAPITAL_VAULT_ADDRESS?: string
  readonly VITE_VERIFIER_ARTIFACT_MANIFEST?: string
  readonly VITE_ARWEAVE_GATEWAYS?: string
  readonly VITE_IPFS_GATEWAYS?: string
  readonly VITE_LOCAL_MIRROR?: string
  readonly VITE_TGE_DEFAULT_PURCHASE_MODE?: string
  readonly VITE_TGE_COMPACT_UI?: string
  readonly VITE_VERIFIER_FACTORY_ADDRESS?: string
  readonly VITE_GOVERNANCE_ADDRESS?: string
  readonly VITE_CROSS_CHAIN_BRIDGE_ADDRESS?: string
  readonly VITE_TIME_LOCK_PURCHASE_LIMITS_ADDRESS?: string
  readonly VITE_BONDING_CURVE_ADDRESS?: string
  readonly VITE_AUTOMATED_LIQUIDITY_DEPLOYER_ADDRESS?: string
  readonly VITE_GOVERNANCE_CORE_ADDRESS?: string
  readonly VITE_CEREMONY_VERIFIER_ADDRESS?: string
  readonly VITE_LIQUIDITY_MINING_GAUGE_ADDRESS?: string
  readonly VITE_TREASURY_BOND_AUCTION_ADDRESS?: string
  readonly VITE_SONIC_MULTICALL3?: string
  readonly VITE_SONIC_SFC?: string
  readonly VITE_SONIC_FTM_TO_S_PORTAL?: string
  readonly VITE_SONIC_GATEWAY_BRIDGE?: string
  readonly VITE_SONIC_GATEWAY_TOKEN_PAIRS?: string
  readonly VITE_SONIC_GATEWAY_STATE_ORACLE?: string
  readonly VITE_ETH_GATEWAY_TOKEN_DEPOSIT?: string
  readonly VITE_ETH_GATEWAY_TOKEN_PAIRS?: string
  readonly VITE_ETH_GATEWAY_STATE_ORACLE?: string
  readonly VITE_AUCTION_CIRCUIT_WASM?: string
  readonly VITE_AUCTION_CIRCUIT_ZKEY?: string
  readonly VITE_AUCTION_CIRCUIT_TXID?: string
  readonly VITE_AUCTION_CIRCUIT_WASM_TXID?: string
  readonly VITE_AUCTION_CIRCUIT_ZKEY_TXID?: string
  readonly VITE_AUCTION_CLAIM_WASM?: string
  readonly VITE_AUCTION_CLAIM_ZKEY?: string
  readonly VITE_AUCTION_CLAIM_TXID?: string
  readonly VITE_AUCTION_CLAIM_WASM_TXID?: string
  readonly VITE_AUCTION_CLAIM_ZKEY_TXID?: string
  readonly VITE_CROWDFUNDING_WASM?: string
  readonly VITE_CROWDFUNDING_ZKEY?: string
  readonly VITE_CROWDFUNDING_TXID?: string
  readonly VITE_CROWDFUNDING_ZKEY_TXID?: string
  readonly VITE_ENABLE_THIRD_PARTY_TRANSLATE?: string
  readonly VITE_CSP_EXTRA_CONNECT?: string
  readonly VITE_TOKENLIST_URLS?: string
  /** Set to `1` to enable canvas/WebGL/audio fingerprint for DDoS heuristics. Default: session-only random id. */
  readonly VITE_ENABLE_CLIENT_FINGERPRINT?: string
  /** Ethereum mainnet JSON-RPC for Gateway deposit proofs (`eth_getProof`). */
  readonly VITE_ETH_RPC_URL?: string
  /** Sonic mainnet JSON-RPC for Gateway claim / state oracle reads (default: rpc.soniclabs.com). */
  readonly VITE_SONIC_MAINNET_RPC_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  ethereum?: {
    request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
    on?: (event: string, callback: (...args: unknown[]) => void) => void
    removeListener?: (event: string, callback: (...args: unknown[]) => void) => void
  }
}
