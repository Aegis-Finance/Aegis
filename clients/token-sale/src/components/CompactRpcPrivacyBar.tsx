import { useEffect, useState } from 'react'
import { ENV } from '../config'
import { isOperationalProfile, isPrivateReadRpc } from '../utils/operationalProfile'
import { isPublicSonicLabsReadRpc } from '../utils/rpcPrivacy'

const DISMISS_KEY = 'aegis_dist_compact_rpc_privacy_dismissed_v1'

export default function CompactRpcPrivacyBar() {
  const [url, setUrl] = useState(ENV.rpcUrl)
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    const onChange = () => setUrl(ENV.rpcUrl)
    window.addEventListener('aegis-rpc-url-changed', onChange)
    return () => window.removeEventListener('aegis-rpc-url-changed', onChange)
  }, [])

  if (!isOperationalProfile() && dismissed) return null

  if (isOperationalProfile()) {
    if (isPrivateReadRpc(url)) return null
    return (
      <div
        role="alert"
        style={{
          textAlign: 'center',
          fontSize: '13px',
          padding: '10px 12px',
          borderBottom: '1px solid rgba(239, 68, 68, 0.35)',
          background: 'rgba(239, 68, 68, 0.08)',
          color: 'var(--color-text)',
        }}
      >
        <strong style={{ color: 'var(--color-error, #ef4444)' }}>Operational profile — non-local RPC</strong>
        <span style={{ color: 'var(--color-text-secondary)' }}>
          {' '}
          — switch to <strong>127.0.0.1:8547</strong> (Aegis app) in RPC settings.
        </span>
      </div>
    )
  }

  if (dismissed || !isPublicSonicLabsReadRpc(url)) return null

  return (
    <div
      role="status"
      style={{
        textAlign: 'center',
        fontSize: '13px',
        padding: '10px 12px',
        borderBottom: '1px solid rgba(234, 179, 8, 0.35)',
        background: 'rgba(234, 179, 8, 0.08)',
        color: 'var(--color-text)',
      }}
    >
      <strong style={{ color: 'var(--color-warning, #eab308)' }}>Public read RPC</strong>
      <span style={{ color: 'var(--color-text-secondary)' }}>
        {' '}
        — this host can correlate your wallet with read traffic. Prefer <strong>DAO / self-hosted</strong> or{' '}
        <strong>localhost</strong> via the RPC button. See{' '}
        <code style={{ fontSize: '0.85em' }}>docs/PRIVACY_DEFAULTS_AND_FINGERPRINTING.md</code>.
      </span>
      <button
        type="button"
        className="ghost"
        style={{ marginLeft: '10px', fontSize: '11px', padding: '4px 8px' }}
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
