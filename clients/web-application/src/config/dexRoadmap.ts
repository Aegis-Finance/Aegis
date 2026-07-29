/**
 * DEX / trading roadmap chips — keep aligned with frontend-docs/docs/roadmap/trading.md
 * and honest vs on-chain reality (Sonic mainnet).
 */
export type MilestoneStatus = 'shipped' | 'in_progress' | 'planned'

export type DexMilestone = {
  id: string
  title: string
  status: MilestoneStatus
  summary: string
}

export const DEX_MILESTONES: DexMilestone[] = [
  {
    id: 'M0',
    title: 'Public AGS / S pool',
    status: 'shipped',
    summary:
      'Public swaps and LP are live for AGS/S. Additional pairs (USDC, USDT, WETH, …) are still being seeded.',
  },
  {
    id: 'M1',
    title: 'PrivateAMM in product',
    status: 'in_progress',
    summary:
      'PrivateAMM and its verifier are on Sonic. We are finishing proof UX, prover reliability, and honest labeling — reserves stay public; proofs gate policy.',
  },
  {
    id: 'M2',
    title: 'Smart routing',
    status: 'in_progress',
    summary:
      'Governed pool router is deployed. Best-quote coverage across funded pools and app wiring are in progress.',
  },
  {
    id: 'M3',
    title: 'Limit orders in the app',
    status: 'in_progress',
    summary:
      'Escrow and EIP-712 limit settlement are live on Sonic. App flows to create and fill orders are next.',
  },
  {
    id: 'M4',
    title: 'RFQ in the app',
    status: 'in_progress',
    summary:
      'One-shot RFQ settlement is live on Sonic. App UX, solver registry, and monitoring are still shipping.',
  },
  {
    id: 'M5',
    title: 'ZK-wrapped advanced execution',
    status: 'planned',
    summary: 'Per-feature circuits where proof latency and audit budget justify confidentiality.',
  },
]

export function milestoneStatusLabel(s: MilestoneStatus): string {
  switch (s) {
    case 'shipped':
      return 'Live'
    case 'in_progress':
      return 'In progress'
    case 'planned':
      return 'Next up'
  }
}
