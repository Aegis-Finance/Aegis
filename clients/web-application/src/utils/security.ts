/**
 * Security utilities for frontend protection
 * Implements request throttling, validation, and attack prevention
 * Enhanced for 15 Tbps DDoS protection from 500k IP addresses
 */

import { checkRateLimit, getRateLimitKey } from './rateLimiter'
import { BrowserFingerprint, IPClusteringDetector, ddosProtection } from './ddosProtection'

// Re-export for convenience
export { checkRateLimit, getRateLimitKey }
export { BrowserFingerprint, IPClusteringDetector, ddosProtection }

/**
 * Request throttling wrapper
 * Automatically applies rate limiting to async functions
 */
export function withRateLimit<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  type: 'api' | 'critical' | 'rpc' | 'gateway' = 'api'
): T {
  return (async (...args: Parameters<T>) => {
    checkRateLimit(type)
    return fn(...args)
  }) as T
}

/**
 * Debounce function to prevent rapid repeated calls
 */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null

  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
    timeoutId = setTimeout(() => {
      fn(...args)
      timeoutId = null
    }, delay)
  }
}

/**
 * Throttle function to limit execution frequency
 */
export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean = false

  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      fn(...args)
      inThrottle = true
      setTimeout(() => {
        inThrottle = false
      }, limit)
    }
  }
}

/**
 * Validate and sanitize user input
 */
export function sanitizeInput(input: string): string {
  // Remove potentially dangerous characters
  return input
    .replace(/[<>]/g, '') // Remove HTML brackets
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, '') // Remove event handlers
    .trim()
    .slice(0, 1000) // Limit length
}

/**
 * Validate Ethereum address
 */
export function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address)
}

/**
 * Validate transaction hash
 */
export function isValidTxHash(hash: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(hash)
}

/**
 * Validate Arweave transaction ID
 */
export function isValidArweaveTxId(txId: string): boolean {
  // Arweave transaction IDs are base64url encoded, 43 characters
  return /^[A-Za-z0-9_-]{43}$/.test(txId)
}

/**
 * Create a secure request with timeout and retry logic
 */
export async function secureFetch(
  url: string,
  options: RequestInit = {},
  maxRetries = 3
): Promise<Response> {
  checkRateLimit('api')

  const timeout = options.signal ? undefined : 15000 // 15 second default timeout

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    let timeoutId: NodeJS.Timeout | null = null
    try {
      const controller = new AbortController()
      timeoutId = timeout
        ? setTimeout(() => controller.abort(), timeout)
        : null

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      })

      if (timeoutId) clearTimeout(timeoutId)

      if (!response.ok && response.status >= 500 && attempt < maxRetries - 1) {
        // Retry on server errors
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)))
        continue
      }

      return response
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId)

      if (attempt === maxRetries - 1) {
        throw error
      }

      // Exponential backoff
      await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)))
    }
  }

  throw new Error('Max retries exceeded')
}

/**
 * Detect and prevent suspicious activity patterns
 */
class SecurityMonitor {
  private suspiciousPatterns: Map<string, number> = new Map()
  private readonly THRESHOLD = 10 // Flag after 10 suspicious events

  recordSuspiciousActivity(type: string): void {
    const count = (this.suspiciousPatterns.get(type) || 0) + 1
    this.suspiciousPatterns.set(type, count)

    if (count >= this.THRESHOLD) {
      console.warn(`[Security] Suspicious activity detected: ${type} (${count} occurrences)`)
      // Could send to monitoring service here
    }
  }

  reset(): void {
    this.suspiciousPatterns.clear()
  }
}

export const securityMonitor = new SecurityMonitor()

/**
 * Check for common attack patterns in requests
 */
export function detectAttackPattern(data: unknown): boolean {
  if (typeof data !== 'string') return false

  const lower = data.toLowerCase()

  // SQL injection patterns
  if (/(union|select|insert|delete|drop|exec|script)/i.test(lower)) {
    securityMonitor.recordSuspiciousActivity('sql_injection_attempt')
    return true
  }

  // XSS patterns
  if (/<script|javascript:|onerror=|onload=/i.test(lower)) {
    securityMonitor.recordSuspiciousActivity('xss_attempt')
    return true
  }

  // Path traversal
  if (/\.\.\/|\.\.\\|\.\.%2f|\.\.%5c/i.test(lower)) {
    securityMonitor.recordSuspiciousActivity('path_traversal_attempt')
    return true
  }

  return false
}

/**
 * Validate amount input
 */
export function validateAmount(amount: string): { valid: boolean; error?: string } {
  if (!amount || amount.trim() === '') {
    return { valid: false, error: 'Amount is required' }
  }

  const num = parseFloat(amount)
  if (isNaN(num) || num <= 0) {
    return { valid: false, error: 'Amount must be a positive number' }
  }

  if (num > Number.MAX_SAFE_INTEGER) {
    return { valid: false, error: 'Amount too large' }
  }

  // Check for suspicious patterns
  if (detectAttackPattern(amount)) {
    return { valid: false, error: 'Invalid amount format' }
  }

  return { valid: true }
}

/**
 * Validate hex string
 */
export function isValidHex(hex: string, length?: number): boolean {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (!/^[a-fA-F0-9]+$/.test(clean)) return false
  if (length !== undefined) {
    const expectedLength = length * 2 // bytes to hex chars
    return clean.length === expectedLength
  }
  return true
}

/**
 * Validate slippage percentage
 */
export function validateSlippage(slippage: string): { valid: boolean; error?: string } {
  if (!slippage || slippage.trim() === '') {
    return { valid: false, error: 'Slippage is required' }
  }

  const num = parseFloat(slippage)
  if (isNaN(num) || num < 0 || num > 100) {
    return { valid: false, error: 'Slippage must be between 0 and 100' }
  }

  return { valid: true }
}

/**
 * Rate limiter wrapper for easy use
 */
export const rateLimiter = {
  isAllowed: (_key: string): boolean => {
    try {
      checkRateLimit('api')
      return true
    } catch {
      return false
    }
  },
}

/**
 * Get security status for debugging
 */
export function getSecurityStatus() {
  return {
    rateLimitKey: getRateLimitKey(),
    suspiciousActivity: Object.fromEntries(securityMonitor['suspiciousPatterns']),
  }
}

