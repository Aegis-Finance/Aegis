/**
 * Enhanced RPC Provider with rate limiting, DDoS protection, and connection pooling
 * (Token Distribution Frontend)
 */

import { JsonRpcProvider } from 'ethers'
import { checkRateLimit } from './rateLimiter'
import { ddosProtection, ConnectionPool } from './ddosProtection'

// Critical RPC methods that need higher priority
const CRITICAL_METHODS = [
  'eth_sendTransaction',
  'eth_sign',
  'eth_signTypedData',
  'eth_estimateGas',
  'eth_call',
]

/**
 * Enhanced provider that applies DDoS protection to all RPC calls
 * Includes connection pooling and rate limiting
 */
export class SecureRpcProvider extends JsonRpcProvider {
  private connectionId: string | null = null
  private rpcUrl: string

  constructor(url: string, network?: any, options?: any) {
    super(url, network, options)
    this.rpcUrl = url
  }

  /**
   * Override send to apply DDoS protection to all RPC calls
   */
  async send(method: string, params: unknown[]): Promise<unknown> {
    // Extract domain for connection pooling
    const url = new URL(this.rpcUrl)
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
          // Use regular provider with all protections
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

