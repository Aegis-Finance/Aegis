/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TOKEN_ADDRESS: string
  readonly VITE_GOVERNANCE_ADDRESS: string
  readonly VITE_VERIFIER_FACTORY_ADDRESS: string
  readonly VITE_STAKING_ADDRESS: string
  readonly VITE_LENDING_ADDRESS: string
  readonly VITE_INSURANCE_ADDRESS: string
  readonly VITE_CROWDFUNDING_ADDRESS: string
  readonly VITE_YIELD_FARMING_ADDRESS: string
  readonly VITE_LEADERBOARD_ADDRESS: string
  readonly VITE_SONIC_GATEWAY_WRAPPER_ADDRESS: string
  readonly VITE_PRIVATEAMMCONTRACT_ADDRESS: string
  readonly VITE_TREASURYLIQUIDITYALLOCATOR_ADDRESS: string
  readonly VITE_GOVERNANCE_TREASURY_ADDRESS: string
  readonly VITE_TOKEN_ALLOCATION_ADDRESS: string
  readonly VITE_CROSS_CHAIN_BRIDGE_ADDRESS: string
  readonly VITE_GOVERNANCE_EMERGENCY_ADDRESS: string
  readonly VITE_POOL_PRICE_VALIDATOR_ADDRESS: string
  readonly VITE_DEFAULT_NETWORK?: string
  readonly VITE_DAO_RPC_URL?: string
  readonly VITE_TRUSTED_RPC_HOSTS?: string
  /** Comma-separated `https://host` (or bare hostnames) added to production CSP `connect-src` at build time. */
  readonly VITE_CSP_EXTRA_CONNECT?: string
  readonly VITE_ETHERSCAN_API_KEY?: string
  readonly VITE_CUSTOM_RPC_URL?: string
  /** Optional remote prover (mint/shield, lending, staking, …) */
  readonly VITE_PROVER_URL?: string
  readonly VITE_PRIVACY_ENTRY_ROUTER_ADDRESS?: string
  /** HTTP privacy entry relayer (`privacy-entry-relayer-http.mjs`) — Wallet shield / transparent exit */
  readonly VITE_PRIVACY_RELAY_HTTP_URL?: string
  readonly VITE_PRIVACY_RELAY_API_KEY?: string
  /** When `0` or `false`, Wallet uses wallet-paid router txs even if `VITE_PRIVACY_RELAY_HTTP_URL` is set */
  readonly VITE_DEFAULT_GASLESS_RELAY?: string
  /** Optional `StagedCapitalVault` for VC-style milestone rounds */
  readonly VITE_STAGED_CAPITAL_VAULT_ADDRESS?: string
  /** Max random delay (ms) before `relayShield` / transparent-exit relay; capped at 30000. 0 or unset = off. */
  readonly VITE_PRIVACY_SUBMIT_JITTER_MAX_MS?: string
  /** When `1`, Wallet shows local shield / transparent-exit stats + optional telemetry opt-in — see docs/ops/PRIVACY_METRICS_PRODUCT_AND_LEGAL.md */
  readonly VITE_SHOW_LOCAL_PRIVACY_STATS?: string
  /** Optional HTTPS URL for opt-in anonymous aggregate privacy counters (CORS must allow static host). */
  readonly VITE_PRIVACY_TELEMETRY_ENDPOINT?: string
  /** Private lending — `VerifierFactory` split circuits (match `Aegis-contracts` + `npm run gen:frontend-env`) */
  readonly VITE_LENDING_TENOR_WASM?: string
  readonly VITE_LENDING_TENOR_ZKEY?: string
  readonly VITE_LENDING_TENOR_TXID?: string
  readonly VITE_LENDING_TENOR_ZKEY_TXID?: string
  readonly VITE_LENDING_LIQUIDITY_WASM?: string
  readonly VITE_LENDING_LIQUIDITY_ZKEY?: string
  readonly VITE_LENDING_LIQUIDITY_TXID?: string
  readonly VITE_LENDING_LIQUIDITY_ZKEY_TXID?: string
  readonly VITE_LENDING_REPAY_WASM?: string
  readonly VITE_LENDING_REPAY_ZKEY?: string
  readonly VITE_LENDING_REPAY_TXID?: string
  readonly VITE_LENDING_REPAY_ZKEY_TXID?: string
  readonly VITE_LENDING_WITHDRAW_WASM?: string
  readonly VITE_LENDING_WITHDRAW_ZKEY?: string
  readonly VITE_LENDING_WITHDRAW_TXID?: string
  readonly VITE_LENDING_WITHDRAW_ZKEY_TXID?: string
  readonly VITE_LENDING_LIQUIDATE_WASM?: string
  readonly VITE_LENDING_LIQUIDATE_ZKEY?: string
  readonly VITE_LENDING_LIQUIDATE_TXID?: string
  readonly VITE_LENDING_LIQUIDATE_ZKEY_TXID?: string
  /** Legacy single-circuit bundle (`lending.circom`) — not used by current `PrivateLendingContract` */
  readonly VITE_LENDING_WASM?: string
  readonly VITE_LENDING_ZKEY?: string
  readonly VITE_LENDING_TXID?: string
  readonly VITE_LENDING_ZKEY_TXID?: string
  readonly VITE_BONDING_CURVE_ADDRESS?: string
  readonly VITE_BONDING_CURVE_PURCHASE_WASM?: string
  readonly VITE_BONDING_CURVE_PURCHASE_ZKEY?: string
  readonly VITE_BONDING_CURVE_PURCHASE_TXID?: string
  readonly VITE_BONDING_CURVE_PURCHASE_ZKEY_TXID?: string
  readonly VITE_BONDING_CURVE_SELL_WASM?: string
  readonly VITE_BONDING_CURVE_SELL_ZKEY?: string
  readonly VITE_BONDING_CURVE_SELL_TXID?: string
  readonly VITE_BONDING_CURVE_SELL_ZKEY_TXID?: string
  readonly VITE_VERIFIER_ARTIFACT_MANIFEST?: string
  readonly VITE_GOVERNANCE_CORE_ADDRESS?: string
  readonly VITE_AUTOMATED_LIQUIDITY_DEPLOYER_ADDRESS?: string
  readonly VITE_TIME_LOCK_PURCHASE_LIMITS_ADDRESS?: string
  readonly VITE_CEREMONY_VERIFIER_ADDRESS?: string
  readonly VITE_TIMELOCK_CONTROLLER_ADDRESS?: string
  readonly VITE_DAO_REVENUE_ROUTER_ADDRESS?: string
  readonly VITE_PUBLIC_POOL_ROUTER_ADDRESS?: string
  readonly VITE_CANONICAL_SWAP_ROUTER_ADDRESS?: string
  readonly VITE_UNISWAP_V3_QUOTER_ADDRESS?: string
  readonly VITE_WRAPPED_NATIVE_ADDRESS?: string
  readonly VITE_UNISWAP_V3_POOL_FEE?: string
  /** Optional Odos API key for higher rate limits (https://docs.odos.xyz/api/sor/) */
  readonly VITE_ODOS_API_KEY?: string
  readonly VITE_TRANSPARENT_ESCROW_ORDERS_ADDRESS?: string
  readonly VITE_SIGNED_LIMIT_ORDER_REGISTRY_ADDRESS?: string
  readonly VITE_RFQ_INTENT_SETTLEMENT_ADDRESS?: string
  readonly VITE_TOKEN_DISTRIBUTION_SALE_ADDRESS?: string
  readonly VITE_LIQUIDITY_MINING_GAUGE_ADDRESS?: string
  readonly VITE_TREASURY_BOND_AUCTION_ADDRESS?: string
  readonly VITE_MESSAGING_ADAPTER_ALLOWLIST_ADDRESS?: string
  readonly VITE_ANALYTICS_SUB_PRICE_WEI?: string
  readonly VITE_ENABLE_THIRD_PARTY_TRANSLATE?: string
  readonly VITE_AUCTION_ADDRESS?: string
  readonly VITE_EXECUTION_RELAY_ADDRESS?: string
  readonly VITE_DERIVATIVES_ADDRESS?: string
  readonly VITE_PRIVACY_RELAY_HTTP_URLS?: string
  readonly VITE_OPERATIONAL_PROFILE?: string
  readonly VITE_SECURITY_PROFILE?: string
  readonly VITE_ARWEAVE_GATEWAYS?: string
  readonly VITE_IPFS_GATEWAYS?: string
  readonly VITE_LOCAL_MIRROR?: string
  readonly VITE_MINT_OPTIMIZED_WASM?: string
  readonly VITE_MINT_OPTIMIZED_ZKEY?: string
  readonly VITE_SHIELDED_TRANSFER_WASM?: string
  readonly VITE_SHIELDED_TRANSFER_ZKEY?: string
  readonly VITE_TRANSFER_UNSHIELD_WASM?: string
  readonly VITE_TRANSFER_UNSHIELD_ZKEY?: string
  readonly VITE_STEALTH_ADDRESS_HUB_ADDRESS?: string
  readonly VITE_RELAYER_MARKETPLACE_ADDRESS?: string
  readonly VITE_SELECTIVE_DISCLOSURE_HUB_ADDRESS?: string
  readonly VITE_PRIVACY_SAVINGS_VAULT_ADDRESS?: string
  readonly VITE_ANONYMOUS_PAYROLL_ADDRESS?: string
  readonly VITE_SHIELDED_TREASURY_MANAGER_ADDRESS?: string
  readonly VITE_PRIVATE_BOND_MARKET_ADDRESS?: string
  readonly VITE_PRIVATE_PREDICTION_MARKET_ADDRESS?: string
  readonly VITE_PRIVATE_STABLE_VAULT_ADDRESS?: string
  readonly VITE_PRIVATE_CREDIT_PROFILE_ADDRESS?: string
  readonly VITE_SHIELDED_GOVERNANCE_TALLY_ADDRESS?: string
  readonly VITE_SHIELDED_ECOSYSTEM_ROUTER_ADDRESS?: string
  readonly VITE_SHIELDED_YIELD_VAULT_ADDRESS?: string
  readonly VITE_SHIELDED_INCENTIVE_CLAIMS_ADDRESS?: string
  readonly VITE_LIQUIDITY_GAUGE_USDC_ADDRESS?: string
  readonly VITE_LIQUIDITY_GAUGE_SONIC_ADDRESS?: string
  readonly VITE_AGS_FEE_MONETIZATION_ADDRESS?: string
  readonly VITE_FEEM_GOVERNANCE_EXTENSION_ADDRESS?: string
  readonly VITE_SONIC_MULTICALL3?: string
  readonly VITE_SONIC_GATEWAY_BRIDGE?: string
  readonly VITE_ETH_GATEWAY_TOKEN_DEPOSIT?: string
  readonly VITE_ETH_RPC_URL?: string
  readonly VITE_SONIC_MAINNET_RPC_URL?: string
  readonly VITE_AUCTION_CIRCUIT_WASM?: string
  readonly VITE_AUCTION_CIRCUIT_ZKEY?: string
  readonly VITE_AUCTION_CLAIM_WASM?: string
  readonly VITE_AUCTION_CLAIM_ZKEY?: string
  readonly VITE_DERIVATIVES_DEFAULT_VOL_PCT?: string
  readonly VITE_DERIVATIVES_DEFAULT_RISK_FREE_PCT?: string
  readonly VITE_DERIVATIVES_UNDERLYING_ASSET_ID?: string
  readonly VITE_ENABLE_CLIENT_FINGERPRINT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

