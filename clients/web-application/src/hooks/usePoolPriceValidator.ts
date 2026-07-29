/**
 * @title usePoolPriceValidator
 * @notice React hooks for PoolPriceValidator integration
 * @dev Provides hooks for validating pool prices, detecting flash loans, and monitoring manipulation
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useWalletStore } from '@/store/walletStore'
import { ethers, type EventLog } from 'ethers'
import toast from 'react-hot-toast'

/**
 * PoolPriceValidator ABI (minimal for frontend)
 */
const VALIDATOR_ABI = [
  'function validatePoolPrice(address pool) external returns (bool isValid, uint256 poolPrice, uint256 oraclePrice, uint256 twapPrice, uint256 deviation)',
  'function getPoolStatus(address pool) external view returns (tuple config, tuple price, tuple flashLoan, uint256 observationCount)',
  'function calculateDynamicFee(address pool) external view returns (uint256 feeBps)',
  'function getHybridPrice(address pool) external view returns (uint256 hybridPrice, uint256 poolPrice, uint256 oraclePrice)',
  'event PriceValidated(address indexed pool, uint256 poolPrice, uint256 oraclePrice, uint256 twapPrice, uint256 deviation, bool isValid)',
  'event FlashLoanDetected(address indexed pool, uint256 reserveChangeBps, uint256 previousReserveAGS, uint256 previousReserveQuote, uint256 currentReserveAGS, uint256 currentReserveQuote)',
  'event PriceManipulationAlert(address indexed pool, uint256 deviation, uint256 poolPrice, uint256 oraclePrice, uint256 twapPrice, string reason)',
] as const

export type PoolPriceStatus = {
  isValid: boolean
  poolPrice: bigint
  oraclePrice: bigint
  twapPrice: bigint
  deviation: bigint
  flashLoanDetected: boolean
  timestamp: number
}

export type PoolConfig = {
  poolAddress: string
  quoteOracles: string[]
  agsOracles: string[]
  enabled: boolean
  maxDeviationBps: bigint
  twapWindow: number
  observationCardinality: number
  flashLoanProtectionEnabled: boolean
}

export type PoolStatus = {
  config: PoolConfig
  price: PoolPriceStatus
  flashLoan: {
    previousReserveAGS: bigint
    previousReserveQuote: bigint
    lastBlockChecked: number
    alertRaised: boolean
  }
  observationCount: bigint
}

/**
 * Hook to validate pool price
 * @param validatorAddress PoolPriceValidator contract address
 * @param poolAddress Pool address to validate
 * @param enabled Whether to auto-validate (default: true)
 */
export function useValidatePoolPrice(
  validatorAddress: string | null,
  poolAddress: string | null,
  enabled = true
) {
  const { provider } = useWalletStore()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['poolPriceValidation', validatorAddress, poolAddress],
    queryFn: async (): Promise<PoolPriceStatus | null> => {
      if (!validatorAddress || !poolAddress || !provider) return null

      const validator = new ethers.Contract(
        validatorAddress,
        VALIDATOR_ABI,
        provider
      )

      try {
        const [isValid, poolPrice, oraclePrice, twapPrice, deviation] =
          await validator.validatePoolPrice(poolAddress)

        return {
          isValid,
          poolPrice,
          oraclePrice,
          twapPrice,
          deviation,
          flashLoanDetected: false, // Would need enhanced contract to get this
          timestamp: Date.now(),
        }
      } catch (error) {
        console.error('Price validation failed:', error)
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        toast.error(`Price validation error: ${errorMessage}`, {
          duration: 5000,
        })
        throw error
      }
    },
    enabled: enabled && !!validatorAddress && !!poolAddress && !!provider,
    refetchInterval: 30000, // Refetch every 30 seconds
    staleTime: 10000, // Consider stale after 10 seconds
  })

  // Handle side effects when data changes
  useEffect(() => {
    if (query.data && !query.data.isValid) {
      // Show warning toast if price is invalid
      toast.error(`Price validation failed for pool ${poolAddress?.slice(0, 8)}...`, {
        duration: 5000,
      })
    }
    if (query.data) {
      // Invalidate related queries when validation succeeds
      queryClient.invalidateQueries({ queryKey: ['poolStatus', validatorAddress, poolAddress] })
    }
  }, [query.data, poolAddress, validatorAddress, queryClient])

  return query
}

