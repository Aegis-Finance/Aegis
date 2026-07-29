import { ENV } from '../config'

/** Internal paths under `Aegis-contracts/docs/` */
const LEDGER_DOCS: ReadonlyArray<{ label: string; path: string }> = [
  { label: 'Economics & risk framing', path: 'MISHKIN_TO_AEGIS_ALIGNMENT.md' },
  { label: 'Improvement roadmap (status)', path: 'MISHKIN_IMPROVEMENT_ROADMAP.md' },
  { label: 'What this protocol is not', path: 'WHAT_AEGIS_IS_NOT.md' },
  { label: 'Invariants vs governance levers', path: 'INVARIANTS_VS_GOVERNANCE_SURFACE.md' },
  { label: 'Primary-sale sybil & adverse selection', path: 'SYBIL_AND_SALE_ADVERSE_SELECTION.md' },
  { label: 'Dutch auction — primary market risk', path: 'DUTCH_AUCTION_MARKET_RISK_NOTE.md' },
  { label: 'Flow: PrivateTokenContract (AGS ledger)', path: 'flows/FLOW-M1-private-token.md' },
  { label: 'Flow: TokenAllocation (genesis tranches)', path: 'flows/FLOW-M1-token-allocation.md' },
  { label: 'Flow: DecentralizedInsurance', path: 'flows/FLOW-M4-insurance.md' },
  { label: 'Flow: AutomatedDutchAuction (TGE)', path: 'flows/FLOW-M5-dutch-auction.md' },
  { label: 'Flow: TimeLock purchase limits / sybil gate', path: 'flows/FLOW-M5-time-lock-purchase-limits.md' },
  { label: 'Flow: Liquidity seed from auction', path: 'flows/FLOW-M5-liquidity-seed-from-auction.md' },
  { label: 'Flow: ZK token distribution sale', path: 'flows/FLOW-M5-token-distribution-sale.md' },
  { label: 'Flow: AutomatedBondingCurve (post-TGE)', path: 'flows/FLOW-M5-bonding-curve.md' },
]

function docHref(relativePath: string): string | undefined {
  const base = ENV.repoDocsBaseUrl
  if (!base) return undefined
  const p = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath
  return `${base.replace(/\/$/, '')}/${p}`
}

type Props = {
  /** Omit long compliance prose; list links only. */
  compact?: boolean
}

export default function ProtocolDocumentationLinks({ compact = false }: Props) {
  return (
    <div className={compact ? 'tge-doc-links tge-doc-links--compact' : undefined} style={compact ? undefined : { marginTop: '12px', fontSize: '0.75rem', lineHeight: 1.55, color: 'var(--color-text-secondary)' }}>
      {!compact ? (
        <>
          <p style={{ margin: '0 0 6px', color: 'var(--color-text)' }}>
            <strong>Open protocol documentation</strong>
          </p>
          <p className="muted" style={{ margin: '0 0 8px' }}>
            We publish this sale as <strong>primary issuance</strong>, not a promise of secondary-market returns. We use
            caps, cooldowns, and (when deployed) time-locked purchase limits to reduce sybil traffic and herd pressure —
            those mitigations do not remove all manipulation or valuation risk. Use the Dutch auction risk note and the
            primary-sale risk entry in the list below for detail.
          </p>
          <p className="muted" style={{ margin: '0 0 8px' }}>
            On-chain mitigations we wire where available include per-address caps, minimums, cooldowns, and{' '}
            <code style={{ fontSize: '0.72em' }}>TimeLockPurchaseLimits</code> plus sybil-circuit binding — see the flow
            specs. The auction contract may emit <strong>price manipulation / flash-loan</strong> sentries when thresholds
            trip (<code style={{ fontSize: '0.72em' }}>AutomatedDutchAuction</code> ABI / events).
          </p>
          <p style={{ margin: '0 0 6px', fontSize: '0.7rem' }}>
            <strong style={{ color: 'var(--color-text)' }}>Protocol invariants</strong> (enforced by contracts, not this
            UI): we ship a <strong>21M</strong> AGS supply cap; <strong>4.2M</strong> founder allocation is a fixed cap-table
            slice and governance works around it; <strong>maximum stealth</strong> means aggregate rails and ZK where
            verifiers apply — not wallet-level surveillance. The economics framing doc at the top of the list explains how
            we talk about those boundaries.
          </p>
        </>
      ) : (
        <p className="muted" style={{ margin: '0 0 8px', fontSize: '0.8rem' }}>
          Technical specs and risk notes for auditors (21M cap, 4.2M founder slice, primary-sale mitigations):
        </p>
      )}
      <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
        {LEDGER_DOCS.map((d) => {
          const href = docHref(d.path)
          return (
            <li key={d.path} style={{ marginBottom: '4px' }}>
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {d.label}
                </a>
              ) : (
                <>
                  {d.label}: <code style={{ fontSize: '0.68em' }}>Aegis-contracts/docs/{d.path}</code>
                </>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
