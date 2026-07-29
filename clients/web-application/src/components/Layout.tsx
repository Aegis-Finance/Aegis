import { ReactNode, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useWalletStore } from '@/store/walletStore'
import WalletButton from './WalletButton'
import RpcSelector from './RpcSelector'
import GoogleTranslate from './GoogleTranslate'
import Logo from './Logo'
import RunYourOwnNode from './RunYourOwnNode'
import { isPrivacySensitiveRoute } from '@/config/privacySensitiveRoutes'
import {
  hasCommitmentRelatedLocalStorage,
  isCommitmentVaultEnabled,
  isCommitmentVaultUnlocked,
} from '@/utils/commitmentStorage'
import { allowThirdPartyTranslate as operationalAllowsTranslate } from '@/utils/operationalProfile'
import { findModuleByPath, getModulesByGroup } from '@/config/moduleCatalog'

interface LayoutProps {
  children: ReactNode
}

function navLabelForPath(pathname: string): string {
  return findModuleByPath(pathname)?.label ?? 'Home'
}

export default function Layout({ children }: LayoutProps) {
  const location = useLocation()
  const { checkConnection, address } = useWalletStore()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const mobileNavRef = useRef<HTMLDivElement>(null)
  const navGroups = getModulesByGroup()

  useEffect(() => {
    checkConnection()
    const interval = setInterval(checkConnection, 30000)
    return () => clearInterval(interval)
  }, [checkConnection])

  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!mobileNavOpen) return

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (mobileNavRef.current?.contains(target)) return
      setMobileNavOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
    }
  }, [mobileNavOpen])

  const allowThirdPartyTranslate =
    operationalAllowsTranslate() && !isPrivacySensitiveRoute(location.pathname)

  const currentPageLabel = navLabelForPath(location.pathname)

  const renderNavLink = (item: (typeof navGroups)[number]['modules'][number]) => {
    const isActive = location.pathname === item.path
    return (
      <Link
        key={item.path}
        to={item.path}
        onClick={() => setMobileNavOpen(false)}
        className={`
          flex items-center gap-2 md:gap-3 px-3 md:px-4 py-2 rounded-lg text-sm transition-all
          ${
            isActive
              ? 'bg-terminal-accent/10 text-terminal-accent border border-terminal-accent/30 font-medium'
              : 'text-terminal-text-dim hover:text-terminal-text hover:bg-terminal-bg'
          }
        `}
      >
        <span className="text-base md:text-lg" aria-hidden>
          {item.icon}
        </span>
        <span className="min-w-0 flex-1 leading-snug">{item.label}</span>
      </Link>
    )
  }

  return (
    <div className="page min-h-screen flex flex-col bg-terminal-bg text-terminal-text">
      {allowThirdPartyTranslate ? <GoogleTranslate /> : null}
      {address ? (
        <div
          className="border-b border-terminal-border bg-terminal-surface px-4 py-1.5 text-center text-[11px] leading-snug text-terminal-text-dim"
          role="note"
        >
          <strong className="text-terminal-text">Device storage:</strong>{' '}
          {isCommitmentVaultEnabled(address) ? (
            isCommitmentVaultUnlocked(address) ? (
              <>
                Encrypted UX cache <strong className="text-terminal-text">unlocked</strong> in memory — blobs on disk
                are AES-GCM wrapped. EVM explorers still see your txs.{' '}
              </>
            ) : (
              <>
                Encrypted UX cache <strong className="text-terminal-text">locked</strong> — open Wallet to unlock (new
                cache writes wait).{' '}
              </>
            )
          ) : (
            <>
              this dApp may persist ZK UX rows in <code className="text-terminal-accent">localStorage</code> as{' '}
              <strong className="text-terminal-text">plaintext</strong> unless you enable the vault on Wallet.{' '}
            </>
          )}
          {hasCommitmentRelatedLocalStorage(address) ? (
            <span className="text-terminal-warning">Rows or vault blobs exist for this wallet.</span>
          ) : null}
        </div>
      ) : null}
      <header className="sticky top-0 z-50 border-b border-terminal-border bg-gradient-to-b from-terminal-surface to-terminal-bg">
        <div className="container mx-auto max-w-[90rem] px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <Logo variant="text" size="lg" className="flex-shrink-0 min-w-0" />
            <div className="flex items-center gap-4">
              <RpcSelector />
              <WalletButton />
            </div>
          </div>
        </div>
      </header>

      <div ref={mobileNavRef} className="md:hidden border-terminal-border border-b bg-terminal-surface z-40">
        <button
          type="button"
          className="w-full px-4 py-2.5 text-left text-sm font-medium text-terminal-text flex items-center justify-between gap-2"
          aria-expanded={mobileNavOpen}
          aria-controls="aegis-mobile-nav"
          onClick={() => setMobileNavOpen((o) => !o)}
        >
          <span className="truncate">{currentPageLabel}</span>
          <span className="text-terminal-text-dim shrink-0" aria-hidden>
            {mobileNavOpen ? '▴' : '▾'}
          </span>
        </button>
        {mobileNavOpen ? (
          <nav id="aegis-mobile-nav" className="px-2 pb-3 max-h-[min(70vh,28rem)] overflow-y-auto" aria-label="Site">
            {navGroups.map(({ group, modules }) => (
              <div key={group.id} className="mb-3">
                <p className="px-3 py-1 text-[10px] uppercase tracking-widest text-terminal-text-dim">{group.label}</p>
                <ul className="space-y-0.5">{modules.map((item) => <li key={item.path}>{renderNavLink(item)}</li>)}</ul>
              </div>
            ))}
          </nav>
        ) : null}
      </div>

      <div className="flex flex-1">
        <aside className="w-72 border-terminal-border border-r bg-terminal-surface hidden md:block">
          <nav className="p-4 space-y-5">
            {navGroups.map(({ group, modules }) => (
              <div key={group.id}>
                <p className="px-4 mb-1 text-[10px] uppercase tracking-widest text-terminal-text-dim">{group.label}</p>
                <ul className="space-y-0.5">{modules.map((item) => <li key={item.path}>{renderNavLink(item)}</li>)}</ul>
              </div>
            ))}
          </nav>
        </aside>

        <main className="flex-1 overflow-auto">
          <div className="container mx-auto max-w-[68rem] px-6 py-8">
            <RunYourOwnNode />
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
