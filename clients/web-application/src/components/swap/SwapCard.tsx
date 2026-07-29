import type { PublicPoolConfig } from '@/config/liquidity'
import type { SwapDirection, SwapQuotePreview, SwapRoute } from '@/utils/swapQuote'
import { applySlippage, poolLabel, slippageBpsFromPercent } from '@/utils/swapQuote'
import { formatUnits } from 'ethers'

const SLIPPAGE_OPTIONS = [0.3, 0.5, 1] as const

type Props = {
  pools: PublicPoolConfig[]
  direction: SwapDirection
  selectedPoolId: string
  amountIn: string
  quote: SwapQuotePreview | null | undefined
  quoteLoading: boolean
  route: SwapRoute
  slippagePercent: number
  paySymbol: string
  receiveSymbol: string
  isConnected: boolean
  isExecuting: boolean
  odosAvailable: boolean
  showRouteSelector?: boolean
  onDirectionChange: (d: SwapDirection) => void
  onPoolChange: (id: string) => void
  onAmountChange: (v: string) => void
  onRouteChange: (r: SwapRoute) => void
  onSlippageChange: (pct: number) => void
  onSwap: () => void
}

export default function SwapCard({
  pools,
  direction,
  selectedPoolId,
  amountIn,
  quote,
  quoteLoading,
  route,
  slippagePercent,
  paySymbol,
  receiveSymbol,
  isConnected,
  isExecuting,
  odosAvailable,
  showRouteSelector = true,
  onDirectionChange,
  onPoolChange,
  onAmountChange,
  onRouteChange,
  onSlippageChange,
  onSwap,
}: Props) {
  const payValue = direction === 'AGS_TO_QUOTE' ? 'AGS' : selectedPoolId
  const receiveValue = direction === 'AGS_TO_QUOTE' ? selectedPoolId : 'AGS'

  const onPayTokenChange = (value: string) => {
    if (value === 'AGS') {
      onDirectionChange('AGS_TO_QUOTE')
      return
    }
    onPoolChange(value)
    onDirectionChange('QUOTE_TO_AGS')
  }

  const onReceiveTokenChange = (value: string) => {
    if (value === 'AGS') {
      onDirectionChange('QUOTE_TO_AGS')
      return
    }
    onPoolChange(value)
    onDirectionChange('AGS_TO_QUOTE')
  }

  const flip = () => onDirectionChange(direction === 'AGS_TO_QUOTE' ? 'QUOTE_TO_AGS' : 'AGS_TO_QUOTE')

  const slippageBps = slippageBpsFromPercent(slippagePercent)
  const minOut =
    quote && quote.amountOutRaw > 0n
      ? formatUnits(applySlippage(quote.amountOutRaw, slippageBps), quote.outputDecimals)
      : null

  const receiveDisplay = (() => {
    if (quoteLoading) return '…'
    if (!amountIn || Number(amountIn) <= 0) return '0'
    if (!quote) return '—'
    return Number(quote.amountOutFormatted).toLocaleString(undefined, { maximumFractionDigits: 8 })
  })()

  const routeLabel =
    quote?.routeUsed === 'odos'
      ? 'Odos (multi-DEX)'
      : quote?.routeUsed === 'router'
        ? 'Aegis router'
        : quote?.routeUsed === 'pool'
          ? 'Aegis pool'
          : '—'

  const canSwap =
    isConnected && !!amountIn && Number(amountIn) > 0 && !!quote && quote.amountOutRaw > 0n && !isExecuting

  return (
    <div className="card border border-terminal-border/60 bg-terminal-surface/80 shadow-aegis space-y-4 overflow-hidden">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-terminal-text">Exchange</h2>
        <div className="flex items-center gap-1 text-[11px] text-terminal-text-dim">
          <span>Slippage</span>
          {SLIPPAGE_OPTIONS.map((pct) => (
            <button
              key={pct}
              type="button"
              onClick={() => onSlippageChange(pct)}
              className={`rounded px-2 py-0.5 border ${
                slippagePercent === pct
                  ? 'border-terminal-accent text-terminal-accent bg-terminal-accent/10'
                  : 'border-terminal-border/50 hover:text-terminal-text'
              }`}
            >
              {pct}%
            </button>
          ))}
        </div>
      </div>

      {showRouteSelector ? (
      <div className="flex gap-1 rounded-lg border border-terminal-border/40 p-1 bg-terminal-bg/50">
        {(
          [
            ['auto', 'Best price'],
            ['aegis', 'Aegis pool'],
            ['odos', 'Odos'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            disabled={id === 'odos' && !odosAvailable}
            onClick={() => onRouteChange(id)}
            className={`flex-1 rounded-md py-2 text-xs font-medium transition-colors ${
              route === id
                ? 'bg-terminal-accent text-white shadow-sm'
                : 'text-terminal-text-dim hover:text-terminal-text'
            } ${id === 'odos' && !odosAvailable ? 'opacity-40 cursor-not-allowed' : ''}`}
            title={id === 'odos' && !odosAvailable ? 'Connect wallet for Odos quotes (ERC-20 pairs only)' : undefined}
          >
            {label}
          </button>
        ))}
      </div>
      ) : null}

      <div className="rounded-xl border border-terminal-border/50 bg-terminal-bg/60 p-4 space-y-2 overflow-hidden">
        <label className="text-xs font-medium uppercase tracking-wide text-terminal-text-dim">You pay</label>
        <div className="grid grid-cols-[minmax(5.5rem,7rem)_minmax(0,1fr)] gap-3 items-center">
          <select
            value={payValue}
            onChange={(e) => onPayTokenChange(e.target.value)}
            className="input-field w-full min-w-0 text-sm font-semibold"
          >
            <option value="AGS">AGS</option>
            {pools.map((pool) => (
              <option key={pool.id} value={pool.id}>
                {poolLabel(pool)}
              </option>
            ))}
          </select>
          <input
            type="number"
            min="0"
            step="any"
            value={amountIn}
            onChange={(e) => onAmountChange(e.target.value)}
            placeholder="0.0"
            className="input-field w-full min-w-0 text-right text-lg font-mono tabular-nums"
          />
        </div>
      </div>

      <div className="flex justify-center -my-1">
        <button
          type="button"
          onClick={flip}
          className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-terminal-border/60 bg-terminal-surface text-terminal-text-dim hover:border-terminal-accent hover:text-terminal-accent transition-colors"
          aria-label="Flip tokens"
        >
          ↕
        </button>
      </div>

      <div className="rounded-xl border border-terminal-border/50 bg-terminal-bg/60 p-4 space-y-2 overflow-hidden">
        <label className="text-xs font-medium uppercase tracking-wide text-terminal-text-dim">You receive</label>
        <div className="grid grid-cols-[minmax(5.5rem,7rem)_minmax(0,1fr)] gap-3 items-center">
          <select
            value={receiveValue}
            onChange={(e) => onReceiveTokenChange(e.target.value)}
            className="input-field w-full min-w-0 text-sm font-semibold"
          >
            <option value="AGS">AGS</option>
            {pools.map((pool) => (
              <option key={pool.id} value={pool.id}>
                {poolLabel(pool)}
              </option>
            ))}
          </select>
          <div className="min-w-0 text-right text-lg font-mono tabular-nums text-terminal-accent min-h-[2.5rem] flex items-center justify-end truncate">
            {receiveDisplay}
          </div>
        </div>
      </div>

      {amountIn && Number(amountIn) > 0 && (
        <div className="rounded-lg border border-terminal-border/30 bg-terminal-bg/40 px-4 py-3 text-xs space-y-1.5">
          <div className="flex justify-between gap-2">
            <span className="text-terminal-text-dim">Route</span>
            <span className="text-terminal-text font-medium">{routeLabel}</span>
          </div>
          {minOut ? (
            <div className="flex justify-between gap-2">
              <span className="text-terminal-text-dim">Minimum received</span>
              <span className="text-terminal-text">
                {Number(minOut).toLocaleString(undefined, { maximumFractionDigits: 8 })} {receiveSymbol}
              </span>
            </div>
          ) : null}
          {quote?.odos?.priceImpact != null ? (
            <div className="flex justify-between gap-2">
              <span className="text-terminal-text-dim">Price impact</span>
              <span className={quote.odos.priceImpact > 2 ? 'text-amber-400' : 'text-terminal-text'}>
                {(quote.odos.priceImpact * 100).toFixed(2)}%
              </span>
            </div>
          ) : null}
          {quote?.fallbackFromOdos ? (
            <p className="text-amber-400/90 pt-1">Odos unavailable — using Aegis pool instead.</p>
          ) : null}
          {quote?.comparedRoutes && quote.aegisAlternative && quote.routeUsed === 'odos' ? (
            <p className="text-terminal-text-dim pt-1">
              Aegis pool would return{' '}
              {Number(quote.aegisAlternative.amountOutFormatted).toLocaleString(undefined, {
                maximumFractionDigits: 6,
              })}{' '}
              {receiveSymbol}.
            </p>
          ) : null}
          {quote?.comparedRoutes && quote.odosAlternative && quote.routeUsed !== 'odos' ? (
            <p className="text-terminal-text-dim pt-1">
              Odos would return{' '}
              {Number(quote.odosAlternative.amountOutFormatted).toLocaleString(undefined, {
                maximumFractionDigits: 6,
              })}{' '}
              {receiveSymbol}.
            </p>
          ) : null}
          {route === 'odos' && isConnected ? (
            <p className="text-terminal-text-dim pt-1 border-t border-terminal-border/20 mt-2">
              Odos routes across Sonic DEX liquidity. Quotes refresh every few seconds; your wallet confirms the
              on-chain swap.
            </p>
          ) : null}
        </div>
      )}

      <button type="button" onClick={onSwap} className="btn-primary w-full py-3 text-base" disabled={!canSwap}>
        {isExecuting
          ? 'Confirm in wallet…'
          : !isConnected
            ? 'Connect wallet'
            : `Swap ${paySymbol} for ${receiveSymbol}`}
      </button>

      {!isConnected && (
        <p className="text-center text-xs text-terminal-text-dim">Connect a Sonic wallet to get live quotes and swap.</p>
      )}
    </div>
  )
}