/**
 * Hook to get full pool status
 * @param validatorAddress PoolPriceValidator contract address
 * @param poolAddress Pool address
 */
export function usePoolStatus(
  validatorAddress: string | null,
  poolAddress: string | null
) {
  const { provider } = useWalletStore()

  return useQuery({
    queryKey: ['poolStatus', validatorAddress, poolAddress],
    queryFn: async (): Promise<PoolStatus | null> => {
      if (!validatorAddress || !poolAddress || !provider) return null

      const validator = new ethers.Contract(
        validatorAddress,
        VALIDATOR_ABI,
        provider
      )

      try {
        const [config, price, flashLoan, observationCount] =
          await validator.getPoolStatus(poolAddress)

        const poolAddr = config?.poolAddress ?? config?.[0]
        if (!poolAddr || String(poolAddr).toLowerCase() === '0x0000000000000000000000000000000000000000') {
          return null
        }

        return {
          config,
          price,
          flashLoan,
          observationCount,
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        if (/not configured|Pool zero/i.test(msg)) return null
        console.error('Failed to get pool status:', error)
        return null
      }
    },
    enabled: !!validatorAddress && !!poolAddress && !!provider,
    refetchInterval: 30000,
  })
}

/**
 * Hook to calculate dynamic fee
 * @param validatorAddress PoolPriceValidator contract address
 * @param poolAddress Pool address
 */
export function useDynamicFee(
  validatorAddress: string | null,
  poolAddress: string | null
) {
  const { provider } = useWalletStore()

  return useQuery({
    queryKey: ['dynamicFee', validatorAddress, poolAddress],
    queryFn: async (): Promise<bigint | null> => {
      if (!validatorAddress || !poolAddress || !provider) return null

      const validator = new ethers.Contract(
        validatorAddress,
        VALIDATOR_ABI,
        provider
      )

      try {
        const feeBps = await validator.calculateDynamicFee(poolAddress)
        return feeBps
      } catch (error) {
        console.error('Failed to calculate dynamic fee:', error)
        return null
      }
    },
    enabled: !!validatorAddress && !!poolAddress && !!provider,
    refetchInterval: 60000, // Refetch every minute
  })
}

/**
 * Hook to get hybrid price
 * @param validatorAddress PoolPriceValidator contract address
 * @param poolAddress Pool address
 */
export function useHybridPrice(
  validatorAddress: string | null,
  poolAddress: string | null
) {
  const { provider } = useWalletStore()

  return useQuery({
    queryKey: ['hybridPrice', validatorAddress, poolAddress],
    queryFn: async () => {
      if (!validatorAddress || !poolAddress || !provider) return null

      const validator = new ethers.Contract(
        validatorAddress,
        VALIDATOR_ABI,
        provider
      )

      try {
        const [hybridPrice, poolPrice, oraclePrice] =
          await validator.getHybridPrice(poolAddress)

        return {
          hybridPrice,
          poolPrice,
          oraclePrice,
        }
      } catch (error) {
        console.error('Failed to get hybrid price:', error)
        throw error
      }
    },
    enabled: !!validatorAddress && !!poolAddress && !!provider,
    refetchInterval: 30000,
  })
}

/**
 * Hook to monitor price manipulation alerts
 * @param validatorAddress PoolPriceValidator contract address
 * @param poolAddress Pool address (optional, if null monitors all pools)
 */
export function usePriceManipulationAlerts(
  validatorAddress: string | null,
  poolAddress: string | null = null
) {
  const { provider } = useWalletStore()

  return useQuery({
    queryKey: ['priceManipulationAlerts', validatorAddress, poolAddress],
    queryFn: async () => {
      if (!validatorAddress || !provider) return []

      const validator = new ethers.Contract(
        validatorAddress,
        VALIDATOR_ABI,
        provider
      )

      // Listen for PriceManipulationAlert events
      const filter = poolAddress
        ? validator.filters.PriceManipulationAlert(poolAddress)
        : validator.filters.PriceManipulationAlert()

      // Get recent events (last 1000 blocks)
      const currentBlock = await provider.getBlockNumber()
      const events = await validator.queryFilter(
        filter,
        currentBlock - 1000,
        currentBlock
      )

      const alerts = events.map((event) => {
        const eventLog = event as EventLog
        return {
          pool: eventLog.args.pool,
          deviation: eventLog.args.deviation,
          poolPrice: eventLog.args.poolPrice,
          oraclePrice: eventLog.args.oraclePrice,
          twapPrice: eventLog.args.twapPrice,
          reason: eventLog.args.reason,
          blockNumber: eventLog.blockNumber,
          transactionHash: eventLog.transactionHash,
        }
      })

      // Show toast for new alerts
      if (alerts.length > 0) {
        const latestAlert = alerts[alerts.length - 1]
        toast.error(
          `Price manipulation detected: ${latestAlert.reason}`,
          {
            duration: 8000,
          }
        )
      }

      return alerts
    },
    enabled: !!validatorAddress && !!provider,
    refetchInterval: 15000, // Refetch every 15 seconds
  })
}

/**
 * Hook to monitor flash loan detections
 * @param validatorAddress PoolPriceValidator contract address
 * @param poolAddress Pool address (optional)
 */
export function useFlashLoanDetections(
  validatorAddress: string | null,
  poolAddress: string | null = null
) {
  const { provider } = useWalletStore()

  return useQuery({
    queryKey: ['flashLoanDetections', validatorAddress, poolAddress],
    queryFn: async () => {
      if (!validatorAddress || !provider) return []

      const validator = new ethers.Contract(
        validatorAddress,
        VALIDATOR_ABI,
        provider
      )

      const filter = poolAddress
        ? validator.filters.FlashLoanDetected(poolAddress)
        : validator.filters.FlashLoanDetected()

      const currentBlock = await provider.getBlockNumber()
      const events = await validator.queryFilter(
        filter,
        currentBlock - 1000,
        currentBlock
      )

      const detections = events.map((event) => {
        const eventLog = event as EventLog
        return {
          pool: eventLog.args.pool,
          reserveChangeBps: eventLog.args.reserveChangeBps,
          previousReserveAGS: eventLog.args.previousReserveAGS,
          previousReserveQuote: eventLog.args.previousReserveQuote,
          currentReserveAGS: eventLog.args.currentReserveAGS,
          currentReserveQuote: eventLog.args.currentReserveQuote,
          blockNumber: eventLog.blockNumber,
          transactionHash: eventLog.transactionHash,
        }
      })

      // Show toast for new flash loan detections
      if (detections.length > 0) {
        const latestDetection = detections[detections.length - 1]
        toast(
          `Flash loan detected: ${Number(latestDetection.reserveChangeBps) / 100}% reserve change`,
          {
            duration: 8000,
            icon: '⚠️',
            style: {
              background: '#f59e0b',
              color: '#fff',
            },
          }
        )
      }

      return detections
    },
    enabled: !!validatorAddress && !!provider,
    refetchInterval: 10000, // Refetch every 10 seconds
  })
}

/**
 * Utility function to format deviation percentage
 */
export function formatDeviation(deviationBps: bigint): string {
  const percentage = Number(deviationBps) / 100
  return `${percentage.toFixed(2)}%`
}

/**
 * Utility function to get deviation severity color
 */
export function getDeviationSeverity(deviationBps: bigint, maxBps: bigint): 'low' | 'medium' | 'high' | 'critical' {
  const percentage = Number(deviationBps) / Number(maxBps)
  if (percentage >= 1.0) return 'critical'
  if (percentage >= 0.75) return 'high'
  if (percentage >= 0.5) return 'medium'
  return 'low'
}

/**
 * Utility function to format dynamic fee
 */
export function formatDynamicFee(feeBps: bigint): string {
  const percentage = Number(feeBps) / 100
  return `${percentage.toFixed(2)}%`
}

