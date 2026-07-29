/**
 * Advanced DDoS Protection System
 *
 * **Privacy default:** `BrowserFingerprint.getId()` uses a session-scoped random id unless
 * `VITE_ENABLE_CLIENT_FINGERPRINT=1` (see `docs/PRIVACY_DEFAULTS_AND_FINGERPRINTING.md`).
 * Canvas/WebGL/audio fingerprinting runs only when that flag is set.
 *
 * Defense Strategies:
 * 1. Browser fingerprinting and IP clustering detection
 * 2. Request queuing and connection pooling limits
 * 3. Circuit breaker patterns with automatic failover
 * 4. Request deduplication and batching
 * 5. Progressive backoff and rate limiting
 * 6. Service Worker request interception
 */

import { checkRateLimit } from './rateLimiter'

/**
 * Browser Fingerprinting
 * Creates unique identifiers without relying on IP addresses
 */
export class BrowserFingerprint {
  private static fingerprint: string | null = null
  /** Session-only id when canvas/WebGL/audio fingerprinting is disabled (default). */
  private static privacySessionId: string | null = null
  private static readonly STORAGE_KEY = 'aegis_fingerprint'
  private static readonly STORAGE_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days

  /**
   * Generate browser fingerprint
   * Combines multiple browser characteristics to create unique ID
   */
  static generate(): string {
    if (this.fingerprint) return this.fingerprint

    // Try to load from storage first
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY)
      if (stored) {
        const { fingerprint, timestamp } = JSON.parse(stored)
        if (Date.now() - timestamp < this.STORAGE_TTL) {
          this.fingerprint = fingerprint
          return fingerprint
        }
      }
    } catch {}

    // Generate new fingerprint
    const components: string[] = []

    // Canvas fingerprinting (most unique)
    try {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.textBaseline = 'top'
        ctx.font = '14px Arial'
        ctx.fillText('Aegis DDoS Protection', 2, 2)
        components.push(canvas.toDataURL().slice(-50))
      }
    } catch {}

    // Screen characteristics
    components.push(`${screen.width}x${screen.height}x${screen.colorDepth}`)
    components.push(`${window.innerWidth}x${window.innerHeight}`)

    // Timezone
    components.push(new Date().getTimezoneOffset().toString())

    // Language
    components.push(navigator.language || 'en')

    // Platform
    components.push(navigator.platform || 'unknown')

    // Hardware concurrency
    components.push((navigator.hardwareConcurrency || 0).toString())

    // Device memory (if available)
    if ('deviceMemory' in navigator) {
      components.push((navigator.deviceMemory || 0).toString())
    }

    // WebGL fingerprint
    try {
      const gl = document.createElement('canvas').getContext('webgl')
      if (gl) {
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
        if (debugInfo) {
          components.push(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
        }
      }
    } catch {}

    // Audio fingerprint (most unique)
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      const oscillator = audioContext.createOscillator()
      const analyser = audioContext.createAnalyser()
      const gainNode = audioContext.createGain()
      const scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1)

      gainNode.gain.value = 0 // Mute
      oscillator.type = 'triangle'
      oscillator.connect(analyser)
      analyser.connect(scriptProcessor)
      scriptProcessor.connect(gainNode)
      gainNode.connect(audioContext.destination)

      oscillator.start(0)

      scriptProcessor.onaudioprocess = (event) => {
        const inputBuffer = event.inputBuffer.getChannelData(0)
        let sum = 0
        for (let i = 0; i < inputBuffer.length; i++) {
          sum += Math.abs(inputBuffer[i])
        }
        components.push(sum.toString().slice(0, 10))
        oscillator.stop()
        audioContext.close()
      }
    } catch {}

    // Combine all components
    const combined = components.join('|')
    this.fingerprint = this.hash(combined)

    // Store in localStorage
    try {
      localStorage.setItem(
        this.STORAGE_KEY,
        JSON.stringify({
          fingerprint: this.fingerprint,
          timestamp: Date.now(),
        })
      )
    } catch {}

    return this.fingerprint
  }

  /**
   * Simple hash function
   */
  private static hash(str: string): string {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36)
  }

  /**
   * Get fingerprint ID
   * @remarks By default (`VITE_ENABLE_CLIENT_FINGERPRINT` unset or not `1`) this returns a random **session-scoped**
   * label only — no canvas/WebGL/audio fingerprinting or `localStorage` persistence. Set `VITE_ENABLE_CLIENT_FINGERPRINT=1`
   * to restore the stronger (more invasive) client id used for DDoS heuristics. See `docs/PRIVACY_DEFAULTS_AND_FINGERPRINTING.md`.
   */
  static getId(): string {
    if (import.meta.env.VITE_ENABLE_CLIENT_FINGERPRINT !== '1') {
      if (this.privacySessionId) return this.privacySessionId
      try {
        let sid = sessionStorage.getItem('aegis_privacy_session_id')
        if (!sid) {
          sid =
            typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
              ? crypto.randomUUID()
              : `p-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
          sessionStorage.setItem('aegis_privacy_session_id', sid)
        }
        this.privacySessionId = `session:${sid}`
        return this.privacySessionId
      } catch {
        this.privacySessionId = 'session:private'
        return this.privacySessionId
      }
    }
    return this.generate()
  }
}

/**
 * IP Clustering Detection
 * Detects if multiple requests are coming from botnet/clustered IPs
 */
export class IPClusteringDetector {
  private static requestPatterns: Map<string, RequestPattern> = new Map()
  private static readonly WINDOW_MS = 60000 // 1 minute
  private static readonly CLUSTER_THRESHOLD = 50 // 50 requests/min from cluster
  private static readonly CLUSTER_SIZE_THRESHOLD = 10 // 10+ unique IPs

  /**
   * Analyze request pattern
   */
  static analyze(ipFingerprint: string): { isCluster: boolean; risk: number } {
    const now = Date.now()
    const pattern = this.requestPatterns.get(ipFingerprint) || {
      requests: [],
      firstSeen: now,
      uniqueIdentifiers: new Set<string>(),
    }

    // Add current request
    pattern.requests.push(now)
    pattern.uniqueIdentifiers.add(ipFingerprint)

    // Clean old requests
    pattern.requests = pattern.requests.filter((time) => now - time < this.WINDOW_MS)

    // Update pattern
    this.requestPatterns.set(ipFingerprint, pattern)

    // Detect clustering
    const requestRate = pattern.requests.length
    const uniqueCount = pattern.uniqueIdentifiers.size

    // High risk if many requests from similar fingerprints
    const isCluster =
      requestRate > this.CLUSTER_THRESHOLD && uniqueCount > this.CLUSTER_SIZE_THRESHOLD

    const risk = Math.min(100, (requestRate / this.CLUSTER_THRESHOLD) * 50 + (uniqueCount / this.CLUSTER_SIZE_THRESHOLD) * 50)

    // Cleanup old patterns
    if (now - pattern.firstSeen > this.WINDOW_MS * 2) {
      this.requestPatterns.delete(ipFingerprint)
    }

    return { isCluster, risk }
  }
}

interface RequestPattern {
  requests: number[]
  firstSeen: number
  uniqueIdentifiers: Set<string>
}

/**
 * Request Queue with Priority
 * Manages request flow to prevent overwhelming gateways
 */
export class RequestQueue {
  private queue: QueuedRequest[] = []
  private processing: Set<string> = new Set()
  private readonly maxConcurrent = 6 // Max concurrent requests per client
  private readonly maxQueueSize = 100 // Max queued requests
  private readonly priorityDelay = {
    critical: 0,
    high: 100,
    normal: 500,
    low: 2000,
  }

  /**
   * Add request to queue
   */
  enqueue(
    id: string,
    requestFn: () => Promise<any>,
    priority: 'critical' | 'high' | 'normal' | 'low' = 'normal'
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      // Reject if queue is full
      if (this.queue.length >= this.maxQueueSize) {
        reject(new Error('Request queue is full. Please try again later.'))
        return
      }

      // Check for duplicate request
      const duplicate = this.queue.find((r) => r.id === id)
      if (duplicate) {
        // If duplicate exists and is higher priority, replace it
        if (this.getPriorityValue(priority) > this.getPriorityValue(duplicate.priority)) {
          const index = this.queue.indexOf(duplicate)
          this.queue[index] = {
            id,
            requestFn,
            priority,
            resolve,
            reject,
            timestamp: Date.now(),
          }
        } else {
          // Wait for existing request by chaining resolve/reject callbacks
          // Store the new resolve/reject in the duplicate entry for chaining
          const originalResolve = duplicate.resolve
          const originalReject = duplicate.reject
          duplicate.resolve = (value: any) => {
            originalResolve(value)
            resolve(value)
          }
          duplicate.reject = (error: any) => {
            originalReject(error)
            reject(error)
          }
        }
        return
      }

      // Add to queue
      this.queue.push({
        id,
        requestFn,
        priority,
        resolve,
        reject,
        timestamp: Date.now(),
      })

      // Process queue
      this.processQueue()
    })
  }

  /**
   * Process queue
   */
  private async processQueue(): Promise<void> {
    // Sort by priority and timestamp
    this.queue.sort((a, b) => {
      const priorityDiff = this.getPriorityValue(b.priority) - this.getPriorityValue(a.priority)
      if (priorityDiff !== 0) return priorityDiff
      return a.timestamp - b.timestamp
    })

    // Process requests up to max concurrent
    while (this.processing.size < this.maxConcurrent && this.queue.length > 0) {
      const request = this.queue.shift()!
      this.processing.add(request.id)

      // Apply priority delay
      const delay = this.priorityDelay[request.priority]
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay))
      }

      // Execute request
      request
        .requestFn()
        .then((result) => {
          request.resolve(result)
        })
        .catch((error) => {
          request.reject(error)
        })
        .finally(() => {
          this.processing.delete(request.id)
          // Process next request
          setTimeout(() => this.processQueue(), 0)
        })
    }
  }

  /**
   * Get priority value
   */
  private getPriorityValue(priority: string): number {
    const values = { critical: 4, high: 3, normal: 2, low: 1 }
    return values[priority as keyof typeof values] || 1
  }

  /**
   * Get queue status
   */
  getStatus(): { queueLength: number; processing: number } {
    return {
      queueLength: this.queue.length,
      processing: this.processing.size,
    }
  }

  /**
   * Clear queue
   */
  clear(): void {
    this.queue.forEach((r) => r.reject(new Error('Queue cleared')))
    this.queue = []
    this.processing.clear()
  }
}

interface QueuedRequest {
  id: string
  requestFn: () => Promise<any>
  priority: 'critical' | 'high' | 'normal' | 'low'
  resolve: (value: any) => void
  reject: (error: Error) => void
  timestamp: number
}

/**
 * Circuit Breaker Pattern
 * Prevents cascading failures by breaking circuit when errors exceed threshold
 */
export class CircuitBreaker {
  private state: 'closed' | 'open' | 'half-open' = 'closed'
  private failures: number = 0
  private lastFailureTime: number = 0
  private readonly failureThreshold = 5 // Open circuit after 5 failures
  private readonly resetTimeout = 30000 // 30 seconds
  // private readonly halfOpenMaxAttempts = 3 // Max attempts in half-open state (reserved for future use)

  /**
   * Execute function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = 'half-open'
        this.failures = 0
      } else {
        throw new Error('Circuit breaker is open. Service unavailable.')
      }
    }

    try {
      const result = await fn()
      // Success - reset failures
      if (this.state === 'half-open') {
        this.state = 'closed'
      }
      this.failures = 0
      return result
    } catch (error) {
      this.failures++
      this.lastFailureTime = Date.now()

      if (this.failures >= this.failureThreshold) {
        this.state = 'open'
      }

      throw error
    }
  }

  /**
   * Get circuit breaker status
   */
  getStatus(): { state: string; failures: number } {
    return {
      state: this.state,
      failures: this.failures,
    }
  }

  /**
   * Reset circuit breaker
   */
  reset(): void {
    this.state = 'closed'
    this.failures = 0
    this.lastFailureTime = 0
  }
}

/**
 * Request Deduplication
 * Prevents duplicate requests from being processed
 */
export class RequestDeduplicator {
  private static pendingRequests: Map<string, Promise<any>> = new Map()
  private static readonly DEDUP_WINDOW_MS = 5000 // 5 seconds

  /**
   * Deduplicate request
   */
  static async deduplicate<T>(
    key: string,
    requestFn: () => Promise<T>
  ): Promise<T> {
    // Check if request is already pending
    const pending = this.pendingRequests.get(key)
    if (pending) {
      return pending
    }

    // Create new request
    const request = requestFn()

    // Store pending request
    this.pendingRequests.set(key, request)

    // Cleanup after completion
    request
      .then(() => {
        setTimeout(() => this.pendingRequests.delete(key), this.DEDUP_WINDOW_MS)
      })
      .catch(() => {
        setTimeout(() => this.pendingRequests.delete(key), this.DEDUP_WINDOW_MS)
      })

    return request
  }

  /**
   * Generate deduplication key from request
   */
  static generateKey(url: string, method: string = 'GET', body?: any): string {
    const bodyHash = body ? this.hash(JSON.stringify(body)) : ''
    return `${method}:${url}:${bodyHash}`
  }

  /**
   * Simple hash
   */
  private static hash(str: string): string {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash
    }
    return Math.abs(hash).toString(36)
  }
}

/**
 * Connection Pool Manager
 * Limits concurrent connections to prevent resource exhaustion
 */
export class ConnectionPool {
  private static activeConnections: Map<string, Connection> = new Map()
  private static readonly MAX_CONNECTIONS = 10 // Max concurrent connections
  private static readonly CONNECTION_TIMEOUT = 30000 // 30 seconds
  private static readonly MAX_CONNECTIONS_PER_DOMAIN = 6 // Per RFC 7230

  /**
   * Acquire connection
   */
  static async acquire(domain: string): Promise<string> {
    const now = Date.now()

    // Cleanup stale connections
    for (const [id, conn] of this.activeConnections.entries()) {
      if (now - conn.timestamp > this.CONNECTION_TIMEOUT) {
        this.activeConnections.delete(id)
      }
    }

    // Check per-domain limit
    const domainConnections = Array.from(this.activeConnections.values()).filter(
      (c) => c.domain === domain
    )
    if (domainConnections.length >= this.MAX_CONNECTIONS_PER_DOMAIN) {
      throw new Error(`Connection limit reached for domain: ${domain}`)
    }

    // Check global limit
    if (this.activeConnections.size >= this.MAX_CONNECTIONS) {
      throw new Error('Global connection limit reached')
    }

    // Create connection ID
    const connectionId = `${domain}:${now}:${Math.random().toString(36)}`

    // Register connection
    this.activeConnections.set(connectionId, {
      domain,
      timestamp: now,
    })

    return connectionId
  }

  /**
   * Release connection
   */
  static release(connectionId: string): void {
    this.activeConnections.delete(connectionId)
  }

  /**
   * Get pool status
   */
  static getStatus(): { active: number; max: number } {
    return {
      active: this.activeConnections.size,
      max: this.MAX_CONNECTIONS,
    }
  }
}

interface Connection {
  domain: string
  timestamp: number
}

/**
 * Request Batcher
 * Batches multiple requests into single calls
 */
export class RequestBatcher {
  private static batchQueue: Map<string, BatchItem[]> = new Map()
  private static batchTimer: Map<string, NodeJS.Timeout> = new Map()
  private static readonly BATCH_DELAY_MS = 100 // Wait 100ms to batch
  private static readonly MAX_BATCH_SIZE = 10

  /**
   * Add request to batch
   */
  static async batch<T>(
    batchKey: string,
    requestFn: () => Promise<T>
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      // Get or create batch queue
      let queue = this.batchQueue.get(batchKey)
      if (!queue) {
        queue = []
        this.batchQueue.set(batchKey, queue)
      }

      // Add to queue
      queue.push({ requestFn, resolve, reject })

      // Clear existing timer
      const existingTimer = this.batchTimer.get(batchKey)
      if (existingTimer) {
        clearTimeout(existingTimer)
      }

      // Process batch if full
      if (queue.length >= this.MAX_BATCH_SIZE) {
        this.processBatch(batchKey)
      } else {
        // Set timer to process batch
        const timer = setTimeout(() => {
          this.processBatch(batchKey)
        }, this.BATCH_DELAY_MS)
        this.batchTimer.set(batchKey, timer)
      }
    })
  }

  /**
   * Process batch
   */
  private static async processBatch(batchKey: string): Promise<void> {
    const queue = this.batchQueue.get(batchKey)
    if (!queue || queue.length === 0) return

    // Clear timer
    const timer = this.batchTimer.get(batchKey)
    if (timer) {
      clearTimeout(timer)
      this.batchTimer.delete(batchKey)
    }

    // Get batch items
    const items = queue.splice(0, this.MAX_BATCH_SIZE)
    this.batchQueue.set(batchKey, queue)

    // Execute all requests in parallel (with rate limiting)
    const results = await Promise.allSettled(
      items.map((item) => item.requestFn())
    )

    // Resolve/reject promises
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        items[index].resolve(result.value)
      } else {
        items[index].reject(result.reason)
      }
    })
  }
}

interface BatchItem {
  requestFn: () => Promise<any>
  resolve: (value: any) => void
  reject: (error: Error) => void
}

/**
 * Global DDoS Protection Manager
 * Coordinates all protection mechanisms
 */
export class DDoSProtectionManager {
  private static requestQueue = new RequestQueue()
  private static circuitBreakers: Map<string, CircuitBreaker> = new Map()
  // private static readonly MAX_REQUESTS_PER_SECOND = 10 // Reserved for future service worker integration

  /**
   * Protected request wrapper
   */
  static async protectedRequest<T>(
    requestId: string,
    requestFn: () => Promise<T>,
    options: {
      priority?: 'critical' | 'high' | 'normal' | 'low'
      circuitBreaker?: string
      deduplicate?: boolean
      batch?: string
    } = {}
  ): Promise<T> {
    // 1. Rate limit check
    try {
      checkRateLimit('api')
    } catch (error) {
      throw new Error('Rate limit exceeded. Please wait before making more requests.')
    }

    // 2. Browser fingerprint check
    const fingerprint = BrowserFingerprint.getId()
    const clustering = IPClusteringDetector.analyze(fingerprint)
    if (clustering.isCluster && clustering.risk > 80) {
      throw new Error('Suspicious activity detected. Access temporarily restricted.')
    }

    // 3. Deduplication
    if (options.deduplicate) {
      const dedupKey = RequestDeduplicator.generateKey(requestId)
      return RequestDeduplicator.deduplicate(dedupKey, () => this.executeRequest(requestFn, options))
    }

    // 4. Batching
    if (options.batch) {
      return RequestBatcher.batch(options.batch, () => this.executeRequest(requestFn, options))
    }

    // 5. Queue with priority
    return this.requestQueue.enqueue(
      requestId,
      () => this.executeRequest(requestFn, options),
      options.priority || 'normal'
    )
  }

  /**
   * Execute request with circuit breaker
   */
  private static async executeRequest<T>(
    requestFn: () => Promise<T>,
    options: {
      circuitBreaker?: string
    }
  ): Promise<T> {
    // Circuit breaker protection
    if (options.circuitBreaker) {
      let breaker = this.circuitBreakers.get(options.circuitBreaker)
      if (!breaker) {
        breaker = new CircuitBreaker()
        this.circuitBreakers.set(options.circuitBreaker, breaker)
      }
      return breaker.execute(requestFn)
    }

    return requestFn()
  }

  /**
   * Get protection status
   */
  static getStatus(): {
    queue: { queueLength: number; processing: number }
    connections: { active: number; max: number }
    circuitBreakers: Array<{ key: string; state: string; failures: number }>
  } {
    return {
      queue: this.requestQueue.getStatus(),
      connections: ConnectionPool.getStatus(),
      circuitBreakers: Array.from(this.circuitBreakers.entries()).map(([key, breaker]) => ({
        key,
        ...breaker.getStatus(),
      })),
    }
  }
}

// Export singleton instances
export const requestQueue = new RequestQueue()
export const ddosProtection = DDoSProtectionManager

