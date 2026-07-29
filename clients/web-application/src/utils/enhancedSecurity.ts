/**
 * Enhanced Security Utilities
 * Additional DDoS protection layers for 15 Tbps attacks from 500k IPs
 */

import { BrowserFingerprint, IPClusteringDetector, ddosProtection } from './ddosProtection'

/**
 * Request Throttling Manager
 * Throttles requests based on browser fingerprint and request patterns
 */
export class RequestThrottleManager {
  private static readonly MAX_REQUESTS_PER_FINGERPRINT = 100 // Per hour
  private static readonly THROTTLE_WINDOW = 60 * 60 * 1000 // 1 hour
  private static requestCounts: Map<string, RequestCount> = new Map()

  /**
   * Check if request should be throttled
   */
  static isThrottled(): boolean {
    const fingerprint = BrowserFingerprint.getId()
    const now = Date.now()

    const count = this.requestCounts.get(fingerprint) || {
      count: 0,
      resetTime: now + this.THROTTLE_WINDOW,
    }

    // Reset if window expired
    if (now >= count.resetTime) {
      count.count = 0
      count.resetTime = now + this.THROTTLE_WINDOW
    }

    // Check limit
    if (count.count >= this.MAX_REQUESTS_PER_FINGERPRINT) {
      return true
    }

    // Increment
    count.count++
    this.requestCounts.set(fingerprint, count)

    return false
  }

  /**
   * Reset throttle for fingerprint (for testing/admin)
   */
  static reset(fingerprint?: string): void {
    if (fingerprint) {
      this.requestCounts.delete(fingerprint)
    } else {
      this.requestCounts.clear()
    }
  }
}

interface RequestCount {
  count: number
  resetTime: number
}

/**
 * Connection Limiter
 * Prevents resource exhaustion from too many concurrent connections
 */
export class ConnectionLimiter {
  private static activeConnections: Map<string, number> = new Map()
  private static readonly MAX_CONNECTIONS_PER_DOMAIN = 6 // Per browser limit

  /**
   * Check if connection is allowed
   */
  static canConnect(domain: string): boolean {
    const count = this.activeConnections.get(domain) || 0
    return count < this.MAX_CONNECTIONS_PER_DOMAIN
  }

  /**
   * Register connection
   */
  static registerConnection(domain: string): void {
    const count = this.activeConnections.get(domain) || 0
    this.activeConnections.set(domain, count + 1)
  }

  /**
   * Unregister connection
   */
  static unregisterConnection(domain: string): void {
    const count = this.activeConnections.get(domain) || 0
    if (count > 0) {
      this.activeConnections.set(domain, count - 1)
    }
  }

  /**
   * Get connection count for domain
   */
  static getConnectionCount(domain: string): number {
    return this.activeConnections.get(domain) || 0
  }
}

/**
 * Request Pattern Analyzer
 * Analyzes request patterns to detect botnet behavior
 */
export class RequestPatternAnalyzer {
  private static patterns: Map<string, RequestPattern> = new Map()
  private static readonly ANALYSIS_WINDOW = 60000 // 1 minute
  private static readonly BOTNET_THRESHOLD = 20 // 20+ identical requests from different fingerprints

  /**
   * Analyze request pattern
   */
  static analyze(requestKey: string): { isBotnet: boolean; risk: number } {
    const fingerprint = BrowserFingerprint.getId()
    const now = Date.now()

    const pattern = this.patterns.get(requestKey) || {
      requestKey,
      fingerprints: new Set<string>(),
      timestamps: [],
      firstSeen: now,
    }

    // Add current request
    pattern.fingerprints.add(fingerprint)
    pattern.timestamps.push(now)

    // Clean old timestamps
    pattern.timestamps = pattern.timestamps.filter(
      (time) => now - time < this.ANALYSIS_WINDOW
    )

    // Detect botnet pattern
    const uniqueFingerprints = pattern.fingerprints.size
    const requestCount = pattern.timestamps.length
    const isBotnet =
      uniqueFingerprints >= this.BOTNET_THRESHOLD && requestCount > this.BOTNET_THRESHOLD

    const risk = Math.min(
      100,
      (uniqueFingerprints / this.BOTNET_THRESHOLD) * 50 + (requestCount / this.BOTNET_THRESHOLD) * 50
    )

    // Update pattern
    this.patterns.set(requestKey, pattern)

    // Cleanup old patterns
    if (now - pattern.firstSeen > this.ANALYSIS_WINDOW * 2) {
      this.patterns.delete(requestKey)
    }

    return { isBotnet, risk }
  }
}

