import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatUnits, parseUnits } from 'ethers'

import { useWalletStore } from '@/store/walletStore'
import { formatBalance, formatDuration } from '@/utils/format'
import ModuleDeploymentNotice from '@/components/ModuleDeploymentNotice'
import {
  DERIVATIVE_TYPE,
  buildPricingGuidance,
  getDefaultDerivativeVolatility,
  getDefaultRiskFreeRate,
  getDefaultUnderlyingAssetId,
  getDerivativesPreviewContract,
  resolveDerivativesAddress,
  type DerivativeTypeId,
} from '@/utils/derivativePricing'
import { getDefaultReadProvider } from '@/utils/contracts'
import DerivativesTradePanel from '@/components/products/DerivativesTradePanel'
import DerivativesOraclePanel from '@/components/DerivativesOraclePanel'

type PageTab = 'negotiate' | 'trade'

function premiumHint(bps: number | null): { label: string; tone: 'neutral' | 'high' | 'low' } {
  if (bps == null || !Number.isFinite(bps)) return { label: 'Enter a premium to compare', tone: 'neutral' }
  const pct = bps / 100
  const sign = pct > 0 ? '+' : ''
  if (Math.abs(pct) <= 5) return { label: `${sign}${pct.toFixed(1)}% vs reference — near fair`, tone: 'neutral' }
  if (pct > 0) return { label: `${sign}${pct.toFixed(1)}% above reference — seller-friendly`, tone: 'high' }
  return { label: `${sign}${pct.toFixed(1)}% below reference — buyer-friendly`, tone: 'low' }
}

