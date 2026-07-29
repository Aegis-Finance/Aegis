export type ZkPrivacyMode = 'legacy' | 'zk'

type Props = {
  mode: ZkPrivacyMode
  onChange: (mode: ZkPrivacyMode) => void
  className?: string
  /** Hide the non-functional legacy path — these modules are ZK-only on-chain. */
  zkOnly?: boolean
}

/** Shared Private (ZK) vs Public (Legacy) toggle — default callers to `zk`. */
export default function ZkModeToggle({ mode, onChange, className = '', zkOnly = false }: Props) {
  if (zkOnly) {
    return (
      <p className={`text-xs text-terminal-text-dim ${className}`}>
        This module settles with <strong className="text-terminal-text">zero-knowledge proofs</strong> on-chain — there
        is no public fallback path.
      </p>
    )
  }

  return (
    <div className={`flex items-center justify-center gap-2 flex-wrap ${className}`}>
      <div className="flex rounded-lg overflow-hidden border border-terminal-border/40">
        <button
          type="button"
          className={`px-4 py-2 text-sm ${mode === 'legacy' ? 'bg-terminal-accent text-black' : 'bg-transparent text-terminal-text'}`}
          onClick={() => onChange('legacy')}
        >
          Public (Legacy)
        </button>
        <button
          type="button"
          className={`px-4 py-2 text-sm ${mode === 'zk' ? 'bg-terminal-accent text-black' : 'bg-transparent text-terminal-text'}`}
          onClick={() => onChange('zk')}
        >
          Private (ZK)
        </button>
      </div>
    </div>
  )
}
