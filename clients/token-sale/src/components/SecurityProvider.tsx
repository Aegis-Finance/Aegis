/**
 * Security Provider Component (Token Distribution)
 * Wraps the app with security monitoring and DDoS protection
 */

import { useEffect, ReactNode } from 'react'
import { BrowserFingerprint, IPClusteringDetector, ddosProtection } from '../utils/ddosProtection'

interface SecurityProviderProps {
  children: ReactNode
}

export default function SecurityProvider({ children }: SecurityProviderProps) {
  useEffect(() => {
    // Initialize browser fingerprinting early
    BrowserFingerprint.getId()

    // Store wallet address globally for rate limiting (if available)
    const updateWalletAddress = () => {
      try {
        const walletAddress = (window as any).ethereum?.selectedAddress || 
                             sessionStorage.getItem('wallet_address')
        if (walletAddress) {
          ;(window as any).__WALLET_ADDRESS__ = walletAddress
        } else {
          delete (window as any).__WALLET_ADDRESS__
        }
      } catch {}
    }

    updateWalletAddress()

    // Monitor wallet address changes
    if ((window as any).ethereum) {
      ;(window as any).ethereum.on('accountsChanged', updateWalletAddress)
    }

    // Monitor request patterns for clustering detection
    const fingerprint = BrowserFingerprint.getId()
    const clustering = IPClusteringDetector.analyze(fingerprint)
    if (import.meta.env.DEV && clustering.isCluster && clustering.risk > 70) {
      console.warn('[Security] High-risk clustering detected:', clustering)
    }
  }, [])

  useEffect(() => {
    // Monitor for suspicious activity
    const handleError = (event: ErrorEvent) => {
      if (import.meta.env.DEV) {
        console.error('[Security] Error detected:', {
          message: event.message?.substring(0, 100),
          filename: event.filename,
          lineno: event.lineno,
        })
      }
    }

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (import.meta.env.DEV) {
        console.error('[Security] Unhandled promise rejection:', {
          reason: String(event.reason).substring(0, 100),
        })
      }
    }

    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleUnhandledRejection)

    // Periodic security status check
    const statusInterval = setInterval(() => {
      try {
        const status = ddosProtection.getStatus()
        if (import.meta.env.DEV) {
          if (status.queue.queueLength > 50) {
            console.warn('[Security] High request queue:', status.queue)
          }
          if (status.connections.active > status.connections.max * 0.9) {
            console.warn('[Security] High connection usage:', status.connections)
          }
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

  return <>{children}</>
}

