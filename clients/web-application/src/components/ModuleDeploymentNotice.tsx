import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { isContractConfigured } from '@/utils/productReadiness'

type Props = {
  moduleName: string
  contractAddress: string | undefined | null
  /** Optional hint when contract is missing (e.g. env key name). */
  envHint?: string
  className?: string
}

/** Blocks misleading UX when a module's contract is not wired in this build. */
export default function ModuleDeploymentNotice({
  moduleName,
  contractAddress,
  envHint,
  className = '',
}: Props) {
  if (isContractConfigured(contractAddress)) return null

  return (
    <div
      className={`rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-terminal-text-dim ${className}`}
      role="alert"
    >
      <p>
        <strong className="text-terminal-text">{moduleName}</strong> is not wired on this deployment
        {envHint ? (
          <>
            {' '}
            (<code className="text-xs">{envHint}</code> unset or zero)
          </>
        ) : null}
        . On-chain actions are disabled until the address is set in your build env.
      </p>
      <p className="mt-2 text-xs">
        Check{' '}
        <code className="text-terminal-accent">public/config/verifier-artifact-manifest.json</code> and run{' '}
        <code className="text-terminal-accent">npm run gen:frontend-env</code> from the repo root, then rebuild.
      </p>
    </div>
  )
}

/** Disables interactive children when the module contract is not configured. */
export function ModuleConfiguredSection({
  contractAddress,
  children,
  className = '',
}: {
  contractAddress: string | undefined | null
  children: ReactNode
  className?: string
}) {
  const live = isContractConfigured(contractAddress)
  return (
    <div
      className={className}
      aria-disabled={!live}
      style={live ? undefined : { opacity: 0.55, pointerEvents: 'none' as const }}
    >
      {children}
    </div>
  )
}

type OptionalLinkProps = Props & {
  docsPath?: string
}

export function ModuleOptionalNotice({ moduleName, contractAddress, docsPath, className = '' }: OptionalLinkProps) {
  if (isContractConfigured(contractAddress)) return null

  return (
    <div
      className={`rounded-lg border border-terminal-border/60 bg-terminal-bg px-4 py-3 text-sm text-terminal-text-dim ${className}`}
      role="note"
    >
      <p>
        <strong className="text-terminal-text">{moduleName}</strong> is optional and not configured for this build.
        {docsPath ? (
          <>
            {' '}
            <Link to={docsPath} className="text-terminal-accent underline">
              Learn more
            </Link>
          </>
        ) : null}
      </p>
    </div>
  )
}
