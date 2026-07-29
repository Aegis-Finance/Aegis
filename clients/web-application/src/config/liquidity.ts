import { ZERO_ADDRESS, DEFAULT_NETWORK } from './contracts'
import liquidityPoolsJson from './liquidity-pools.json'

export type PublicPoolConfig = {
  id: string
  poolAddress: string
  tokenAddress: string | null
  tokenSymbol: string
  lpSymbol: string | null
  useNative: boolean
}

const poolEnvPrefix = 'VITE_POOL_'
const poolAddressEnvKey = /^VITE_POOL_[A-Z0-9]+_ADDRESS$/

// Pool ID mapping for matching JSON pools to env keys
const POOL_ID_MAP: Record<string, string> = {
  'S (native)': 'S',
  'wS (wrapped)': 'WS',
  'USDC': 'USDC',
  'USDT': 'USDT',
  'WETH': 'WETH',
}

function normalizeSymbol(raw: string): string {
  return raw.replace(/_ADDRESS$/, '')
}

function getEnv(key: string): string | undefined {
  const value = import.meta.env[key]
  if (!value || value === '') return undefined
  return value
}

function parseBoolean(value: string | undefined): boolean {
  if (!value) return false
  return value.toLowerCase() === 'true'
}

function resolvePool(symbolKey: string): PublicPoolConfig | null {
  const baseId = normalizeSymbol(symbolKey.replace(poolEnvPrefix, ''))
  const poolAddress = getEnv(symbolKey)

  if (!poolAddress || poolAddress === ZERO_ADDRESS) {
    return null
  }

  const tokenSymbol = getEnv(`${poolEnvPrefix}${baseId}_TOKEN_SYMBOL`) ?? baseId.replace(/_/g, ' ')
  const lpSymbol = getEnv(`${poolEnvPrefix}${baseId}_LP_SYMBOL`) ?? null
  const tokenAddress = getEnv(`${poolEnvPrefix}${baseId}_TOKEN_ADDRESS`) ?? null
  const useNative = parseBoolean(getEnv(`${poolEnvPrefix}${baseId}_USE_NATIVE`))

  return {
    id: baseId,
    poolAddress,
    tokenAddress,
    tokenSymbol,
    lpSymbol,
    useNative,
  }
}

/**
 * Get pools from environment variables (VITE_POOL_*)
 */
function getPoolsFromEnv(): PublicPoolConfig[] {
  const env = import.meta.env
  // Pool address only — exclude VITE_POOL_*_TOKEN_ADDRESS (quote token) and unrelated keys like VITE_POOL_PRICE_VALIDATOR_ADDRESS
  const entries = Object.keys(env).filter((key) => poolAddressEnvKey.test(key))

  const pools = entries
    .map(resolvePool)
    .filter((pool): pool is PublicPoolConfig => pool !== null)

  // Deduplicate by pool address and keep stable order
  const unique = new Map<string, PublicPoolConfig>()
  for (const pool of pools) {
    if (!unique.has(pool.poolAddress.toLowerCase())) {
      unique.set(pool.poolAddress.toLowerCase(), pool)
    }
  }

  return Array.from(unique.values())
}

/**
 * Get pools from JSON config file (contracts config)
 * Returns pools with their token info, but pool addresses need to come from .env
 */
function getPoolsFromJson(): Array<Omit<PublicPoolConfig, 'poolAddress'> & { poolAddress?: string }> {
  // Determine network: 14601 = testnet, 146 = mainnet
  const isTestnet = DEFAULT_NETWORK.chainId === 14601
  const networkKey = isTestnet ? 'sonicTestnet' : 'sonic'
  
  const poolsConfig = liquidityPoolsJson as unknown as Record<string, Array<{
    tokenSymbol: string
    tokenAddress: string
    lpSymbol: string
    useNative: boolean
    enabled: boolean
  }>>
  
  const networkPools = poolsConfig[networkKey] || []

  return networkPools
    .filter(pool => pool.enabled)
    .map((pool) => {
      // Use predefined mapping or generate ID from token symbol
      const id = POOL_ID_MAP[pool.tokenSymbol] || pool.tokenSymbol
        .replace(/[()]/g, '') // Remove parentheses
        .replace(/\s+/g, '_') // Replace spaces with underscores
        .replace(/[^a-zA-Z0-9_]/g, '') // Remove special chars
        .toUpperCase()

      // Try to get pool address from env
      const poolAddress = getEnv(`${poolEnvPrefix}${id}_ADDRESS`) || ''

      return {
        id,
        poolAddress,
        tokenAddress: pool.tokenAddress !== ZERO_ADDRESS ? pool.tokenAddress : null,
        tokenSymbol: pool.tokenSymbol,
        lpSymbol: pool.lpSymbol,
        useNative: pool.useNative,
      }
    })
    .filter(pool => pool.poolAddress && pool.poolAddress !== ZERO_ADDRESS) // Only include pools with addresses from .env
}

