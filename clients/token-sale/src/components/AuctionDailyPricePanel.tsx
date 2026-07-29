import { useMemo } from 'react'

import { useAuctionSaleInfo } from '../hooks/useAuctionSaleInfo'
import { formatCountdown, formatPriceWei } from '../utils/format'
import {
  agsPerNativeFromPriceWei,
  buildDailyAuctionPrices,
  type AuctionDayPrice,
} from '../utils/auctionPriceSchedule'

export default function AuctionDailyPricePanel() {
  const sale = useAuctionSaleInfo()

  const dailyRows = useMemo((): AuctionDayPrice[] => {
    if (!sale.data) return []
    return buildDailyAuctionPrices({
      startPrice: sale.data.startPrice,
      reservePrice: sale.data.reservePrice,
      auctionStartTimeSec: sale.data.auctionStartTime,
      auctionEndTimeSec: sale.data.auctionEndTime,
      auctionDurationSec: sale.data.auctionDuration,
      saleCompleted: sale.data.isCompleted,
    })
  }, [sale.data])

  const liveAgsPerS = useMemo(() => {
    if (!sale.data) return null
    return agsPerNativeFromPriceWei(sale.data.currentPrice)
  }, [sale.data])

  if (sale.isPending) {
    return (
      <section className="card">
        <p className="text-sm text-terminal-text-dim">Loading live auction price from chain…</p>
      </section>
    )
  }

  if (sale.isError || !sale.data) {
    return (
      <section className="card border-terminal-warning/40">
        <p className="text-sm text-terminal-text-dim">
          Could not read auction price from RPC. Check your network and retry.
        </p>
        <button type="button" className="btn-secondary mt-3 text-sm" onClick={() => void sale.refetch()}>
          Retry
        </button>
      </section>
    )
  }

  const { data } = sale
  const notStarted = !data.isActive || data.auctionStartTime === 0
  const todayRow = dailyRows.find((r) => r.isToday)

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-terminal-text">Live auction price</h2>
          <p className="text-sm text-terminal-text-dim mt-1">
            {notStarted
              ? 'Spot follows the Dutch schedule once the sale is activated on-chain.'
              : data.isCompleted
                ? 'Sale ended — final marginal price from contract state.'
                : 'Updates every ~12s from AutomatedDutchAuction on Sonic.'}
          </p>
        </div>
        {sale.isFetching ? (
          <span className="text-xs text-terminal-text-dim">Refreshing…</span>
        ) : null}
      </div>

      <div className="rounded-xl border border-terminal-accent/30 bg-terminal-accent/5 p-4 sm:p-5">
        <p className="text-xs uppercase tracking-wide text-terminal-text-dim font-medium">
          {notStarted ? 'Current schedule spot (pre-activation)' : "Today's price"}
        </p>
        <p className="mt-2 text-2xl sm:text-3xl font-semibold text-terminal-text tabular-nums">
          {formatPriceWei(data.currentPrice, 4)} <span className="text-lg font-medium text-terminal-text-dim">S / AGS</span>
        </p>
        {liveAgsPerS && liveAgsPerS > 0 ? (
          <p className="mt-1 text-sm text-terminal-text-dim">
            ≈ {liveAgsPerS.toLocaleString(undefined, { maximumFractionDigits: 6 })} AGS per 1 S at this ask
          </p>
        ) : null}
        {!notStarted && !data.isCompleted && data.timeRemaining > 0 ? (
          <p className="mt-2 text-xs text-terminal-text-dim">
            Window closes in {formatCountdown(data.timeRemaining)}
          </p>
        ) : null}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-terminal-text mb-2">Daily schedule (S per AGS)</h3>
        <p className="text-xs text-terminal-text-dim mb-3">
          Linear Dutch curve — price at the start of each sale day. Your fill uses the spot at transaction confirmation.
        </p>
        <div className="overflow-x-auto rounded-lg border border-terminal-border">
          <table className="w-full text-sm text-left">
            <thead className="bg-terminal-bg/80 text-terminal-text-dim text-xs uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2 font-medium">Day</th>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Price (S / AGS)</th>
                <th className="px-3 py-2 font-medium hidden sm:table-cell">AGS per 1 S</th>
              </tr>
            </thead>
            <tbody>
              {dailyRows.map((row) => {
                const agsPerS = agsPerNativeFromPriceWei(row.priceWeiPerAgs)
                const isLiveRow = row.isToday && data.isActive && !data.isCompleted
                return (
                  <tr
                    key={row.dayIndex}
                    className={
                      isLiveRow
                        ? 'bg-terminal-accent/10 border-t border-terminal-border'
                        : 'border-t border-terminal-border'
                    }
                  >
                    <td className="px-3 py-2 font-medium">
                      {row.dayIndex}
                      {isLiveRow ? (
                        <span className="ml-2 text-[10px] uppercase text-terminal-accent font-semibold">Today</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-terminal-text-dim">{row.label}</td>
                    <td className="px-3 py-2 tabular-nums">{formatPriceWei(row.priceWeiPerAgs, 4)}</td>
                    <td className="px-3 py-2 tabular-nums text-terminal-text-dim hidden sm:table-cell">
                      {agsPerS > 0 ? agsPerS.toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {todayRow && data.isActive ? (
          <p className="mt-2 text-xs text-terminal-text-dim">
            On-chain spot now: <strong className="text-terminal-text">{formatPriceWei(data.currentPrice, 4)} S/AGS</strong>
            {data.currentPrice !== todayRow.priceWeiPerAgs ? ' (moves continuously within today)' : ''}
          </p>
        ) : null}
      </div>
    </section>
  )
}
