import { isZkProvingConfigured } from '@/utils/productReadiness'
import { isCircuitProvingReady } from '@/config/circuitReadiness'

type Props = {
  moduleLabel?: string
  /** When set, notice only shows if this specific circuit is not ready. */
  circuitSlug?: string
  className?: string
}

/** Warn when ZK-only actions cannot run in this browser build. */
export default function ZkProverNotice({ moduleLabel = 'This module', circuitSlug, className = '' }: Props) {
  if (circuitSlug) {
    if (isCircuitProvingReady(circuitSlug)) return null
    return (
      <div
        className={`rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-terminal-text-dim ${className}`}
        role="alert"
      >
        <p>
          <strong className="text-terminal-text">{moduleLabel}</strong> needs a private proof step that is not enabled
          in this app build yet. You can still use Wallet and public tabs; try this again after the operator turns on
          in-browser proving.
        </p>
      </div>
    )
  }

  if (isZkProvingConfigured()) return null

  return (
    <div
      className={`rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-terminal-text-dim ${className}`}
      role="alert"
    >
      <p>
        <strong className="text-terminal-text">{moduleLabel}</strong> needs zero-knowledge proofs, but this build does
        not have proving set up. Private actions here will fail until proving is enabled for this deployment.
      </p>
    </div>
  )
}
