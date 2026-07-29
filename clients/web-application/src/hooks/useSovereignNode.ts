/**
 * Hook for using sovereign nodes for critical operations
 */

import { useState, useCallback } from 'react'
import { callSovereignNode, hasSovereignNodes, getSovereignNodeStatus } from '@/utils/sovereignNode'
import { useWalletStore } from '@/store/walletStore'

export function useSovereignNode() {
  const { provider } = useWalletStore()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const executeRpc = useCallback(
    async (method: string, params: unknown[] = []) => {
      setIsLoading(true)
      setError(null)

      try {
        // Prefer sovereign node if available
        if (hasSovereignNodes()) {
          return await callSovereignNode(method, params)
        }

        // Fallback to provider if no sovereign nodes
        if (!provider) {
          throw new Error('No provider or sovereign nodes available')
        }

        return await provider.send(method, params)
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        setError(error)
        throw error
      } finally {
        setIsLoading(false)
      }
    },
    [provider]
  )

  const getStatus = useCallback(() => {
    return {
      hasNodes: hasSovereignNodes(),
      nodes: getSovereignNodeStatus(),
    }
  }, [])

  return {
    executeRpc,
    getStatus,
    isLoading,
    error,
    hasSovereignNodes: hasSovereignNodes(),
  }
}

