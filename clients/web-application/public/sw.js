/**
 * Service Worker for DDoS Protection
 * Intercepts and throttles requests at the browser level
 * Provides offline caching and request queuing
 */

const CACHE_VERSION = 'aegis-v1'
const CACHE_NAME = `aegis-cache-${CACHE_VERSION}`
const MAX_REQUESTS_PER_SECOND = 15
const REQUEST_QUEUE_SIZE = 50
const CACHE_MAX_ENTRIES = 100

// Request tracking
const requestTimestamps = []
const requestQueue = []
let isProcessingQueue = false

/**
 * Install service worker
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        '/',
        '/index.html',
        '/manifest.json',
      ])
    })
  )
  self.skipWaiting()
})

/**
 * Activate service worker
 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    })
  )
  self.clients.claim()
})

/**
 * Rate limiting check
 */
function isRateLimited() {
  const now = Date.now()
  // Remove requests older than 1 second
  while (requestTimestamps.length > 0 && now - requestTimestamps[0] > 1000) {
    requestTimestamps.shift()
  }
  return requestTimestamps.length >= MAX_REQUESTS_PER_SECOND
}

/**
 * Add request to queue
 */
function queueRequest(request, event) {
  if (requestQueue.length >= REQUEST_QUEUE_SIZE) {
    // Reject oldest request
    requestQueue.shift()
    event.respondWith(
      new Response('Request queue full', { status: 503 })
    )
    return
  }

  requestQueue.push(request)

  // Process queue if not already processing
  if (!isProcessingQueue) {
    processQueue(event)
  }
}

/**
 * Process request queue
 */
async function processQueue(event) {
  if (isProcessingQueue || requestQueue.length === 0) return

  isProcessingQueue = true

  while (requestQueue.length > 0 && !isRateLimited()) {
    const request = requestQueue.shift()
    if (!request) break
    
    requestTimestamps.push(Date.now())

    try {
      // Try cache first
      const cached = await caches.match(request)
      if (cached) {
        event.respondWith(cached.clone())
        continue
      }

      // Fetch with timeout
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000) // 10 second timeout

      try {
        const response = await fetch(request, {
          signal: controller.signal,
        })
        clearTimeout(timeout)

        // Cache successful responses
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME)
          await cache.put(request, response.clone())

          // Cleanup cache if too large
          const keys = await cache.keys()
          if (keys.length > CACHE_MAX_ENTRIES) {
            await cache.delete(keys[0])
          }
        }

        event.respondWith(response)
      } catch (error) {
        clearTimeout(timeout)
        // Try cache on error
        const cached = await caches.match(request)
        if (cached) {
          event.respondWith(cached)
        } else {
          event.respondWith(
            new Response('Service unavailable', { status: 503 })
          )
        }
      }
    } catch (error) {
      event.respondWith(
        new Response('Request failed', { status: 500 })
      )
    }

    // Small delay between requests
    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  isProcessingQueue = false
}

/**
 * Fetch event handler with DDoS protection
 */
self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)

  // Skip non-GET requests (they can't be cached)
  if (request.method !== 'GET') {
    event.respondWith(fetch(request))
    return
  }

  // Skip same-origin requests (handled by app)
  if (url.origin === self.location.origin) {
    event.respondWith(fetch(request))
    return
  }

  // Check rate limit
  if (isRateLimited()) {
    queueRequest(request, event)
    return
  }

  // Process immediately
  event.respondWith(
    (async () => {
      // Try cache first
      const cached = await caches.match(request)
      if (cached) {
        return cached
      }

      // Fetch with timeout
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)

      try {
        const response = await fetch(request, {
          signal: controller.signal,
        })
        clearTimeout(timeout)

        // Cache successful responses
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME)
          await cache.put(request, response.clone())
        }

        requestTimestamps.push(Date.now())
        return response
      } catch (error) {
        clearTimeout(timeout)
        // Try cache on error
        const cached = await caches.match(request)
        if (cached) {
          return cached
        }
        throw error
      }
    })()
  )
})

/**
 * Message handler for cache clearing
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.delete(CACHE_NAME).then(() => {
        return caches.open(CACHE_NAME)
      })
    )
  }
})

