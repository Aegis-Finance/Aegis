import { useAgsReferencePrice } from '@/hooks/useAgsReferencePrice'

type Props = {
  className?: string
}

/**
 * Single AGS/S reference line — canonical policy (v3 → Odos → Dutch auction).
 * Does not promote thin bootstrap pool reserves as the headline market price.
 */
export default function PoolSpotStrip({ className = '' }: Props) {
  const { data, isFetching } = useAgsReferencePrice()

  if (!data?.agsPerOneNative || data.agsPerOneNative <= 0) {
    if (!data?.detail) return null
    return (
      <div
        className={`rounded-md border border-terminal-border/40 bg-terminal-surface/30 px-3 py-2 text-xs text-terminal-text-dim ${className}`}
      >
        {data.detail}
      </div>
    )
  }

  const agsFmt = data.agsPerOneNative.toLocaleString(undefined, { maximumFractionDigits: 6 })
  const showBootstrapNote =
    data.source !== 'bootstrap-pool' &&
    data.bootstrapAgsPerNative &&
    data.bootstrapAgsPerNative > 0 &&
    Math.abs(data.bootstrapAgsPerNative - data.agsPerOneNative) / data.agsPerOneNative > 0.05

  return (
    <div
      className={`rounded-md border border-terminal-border/40 bg-terminal-surface/30 px-3 py-2 text-xs space-y-1 ${className}`}
    >
      <div className="text-terminal-text/90">
        <span className="text-terminal-text-muted">{isFetching ? 'Updating… ' : ''}</span>
        <span className="font-medium text-terminal-text">Reference:</span>{' '}
        1 S ≈ {agsFmt} AGS
        <span className="text-terminal-text-muted"> ({data.sourceLabel})</span>
      </div>
      {data.detail ? <p className="text-terminal-text-dim leading-snug">{data.detail}</p> : null}
      {showBootstrapNote ? (
        <p className="text-amber-200/80 leading-snug">
          Bootstrap pool mid-price (execution only): 1 S ≈{' '}
          {data.bootstrapAgsPerNative!.toLocaleString(undefined, { maximumFractionDigits: 2 })} AGS — thin
          liquidity; swaps may use Auto/Odos or the canonical router.
        </p>
      ) : null}
    </div>
  )
}
