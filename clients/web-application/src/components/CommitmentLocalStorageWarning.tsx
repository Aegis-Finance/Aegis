import {
  hasCommitmentRelatedLocalStorage,
  isCommitmentVaultEnabled,
  isCommitmentVaultUnlocked,
} from '@/utils/commitmentStorage'

type Props = {
  walletAddress: string | null | undefined
  /** 'wallet' shows stronger copy when records already exist */
  variant?: 'wallet' | 'lending'
}

/**
 * Prominent notice: commitment UX data and optional encrypted-at-rest vault (Phase D+).
 */
export default function CommitmentLocalStorageWarning({ walletAddress, variant = 'wallet' }: Props) {
  if (!walletAddress) return null
  const has = hasCommitmentRelatedLocalStorage(walletAddress)
  const vaultOn = isCommitmentVaultEnabled(walletAddress)
  const vaultOpen = isCommitmentVaultUnlocked(walletAddress)

  let border = 'border-terminal-border/60 bg-terminal-bg'
  if (vaultOn && !vaultOpen) border = 'border-amber-500/50 bg-amber-500/10'
  else if (variant === 'wallet' && has) border = 'border-amber-500/50 bg-amber-500/10'

  return (
    <div
      className={`rounded-lg border px-3 py-2.5 text-xs leading-relaxed text-terminal-text-dim ${border}`}
      role="status"
    >
      <p>
        <strong className="text-terminal-text">Device storage:</strong> this app stores ZK UX rows (commitments,
        loans, staking, etc.) in <code className="text-terminal-accent">localStorage</code>.{' '}
        {!vaultOn ? (
          <>
            By default that is <strong className="text-terminal-text">plaintext JSON</strong> — not encrypted. Same-origin
            scripts, extensions, or anyone with access to this profile can read it.
          </>
        ) : vaultOpen ? (
          <>
            You enabled the <strong className="text-terminal-text">encrypted device cache</strong>: blobs are wrapped with
            AES-GCM while locked; decrypted only in memory while unlocked.{' '}
            <strong className="text-terminal-text">EVM stealth limit:</strong> active XSS in this origin can still read
            decrypted data from the running page.
          </>
        ) : (
          <>
            <strong className="text-terminal-text">Encrypted cache is locked</strong> — unlock on Wallet to load rows;
            new writes are skipped until unlock (avoid parsing txs while locked).
          </>
        )}
        {variant === 'wallet' && has && !(vaultOn && !vaultOpen) ? (
          <span className="text-amber-700"> Records exist for this wallet in this browser.</span>
        ) : null}
      </p>
    </div>
  )
}
