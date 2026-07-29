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
} from '../utils/commitmentStorage'

type Props = {
  walletAddress: string | null | undefined
}

export default function AuctionCommitmentVaultControls({ walletAddress }: Props) {
  const queryClient = useQueryClient()
  const [pass1, setPass1] = useState('')
  const [pass2, setPass2] = useState('')
  const [busy, setBusy] = useState(false)

  if (!walletAddress) return null

  const vaultOn = isCommitmentVaultEnabled(walletAddress)
  const unlocked = isCommitmentVaultUnlocked(walletAddress)

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['claim-info', walletAddress] })
    void queryClient.invalidateQueries({ queryKey: ['user-info', walletAddress] })
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
      invalidate()
      toast.success('Auction cache updated.')
      setPass1('')
      setPass2('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Vault operation failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        maxWidth: 'var(--max-width)',
        margin: '0 auto',
        padding: '0 var(--container-padding) 12px',
        fontSize: '0.75rem',
        lineHeight: 1.5,
        color: 'var(--color-text-secondary)',
      }}
    >
      <div
        style={{
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
          padding: '12px',
          background: 'var(--color-surface)',
        }}
      >
        <p style={{ margin: 0, color: 'var(--color-text)', fontWeight: 600 }}>Encrypted auction cache (optional)</p>
        <p style={{ margin: '8px 0 0' }}>
          Wraps <code style={{ fontSize: '0.85em' }}>aegis_auction_commitments_*</code> with AES-GCM at rest (same crypto
          story as the main Aegis dApp). Does not hide on-chain txs. Unlock before claiming if you rely on stored ZK
          purchase rows.
        </p>
        <p style={{ margin: '6px 0 0', fontSize: '0.7rem', opacity: 0.9 }}>
          {!vaultOn ? (
            <span>Status: plaintext default</span>
          ) : unlocked ? (
            <span style={{ color: 'var(--color-accent, #22c55e)' }}>Encrypted — unlocked this session</span>
          ) : (
            <span style={{ color: 'var(--color-warning, #f59e0b)' }}>Encrypted — locked (unlock to load rows)</span>
          )}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '10rem', flex: '1 1 8rem' }}>
            <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', opacity: 0.8 }}>Passphrase</span>
            <input
              type="password"
              autoComplete="new-password"
              value={pass1}
              onChange={(e) => setPass1(e.target.value)}
              style={{
                padding: '6px 8px',
                borderRadius: '6px',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
                fontSize: '0.8rem',
              }}
              placeholder={vaultOn ? 'Unlock passphrase' : '10+ characters'}
            />
          </label>
          {!vaultOn ? (
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '10rem', flex: '1 1 8rem' }}>
              <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', opacity: 0.8 }}>Confirm</span>
              <input
                type="password"
                autoComplete="new-password"
                value={pass2}
                onChange={(e) => setPass2(e.target.value)}
                style={{
                  padding: '6px 8px',
                  borderRadius: '6px',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg)',
                  color: 'var(--color-text)',
                  fontSize: '0.8rem',
                }}
                placeholder="Repeat"
              />
            </label>
          ) : null}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' }}>
          {!vaultOn ? (
            <button
              type="button"
              disabled={busy || pass1.length < 10 || pass1 !== pass2}
              className="primary"
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
                className="primary"
                onClick={() => void run(async () => await unlockCommitmentVault(walletAddress, pass1))}
              >
                Unlock
              </button>
              <button
                type="button"
                disabled={busy || !unlocked}
                className="ghost"
                onClick={() => {
                  lockCommitmentVault(walletAddress)
                  invalidate()
                  toast.success('Locked — key cleared from memory.')
                }}
              >
                Lock
              </button>
              <button
                type="button"
                disabled={busy || pass1.length < 10}
                className="ghost"
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
      </div>
    </div>
  )
}
