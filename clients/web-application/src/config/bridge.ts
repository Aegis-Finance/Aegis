import { ZERO_ADDRESS, DEFAULT_NETWORK } from './contracts'
import bridgeTokensJson from './bridge-tokens.json'

export type BridgeTokenConfig = {
  id: string
  tokenAddress: string | null
  tokenSymbol: string
  description?: string
  /**
   * How the token typically reaches Sonic through the official Sonic Gateway.
   * `circle-cctp-v2` — USDC path documented as CCTP V2 (see Sonic Gateway user guide).
   * `sonic-gateway-native` — other tokens using the native Gateway rail (still deposit → heartbeat → claim).
   */
  settlementRail?: 'circle-cctp-v2' | 'sonic-gateway-native'
}

const TOKEN_ID_MAP: Record<string, string> = {
  'AGS': 'AGS',
  'wS': 'wS',
  'USDC': 'USDC',
  'USDT': 'USDT',
  'WETH': 'WETH',
  'EURC': 'EURC',
}

/** Stable UI / config id for a bridge token symbol (matches `bridge-tokens.json` rows). */
export function bridgeTokenIdFromSymbol(symbol: string): string {
  return (
    TOKEN_ID_MAP[symbol] ||
    symbol
      .replace(/[()]/g, '')
      .replace(/\s+/g, '_')
      .replace(/[^A-Za-z0-9_]/g, '')
      .toUpperCase()
  )
}

/**
 * Load bridge token configurations from JSON config file
 */
function loadBridgeTokensFromJson(): BridgeTokenConfig[] {
  // Determine network: 14601 = testnet, 146 = mainnet
  const isTestnet = DEFAULT_NETWORK.chainId === 14601
  const networkKey = isTestnet ? 'sonicTestnet' : 'sonic'
  
  const tokensConfig = bridgeTokensJson as unknown as Record<string, Array<{
    tokenSymbol: string
    tokenAddress: string
    enabled: boolean
    description?: string
    settlementRail?: 'circle-cctp-v2' | 'sonic-gateway-native'
  }>>
  
  const networkTokens = tokensConfig[networkKey] || []

  return networkTokens
    .filter(token => token.enabled)
    .map((token) => {
      const id = bridgeTokenIdFromSymbol(token.tokenSymbol)

      return {
        id,
        tokenAddress: token.tokenAddress !== ZERO_ADDRESS ? token.tokenAddress : null,
        tokenSymbol: token.tokenSymbol,
        description: token.description,
        settlementRail: token.settlementRail,
      }
    })
}

/**
 * Get all bridge token configurations
 * Returns tokens that can potentially be bridged and converted to private commitments
 */
export function getBridgeTokenConfigs(): BridgeTokenConfig[] {
  return loadBridgeTokensFromJson()
}

/**
 * Get bridge token config by symbol
 */
export function getBridgeTokenBySymbol(symbol: string): BridgeTokenConfig | undefined {
  return getBridgeTokenConfigs().find(token => token.tokenSymbol === symbol)
}

/**
 * Get bridge token config by address
 */
export function getBridgeTokenByAddress(address: string): BridgeTokenConfig | undefined {
  return getBridgeTokenConfigs().find(
    token => token.tokenAddress?.toLowerCase() === address.toLowerCase()
  )
}

