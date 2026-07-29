/**
 * Client-side rate limiting to prevent abuse and DDoS attacks
 * Implements token bucket algorithm with sliding window
 */

interface RateLimitConfig {
  maxRequests: number
  windowMs: number
  blockDurationMs: number
}

interface RequestRecord {
  count: number
  resetTime: number
  blockedUntil: number
}

class RateLimiter {
  private records: Map<string, RequestRecord> = new Map()
  private config: RateLimitConfig

  constructor(config: RateLimitConfig) {
    this.config = config
    // Clean up old records periodically
    setInterval(() => this.cleanup(), 60000) // Every minute
  }

  /**
   * Check if request is allowed
   * @param key - Unique identifier (IP, address, or session)
   * @returns true if allowed, false if rate limited
   */
  isAllowed(key: string): boolean {
    const now = Date.now()
    const record = this.records.get(key) || {
      count: 0,
      resetTime: now + this.config.windowMs,
      blockedUntil: 0,
    }

    // Check if currently blocked
    if (now < record.blockedUntil) {
      return false
    }

    // Reset if window expired
    if (now >= record.resetTime) {
      record.count = 0
      record.resetTime = now + this.config.windowMs
      record.blockedUntil = 0
    }

    // Check limit
    if (record.count >= this.config.maxRequests) {
      // Block for configured duration
      record.blockedUntil = now + this.config.blockDurationMs
      this.records.set(key, record)
      return false
    }

    // Increment and allow
    record.count++
    this.records.set(key, record)
    return true
  }

  /**
   * Get remaining requests for a key
   */
  getRemaining(key: string): number {
    const record = this.records.get(key)
    if (!record) return this.config.maxRequests

    const now = Date.now()
    if (now >= record.resetTime) {
      return this.config.maxRequests
    }

    return Math.max(0, this.config.maxRequests - record.count)
  }

  /**
   * Get time until reset
   */
  getResetTime(key: string): number {
    const record = this.records.get(key)
    if (!record) return 0

    const now = Date.now()
    return Math.max(0, record.resetTime - now)
  }

  /**
   * Clean up old records
   */
  private cleanup(): void {
    const now = Date.now()
    for (const [key, record] of this.records.entries()) {
      // Remove if reset time passed and not blocked
      if (now >= record.resetTime && now >= record.blockedUntil) {
        this.records.delete(key)
      }
    }
  }

  /**
   * Reset rate limit for a key (for testing/admin)
   */
  reset(key: string): void {
    this.records.delete(key)
  }
}

// Create rate limiters for different operation types
// Limits are stricter to handle 15 Tbps DDoS attacks from 500k IPs
export const rateLimiters = {
  // General API calls - stricter limits
  api: new RateLimiter({
    maxRequests: 30, // Reduced from 100 to 30
    windowMs: 60000, // per minute
    blockDurationMs: 600000, // block for 10 minutes if exceeded (increased from 5)
  }),

  // Critical operations (governance, transactions)
  critical: new RateLimiter({
    maxRequests: 5, // Reduced from 10 to 5
    windowMs: 60000, // per minute
    blockDurationMs: 900000, // block for 15 minutes if exceeded (increased from 10)
  }),

  // RPC calls - stricter limits
  rpc: new RateLimiter({
    maxRequests: 50, // Reduced from 200 to 50
    windowMs: 60000, // per minute
    blockDurationMs: 300000, // block for 5 minutes if exceeded (increased from 3)
  }),

  // Arweave gateway requests - stricter limits
  gateway: new RateLimiter({
    maxRequests: 20, // Reduced from 50 to 20
    windowMs: 60000, // per minute
    blockDurationMs: 300000, // block for 5 minutes if exceeded (increased from 2)
  }),
}

/**
 * Get a unique key for rate limiting
 * Uses browser fingerprint + wallet address for stronger identification
 */
export function getRateLimitKey(): string {
  if (typeof window === 'undefined') {
    return 'anonymous'
  }

  // Import browser fingerprint (lazy load to avoid circular dependencies)
  let fingerprint: string
  try {
    const { BrowserFingerprint } = require('./ddosProtection')
    fingerprint = BrowserFingerprint.getId()
  } catch {
    // Align with privacy-default `aegis_privacy_session_id` (no legacy device hash unless fingerprint flag is on).
    try {
      let sid = sessionStorage.getItem('aegis_privacy_session_id')
      if (!sid) {
        sid =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `rl-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
        sessionStorage.setItem('aegis_privacy_session_id', sid)
      }
      fingerprint = `session:${sid}`
    } catch {
      fingerprint = 'session:anonymous'
    }
  }

  // Try to get wallet address from global state
  const walletAddress = (window as any).__WALLET_ADDRESS__
  if (walletAddress) {
    return `wallet:${walletAddress.toLowerCase()}:${fingerprint}`
  }

  // Use session storage ID + fingerprint
  let sessionId = sessionStorage.getItem('aegis_session_id')
  if (!sessionId) {
    sessionId = `session:${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    sessionStorage.setItem('aegis_session_id', sessionId)
  }
  return `${sessionId}:${fingerprint}`
}

/**
 * Check rate limit and throw if exceeded
 */
export function checkRateLimit(type: keyof typeof rateLimiters): void {
  const key = getRateLimitKey()
  const limiter = rateLimiters[type]

  if (!limiter.isAllowed(key)) {
    const resetTime = limiter.getResetTime(key)
    throw new Error(
      `Rate limit exceeded. Please wait ${Math.ceil(resetTime / 1000)} seconds before trying again.`
    )
  }
}

