import { useEffect, useState } from 'react'
import { isOperationalProfile, isPrivateReadRpc } from '@/utils/operationalProfile'
import { Link } from 'react-router-dom'
import { useWalletStore } from '@/store/walletStore'
import { isPublicSonicLabsReadRpc } from './RpcPrivacyHint'

const DISMISS_KEY = 'aegis_compact_rpc_privacy_dismissed_v1'

/**
 * One-line reminder when the read RPC is a public Sonic Labs host (not DAO/local).
 * Dismissible per browser (sessionStorage).
 */
export default function CompactRpcPrivacyBar() {
  const { rpcUrl } = useWalletStore()
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1')
    } catch {
      setDismissed(false)
    }
  }, [rpcUrl])

  if (!isOperationalProfile() && dismissed) return null
  if (isOperationalProfile()) {
    if (isPrivateReadRpc(rpcUrl)) return null
    return (
      <div
        className="border-b border-terminal-error/40 bg-terminal-error/10 px-4 py-2 text-center text-xs text-terminal-text md:text-sm"
        role="alert"
      >
        <span className="font-medium text-terminal-error">Operational profile — non-local RPC</span>
        <span className="text-terminal-text-dim">
          {' '}
          — public or untrusted hosts are blocked at build time; switch to{' '}
          <strong className="text-terminal-text">127.0.0.1:8547</strong> (Aegis app) in the header RPC
          selector.
        </span>
      </div>
    )
  }

  if (dismissed || !isPublicSonicLabsReadRpc(rpcUrl)) return null

  return (
    <div
      className="border-b border-terminal-warning/35 bg-terminal-warning/10 px-4 py-2 text-center text-xs text-terminal-text md:text-sm"
      role="status"
    >
      <span className="text-terminal-warning font-medium">Public read RPC</span>
      <span className="text-terminal-text-dim"> — this host can correlate your wallet with read traffic. Prefer </span>
      <strong className="text-terminal-text">DAO RPC</strong>
      <span className="text-terminal-text-dim"> or a </span>
      <strong className="text-terminal-text">local node</strong>
      <span className="text-terminal-text-dim"> (header selector). </span>
      <Link to="/governance" className="text-terminal-accent underline-offset-2 hover:underline">
        Governance
      </Link>
      <span className="text-terminal-text-dim"> · </span>
      <span className="text-terminal-text-dim">
        See <code className="text-terminal-accent">docs/PRIVACY_DEFAULTS_AND_FINGERPRINTING.md</code> in the repo.
      </span>
      <button
        type="button"
        className="ml-3 rounded border border-terminal-border/60 px-2 py-0.5 text-[11px] uppercase tracking-wide text-terminal-text-dim hover:bg-terminal-muted/30"
        onClick={() => {
          try {
            sessionStorage.setItem(DISMISS_KEY, '1')
          } catch {
            /* ignore */
          }
          setDismissed(true)
        }}
      >
        Dismiss
      </button>
    </div>
  )
}
