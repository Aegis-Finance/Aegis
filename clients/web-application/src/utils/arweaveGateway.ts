/**
 * Arweave Gateway Fallback System
 * Implements multiple gateway fallback for resilience against DDoS attacks
 */

export interface GatewayConfig {
  url: string
  priority: number
  timeout: number
  enabled: boolean
}

/**
 * List of Arweave gateways with priority order
 * Higher priority = tried first
 * Expanded list for better DDoS resilience (15+ gateways)
 *
 * **Monorepo alignment:** default CSV for `VITE_ARWEAVE_GATEWAYS` in `Aegis-contracts/scripts/generate-frontend-env.js`
 * (`DEFAULT_ARWEAVE_GATEWAYS_CSV`) must list the same HTTPS origins; `sonic_extension` and sovereign-node `config.example.json` mirror this set.
 */
export const ARWEAVE_GATEWAYS: GatewayConfig[] = [
  {
    url: 'https://arweave.net',
    priority: 1,
    timeout: 8000, // Reduced timeout for faster failover
    enabled: true,
  },
  {
    url: 'https://ar-io.net',
    priority: 2,
    timeout: 8000,
    enabled: true,
  },
  {
    url: 'https://arweave.live',
    priority: 3,
    timeout: 8000,
    enabled: true,
  },
  {
    url: 'https://gateway.arweave.net',
    priority: 4,
    timeout: 8000,
    enabled: true,
  },
  {
    url: 'https://arweave.dev',
    priority: 5,
    timeout: 8000,
    enabled: true,
  },
  {
    url: 'https://gateway.irys.xyz',
    priority: 6,
    timeout: 8000,
    enabled: true,
  },
  {
    url: 'https://arweave-search.goldsky.com',
    priority: 7,
    timeout: 8000,
    enabled: true,
  },
  {
    url: 'https://arweave.news',
    priority: 8,
    timeout: 8000,
    enabled: true,
  },
  {
    url: 'https://ar-io.dev',
    priority: 9,
    timeout: 8000,
    enabled: true,
  },
  {
    url: 'https://arweave.cache.holaplex.com',
    priority: 10,
    timeout: 8000,
    enabled: true,
  },
]

/**
 * Track gateway health
 */
interface GatewayHealth {
  url: string
  lastSuccess: number
  lastFailure: number
  consecutiveFailures: number
  averageResponseTime: number
}

class GatewayManager {
  private health: Map<string, GatewayHealth> = new Map()
  private readonly MAX_CONSECUTIVE_FAILURES = 3
  private readonly HEALTH_CHECK_INTERVAL = 15000 // 15 seconds (faster health checks)
  private readonly FAST_FAIL_THRESHOLD = 5 // Fast fail after 5 consecutive failures
  private readonly CIRCUIT_BREAKER_TIMEOUT = 60000 // 1 minute circuit breaker

  constructor() {
    // Initialize health tracking
    ARWEAVE_GATEWAYS.forEach((gateway) => {
      this.health.set(gateway.url, {
        url: gateway.url,
        lastSuccess: Date.now(),
        lastFailure: 0,
        consecutiveFailures: 0,
        averageResponseTime: 0,
      })
    })

    // Periodic health check (more frequent for faster failover)
    setInterval(() => this.healthCheck(), this.HEALTH_CHECK_INTERVAL)
  }

  /**
   * Get gateways sorted by health and priority
   * Excludes gateways with circuit breaker open (too many failures)
   */
  getHealthyGateways(): GatewayConfig[] {
    const now = Date.now()
    
    return ARWEAVE_GATEWAYS.filter((gw) => {
      const health = this.health.get(gw.url)
      if (!health || !gw.enabled) return false

      // Check circuit breaker - if too many failures, wait before retry
      if (health.consecutiveFailures >= this.FAST_FAIL_THRESHOLD) {
        const timeSinceLastFailure = now - health.lastFailure
        if (timeSinceLastFailure < this.CIRCUIT_BREAKER_TIMEOUT) {
          return false // Circuit breaker is open
        }
      }

      // Include gateways with fewer than max consecutive failures
      return health.consecutiveFailures < this.MAX_CONSECUTIVE_FAILURES
    }).sort((a, b) => {
      const healthA = this.health.get(a.url)!
      const healthB = this.health.get(b.url)!

      // Sort by: health (fewer failures) > priority > response time
      if (healthA.consecutiveFailures !== healthB.consecutiveFailures) {
        return healthA.consecutiveFailures - healthB.consecutiveFailures
      }
      if (a.priority !== b.priority) {
        return a.priority - b.priority
      }
      return healthA.averageResponseTime - healthB.averageResponseTime
    })
  }

  /**
   * Record successful request
   */
  recordSuccess(url: string, responseTime: number): void {
    const health = this.health.get(url)
    if (health) {
      health.lastSuccess = Date.now()
      health.consecutiveFailures = 0
      // Update average response time (simple moving average)
      health.averageResponseTime =
        (health.averageResponseTime * 0.7 + responseTime * 0.3)
    }
  }

