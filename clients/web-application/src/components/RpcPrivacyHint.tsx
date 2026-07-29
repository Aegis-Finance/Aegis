import { Link } from 'react-router-dom'
import { useWalletStore } from '@/store/walletStore'

/**
 * True when the read RPC hostname looks like a public Sonic Labs endpoint (metadata / IP exposure to a third party).
 * Localhost and `VITE_DAO_RPC_URL` hostname are treated as lower-risk for this narrow banner.
 */
export function isPublicSonicLabsReadRpc(url: string): boolean {
  try {
    const h = new URL(url.trim()).hostname.toLowerCase()
    if (h === '127.0.0.1' || h === 'localhost') return false
    const daoRaw = import.meta.env.VITE_DAO_RPC_URL?.trim()
    if (daoRaw) {
      try {
        if (new URL(daoRaw).hostname.toLowerCase() === h) return false
      } catch {
        /* ignore */
      }
    }
    return h.endsWith('soniclabs.com')
  } catch {
    return false
  }
}

type RpcPrivacyHintProps = {
  /** Extra context shown in the banner */
  context?: string
  className?: string
}

/**
 * Phase-A style reminder: sensitive flows still leave traces at the RPC layer when using public endpoints.
 */
export default function RpcPrivacyHint({ context, className = '' }: RpcPrivacyHintProps) {
  const { rpcUrl } = useWalletStore()
  if (!isPublicSonicLabsReadRpc(rpcUrl)) return null

  return (
    <div
      className={`rounded-lg border border-terminal-warning/40 bg-terminal-warning/10 px-4 py-3 text-sm text-terminal-text ${className}`}
      role="status"
    >
      <p className="font-medium text-terminal-warning">Read RPC is a public Sonic endpoint</p>
      <p className="mt-1 text-terminal-text-dim leading-relaxed">
        Your wallet address and read patterns are visible to that RPC operator. For stronger hygiene use a{' '}
        <strong className="text-terminal-text">private or self-hosted RPC</strong> and pick it in the header RPC
        selector. {context}
      </p>
      <p className="mt-2 text-xs text-terminal-text-dim">
        <Link to="/governance" className="text-terminal-accent underline-offset-2 hover:underline">
          Governance
        </Link>{' '}
        sets RPC and privacy policy over time.
      </p>
    </div>
  )
}