/**
 * Get all public pool configurations
 * Combines pools from .env (with addresses) and JSON config (token info)
 * .env pools take precedence if both exist
 */
export function getPublicPoolConfigs(): PublicPoolConfig[] {
  // First, get pools from .env (these have addresses already)
  const envPools = getPoolsFromEnv()
  
  // Then, get pools from JSON config
  const jsonPools = getPoolsFromJson()

  // Create a map of existing pools by ID (from env)
  const poolsMap = new Map<string, PublicPoolConfig>()
  
  // Add env pools first (they take precedence)
  for (const pool of envPools) {
    // Only add pools with valid addresses
    if (pool.poolAddress && pool.poolAddress !== ZERO_ADDRESS) {
      poolsMap.set(pool.id.toLowerCase(), pool)
    }
  }

  // Add JSON pools that aren't already in env AND have addresses
  for (const jsonPool of jsonPools) {
    if (jsonPool.poolAddress && 
        jsonPool.poolAddress !== ZERO_ADDRESS && 
        !poolsMap.has(jsonPool.id.toLowerCase())) {
      poolsMap.set(jsonPool.id.toLowerCase(), jsonPool as PublicPoolConfig)
    }
  }

  // Also try to match JSON pools by token symbol to env pools (to fill in missing info)
  for (const envPool of envPools) {
    if (!envPool.poolAddress || envPool.poolAddress === ZERO_ADDRESS) continue
    
    const matchingJsonPool = jsonPools.find(
      jp => jp.tokenSymbol.toLowerCase().replace(/\s*\(.*?\)\s*/g, '') === 
            envPool.tokenSymbol.toLowerCase().replace(/\s*\(.*?\)\s*/g, '') ||
            jp.tokenAddress?.toLowerCase() === envPool.tokenAddress?.toLowerCase()
    )
    
    if (matchingJsonPool) {
      // Merge JSON info into env pool if missing
      const merged = poolsMap.get(envPool.id.toLowerCase())
      if (merged) {
        // Use clean token symbol from JSON (remove suffixes like "TOKEN")
        const cleanSymbol = matchingJsonPool.tokenSymbol
          .replace(/\s*\(.*?\)\s*/g, '') // Remove (native), (wrapped) etc
          .replace(/\s+TOKEN\s*$/i, '') // Remove trailing "TOKEN"
          .trim()
        if (!merged.tokenSymbol || merged.tokenSymbol.includes('TOKEN')) {
          merged.tokenSymbol = cleanSymbol || matchingJsonPool.tokenSymbol
        }
        
        if (!merged.lpSymbol && matchingJsonPool.lpSymbol) {
          merged.lpSymbol = matchingJsonPool.lpSymbol
        }
        if (!merged.tokenAddress && matchingJsonPool.tokenAddress) {
          merged.tokenAddress = matchingJsonPool.tokenAddress
        }
        if (merged.useNative !== matchingJsonPool.useNative && matchingJsonPool.useNative) {
          merged.useNative = matchingJsonPool.useNative
        }
      }
    }
  }

  // Filter out pools without addresses and deduplicate by address
  const result: PublicPoolConfig[] = []
  const seenAddresses = new Set<string>()
  
  for (const pool of Array.from(poolsMap.values())) {
    if (!pool.poolAddress || pool.poolAddress === ZERO_ADDRESS) continue
    
    const addrKey = pool.poolAddress.toLowerCase()
    if (!seenAddresses.has(addrKey)) {
      seenAddresses.add(addrKey)
      // Clean up token symbol
      pool.tokenSymbol = pool.tokenSymbol
        .replace(/\s*\(.*?\)\s*/g, '')
        .replace(/\s+TOKEN\s*$/i, '')
        .trim()
      result.push(pool)
    }
  }

  return result
}


