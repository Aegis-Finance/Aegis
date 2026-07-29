import { useCallback, useState } from 'react'
import { useWalletStore } from '@/store/walletStore'
import { formatAddress } from '@/utils/format'
import { requestInjectedWalletOptions, type InjectedWalletOption } from '@/utils/injectedWallets'
import { walletPickerInitial } from '@/utils/walletPickerInitial'
import { SONIC_GATEWAY_DOCS } from '@/config/sonicInfra'
import toast from 'react-hot-toast'

export default function WalletButton() {
  const { address, isConnected, isConnecting, connectWithInjected, disconnect } = useWalletStore()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [walletChoices, setWalletChoices] = useState<InjectedWalletOption[]>([])

  const runConnectFlow = useCallback(async () => {
    const wallets = await requestInjectedWalletOptions(500)
    if (wallets.length === 0) {
      toast.error(
        `No browser wallet found. Install a Sonic-compatible wallet (${SONIC_GATEWAY_DOCS.wallets}) such as MetaMask or Rabby, then refresh.`,
        { duration: 8000 }
      )
      return
    }
    if (wallets.length === 1) {
      await connectWithInjected(wallets[0].provider)
      return
    }
    setWalletChoices(wallets)
    setPickerOpen(true)
  }, [connectWithInjected])

  const pickWallet = async (w: InjectedWalletOption) => {
    setPickerOpen(false)
    setWalletChoices([])
    await connectWithInjected(w.provider)
  }

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-3">
        <div className="px-3 py-1.5 bg-terminal-accent/10 border border-terminal-accent/40 rounded-lg text-terminal-accent text-sm font-mono">
          {formatAddress(address)}
        </div>
        <button type="button" onClick={disconnect} className="btn-secondary text-sm">
          Disconnect
        </button>
      </div>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void runConnectFlow()}
        disabled={isConnecting}
        className="btn-primary"
      >
        {isConnecting ? 'Connecting...' : 'Connect wallet'}
      </button>

      {pickerOpen && walletChoices.length > 0 && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/40"
            aria-hidden
            onClick={() => {
              setPickerOpen(false)
              setWalletChoices([])
            }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-picker-title"
            className="fixed left-1/2 top-1/2 z-[70] w-[min(100vw-2rem,22rem)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-terminal-border bg-terminal-surface p-4 shadow-xl"
          >
            <h2 id="wallet-picker-title" className="text-sm font-semibold text-terminal-text">
              Choose wallet
            </h2>
            <p className="mt-1 text-xs text-terminal-text-dim">
              Multiple wallets detected (EIP-6963). Pick one to connect — same as Rabby / MetaMask / OKX on{' '}
              <a
                href={SONIC_GATEWAY_DOCS.wallets}
                target="_blank"
                rel="noreferrer"
                className="text-terminal-accent underline"
              >
                Sonic
              </a>
              .
            </p>
            <ul className="mt-3 max-h-[min(60vh,20rem)] space-y-2 overflow-y-auto">
              {walletChoices.map((w) => (
                <li key={w.info.uuid}>
                  <button
                    type="button"
                    onClick={() => void pickWallet(w)}
                    className="flex w-full items-center gap-3 rounded-md border border-terminal-border/60 bg-terminal-bg px-3 py-2 text-left text-sm text-terminal-text transition hover:border-terminal-accent/50 hover:bg-terminal-accent/5"
                  >
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-terminal-accent/25 bg-terminal-accent/15 text-xs font-bold text-terminal-accent"
                      aria-hidden
                    >
                      {walletPickerInitial(w.info.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{w.info.name}</span>
                      <span className="block truncate text-[10px] text-terminal-text-dim">{w.info.rdns}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn-secondary mt-3 w-full text-sm"
              onClick={() => {
                setPickerOpen(false)
                setWalletChoices([])
              }}
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </>
  )
}
