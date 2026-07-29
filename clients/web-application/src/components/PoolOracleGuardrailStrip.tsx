import { useMemo } from 'react'

import { resolvePoolPriceValidatorAddress } from '@/utils/deploymentManifest'
import { usePoolValidatorRegistration } from '@/hooks/usePoolValidatorRegistration'
import { usePoolStatus, formatDeviation, getDeviationSeverity } from '@/hooks/usePoolPriceValidator'
import { SONIC_GATEWAY_DOCS, explorerAddressUrl } from '@/config/sonicInfra'

type Props = {
  poolAddress?: string | null
  className?: string
}

/**
 * Compact pool vs oracle/TWAP readout from `PoolPriceValidatorEnhanced` (view-only `getPoolStatus`).
 */
export default function PoolOracleGuardrailStrip({ poolAddress, className = '' }: Props) {
  const validatorAddress = useMemo(() => resolvePoolPriceValidatorAddress(), [])
  const { data: registered, isLoading: registrationLoading } = usePoolValidatorRegistration(poolAddress)
  const { data: poolStatus, isFetching } = usePoolStatus(
    validatorAddress,
    registered ? poolAddress ?? null : null
  )

  if (!validatorAddress || !poolAddress) return null
  if (registrationLoading || registered === false) return null

  if (isFetching && !poolStatus) {
    return (
      <div className={`rounded-md border border-terminal-border/40 bg-terminal-surface/30 px-3 py-2 text-xs text-terminal-text-dim ${className}`}>
        Checking pool vs oracle…
      </div>
    )
  }

  if (!poolStatus) return null

  const price = poolStatus.price as {
    isValid?: boolean
    deviation?: bigint
    poolPrice?: bigint
    oraclePrice?: bigint
    twapPrice?: bigint
  }
  const config = poolStatus.config as { enabled?: boolean; maxDeviationBps?: bigint }
  const deviation = price.deviation ?? 0n
  const maxBps = config.maxDeviationBps ?? 500n
  const severity = getDeviationSeverity(deviation, maxBps)
  const valid = price.isValid !== false && config.enabled !== false

  const tone =
    severity === 'critical' || severity === 'high'
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-100/90'
      : valid
        ? 'border-terminal-accent/30 bg-terminal-accent/5 text-terminal-text-dim'
        : 'border-terminal-border/40 bg-terminal-surface/30 text-terminal-text-dim'

  return (
    <div className={`rounded-md border px-3 py-2 text-xs space-y-1 ${tone} ${className}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium text-terminal-text">Pool guardrails</span>
        <span>·</span>
        <span>{valid ? 'Within oracle band' : 'Outside oracle band'}</span>
        <span>·</span>
        <span>Deviation {formatDeviation(deviation)}</span>
        {isFetching ? <span className="opacity-70">(updating…)</span> : null}
      </div>
      <details className="text-[11px] opacity-90">
        <summary className="cursor-pointer text-terminal-accent">Oracle &amp; TWAP details</summary>
        <ul className="mt-1.5 space-y-0.5 list-disc pl-4">
          <li>
            Validator:{' '}
            <a
              href={explorerAddressUrl(validatorAddress)}
              target="_blank"
              rel="noreferrer"
              className="text-terminal-accent underline"
            >
              {validatorAddress.slice(0, 10)}…
            </a>
          </li>
          <li>
            Max deviation: {formatDeviation(maxBps)} ·{' '}
            <a href={SONIC_GATEWAY_DOCS.toolingAndInfra} target="_blank" rel="noreferrer" className="underline">
              Sonic oracle providers
            </a>
          </li>
        </ul>
      </details>
    </div>
  )
}
