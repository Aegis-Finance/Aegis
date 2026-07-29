/**
 * @title PoolPriceMonitor
 * @notice Component for monitoring pool prices, oracle validation, and manipulation alerts
 */

import { useValidatePoolPrice, usePoolStatus, useDynamicFee, useHybridPrice, usePriceManipulationAlerts, useFlashLoanDetections, formatDeviation, getDeviationSeverity, formatDynamicFee } from '@/hooks/usePoolPriceValidator'
import { formatBalance } from '@/utils/format'
import { CONTRACT_ADDRESSES } from '@/config/contracts'
import { resolvePoolPriceValidatorAddress } from '@/utils/deploymentManifest'
import { useMemo } from 'react'

interface PoolPriceMonitorProps {
  poolAddress: string
  validatorAddress?: string
  showAlerts?: boolean
  showFlashLoans?: boolean
}

export default function PoolPriceMonitor({
  poolAddress,
  validatorAddress = (resolvePoolPriceValidatorAddress() ?? CONTRACT_ADDRESSES.POOL_PRICE_VALIDATOR) || undefined,
  showAlerts = true,
  showFlashLoans = true,
}: PoolPriceMonitorProps) {
  const { data: priceStatus, isLoading: priceLoading } = useValidatePoolPrice(
    validatorAddress || null,
    poolAddress,
    !!validatorAddress
  )

  const { data: poolStatus } = usePoolStatus(
    validatorAddress || null,
    poolAddress
  )

  const { data: dynamicFee } = useDynamicFee(
    validatorAddress || null,
    poolAddress
  )

  const { data: hybridPrice } = useHybridPrice(
    validatorAddress || null,
    poolAddress
  )

  const { data: alerts } = usePriceManipulationAlerts(
    validatorAddress || null,
    poolAddress
  )

  const { data: flashLoans } = useFlashLoanDetections(
    validatorAddress || null,
    poolAddress
  )

  const deviationSeverity = useMemo(() => {
    if (!priceStatus || !poolStatus) return 'low'
    return getDeviationSeverity(
      priceStatus.deviation,
      poolStatus.config.maxDeviationBps
    )
  }, [priceStatus, poolStatus])

  const severityColors = {
    low: 'text-terminal-accent',
    medium: 'text-yellow-500',
    high: 'text-orange-500',
    critical: 'text-red-500',
  }

  if (!validatorAddress) {
    return (
      <div className="card border-terminal-border/40">
        <p className="text-terminal-text-dim text-sm">
          Price validator not configured
        </p>
      </div>
    )
  }

  if (priceLoading) {
    return (
      <div className="card border-terminal-border/40">
        <p className="text-terminal-text-dim">Loading price validation...</p>
      </div>
    )
  }

  if (!priceStatus) {
    return (
      <div className="card border-terminal-border/40">
        <p className="text-terminal-text-dim">Price validation unavailable</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Price Status Card */}
      <div className={`card border ${
        priceStatus.isValid
          ? 'border-terminal-accent/30 bg-terminal-accent/5'
          : 'border-red-500/30 bg-red-500/5'
      }`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-terminal-text">
            Price Validation
          </h3>
          <div className={`px-3 py-1 rounded-full text-sm font-medium ${
            priceStatus.isValid
              ? 'bg-terminal-accent/20 text-terminal-accent'
              : 'bg-red-500/20 text-red-500'
          }`}>
            {priceStatus.isValid ? '✓ Valid' : '⚠ Invalid'}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-terminal-text-dim">Pool Price:</span>
            <span className="ml-2 font-semibold text-terminal-text">
              {formatBalance(priceStatus.poolPrice, 18)}
            </span>
          </div>
          <div>
            <span className="text-terminal-text-dim">Oracle Price:</span>
            <span className="ml-2 font-semibold text-terminal-text">
              {formatBalance(priceStatus.oraclePrice, 18)}
            </span>
          </div>
          <div>
            <span className="text-terminal-text-dim">TWAP Price:</span>
            <span className="ml-2 font-semibold text-terminal-text">
              {formatBalance(priceStatus.twapPrice, 18)}
            </span>
          </div>
          {hybridPrice && (
            <div>
              <span className="text-terminal-text-dim">Hybrid Price:</span>
              <span className="ml-2 font-semibold text-terminal-accent">
                {formatBalance(hybridPrice.hybridPrice, 18)}
              </span>
            </div>
          )}
          <div className="col-span-2">
            <span className="text-terminal-text-dim">Deviation:</span>
            <span className={`ml-2 font-semibold ${severityColors[deviationSeverity]}`}>
              {formatDeviation(priceStatus.deviation)}
            </span>
            {poolStatus && (
              <span className="ml-2 text-terminal-text-dim text-xs">
                (max: {formatDeviation(poolStatus.config.maxDeviationBps)})
              </span>
            )}
          </div>
          {dynamicFee != null && (
            <div>
              <span className="text-terminal-text-dim">Dynamic Fee:</span>
              <span className="ml-2 font-semibold text-terminal-text">
                {formatDynamicFee(dynamicFee)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Flash Loan Detections */}
      {showFlashLoans && flashLoans && flashLoans.length > 0 && (
        <div className="card border-red-500/30 bg-red-500/5">
          <h3 className="text-lg font-semibold text-red-500 mb-3">
            Flash Loan Detections ({flashLoans.length})
          </h3>
          <div className="space-y-2">
            {flashLoans.slice(0, 5).map((detection, index) => (
              <div
                key={index}
                className="p-3 bg-terminal-surface rounded border border-red-500/20"
              >
                <div className="text-sm">
                  <div className="flex justify-between mb-1">
                    <span className="text-terminal-text-dim">Block:</span>
                    <span className="text-terminal-text">{detection.blockNumber}</span>
                  </div>
                  <div className="flex justify-between mb-1">
                    <span className="text-terminal-text-dim">Reserve Change:</span>
                    <span className="text-red-500 font-semibold">
                      {formatDeviation(detection.reserveChangeBps)}
                    </span>
                  </div>
                  <div className="text-xs text-terminal-text-dim mt-2 break-all">
                    TX: {detection.transactionHash}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Price Manipulation Alerts */}
      {showAlerts && alerts && alerts.length > 0 && (
        <div className="card border-orange-500/30 bg-orange-500/5">
          <h3 className="text-lg font-semibold text-orange-500 mb-3">
            Manipulation Alerts ({alerts.length})
          </h3>
          <div className="space-y-2">
            {alerts.slice(0, 5).map((alert, index) => (
              <div
                key={index}
                className="p-3 bg-terminal-surface rounded border border-orange-500/20"
              >
                <div className="text-sm">
                  <div className="flex justify-between mb-1">
                    <span className="text-terminal-text-dim">Reason:</span>
                    <span className="text-orange-500 font-semibold">{alert.reason}</span>
                  </div>
                  <div className="flex justify-between mb-1">
                    <span className="text-terminal-text-dim">Deviation:</span>
                    <span className="text-orange-500">
                      {formatDeviation(alert.deviation)}
                    </span>
                  </div>
                  <div className="text-xs text-terminal-text-dim mt-2 break-all">
                    Block: {alert.blockNumber} | TX: {alert.transactionHash}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

