import type { ReactNode } from 'react'

import Logo from './Logo'
import RpcSelector from './RpcSelector'
import CompactRpcPrivacyBar from './CompactRpcPrivacyBar'
import { isCompactTgeUi } from '../config'

export type TgeAppView = 'sale' | 'bridge' | 'privacy'

type Props = {
  children: ReactNode
  appView: TgeAppView
  onViewChange: (view: TgeAppView) => void
  headerActions?: ReactNode
}

const NAV: { id: TgeAppView; label: string }[] = [
  { id: 'sale', label: 'Token sale' },
  { id: 'privacy', label: 'Privacy entry' },
  { id: 'bridge', label: 'Ethereum ⇌ Sonic' },
]

export default function TgeLayout({ children, appView, onViewChange, headerActions }: Props) {
  const compact = isCompactTgeUi()

  return (
    <div className="min-h-screen flex flex-col bg-terminal-bg text-terminal-text">
      {!compact ? <CompactRpcPrivacyBar /> : null}
      <header className="border-b border-terminal-border bg-terminal-surface/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="mx-auto max-w-4xl px-4 py-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Logo size="md" />
          <div className="flex flex-wrap items-center gap-2 justify-end">
            <RpcSelector />
            {headerActions}
          </div>
        </div>
        <nav
          className="mx-auto max-w-4xl px-4 pb-3 flex flex-wrap gap-2"
          aria-label="Token distribution"
        >
          {NAV.map((item) => {
            const active = appView === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onViewChange(item.id)}
                aria-current={active ? 'page' : undefined}
                className={
                  active
                    ? 'btn-primary text-sm'
                    : 'btn-secondary text-sm text-terminal-text-dim hover:text-terminal-text'
                }
              >
                {item.label}
              </button>
            )
          })}
        </nav>
      </header>
      <main className="flex-1 mx-auto w-full max-w-4xl px-4 py-6 space-y-6">{children}</main>
      <footer className="border-t border-terminal-border py-4 text-center text-xs text-terminal-text-dim">
        Sonic mainnet · Dutch auction · ZK purchase option
      </footer>
    </div>
  )
}