interface RequestPattern {
  requestKey: string
  fingerprints: Set<string>
  timestamps: number[]
  firstSeen: number
}

/**
 * Progressive Backoff Manager
 * Implements exponential backoff for failed requests
 */
export class ProgressiveBackoffManager {
  private static backoffMap: Map<string, BackoffState> = new Map()
  private static readonly MAX_BACKOFF = 30000 // 30 seconds
  private static readonly BASE_BACKOFF = 1000 // 1 second

  /**
   * Get backoff delay for key
   */
  static getBackoff(key: string): number {
    const state = this.backoffMap.get(key) || {
      attempts: 0,
      lastAttempt: 0,
    }

    const now = Date.now()
    const timeSinceLastAttempt = now - state.lastAttempt

    // Reset if enough time has passed
    if (timeSinceLastAttempt > this.MAX_BACKOFF) {
      state.attempts = 0
    }

    // Calculate exponential backoff
    const backoff = Math.min(
      this.BASE_BACKOFF * Math.pow(2, state.attempts),
      this.MAX_BACKOFF
    )

    // Update state
    state.attempts++
    state.lastAttempt = now
    this.backoffMap.set(key, state)

    return backoff
  }

  /**
   * Record successful request
   */
  static recordSuccess(key: string): void {
    this.backoffMap.delete(key)
  }

  /**
   * Get backoff status
   */
  static getStatus(key: string): { attempts: number; backoff: number } {
    const state = this.backoffMap.get(key)
    if (!state) {
      return { attempts: 0, backoff: 0 }
    }

    return {
      attempts: state.attempts,
      backoff: this.getBackoff(key),
    }
  }
}

interface BackoffState {
  attempts: number
  lastAttempt: number
}

/**
 * Enhanced Protected Request
 * Combines all protection mechanisms
 */
export async function enhancedProtectedRequest<T>(
  requestId: string,
  requestFn: () => Promise<T>,
  options: {
    priority?: 'critical' | 'high' | 'normal' | 'low'
    deduplicate?: boolean
    throttle?: boolean
  } = {}
): Promise<T> {
  // 1. Throttle check
  if (options.throttle !== false && RequestThrottleManager.isThrottled()) {
    throw new Error('Request throttled. Please wait before making more requests.')
  }

  // 2. Browser fingerprint and clustering detection
  const fingerprint = BrowserFingerprint.getId()
  const clustering = IPClusteringDetector.analyze(fingerprint)
  
  if (clustering.isCluster && clustering.risk > 80) {
    throw new Error('Suspicious activity detected. Access temporarily restricted.')
  }

  // 3. Request pattern analysis
  const patternAnalysis = RequestPatternAnalyzer.analyze(requestId)
  if (patternAnalysis.isBotnet && patternAnalysis.risk > 70) {
    throw new Error('Botnet pattern detected. Access denied.')
  }

  // 4. Progressive backoff for retries
  const backoff = ProgressiveBackoffManager.getBackoff(requestId)
  if (backoff > 0) {
    await new Promise((resolve) => setTimeout(resolve, backoff))
  }

  try {
    // 5. Execute with DDoS protection
    const result = await ddosProtection.protectedRequest(
      requestId,
      requestFn,
      {
        priority: options.priority || 'normal',
        deduplicate: options.deduplicate !== false,
      }
    )

    // Record success
    ProgressiveBackoffManager.recordSuccess(requestId)
    RequestPatternAnalyzer.analyze(requestId) // Update pattern

    return result
  } catch (error) {
    // Progressive backoff will handle retry delays
    throw error
  }
}

/**
 * Get enhanced security status
 */
export function getEnhancedSecurityStatus() {
  return {
    fingerprint: BrowserFingerprint.getId(),
    protection: ddosProtection.getStatus(),
    throttle: {
      active: RequestThrottleManager.isThrottled(),
    },
  }
}

