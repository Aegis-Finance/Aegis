/**
 * Enhanced Gateway Manager with DDoS Protection
 * Manages multiple Arweave gateways with health checks, failover, and circuit breakers
 */

import { ARWEAVE_GATEWAYS, fetchFromArweave } from './arweaveGateway'
import { ddosProtection, ConnectionPool } from './ddosProtection'
import { checkRateLimit } from './rateLimiter'

/**
 * Gateway manager with DDoS protection
 * Distributes requests across multiple gateways to prevent single point of failure
 */
export class ProtectedGatewayManager {
  private static readonly MAX_PARALLEL_REQUESTS = 3 // Max parallel requests to different gateways
  private static readonly REQUEST_TIMEOUT = 8000 // 8 seconds

  /**
   * Fetch from Arweave with DDoS protection and gateway rotation
   */
  static async fetchProtected(
    transactionId: string,
    options?: RequestInit
  ): Promise<Response> {
    // Check rate limit
    checkRateLimit('gateway')

    // Use DDoS protection wrapper
    return ddosProtection.protectedRequest(
      `gateway:${transactionId}`,
      async () => {
        // Try primary gateway first with circuit breaker
        return fetchFromArweave(transactionId, options)
      },
      {
        priority: 'normal',
        circuitBreaker: 'arweave-gateways',
        deduplicate: true,
      }
    )
  }

  /**
   * Fetch with multiple gateway fallback
   * Tries multiple gateways in parallel for faster response
   */
  static async fetchWithParallelFallback(
    transactionId: string,
    options?: RequestInit
  ): Promise<Response> {
    checkRateLimit('gateway')

    // Get healthy gateways from gateway manager
    const { gatewayManager } = await import('./arweaveGateway')
    const gateways = gatewayManager.getHealthyGateways().slice(0, this.MAX_PARALLEL_REQUESTS)

    if (gateways.length === 0) {
      throw new Error('No healthy Arweave gateways available')
    }

    // Try gateways in parallel, return first successful response
    const requests = gateways.map(async (gateway: { url: string; timeout: number }) => {
      try {
        const domain = new URL(gateway.url).hostname
        const connectionId = await ConnectionPool.acquire(domain)

        try {
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), this.REQUEST_TIMEOUT)

          const response = await fetch(`${gateway.url}/${transactionId}`, {
            ...options,
            signal: controller.signal,
          })

          clearTimeout(timeout)
          ConnectionPool.release(connectionId)

          if (response.ok) {
            return response
          }
          throw new Error(`Gateway returned ${response.status}`)
        } catch (error) {
          ConnectionPool.release(connectionId)
          throw error
        }
      } catch (error) {
        throw error
      }
    })

    // Wait for first successful response
    const results = await Promise.allSettled(requests)
    for (const result of results) {
      if (result.status === 'fulfilled') {
        return result.value
      }
    }

    // All failed
    throw new Error('All gateway requests failed')
  }

  /**
   * Get gateway status
   */
  static getStatus(): {
    totalGateways: number
    healthyGateways: number
    protectionStatus: any
  } {
    const { getHealthyGateways } = require('./arweaveGateway')
    const healthyGateways = getHealthyGateways()
    const protectionStatus = ddosProtection.getStatus()

    return {
      totalGateways: ARWEAVE_GATEWAYS.length,
      healthyGateways: healthyGateways.length,
      protectionStatus,
    }
  }
}

/**
 * Export protected gateway fetch
 */
export async function protectedGatewayFetch(
  transactionId: string,
  options?: RequestInit
): Promise<Response> {
  return ProtectedGatewayManager.fetchProtected(transactionId, options)
}

