/** Mirrors on-chain linear Dutch schedule (`AuctionPriceLib` / `getCurrentPrice`). */

const DAY_SEC = 86_400

export type AuctionDayPrice = {
  dayIndex: number
  label: string
  startTimestampSec: number
  priceWeiPerAgs: bigint
  isToday: boolean
  isPast: boolean
}

export function linearDutchPriceAt(
  startPrice: bigint,
  reservePrice: bigint,
  auctionStartTimeSec: number,
  auctionEndTimeSec: number,
  atSec: number,
  saleCompleted: boolean
): bigint {
  if (auctionStartTimeSec === 0 || atSec < auctionStartTimeSec) return startPrice
  if (saleCompleted || atSec >= auctionEndTimeSec) return reservePrice
  const duration = auctionEndTimeSec - auctionStartTimeSec
  if (duration <= 0) return reservePrice
  const elapsed = atSec - auctionStartTimeSec
  const delta = startPrice - reservePrice
  return reservePrice + (delta * BigInt(duration - elapsed)) / BigInt(duration)
}

export function buildDailyAuctionPrices(args: {
  startPrice: bigint
  reservePrice: bigint
  auctionStartTimeSec: number
  auctionEndTimeSec: number
  auctionDurationSec: number
  saleCompleted: boolean
  nowSec?: number
}): AuctionDayPrice[] {
  const nowSec = args.nowSec ?? Math.floor(Date.now() / 1000)
  const durationSec =
    args.auctionEndTimeSec > args.auctionStartTimeSec && args.auctionStartTimeSec > 0
      ? args.auctionEndTimeSec - args.auctionStartTimeSec
      : args.auctionDurationSec > 0
        ? args.auctionDurationSec
        : 30 * DAY_SEC

  const dayCount = Math.max(1, Math.ceil(durationSec / DAY_SEC))
  const scheduleStart =
    args.auctionStartTimeSec > 0 ? args.auctionStartTimeSec : nowSec

  const rows: AuctionDayPrice[] = []
  for (let i = 0; i < dayCount; i++) {
    const ts = scheduleStart + i * DAY_SEC
    const priceWeiPerAgs = linearDutchPriceAt(
      args.startPrice,
      args.reservePrice,
      args.auctionStartTimeSec > 0 ? args.auctionStartTimeSec : scheduleStart,
      args.auctionStartTimeSec > 0 ? args.auctionEndTimeSec : scheduleStart + durationSec,
      ts,
      args.saleCompleted
    )
    const dayStart = args.auctionStartTimeSec > 0 ? args.auctionStartTimeSec + i * DAY_SEC : ts
    const dayEnd = dayStart + DAY_SEC
    const isToday = nowSec >= dayStart && nowSec < dayEnd
    const isPast = nowSec >= dayEnd || args.saleCompleted
    rows.push({
      dayIndex: i + 1,
      label:
        args.auctionStartTimeSec > 0
          ? new Date(dayStart * 1000).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            })
          : `Day ${i + 1}`,
      startTimestampSec: dayStart,
      priceWeiPerAgs,
      isToday,
      isPast,
    })
  }
  return rows
}

export function agsPerNativeFromPriceWei(priceWeiPerAgs: bigint): number {
  if (priceWeiPerAgs <= 0n) return 0
  const sPerAgs = Number(priceWeiPerAgs) / 1e18
  if (sPerAgs <= 0) return 0
  return 1 / sPerAgs
}
