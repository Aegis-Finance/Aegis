/**
 * Security Provider Component
 * Wraps the app with security monitoring and DDoS protection
 */

import { useEffect, ReactNode } from 'react'
import { useWalletStore } from '@/store/walletStore'
import { BrowserFingerprint, IPClusteringDetector, ddosProtection } from '@/utils/ddosProtection'

interface SecurityProviderProps {
  children: ReactNode
}

export default function SecurityProvider({ children }: SecurityProviderProps) {
  const { address } = useWalletStore()

  useEffect(() => {
    // Initialize browser fingerprinting early
    BrowserFingerprint.getId()

    // Store wallet address globally for rate limiting
    if (address) {
      ;(window as any).__WALLET_ADDRESS__ = address
    } else {
      delete (window as any).__WALLET_ADDRESS__
    }

    // Monitor request patterns for clustering detection
    const fingerprint = BrowserFingerprint.getId()
    const clustering = IPClusteringDetector.analyze(fingerprint)
    if (clustering.isCluster && clustering.risk > 70) {
      console.warn('[Security] High-risk clustering detected:', clustering)
    }
  }, [address])

  useEffect(() => {
    // Monitor for suspicious activity
    const handleError = (event: ErrorEvent) => {
      // Log errors but don't expose sensitive info
      console.error('[Security] Error detected:', {
        message: event.message?.substring(0, 100),
        filename: event.filename,
        lineno: event.lineno,
      })
    }

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('[Security] Unhandled promise rejection:', {
        reason: String(event.reason).substring(0, 100),
      })
    }

    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleUnhandledRejection)

    // Periodic security status check
    const statusInterval = setInterval(() => {
      try {
        const status = ddosProtection.getStatus()
        if (status.queue.queueLength > 50) {
          console.warn('[Security] High request queue:', status.queue)
        }
        if (status.connections.active > status.connections.max * 0.9) {
          console.warn('[Security] High connection usage:', status.connections)
        }
      } catch (error) {
        // Ignore errors in status check
      }
    }, 30000) // Every 30 seconds

    return () => {
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
      if (statusInterval) {
        clearInterval(statusInterval)
      }
    }
  }, [])

  // Register Service Worker for request interception (already done in main.tsx in production)
  // This is a fallback for development
  useEffect(() => {
    if (import.meta.env.DEV && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((registration) => {
          console.log('[Security] Service Worker registered (dev):', registration.scope)
        })
        .catch((error) => {
          console.warn('[Security] Service Worker registration failed (dev):', error)
        })
    }
  }, [])

  return <>{children}</>
}

