/**
 * Service Worker Registration and Management
 * Handles service worker lifecycle for DDoS protection
 */

/**
 * Register service worker
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
      })

      if (import.meta.env.DEV) {
        console.log('[Service Worker] Registered:', registration.scope)
      }

      // Handle updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              if (import.meta.env.DEV) {
                console.log('[Service Worker] New version available')
              }
            }
          })
        }
      })

      return registration
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('[Service Worker] Registration failed:', error)
      }
      return null
    }
  }
  return null
}

/**
 * Unregister service worker
 */
export async function unregisterServiceWorker(): Promise<boolean> {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.ready
      const success = await registration.unregister()
      if (success) {
        console.log('[Service Worker] Unregistered')
      }
      return success
    } catch (error) {
      console.error('[Service Worker] Unregister failed:', error)
      return false
    }
  }
  return false
}

/**
 * Clear service worker cache
 */
export async function clearServiceWorkerCache(): Promise<void> {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.ready
      if (registration.active) {
        registration.active.postMessage({ type: 'CLEAR_CACHE' })
      }
      // Also clear caches directly
      const cacheNames = await caches.keys()
      await Promise.all(cacheNames.map((name) => caches.delete(name)))
      console.log('[Service Worker] Cache cleared')
    } catch (error) {
      console.error('[Service Worker] Cache clear failed:', error)
    }
  }
}

/**
 * Get service worker status
 */
export async function getServiceWorkerStatus(): Promise<{
  registered: boolean
  active: boolean
  installing: boolean
  waiting: boolean
}> {
  if (!('serviceWorker' in navigator)) {
    return {
      registered: false,
      active: false,
      installing: false,
      waiting: false,
    }
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration) {
      return {
        registered: false,
        active: false,
        installing: false,
        waiting: false,
      }
    }

    return {
      registered: true,
      active: !!registration.active,
      installing: !!registration.installing,
      waiting: !!registration.waiting,
    }
  } catch (error) {
    console.error('[Service Worker] Status check failed:', error)
    return {
      registered: false,
      active: false,
      installing: false,
      waiting: false,
    }
  }
}