  /**
   * Record failed request
   */
  recordFailure(url: string): void {
    const health = this.health.get(url)
    if (health) {
      health.lastFailure = Date.now()
      health.consecutiveFailures++
    }
  }

  /**
   * Periodic health check with parallel checks on top gateways
   */
  private async healthCheck(): Promise<void> {
    const healthyGateways = this.getHealthyGateways()
    if (healthyGateways.length === 0) {
      // Reset all if all are down (might be temporary)
      this.health.forEach((health) => {
        health.consecutiveFailures = Math.max(0, health.consecutiveFailures - 1)
      })
      return
    }

    // Check top 3 gateways in parallel for faster health detection
    const gatewaysToCheck = healthyGateways.slice(0, 3)
    const healthChecks = gatewaysToCheck.map(async (gateway) => {
      try {
        const start = Date.now()
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 3000) // 3 second timeout
        
        const response = await fetch(`${gateway.url}/health`, {
          method: 'HEAD',
          signal: controller.signal,
        })
        
        clearTimeout(timeout)
        const responseTime = Date.now() - start
        
        if (response.ok) {
          this.recordSuccess(gateway.url, responseTime)
        } else {
          this.recordFailure(gateway.url)
        }
      } catch {
        this.recordFailure(gateway.url)
      }
    })

    // Wait for all health checks to complete
    await Promise.allSettled(healthChecks)
  }
}

const gatewayManager = new GatewayManager()

// Export gateway manager for use in other modules
export { gatewayManager }

/**
 * Fetch from Arweave with automatic gateway fallback and DDoS protection
 */
export async function fetchFromArweave(
  transactionId: string,
  options?: RequestInit
): Promise<Response> {
  const healthyGateways = gatewayManager.getHealthyGateways()

  if (healthyGateways.length === 0) {
    throw new Error('No healthy Arweave gateways available')
  }

  const errors: Error[] = []

  // Try each gateway in order with DDoS protection
  for (const gateway of healthyGateways) {
    let timeoutId: NodeJS.Timeout | null = null
    try {
      const url = `${gateway.url}/${transactionId}`
      const start = Date.now()

      // Check rate limit before attempting
      const { checkRateLimit } = await import('./rateLimiter')
      checkRateLimit('gateway')

      const controller = new AbortController()
      timeoutId = setTimeout(() => controller.abort(), gateway.timeout)

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      })

      if (timeoutId) clearTimeout(timeoutId)
      const responseTime = Date.now() - start

      if (response.ok) {
        gatewayManager.recordSuccess(gateway.url, responseTime)
        return response
      } else if (response.status >= 500) {
        // Server error - try next gateway
        gatewayManager.recordFailure(gateway.url)
        errors.push(new Error(`Gateway ${gateway.url} returned ${response.status}`))
        continue
      } else {
        // Client error (404, etc.) - don't retry
        gatewayManager.recordSuccess(gateway.url, responseTime)
        return response
      }
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId)
      gatewayManager.recordFailure(gateway.url)
      errors.push(
        error instanceof Error
          ? error
          : new Error(`Gateway ${gateway.url} failed: ${String(error)}`)
      )
      continue
    }
  }

  // All gateways failed
  throw new Error(
    `All Arweave gateways failed. Last error: ${errors[errors.length - 1]?.message}`
  )
}

/**
 * Get content from Arweave transaction
 */
export async function getArweaveContent(transactionId: string): Promise<string> {
  const response = await fetchFromArweave(transactionId)
  return await response.text()
}

/**
 * Get JSON from Arweave transaction
 */
export async function getArweaveJSON<T>(transactionId: string): Promise<T> {
  const response = await fetchFromArweave(transactionId)
  return await response.json()
}

/**
 * Parse comma-separated list of URLs
 */
export function parseList(env?: string): string[] {
  if (!env) return []
  return env
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Build gateway URLs from transaction ID
 */
export function buildGatewayUrls(txid: string, gateways: string[], pathSuffix = ''): string[] {
  if (txid.startsWith('http://') || txid.startsWith('https://')) {
    return [txid]
  }
  return gateways.map((g) => `${g.replace(/\/+$/,'')}/${txid}${pathSuffix}`)
}

/**
 * Pick first reachable URL from candidates
 */
export async function pickFirstReachable(urls: string[], timeoutMs = 7000): Promise<string> {
  for (const url of urls) {
    try {
      const controller = new AbortController()
      const t = setTimeout(() => controller.abort(), timeoutMs)
      const res = await fetch(url, { method: 'HEAD', signal: controller.signal })
      clearTimeout(t)
      if (res.ok) return url
    } catch {}
  }
  // Fallback to first even if HEAD failed
  return urls[0] || ''
}

