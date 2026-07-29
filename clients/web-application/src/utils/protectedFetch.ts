/**
 * Protected Fetch Wrapper
 * Wraps all fetch requests with DDoS protection mechanisms
 */

import { ddosProtection, ConnectionPool, RequestDeduplicator } from './ddosProtection'
import { checkRateLimit } from './rateLimiter'

interface ProtectedFetchOptions extends Omit<RequestInit, 'priority'> {
  requestPriority?: 'critical' | 'high' | 'normal' | 'low'
  circuitBreaker?: string
  deduplicate?: boolean
  batch?: string
  timeout?: number
  retries?: number
}

/**
 * Protected fetch with all DDoS protection mechanisms
 */
export async function protectedFetch(
  url: string,
  options: ProtectedFetchOptions = {}
): Promise<Response> {
  const {
    requestPriority = 'normal',
    circuitBreaker,
    deduplicate = true,
    batch,
    timeout = 15000,
    retries = 3,
    ...fetchOptions
  } = options

  // Extract domain for connection pooling
  const urlObj = new URL(url)
  const domain = urlObj.hostname

  // Generate request ID for deduplication
  const requestId = RequestDeduplicator.generateKey(url, fetchOptions.method || 'GET', fetchOptions.body)

  return ddosProtection.protectedRequest(
    requestId,
    async () => {
      // Acquire connection
      let connectionId: string | null = null
      try {
        connectionId = await ConnectionPool.acquire(domain)
      } catch (error) {
        throw new Error('Connection limit reached. Please try again later.')
      }

      try {
        // Execute fetch with retries
        return await fetchWithRetry(url, fetchOptions, timeout, retries)
      } finally {
        // Release connection
        if (connectionId) {
          ConnectionPool.release(connectionId)
        }
      }
    },
    {
      priority: requestPriority,
      circuitBreaker: circuitBreaker || `gateway:${domain}`,
      deduplicate,
      batch,
    }
  )
}

/**
 * Fetch with retry logic and exponential backoff
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  timeout: number,
  maxRetries: number
): Promise<Response> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      // Check rate limit before each attempt
      checkRateLimit('api')

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      // Don't retry on client errors (4xx)
      if (response.status >= 400 && response.status < 500) {
        return response
      }

      // Retry on server errors (5xx) or network errors
      if (response.ok || attempt === maxRetries - 1) {
        return response
      }

      // Exponential backoff
      const backoffDelay = Math.min(1000 * Math.pow(2, attempt), 10000)
      await new Promise((resolve) => setTimeout(resolve, backoffDelay))
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // Don't retry on abort (timeout) on last attempt
      if (attempt === maxRetries - 1) {
        break
      }

      // Exponential backoff
      const backoffDelay = Math.min(1000 * Math.pow(2, attempt), 10000)
      await new Promise((resolve) => setTimeout(resolve, backoffDelay))
    }
  }

  throw lastError || new Error('Fetch failed after retries')
}

/**
 * Batch multiple fetches together
 */
export async function batchFetch(
  requests: Array<{ url: string; options?: RequestInit }>,
  batchKey: string = 'default'
): Promise<Response[]> {
  const batchResults = await Promise.allSettled(
    requests.map((req) =>
      protectedFetch(req.url, {
        ...req.options,
        batch: batchKey,
        requestPriority: 'normal',
      })
    )
  )

  return batchResults.map((result) => {
    if (result.status === 'fulfilled') {
      return result.value
    }
    throw result.reason
  })
}

/**
 * Critical fetch for important requests
 */
export async function criticalFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  return protectedFetch(url, {
    ...options,
    requestPriority: 'critical',
    deduplicate: true,
    timeout: 30000,
    retries: 5,
  })
}