export default function Derivatives() {
  const { provider, isConnected } = useWalletStore()
  const readProvider = provider ?? getDefaultReadProvider()
  const [pageTab, setPageTab] = useState<PageTab>('negotiate')
  const [showAdvanced, setShowAdvanced] = useState(false)

  const [derivativeType, setDerivativeType] = useState<DerivativeTypeId>(DERIVATIVE_TYPE.CALL_OPTION)
  const [strike, setStrike] = useState('1.0')
  const [notional, setNotional] = useState('100')
  const [scenarioSpot, setScenarioSpot] = useState('')
  const [premiumOffer, setPremiumOffer] = useState('')
  const [expiryDays, setExpiryDays] = useState('30')
  const [volPct, setVolPct] = useState(String(getDefaultDerivativeVolatility() * 100))
  const [riskFreePct, setRiskFreePct] = useState(String(getDefaultRiskFreeRate() * 100))
  const [assetId] = useState(getDefaultUnderlyingAssetId())

  const { data: derivativesAddress } = useQuery({
    queryKey: ['derivatives-address'],
    queryFn: resolveDerivativesAddress,
    staleTime: 60_000,
  })

  const { data: marketStats } = useQuery({
    queryKey: ['derivatives-market', derivativesAddress],
    queryFn: async () => {
      if (!derivativesAddress) return null
      const c = getDerivativesPreviewContract(derivativesAddress, readProvider)
      const [nextId, tvl, fees, asset] = await Promise.all([
        c.nextContractId(),
        c.totalValueLocked(),
        c.protocolFees(),
        c.getAssetPrice(assetId),
      ])
      return {
        activeContracts: Number(nextId) > 0 ? Number(nextId) - 1 : 0,
        tvl: BigInt(tvl),
        fees: BigInt(fees),
        oracleSpot: BigInt(asset?.price ?? asset?.[0] ?? 0),
        oracleTs: Number(asset?.timestamp ?? asset?.[1] ?? 0),
      }
    },
    enabled: Boolean(derivativesAddress),
    refetchInterval: 30_000,
  })

  const oracleSpotWei = marketStats?.oracleSpot ?? 0n

  const spotWei = useMemo(() => {
    if (scenarioSpot.trim()) {
      try {
        return parseUnits(scenarioSpot, 18)
      } catch {
        return 0n
      }
    }
    return oracleSpotWei
  }, [scenarioSpot, oracleSpotWei])

  const spotSourceLabel = scenarioSpot.trim() ? 'scenario (calculator only)' : 'on-chain oracle'

  const expiryTimestamp = useMemo(() => {
    const d = Number(expiryDays)
    if (!Number.isFinite(d) || d <= 0) return Math.floor(Date.now() / 1000)
    return Math.floor(Date.now() / 1000) + Math.round(d * 86400)
  }, [expiryDays])

  const guidanceQuery = useQuery({
    queryKey: [
      'derivatives-pricing',
      derivativesAddress,
      derivativeType,
      strike,
      notional,
      spotWei.toString(),
      expiryTimestamp,
      premiumOffer,
      volPct,
      riskFreePct,
    ],
    queryFn: async () => {
      if (!derivativesAddress || spotWei === 0n) return null
      let strikeWei = 0n
      let notionalWei = 0n
      let premiumWei = 0n
      try {
        strikeWei = parseUnits(strike, 18)
        notionalWei = parseUnits(notional, 18)
        if (premiumOffer.trim()) premiumWei = parseUnits(premiumOffer, 18)
      } catch {
        return null
      }
      const vol = Number(volPct) / 100
      const rf = Number(riskFreePct) / 100
      return buildPricingGuidance(derivativesAddress, readProvider, {
        derivativeType,
        strikeWei,
        notionalWei,
        spotWei,
        expiryTimestamp,
        userPremiumWei: premiumWei,
        volatility: Number.isFinite(vol) && vol > 0 ? vol : getDefaultDerivativeVolatility(),
        riskFreeRate: Number.isFinite(rf) && rf >= 0 ? rf : getDefaultRiskFreeRate(),
      })
    },
    enabled: Boolean(derivativesAddress) && spotWei > 0n,
  })

  const g = guidanceQuery.data
  const premiumCompare = premiumHint(g?.premiumVsFairBps ?? null)

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold text-terminal-text md:text-3xl">Options</h1>
        <p className="text-sm text-terminal-text-dim max-w-2xl leading-relaxed">
          Write custom call or put options directly with another party on Sonic. You agree the strike, size, premium,
          and expiry — then both sides post collateral. There is no public order book; every deal is bilateral and
          settled with zero-knowledge privacy.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <StepCard
          step="1"
          title="Agree terms"
          body="Pick call or put, strike, notional, premium, and expiry. Use the reference calculator to negotiate — the chain does not set price for you."
        />
        <StepCard
          step="2"
          title="Open on-chain"
          body="Buyer and seller lock collateral in a shielded contract. Premium and positions stay private on Sonic."
        />
        <StepCard
          step="3"
          title="Exercise or settle"
          body="If the option is in the money before expiry, the holder exercises. After expiry, remaining contracts settle to intrinsic value."
        />
      </div>

      <ModuleDeploymentNotice
        moduleName="Private options"
        contractAddress={derivativesAddress}
        envHint="VITE_DERIVATIVES_ADDRESS"
      />

      {derivativesAddress ? (
        <DerivativesOraclePanel derivativesAddress={derivativesAddress} assetId={assetId} />
      ) : null}

      {marketStats ? (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <StatCard label="Open interest (TVL)" value={`${formatBalance(marketStats.tvl)} AGS`} />
          <StatCard label="Live contracts" value={String(marketStats.activeContracts)} />
          <StatCard
            label="AGS spot (settlement)"
            value={
              marketStats.oracleSpot > 0n ? formatBalance(marketStats.oracleSpot, 18, 4) : 'Not set'
            }
            hint={
              marketStats.oracleTs > 0
                ? `Oracle · ${new Date(marketStats.oracleTs * 1000).toLocaleString()}`
                : 'Refresh oracle on-chain if feeds are wired'
            }
          />
          <StatCard label="Protocol fees" value={`${formatBalance(marketStats.fees)} AGS`} />
        </div>
      ) : null}

      <div className="flex rounded-lg border border-terminal-border/40 p-1 bg-terminal-bg/40">
        <button
          type="button"
          onClick={() => setPageTab('negotiate')}
          className={`flex-1 rounded-md py-2.5 text-sm font-medium transition-colors ${
            pageTab === 'negotiate'
              ? 'bg-terminal-surface text-terminal-text shadow-sm'
              : 'text-terminal-text-dim hover:text-terminal-text'
          }`}
        >
          Plan &amp; price
        </button>
        <button
          type="button"
          onClick={() => setPageTab('trade')}
          className={`flex-1 rounded-md py-2.5 text-sm font-medium transition-colors ${
            pageTab === 'trade'
              ? 'bg-terminal-accent/15 text-terminal-accent shadow-sm'
              : 'text-terminal-text-dim hover:text-terminal-text'
          }`}
        >
          Create &amp; manage
        </button>
      </div>

      {pageTab === 'negotiate' && (
        <div className="grid gap-6 lg:grid-cols-5">
          <section className="lg:col-span-3 card space-y-4 border border-terminal-border/60 bg-terminal-surface/80">
            <div>
              <h2 className="text-lg font-semibold text-terminal-text">Deal terms</h2>
              <p className="text-xs text-terminal-text-dim mt-1">
                Fill in what you and your counterparty are negotiating. These fields are not submitted until you open a
                contract on the next tab.
              </p>
            </div>

            <div className="flex gap-2">
              {(
                [
                  [DERIVATIVE_TYPE.CALL_OPTION, 'Call', 'Right to buy AGS at the strike'],
                  [DERIVATIVE_TYPE.PUT_OPTION, 'Put', 'Right to sell AGS at the strike'],
                ] as const
              ).map(([type, label, hint]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setDerivativeType(type)}
                  className={`flex-1 rounded-lg border px-3 py-3 text-left transition-colors ${
                    derivativeType === type
                      ? 'border-terminal-accent bg-terminal-accent/10'
                      : 'border-terminal-border/50 hover:border-terminal-border'
                  }`}
                >
                  <span className="block text-sm font-semibold text-terminal-text">{label}</span>
                  <span className="block text-[11px] text-terminal-text-dim mt-0.5">{hint}</span>
                </button>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Scenario spot (optional, AGS)"
                value={scenarioSpot}
                onChange={setScenarioSpot}
                placeholder={
                  oracleSpotWei > 0n ? `Uses oracle ${formatUnits(oracleSpotWei, 18)} when blank` : 'Enter spot for calculator'
                }
              />
              <Field label="Strike price" value={strike} onChange={setStrike} />
              <Field label="Size (AGS notional)" value={notional} onChange={setNotional} />
              <Field
                label="Premium you offer (AGS)"
                value={premiumOffer}
                onChange={setPremiumOffer}
                placeholder="Optional"
              />
              <Field label="Days until expiry" value={expiryDays} onChange={setExpiryDays} />
            </div>

            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-xs text-terminal-accent hover:underline"
            >
              {showAdvanced ? 'Hide' : 'Show'} advanced pricing assumptions
            </button>

            {showAdvanced ? (
              <div className="grid gap-3 sm:grid-cols-2 rounded-lg border border-terminal-border/30 bg-terminal-bg/50 p-3">
                <Field label="Volatility (%)" value={volPct} onChange={setVolPct} />
                <Field label="Risk-free rate (%)" value={riskFreePct} onChange={setRiskFreePct} />
                <p className="sm:col-span-2 text-[11px] text-terminal-text-dim leading-relaxed">
                  Volatility and risk-free rate are <strong className="text-terminal-text">illustrative only</strong> —
                  they are not stored on-chain. The calculator uses spot from{' '}
                  <strong className="text-terminal-text">{spotSourceLabel}</strong>. Settlement at exercise uses the
                  oracle spot above.
                </p>
              </div>
            ) : null}
          </section>

          <section className="lg:col-span-2 card space-y-4 border border-terminal-accent/25 bg-terminal-accent/5">
            <div>
              <h2 className="text-lg font-semibold text-terminal-accent">Reference price</h2>
              <p className="text-xs text-terminal-text-dim mt-1">
                Illustrative negotiation helper — not a guarantee of on-chain settlement.
              </p>
            </div>

            {guidanceQuery.isLoading ? (
              <p className="text-sm text-terminal-text-dim">Calculating…</p>
            ) : spotWei === 0n ? (
              <p className="text-sm text-terminal-text-dim">
                Enter a scenario spot or refresh the on-chain oracle above to use the calculator.
              </p>
            ) : !g ? (
              <p className="text-sm text-terminal-text-dim">Enter strike and size to see a reference.</p>
            ) : (
              <div className="space-y-4">
                <div className="rounded-lg border border-terminal-border/40 bg-terminal-bg/60 p-4 space-y-1">
                  <div className="text-xs text-terminal-text-dim uppercase tracking-wide">Suggested premium</div>
                  <div className="text-2xl font-semibold text-terminal-text font-mono tabular-nums">
                    {g.bsTotalPremiumWei != null ? `${formatBalance(g.bsTotalPremiumWei)} AGS` : '—'}
                  </div>
                  <div className="text-[11px] text-terminal-text-dim">
                    Black–Scholes estimate (illustrative) · spot: {spotSourceLabel}
                  </div>
                </div>

                <div className="space-y-2 text-sm">
                  <Row
                    label="Payoff if exercised now"
                    value={`${formatBalance(g.intrinsicWei)} AGS`}
                    highlight={g.inTheMoney}
                  />
                  <Row label="Seller collateral required" value={`${formatBalance(g.collateralWei)} AGS`} />
                  <Row label="Time left" value={formatDuration(g.secondsToExpiry)} />
                </div>

                {premiumOffer.trim() ? (
                  <div
                    className={`rounded-lg px-3 py-2 text-xs ${
                      premiumCompare.tone === 'high'
                        ? 'bg-amber-500/10 text-amber-200/90 border border-amber-500/30'
                        : premiumCompare.tone === 'low'
                          ? 'bg-emerald-500/10 text-emerald-200/90 border border-emerald-500/30'
                          : 'bg-terminal-bg/50 text-terminal-text-dim border border-terminal-border/30'
                    }`}
                  >
                    Your offer: {premiumCompare.label}
                  </div>
                ) : null}

                <p className="text-[11px] text-terminal-text-dim leading-relaxed border-t border-terminal-border/20 pt-3">
                  At settlement the chain pays <strong className="text-terminal-text">intrinsic value</strong> — how
                  far in-the-money the option is — not the Black–Scholes number above.
                </p>
              </div>
            )}
          </section>
        </div>
      )}

      {pageTab === 'trade' && (
        <div className="space-y-4">
          {!derivativesAddress ? (
            <div className="card text-sm text-terminal-text-dim">
              Options are not available on this network yet.
            </div>
          ) : !isConnected ? (
            <div className="card text-sm text-terminal-text-dim text-center py-6">
              Connect your wallet to create, exercise, or settle options.
            </div>
          ) : null}
          {derivativesAddress ? <DerivativesTradePanel derivativesAddress={derivativesAddress} /> : null}
        </div>
      )}
    </div>
  )
}

function StepCard({ step, title, body }: { step: string; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-terminal-border/50 bg-terminal-surface/60 p-4 space-y-2">
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-terminal-accent/15 text-xs font-bold text-terminal-accent">
        {step}
      </span>
      <h3 className="text-sm font-semibold text-terminal-text">{title}</h3>
      <p className="text-xs text-terminal-text-dim leading-relaxed">{body}</p>
    </div>
  )
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-terminal-border/40 bg-terminal-bg/50 px-4 py-3">
      <div className="text-[11px] text-terminal-text-dim uppercase tracking-wide">{label}</div>
      <div className="text-base font-semibold text-terminal-text mt-1 tabular-nums">{value}</div>
      {hint ? <div className="text-[10px] text-terminal-text-dim mt-1 truncate">{hint}</div> : null}
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="block space-y-1.5 text-sm min-w-0">
      <span className="text-terminal-text-dim text-xs">{label}</span>
      <input
        className="input-field w-full min-w-0 font-mono text-sm"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between gap-3 border-b border-terminal-border/15 pb-2">
      <span className="text-terminal-text-dim text-xs">{label}</span>
      <span className={`text-sm tabular-nums ${highlight ? 'text-terminal-accent font-medium' : 'text-terminal-text'}`}>
        {value}
      </span>
    </div>
  )
}
