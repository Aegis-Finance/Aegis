/**
 * Enhanced RPC Provider with rate limiting, DDoS protection, and sovereign node fallback
 */

import { JsonRpcProvider, type Networkish } from 'ethers'

import { checkRateLimit } from './rateLimiter'
import { callSovereignNode, hasSovereignNodes } from './sovereignNode'
import { ddosProtection, ConnectionPool } from './ddosProtection'

// Critical RPC methods that should use sovereign nodes
const CRITICAL_METHODS = [
  'eth_sendTransaction',
  'eth_sign',
  'eth_signTypedData',
  'eth_estimateGas',
  'eth_call',
]

/**
 * Enhanced provider that uses sovereign nodes for critical operations
 * Includes DDoS protection for all RPC calls
 */
export class SecureRpcProvider extends JsonRpcProvider {
  private connectionId: string | null = null
  private readonly providerUrl: string

  constructor(url: string, network?: Networkish) {
    super(url, network)
    // Store URL string for connection pooling
    this.providerUrl = url
  }

  /**
   * Override send to use sovereign nodes when available and apply DDoS protection
   */
  async send(method: string, params: unknown[]): Promise<unknown> {
    // Extract domain for connection pooling
    const url = new URL(this.providerUrl)
    const domain = url.hostname

    const isCritical = CRITICAL_METHODS.includes(method)

    // Use DDoS protection for all RPC calls
    return ddosProtection.protectedRequest(
      `rpc:${method}:${JSON.stringify(params).slice(0, 100)}`,
      async () => {
        // Rate limit all RPC calls
        checkRateLimit('rpc')

        // Acquire connection
        try {
          this.connectionId = await ConnectionPool.acquire(domain)
        } catch (error) {
          throw new Error('Connection limit reached for RPC. Please try again later.')
        }

        try {
          // For critical operations, prefer sovereign nodes
          if (isCritical && hasSovereignNodes()) {
            try {
              return await callSovereignNode(method, params)
            } catch (error) {
              // Fallback to regular provider if sovereign node fails
              console.warn('[Security] Sovereign node failed, falling back to provider:', error)
            }
          }

          // Use regular provider for non-critical or fallback
          return super.send(method, params)
        } finally {
          // Release connection
          if (this.connectionId) {
            ConnectionPool.release(this.connectionId)
            this.connectionId = null
          }
        }
      },
      {
        priority: isCritical ? 'high' : 'normal',
        circuitBreaker: `rpc:${domain}`,
        deduplicate: true,
      }
    )
  }
}

/**
 * Create a secure provider wrapper
 */
export function createSecureProvider(url: string): JsonRpcProvider {
  return new SecureRpcProvider(url)
}

