import { DEFAULT_NETWORK } from './contracts'

/** Official Sonic Gateway docs — use these instead of guessing infra or UX. */
export const SONIC_GATEWAY_DOCS = {
  /** Wallets Sonic supports for end users and institutions (RPC / explorer hints). */
  wallets: 'https://docs.soniclabs.com/sonic/wallets',
  /** User-facing bridge flow (deposit → heartbeat → claim, Fast Lane, fail-safe). */
  userGuide: 'https://docs.soniclabs.com/sonic/sonic-gateway',
  /** Canonical `ETH_CONTRACTS` / `SONIC_CONTRACTS` snippet and programmatic claim flows. */
  programmatic: 'https://docs.soniclabs.com/sonic/build-on-sonic/programmatic-gateway',
  /** Published infrastructure tables (re-verify after Sonic deploy changes). */
  contractAddresses: 'https://docs.soniclabs.com/sonic/build-on-sonic/contract-addresses',
  /** Official Sonic Gateway web app (deposit / claim UI). */
  gatewayApp: 'https://gateway.soniclabs.com',
  /** Circle Cross-Chain Transfer Protocol (Sonic Gateway uses CCTP V2 for USDC per Sonic docs). */
  circleCctp: 'https://www.circle.com/en/cross-chain-transfer-protocol',
  /** Sonic Labs index of explorers, RPCs, oracles, on-ramps (ecosystem integrations). */
  toolingAndInfra: 'https://docs.soniclabs.com/sonic/build-on-sonic/tooling-and-infra',
} as const

/**
 * Canonical Sonic infra surfaced as `VITE_SONIC_*` / `VITE_ETH_GATEWAY_*` by
 * `Aegis-contracts/scripts/generate-frontend-env.js` from `config/sonic-infrastructure.json`.
 * On-chain fallbacks for Sonic **mainnet (chain 146)** match the same addresses as Sonic Labs’
 * [Programmatic Gateway](https://docs.soniclabs.com/sonic/build-on-sonic/programmatic-gateway) guide
 * and [contract addresses](https://docs.soniclabs.com/sonic/build-on-sonic/contract-addresses).
 */

function envAddr(key: string): string | undefined {
  const v = import.meta.env[key] as string | undefined
  if (!v || v === '0x0000000000000000000000000000000000000000') return undefined
  return v
}

export function getPrimaryExplorerBase(): string {
  const u = DEFAULT_NETWORK.blockExplorerUrls?.[0]
  return (u ?? 'https://sonicscan.org').replace(/\/$/, '')
}

export function explorerAddressUrl(address: string): string {
  return `${getPrimaryExplorerBase()}/address/${address}`
}

const ETHERSCAN_BASE = 'https://etherscan.io'

/** Ethereum L1 contract (e.g. Gateway TokenDeposit) — always Etherscan. */
export function explorerEthMainnetAddressUrl(address: string): string {
  return `${ETHERSCAN_BASE}/address/${address}`
}

/** Sonic mainnet Gateway `BRIDGE` (Programmatic Gateway `SONIC_CONTRACTS.BRIDGE`). */
export function getSonicGatewayBridgeAddress(): string | undefined {
  return (
    envAddr('VITE_SONIC_GATEWAY_BRIDGE') ??
    (DEFAULT_NETWORK.chainId === 146 ? '0x9Ef7629F9B930168b76283AdD7120777b3c895b3' : undefined)
  )
}

/** Ethereum mainnet `TOKEN_DEPOSIT` (Programmatic Gateway `ETH_CONTRACTS.TOKEN_DEPOSIT`). */
export function getEthGatewayTokenDepositAddress(): string | undefined {
  return (
    envAddr('VITE_ETH_GATEWAY_TOKEN_DEPOSIT') ??
    (DEFAULT_NETWORK.chainId === 146 ? '0xa1E2481a9CD0Cb0447EeB1cbc26F1b3fff3bec20' : undefined)
  )
}

/** Ethereum mainnet `TOKEN_PAIRS` (`ETH_CONTRACTS.TOKEN_PAIRS`). */
export function getEthGatewayTokenPairsAddress(): string | undefined {
  return (
    envAddr('VITE_ETH_GATEWAY_TOKEN_PAIRS') ??
    (DEFAULT_NETWORK.chainId === 146 ? '0xf2b1510c2709072C88C5b14db90Ec3b6297193e4' : undefined)
  )
}

/** Ethereum mainnet `STATE_ORACLE` (`ETH_CONTRACTS.STATE_ORACLE`). */
export function getEthGatewayStateOracleAddress(): string | undefined {
  return (
    envAddr('VITE_ETH_GATEWAY_STATE_ORACLE') ??
    (DEFAULT_NETWORK.chainId === 146 ? '0xB7e8CC3F5FeA12443136f0cc13D81F109B2dEd7f' : undefined)
  )
}

/** Sonic mainnet `TOKEN_PAIRS` (`SONIC_CONTRACTS.TOKEN_PAIRS`). */
export function getSonicGatewayTokenPairsAddress(): string | undefined {
  return (
    envAddr('VITE_SONIC_GATEWAY_TOKEN_PAIRS') ??
    (DEFAULT_NETWORK.chainId === 146 ? '0x134E4c207aD5A13549DE1eBF8D43c1f49b00ba94' : undefined)
  )
}

/** Sonic mainnet `STATE_ORACLE` (`SONIC_CONTRACTS.STATE_ORACLE`). */
export function getSonicGatewayStateOracleAddress(): string | undefined {
  return (
    envAddr('VITE_SONIC_GATEWAY_STATE_ORACLE') ??
    (DEFAULT_NETWORK.chainId === 146 ? '0x836664B0c0CB29B7877bCcF94159CC996528F2C3' : undefined)
  )
}

export function getSonicMulticall3Address(): string | undefined {
  return (
    envAddr('VITE_SONIC_MULTICALL3') ??
    '0xcA11bde05977b3631167028862bE2a173976CA11'
  )
}
