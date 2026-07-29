import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Contract } from 'ethers'

import { useWalletStore } from '@/store/walletStore'
import { formatBalance } from '@/utils/format'
import {
  ORACLE_MAX_STALENESS_SEC,
  fetchDerivativesOracleStatus,
  getDerivativesOracleContract,
} from '@/utils/derivativesOracle'
import { explorerAddressUrl, SONIC_GATEWAY_DOCS } from '@/config/sonicInfra'
import { waitAndParseTransaction } from '@/utils/transactionHelper'

type Props = {
  derivativesAddress: string
  assetId: string
}

function formatAge(sec: number | null): string {
  if (sec == null) return 'never updated'
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  return `${Math.floor(sec / 3600)}h ago`
}

export default function DerivativesOraclePanel({ derivativesAddress, assetId }: Props) {
  const { provider, signer, address, isConnected } = useWalletStore()
  const queryClient = useQueryClient()
  const [syncing, setSyncing] = useState(false)

  const { data: status, isFetching } = useQuery({
    queryKey: ['derivatives-oracle-status', derivativesAddress, assetId],
    queryFn: async () => {
      if (!provider) return null
      return fetchDerivativesOracleStatus(provider, derivativesAddress, assetId)
    },
    enabled: Boolean(provider && derivativesAddress),
    refetchInterval: 30_000,
  })

  const onSyncOracle = async () => {
    if (!signer || !address) {
      toast.error('Connect wallet to refresh oracle price on-chain')
      return
    }
    setSyncing(true)
    try {
      const c = getDerivativesOracleContract(derivativesAddress, signer) as Contract
      const tx = await c.updatePriceFromOracle(assetId)
      toast.loading('Updating oracle price…', { id: 'oracle-sync' })
      await waitAndParseTransaction(tx, address, provider!)
      toast.success('Oracle price updated', { id: 'oracle-sync' })
      await queryClient.invalidateQueries({ queryKey: ['derivatives-oracle-status'] })
      await queryClient.invalidateQueries({ queryKey: ['derivatives-market'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Oracle update failed', { id: 'oracle-sync' })
    } finally {
      setSyncing(false)
    }
  }

  if (!status && isFetching) {
    return (
      <div className="rounded-lg border border-terminal-border/40 bg-terminal-bg/40 px-4 py-3 text-xs text-terminal-text-dim">
        Loading oracle wiring…
      </div>
    )
  }

  if (!status) return null

  const statusTone = !status.feedsWired
    ? 'border-amber-500/40 bg-amber-500/10'
    : status.stale || status.priceMissing
      ? 'border-amber-500/40 bg-amber-500/10'
      : 'border-terminal-accent/30 bg-terminal-accent/5'

  return (
    <div className={`rounded-lg border px-4 py-3 text-xs space-y-2 ${statusTone}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-medium text-terminal-text text-sm">Settlement oracle · {status.assetLabel}</div>
          <p className="text-terminal-text-dim mt-0.5 max-w-xl leading-relaxed">
            Exercise and expiry use this on-chain spot — not the Black–Scholes calculator. Pre-TGE the mark may be a
            governance bootstrap price; after liquidity, keepers sync from the AGS/wS pool. Listed Sonic oracles
            (Chainlink, Pyth, API3, …) plug in when an AGS feed exists.
          </p>
        </div>
        {status.feedsWired && (status.stale || status.priceMissing) && isConnected ? (
          <button
            type="button"
            className="btn-secondary text-xs shrink-0 px-3 py-1.5"
            disabled={syncing}
            onClick={() => void onSyncOracle()}
          >
            {syncing ? 'Syncing…' : 'Refresh on-chain'}
          </button>
        ) : null}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-terminal-text-dim">
        <div>
          <div className="text-[10px] uppercase tracking-wide">Spot</div>
          <div className="text-terminal-text font-semibold tabular-nums">
            {status.priceMissing ? '—' : `${formatBalance(status.price, 18, 4)} (18-dec)`}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide">Last update</div>
          <div className="text-terminal-text">
            {status.timestamp > 0 ? new Date(status.timestamp * 1000).toLocaleString() : 'Never'}
          </div>
          <div className={status.stale ? 'text-amber-200/90' : ''}>{formatAge(status.ageSec)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide">Feed mode</div>
          <div className="text-terminal-text">
            {status.useMultiOracle ? 'Multi-oracle aggregator' : 'Legacy Chainlink-style'}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide">Wiring</div>
          <div className="text-terminal-text">
            {!status.feedsWired
              ? 'No feeds configured'
              : status.useMultiOracle
                ? 'Aggregator linked'
                : `${status.legacyOracleCount} feed(s), ${status.requiredConfirmations} confirmations`}
          </div>
        </div>
      </div>

      {!status.feedsWired ? (
        <p className="text-amber-200/90 leading-relaxed">
          Governance has not registered Sonic price feeds for this asset yet. Settlement spot will stay empty until{' '}
          <code className="text-terminal-accent">addOracle</code> / <code className="text-terminal-accent">setMultiOracleAggregator</code>{' '}
          is configured on-chain.
        </p>
      ) : null}

      {status.feedsWired && (status.stale || status.priceMissing) ? (
        <p className="text-amber-200/90">
          Price is {status.priceMissing ? 'unset' : 'stale'} (older than {ORACLE_MAX_STALENESS_SEC / 3600}h).{' '}
          {isConnected ? 'Use Refresh on-chain or wait for a keeper.' : 'Connect a wallet to push an update.'}
        </p>
      ) : null}

      <details className="text-[11px]">
        <summary className="cursor-pointer text-terminal-accent">Contract addresses</summary>
        <ul className="mt-1.5 space-y-1 list-none font-mono">
          <li>
            PrivateDerivatives:{' '}
            <a href={explorerAddressUrl(derivativesAddress)} target="_blank" rel="noreferrer" className="underline">
              {derivativesAddress.slice(0, 10)}…
            </a>
          </li>
          {status.multiOracleAggregator ? (
            <li>
              Aggregator (asset):{' '}
              <a
                href={explorerAddressUrl(status.multiOracleAggregator)}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                {status.multiOracleAggregator.slice(0, 10)}…
              </a>
            </li>
          ) : null}
          {status.manifestMultiOracleAggregator &&
          status.manifestMultiOracleAggregator.toLowerCase() !== status.multiOracleAggregator?.toLowerCase() ? (
            <li>
              Manifest MultiOracle:{' '}
              <a
                href={explorerAddressUrl(status.manifestMultiOracleAggregator)}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                {status.manifestMultiOracleAggregator.slice(0, 10)}…
              </a>
            </li>
          ) : null}
          <li>
            <a href={SONIC_GATEWAY_DOCS.toolingAndInfra} target="_blank" rel="noreferrer" className="underline">
              Sonic oracle provider list
            </a>
          </li>
        </ul>
      </details>
    </div>
  )
}
