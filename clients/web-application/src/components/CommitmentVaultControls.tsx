import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  disableEncryptedCommitmentCache,
  enableEncryptedCommitmentCache,
  isCommitmentVaultEnabled,
  isCommitmentVaultUnlocked,
  lockCommitmentVault,
  unlockCommitmentVault,
} from '@/utils/commitmentStorage'

type Props = {
  walletAddress: string | null | undefined
}

function invalidateCommitmentQueries(queryClient: ReturnType<typeof useQueryClient>, address: string) {
  void queryClient.invalidateQueries({ queryKey: ['wallet-commitments', address] })
  void queryClient.invalidateQueries({ queryKey: ['lending'] })
}

/**
 * Optional passphrase-wrapped local UX cache (AES-GCM at rest). Honest DAO default-off control on Wallet.
 */
export default function CommitmentVaultControls({ walletAddress }: Props) {
  const queryClient = useQueryClient()
  const [pass1, setPass1] = useState('')
  const [pass2, setPass2] = useState('')
  const [busy, setBusy] = useState(false)

  if (!walletAddress) return null

  const vaultOn = isCommitmentVaultEnabled(walletAddress)
  const unlocked = isCommitmentVaultUnlocked(walletAddress)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
      invalidateCommitmentQueries(queryClient, walletAddress)
      toast.success('Device cache updated.')
      setPass1('')
      setPass2('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Vault operation failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-terminal-border/70 bg-terminal-bg px-3 py-3 text-xs leading-relaxed text-terminal-text-dim space-y-2">
      <p className="text-terminal-text font-semibold text-sm">Device cache vault (optional)</p>
      <p>
        On an <strong className="text-terminal-text">EVM</strong> chain, explorers and indexers still see what you
        submit. This control only wraps the dApp&apos;s <code className="text-terminal-accent">localStorage</code> UX
        rows (commitments, loans, staking, unstake) with <strong className="text-terminal-text">AES-256-GCM</strong> so
        a copied browser profile is harder to read offline. It does <strong className="text-terminal-text">not</strong>{' '}
        stop same-origin JavaScript from reading memory while this tab is open.
      </p>
      <p className="text-[11px] opacity-90">
        Status:{' '}
        {!vaultOn ? (
          <span>plaintext default</span>
        ) : unlocked ? (
          <span className="text-emerald-200/95">encrypted at rest — unlocked this session</span>
        ) : (
          <span className="text-amber-700">encrypted at rest — locked (unlock to view / save)</span>
        )}
      </p>
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-end sm:flex-wrap">
        <label className="flex flex-col gap-0.5 min-w-[10rem] flex-1">
          <span className="text-[10px] uppercase tracking-wide opacity-80">Passphrase</span>
          <input
            type="password"
            autoComplete="new-password"
            value={pass1}
            onChange={(e) => setPass1(e.target.value)}
            className="rounded border border-terminal-border bg-terminal-muted/70 px-2 py-1 text-terminal-text text-xs"
            placeholder={vaultOn ? 'Unlock passphrase' : 'Choose passphrase (10+ chars)'}
          />
        </label>
        {!vaultOn ? (
          <label className="flex flex-col gap-0.5 min-w-[10rem] flex-1">
            <span className="text-[10px] uppercase tracking-wide opacity-80">Confirm</span>
            <input
              type="password"
              autoComplete="new-password"
              value={pass2}
              onChange={(e) => setPass2(e.target.value)}
              className="rounded border border-terminal-border bg-terminal-muted/70 px-2 py-1 text-terminal-text text-xs"
              placeholder="Repeat passphrase"
            />
          </label>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        {!vaultOn ? (
          <button
            type="button"
            disabled={busy || pass1.length < 10 || pass1 !== pass2}
            className="rounded border border-terminal-accent/50 bg-terminal-accent/15 px-3 py-1.5 text-xs text-terminal-accent hover:bg-terminal-accent/25 disabled:opacity-40"
            onClick={() =>
              void run(async () => {
                if (pass1 !== pass2) throw new Error('Passphrases do not match.')
                await enableEncryptedCommitmentCache(walletAddress, pass1)
              })
            }
          >
            Enable encrypted cache
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={busy || pass1.length < 10}
              className="rounded border border-terminal-accent/50 bg-terminal-accent/15 px-3 py-1.5 text-xs text-terminal-accent hover:bg-terminal-accent/25 disabled:opacity-40"
              onClick={() => void run(async () => await unlockCommitmentVault(walletAddress, pass1))}
            >
              Unlock
            </button>
            <button
              type="button"
              disabled={busy || !unlocked}
              className="rounded border border-terminal-border px-3 py-1.5 text-xs hover:bg-white/5 disabled:opacity-40"
              onClick={() => {
                lockCommitmentVault(walletAddress)
                invalidateCommitmentQueries(queryClient, walletAddress)
                toast.success('Locked — passphrase cleared from memory.')
              }}
            >
              Lock (clear memory)
            </button>
            <button
              type="button"
              disabled={busy || pass1.length < 10}
              className="rounded border border-rose-500/40 px-3 py-1.5 text-xs text-rose-200/95 hover:bg-rose-500/10 disabled:opacity-40"
              onClick={() => {
                if (!window.confirm('Remove encryption and store plaintext JSON again?')) return
                void run(async () => await disableEncryptedCommitmentCache(walletAddress, pass1))
              }}
            >
              Remove encryption
            </button>
          </>
        )}
      </div>
      <p className="text-[10px] opacity-75">
        DAO reminder: losing the passphrase loses access to encrypted rows. Back up critical note openings out of band
        if you rely on them.
      </p>
    </div>
  )
}
