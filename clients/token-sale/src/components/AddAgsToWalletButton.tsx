import { useState } from 'react'
import { useWalletStore } from '../store/walletStore'
import { addAgsToWalletWithToast } from '../utils/addAgsToWallet'

type Props = {
  className?: string
  /** Shorter label for tight headers */
  compact?: boolean
}

/**
 * One-click "add AGS to wallet" (EIP-747). Works with any injected wallet we support at connect time.
 */
export default function AddAgsToWalletButton({ className = '', compact = false }: Props) {
  const eip1193 = useWalletStore((s) => s.eip1193)
  const [busy, setBusy] = useState(false)

  const label = compact ? '+ AGS' : 'Add AGS to wallet'

  return (
    <button
      type="button"
      className={`ghost add-ags-wallet-btn ${className}`.trim()}
      disabled={busy}
      title="Add Aegis token (AGS) to your wallet — no need to paste the contract address"
      onClick={() => {
        setBusy(true)
        void addAgsToWalletWithToast(eip1193).finally(() => setBusy(false))
      }}
    >
      {busy ? 'Adding…' : label}
    </button>
  )
}
