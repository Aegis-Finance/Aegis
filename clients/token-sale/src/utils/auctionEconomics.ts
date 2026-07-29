/** Matches `AutomatedDutchAuction.AUCTION_PRICE_CURVE_ID` on-chain. */
const CURVE_LABELS: Record<number, string> = {
  1: 'Time-linear Dutch (ZK verifier v1)',
}

export function describeAuctionCurve(curveId: number): string {
  return CURVE_LABELS[curveId] ?? `Curve ID ${curveId} — see deployment docs`
}
