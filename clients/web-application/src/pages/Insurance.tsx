import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { EventLog } from 'ethers'
import toast from 'react-hot-toast'
import { parseEther, randomBytes, ZeroHash } from 'ethers'

import { useWalletStore } from '@/store/walletStore'
import { getInsuranceContract } from '@/utils/contracts'
import { formatBalance, formatDate } from '@/utils/format'
import { proveInsurance } from '@/utils/prover'
import { validateAmount, detectAttackPattern, checkRateLimit, isValidHex } from '@/utils/security'
import { groth16ProofBigintsToBytes256, hexToBytesStrict } from '@/utils/proofBytes'
import { waitAndParseTransaction } from '@/utils/transactionHelper'
import DaoModuleNotice from '@/components/DaoModuleNotice'
import ModuleDeploymentNotice, { ModuleConfiguredSection } from '@/components/ModuleDeploymentNotice'
import ZkProverNotice from '@/components/ZkProverNotice'
import ZkModeToggle from '@/components/ZkModeToggle'
import { CONTRACT_ADDRESSES } from '@/config/contracts'

type InsurancePoolStats = {
  pool: bigint
  totalCoverage: bigint
  premiumsCollected: bigint
  claimsPaid: bigint
  activePolicies: number
  /** Outstanding nominal / pool depth (basis points, contract-defined). */
  coverageToPoolBps: bigint
  /** Claims paid / premiums collected experience (basis points). */
  lossRatioBps: bigint
}

type InsuranceChainParams = {
  minCoverageWei: bigint
  maxCoverageWei: bigint
  minPeriodSec: bigint
  maxPeriodSec: bigint
  claimPeriodSec: bigint
}

function bpsToPercentLabel(b: bigint): string {
  if (b < 0n || b > 1_000_000n) return '—'
  return `${(Number(b) / 100).toFixed(2)}%`
}

function secondsToDaysRoundedUp(sec: bigint): number {
  const d = sec / 86400n
  const r = sec % 86400n
  return Number(d) + (r > 0n ? 1 : 0)
}

/** Normalized `bytes32` (0x + 64 hex). Null if empty or not exactly 32 bytes of hex. */
function parseBytes32Input(raw: string): `0x${string}` | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const body = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed
  if (!isValidHex(body, 32)) return null
  return (`0x${body.padStart(64, '0')}`) as `0x${string}`
}

/** Single flight: pool + aggregate coverage stress + loss experience + active policy count. */
function useInsuranceMarket() {
  const { provider } = useWalletStore()
  return useQuery({
    queryKey: ['insurance-market-snapshot'],
    queryFn: async (): Promise<InsurancePoolStats | null> => {
      if (!provider) return null
      const contract = getInsuranceContract(provider)
      const snap = await contract.getInsuranceMarketSnapshot()
      const pool = BigInt(snap.poolWei ?? snap[0])
      const totalCoverage = BigInt(snap.outstandingCoverageWei ?? snap[1])
      const premiumsCollected = BigInt(snap.premiumsCollectedWei ?? snap[2])
      const claimsPaid = BigInt(snap.claimsPaidWei ?? snap[3])
      const coverageToPoolBps = BigInt(snap.coverageToPoolBps ?? snap[4])
      const lossRatioBps = BigInt(snap.lossRatioBps ?? snap[5])

      let activePolicies = 0
      try {
        const filter = contract.filters.PolicyCreated()
        const events = (await contract.queryFilter(filter, 0, 'latest')) as EventLog[]
        for (const event of events) {
          const policyId = event.args?.[0] ?? event.topics?.[1]
          if (policyId == null) continue
          try {
            const p = await contract.getPolicy(policyId)
            const st = Number(p.status)
            if (st === 0) activePolicies++
          } catch {
            continue
          }
        }
      } catch {
        /* ignore */
      }

      return {
        pool,
        totalCoverage,
        premiumsCollected,
        claimsPaid,
        activePolicies,
        coverageToPoolBps,
        lossRatioBps,
      }
    },
    enabled: Boolean(provider),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}

function useInsuranceChainParams() {
  const { provider } = useWalletStore()
  return useQuery({
    queryKey: ['insurance-chain-params'],
    queryFn: async (): Promise<InsuranceChainParams | null> => {
      if (!provider) return null
      const c = getInsuranceContract(provider)
      const [minCoverageWei, maxCoverageWei, minPeriodSec, maxPeriodSec, claimPeriodSec] = await Promise.all([
        c.MIN_COVERAGE_AMOUNT(),
        c.MAX_COVERAGE_AMOUNT(),
        c.MIN_COVERAGE_PERIOD(),
        c.MAX_COVERAGE_PERIOD(),
        c.CLAIM_PERIOD(),
      ])
      return {
        minCoverageWei: BigInt(minCoverageWei),
        maxCoverageWei: BigInt(maxCoverageWei),
        minPeriodSec: BigInt(minPeriodSec),
        maxPeriodSec: BigInt(maxPeriodSec),
        claimPeriodSec: BigInt(claimPeriodSec),
      }
    },
    enabled: Boolean(provider),
    staleTime: 60_000,
  })
}

type InsurancePolicy = {
  id: number
  coverage: bigint
  premium: bigint
  expiry: number
  startedAt: number
  maxClaim: bigint
  deductible: bigint
  insuranceType: number
  isPrivate: boolean
}

type InsuranceClaim = {
  id: number
  policyId: number
  amount: bigint
  status: 'Pending' | 'Approved' | 'Rejected' | 'Paid'
}

type InsuranceType =
  | 'SMART_CONTRACT'
  | 'DEFI_PROTOCOL'
  | 'STABLECOIN_DEPEG'
  | 'SLASHING'
  | 'BRIDGE'
  | 'HEALTH'
  | 'CROP'
  | 'BUSINESS'

/** Active policies list is deployment-wide (not wallet-scoped); ZK lines have no on-chain owner. */
const INSURANCE_ACTIVE_POLICIES_KEY = ['insurance-policies', 'active-on-chain'] as const

function insuranceTypeIndexToLabel(idx: number): string {
  const labels = ['Smart contract', 'DeFi protocol', 'Stablecoin depeg', 'Slashing', 'Bridge'] as const
  return labels[idx] ?? `Type ${idx}`
}

export default function Insurance() {
  const [activeTab, setActiveTab] = useState<'policies' | 'create' | 'claims'>('policies')
  const [mode, setMode] = useState<'legacy' | 'zk'>('zk')

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="text-3xl font-bold text-terminal-accent mb-2">Insurance</h1>
        <DaoModuleNotice>
          <p>
            On-chain coverage here is <strong className="text-terminal-text">parametric</strong>: it pays only when the
            contract&apos;s conditions and claims path are satisfied, up to pool limits. It is{' '}
            <strong className="text-terminal-text">not</strong> comprehensive life or traditional insurance; if the vault
            is insufficient, payouts cannot exceed what the protocol holds.
          </p>
          <p className="mt-2 text-terminal-text-dim">
            We are <strong className="text-terminal-text">not</strong> a bank and this module is{' '}
            <strong className="text-terminal-text">not</strong> government-backed deposit insurance: there is no
            statutory backstop. Payouts are limited by what the on-chain pool actually holds; first-loss sits with the
            pool and related protocol tranches.
          </p>
        </DaoModuleNotice>
        <ModuleDeploymentNotice
          moduleName="Insurance"
          contractAddress={CONTRACT_ADDRESSES.INSURANCE}
          envHint="VITE_INSURANCE_ADDRESS"
        />
      </div>

      <ZkProverNotice moduleLabel="Insurance" />
      <ZkModeToggle mode={mode} onChange={setMode} zkOnly />

      <ModuleConfiguredSection contractAddress={CONTRACT_ADDRESSES.INSURANCE}>
      {/* Pool Stats */}
      <InsuranceStats />

      {/* Tabs */}
      <div className="flex gap-2 border-terminal-border border-b">
        {(['policies', 'create', 'claims'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 font-medium capitalize transition-colors ${
              activeTab === tab
                ? 'text-terminal-accent border-b-2 border-terminal-accent'
                : 'text-terminal-text-dim hover:text-terminal-text'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === 'policies' && <PoliciesList />}
      {activeTab === 'create' && <CreatePolicy mode={mode} />}
      {activeTab === 'claims' && <ClaimsList mode={mode} />}
      </ModuleConfiguredSection>
    </div>
  )
}

function InsuranceStats() {
  const { provider } = useWalletStore()
  const { data: poolStats, isPending, isFetching, isError } = useInsuranceMarket()

  if (!provider) {
    return (
      <div className="card text-center py-10 text-terminal-text-dim">
        Connect a wallet with RPC access to load pool depth, outstanding coverage, and loss experience.
      </div>
    )
  }

  if (isError) {
    return (
      <div className="card text-center py-10 text-terminal-text-dim">
        Could not read the insurance market snapshot from the chain.
      </div>
    )
  }

  if (isPending || (isFetching && poolStats == null)) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="card">
            <div className="text-sm text-terminal-text-dim mb-1">Loading...</div>
            <div className="text-xl font-bold text-terminal-text">-</div>
          </div>
        ))}
      </div>
    )
  }

  if (!poolStats) {
    return null
  }

  const stressHigh = poolStats.coverageToPoolBps > 8500n

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="card">
          <div className="text-sm text-terminal-text-dim mb-1">Insurance pool</div>
          <div className="text-2xl font-bold text-terminal-text">{formatBalance(poolStats.pool)} AGS</div>
        </div>
        <div className="card">
          <div className="text-sm text-terminal-text-dim mb-1">Outstanding coverage</div>
          <div className="text-2xl font-bold text-terminal-text">{formatBalance(poolStats.totalCoverage)} AGS</div>
        </div>
        <div className="card">
          <div className="text-sm text-terminal-text-dim mb-1">Premiums collected</div>
          <div className="text-2xl font-bold text-terminal-accent">{formatBalance(poolStats.premiumsCollected)} AGS</div>
        </div>
        <div className="card">
          <div className="text-sm text-terminal-text-dim mb-1">Claims paid</div>
          <div className="text-2xl font-bold text-terminal-text">{formatBalance(poolStats.claimsPaid)} AGS</div>
        </div>
        <div className={`card ${stressHigh ? 'ring-1 ring-amber-500/60' : ''}`}>
          <div className="text-sm text-terminal-text-dim mb-1">Coverage / pool (stress)</div>
          <div className="text-2xl font-bold text-terminal-text">{bpsToPercentLabel(poolStats.coverageToPoolBps)}</div>
        </div>
        <div className="card">
          <div className="text-sm text-terminal-text-dim mb-1">Loss ratio (paid / prem.)</div>
          <div className="text-2xl font-bold text-terminal-text">{bpsToPercentLabel(poolStats.lossRatioBps)}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-4 text-sm text-terminal-text-dim">
        <span>
          Active policies (status): <strong className="text-terminal-text">{poolStats.activePolicies}</strong>
        </span>
        {stressHigh ? (
          <span className="text-amber-400">
            High aggregate coverage vs pool — DAO should review new issuance and pricing.
          </span>
        ) : null}
      </div>
    </div>
  )
}

function PoliciesList() {
  const { provider } = useWalletStore()

  const { data: policies, isPending, isError } = useQuery<InsurancePolicy[]>({
    queryKey: INSURANCE_ACTIVE_POLICIES_KEY,
    queryFn: async () => {
      if (!provider) return []
      try {
        const contract = getInsuranceContract(provider)
        const filter = contract.filters.PolicyCreated()
        const events = (await contract.queryFilter(filter)) as EventLog[]

        const policyPromises = events.map(async (event) => {
          try {
            const policyId = event.args?.[0] ?? event.topics?.[1]
            if (!policyId) return null
            const rawPolicy = (await contract.getPolicy(policyId)) as unknown as {
              coverageAmount: bigint
              premiumAmount: bigint
              endTime: bigint
              startTime: bigint
              status: number
              maxClaimAmount: bigint
              deductible: bigint
              insuranceType: number
              isPrivate: boolean
            }
            if (Number(rawPolicy.status) !== 0) return null
            return {
              id: Number(policyId),
              coverage: BigInt(rawPolicy.coverageAmount ?? 0),
              premium: BigInt(rawPolicy.premiumAmount ?? 0),
              expiry: Number(rawPolicy.endTime ?? 0),
              startedAt: Number(rawPolicy.startTime ?? 0),
              maxClaim: BigInt(rawPolicy.maxClaimAmount ?? 0),
              deductible: BigInt(rawPolicy.deductible ?? 0),
              insuranceType: Number(rawPolicy.insuranceType ?? 0),
              isPrivate: Boolean(rawPolicy.isPrivate),
            } satisfies InsurancePolicy
          } catch (policyError) {
            console.warn('Error fetching policy', policyError)
            return null
          }
        })

        const results = await Promise.all(policyPromises)
        const active = results.filter((policy): policy is InsurancePolicy => policy !== null)
        active.sort((a, b) => b.id - a.id)
        return active
      } catch (error) {
        console.error('Error fetching policies:', error)
        return []
      }
    },
    enabled: Boolean(provider),
    staleTime: 20_000,
  })

  if (!provider) {
    return (
      <div className="card text-center py-12 text-terminal-text-dim">
        Connect a wallet to load active policies from the chain.
      </div>
    )
  }

  if (isError) {
    return (
      <div className="card text-center py-12 text-terminal-text-dim">
        Could not load policies (RPC or contract error).
      </div>
    )
  }

  if (isPending || policies === undefined) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="card animate-pulse">
            <div className="h-6 bg-terminal-border/30 rounded w-1/2 mb-4" />
            <div className="h-4 bg-terminal-border/20 rounded mb-2" />
            <div className="h-4 bg-terminal-border/20 rounded mb-2" />
            <div className="h-4 bg-terminal-border/20 rounded w-3/4" />
          </div>
        ))}
      </div>
    )
  }

  if (policies.length === 0) {
    return (
      <div className="card text-center py-12 space-y-2">
        <p className="text-terminal-text-dim">No active policies on this deployment.</p>
        <p className="text-xs text-terminal-text-dim max-w-md mx-auto">
          This list is not filtered by wallet: private (ZK) policies do not expose an on-chain owner. Use the policy ID
          from your issuance flow when filing a claim.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-terminal-text-dim max-w-3xl">
        Showing <strong className="text-terminal-text">active</strong> policies chain-wide (newest first). For claims,
        use the policy ID here; ZK lines are not tied to your connected address on-chain.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {policies.map((policy) => (
          <div key={policy.id} className="card">
            <div className="mb-3 flex items-start justify-between gap-2">
              <h3 className="text-lg font-semibold">Policy #{policy.id}</h3>
              {policy.isPrivate ? (
                <span className="text-xs px-2 py-0.5 rounded bg-terminal-accent/15 text-terminal-accent shrink-0">
                  Private
                </span>
              ) : (
                <span className="text-xs px-2 py-0.5 rounded bg-terminal-border/40 text-terminal-text-dim shrink-0">
                  Public
                </span>
              )}
            </div>
            <div className="space-y-2 mb-4 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-terminal-text-dim">Line</span>
                <span className="font-medium text-right">{insuranceTypeIndexToLabel(policy.insuranceType)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-terminal-text-dim">Coverage</span>
                <span className="font-semibold">{formatBalance(policy.coverage)} AGS</span>
              </div>
              <div className="flex justify-between">
                <span className="text-terminal-text-dim">Premium paid</span>
                <span className="font-semibold">{formatBalance(policy.premium)} AGS</span>
              </div>
              <div className="flex justify-between">
                <span className="text-terminal-text-dim">Deductible</span>
                <span className="font-semibold">{formatBalance(policy.deductible)} AGS</span>
              </div>
              <div className="flex justify-between">
                <span className="text-terminal-text-dim">Max claim</span>
                <span className="font-semibold">{formatBalance(policy.maxClaim)} AGS</span>
              </div>
              <div className="flex justify-between">
                <span className="text-terminal-text-dim">Started</span>
                <span className="font-semibold">{policy.startedAt ? formatDate(policy.startedAt) : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-terminal-text-dim">Expires</span>
                <span className="font-semibold">{policy.expiry ? formatDate(policy.expiry) : '—'}</span>
              </div>
            </div>
            <button
              type="button"
              className="btn-secondary w-full"
              onClick={() => {
                void navigator.clipboard.writeText(String(policy.id)).then(
                  () => {
                    toast.success(`Copied policy #${policy.id}`)
                  },
                  () => {
                    toast.error('Could not copy to clipboard')
                  }
                )
              }}
            >
              Copy policy ID
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function CreatePolicy({ mode }: { mode: 'legacy' | 'zk' }) {
  const queryClient = useQueryClient()
  const { provider, signer, isConnected, address } = useWalletStore()
  const [insuranceType, setInsuranceType] = useState<InsuranceType>('SMART_CONTRACT')
  const [coverageAmount, setCoverageAmount] = useState('')
  const [coveragePeriod, setCoveragePeriod] = useState('')
  const [deductible, setDeductible] = useState('')
  const [protocolIdentifier, setProtocolIdentifier] = useState('')
  const [creating, setCreating] = useState(false)
  const proverUrl = import.meta.env.VITE_PROVER_URL as string | undefined

  const { data: chainParams } = useInsuranceChainParams()
  const { data: market } = useInsuranceMarket()

  const protocolIdBytes = useMemo(() => {
    const trimmedProto = protocolIdentifier.trim()
    if (!trimmedProto) return ZeroHash
    return parseBytes32Input(protocolIdentifier)
  }, [protocolIdentifier])

  const coverageWeiParsed = useMemo(() => {
    try {
      const t = coverageAmount.trim()
      if (!t) return null
      return parseEther(t)
    } catch {
      return null
    }
  }, [coverageAmount])

  const periodSecParsed = useMemo(() => {
    const n = parseInt(coveragePeriod, 10)
    if (!Number.isFinite(n) || n <= 0) return null
    return BigInt(n) * 86400n
  }, [coveragePeriod])

  const { data: premiumQuote } = useQuery({
    queryKey: [
      'insurance-premium-quote',
      insuranceType,
      protocolIdBytes ?? '',
      coverageWeiParsed?.toString() ?? '',
      periodSecParsed?.toString() ?? '',
    ],
    queryFn: async () => {
      if (!provider || protocolIdBytes === null || !coverageWeiParsed || coverageWeiParsed <= 0n) return null
      if (!periodSecParsed || periodSecParsed <= 0n) return null
      const c = getInsuranceContract(provider)
      const ty = getInsuranceTypeEnum(insuranceType)
      const prem = await c.calculatePremium(ty, protocolIdBytes, coverageWeiParsed, periodSecParsed)
      const base = await c.basePremiumRates(ty)
      let protoRisk: { score: bigint; assessment: bigint } | null = null
      if (protocolIdBytes !== ZeroHash) {
        const r = await c.getProtocolRiskScore(protocolIdBytes)
        protoRisk = { score: BigInt(r[0]), assessment: BigInt(r[1]) }
      }
      return {
        premiumWei: BigInt(prem),
        baseRateBps: BigInt(base),
        protoRisk,
      }
    },
    enabled:
      Boolean(provider) &&
      protocolIdBytes !== null &&
      Boolean(coverageWeiParsed && coverageWeiParsed > 0n) &&
      Boolean(periodSecParsed && periodSecParsed > 0n),
    staleTime: 10_000,
  })

  const minDaysAllowed = chainParams ? secondsToDaysRoundedUp(chainParams.minPeriodSec) : 1
  const maxDaysAllowed = chainParams ? Number(chainParams.maxPeriodSec / 86400n) : 365

  const handleCreatePolicy = async () => {
    try {
      checkRateLimit('api')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit exceeded')
      return
    }

    if (!signer || !isConnected || !provider) {
      toast.error('Please connect wallet')
      return
    }

    const coverageValidation = validateAmount(coverageAmount)
    if (!coverageValidation.valid) {
      toast.error(coverageValidation.error || 'Invalid coverage amount')
      return
    }

    const periodNum = parseInt(coveragePeriod, 10)
    if (!Number.isFinite(periodNum) || periodNum < 1) {
      toast.error('Enter a valid coverage period in whole days')
      return
    }

    const deductibleValidation = validateAmount(deductible)
    if (!deductibleValidation.valid) {
      toast.error(deductibleValidation.error || 'Invalid deductible')
      return
    }

    if (detectAttackPattern(coverageAmount) || detectAttackPattern(deductible)) {
      toast.error('Invalid input detected')
      return
    }

    if (protocolIdBytes === null) {
      toast.error('Protocol identifier must be empty or a valid 32-byte hex value (bytes32)')
      return
    }

    let coverageWei: bigint
    try {
      coverageWei = parseEther(coverageAmount.trim())
    } catch {
      toast.error('Invalid coverage amount')
      return
    }
    let deductibleWei: bigint
    try {
      deductibleWei = parseEther(deductible.trim())
    } catch {
      toast.error('Invalid deductible')
      return
    }
    if (deductibleWei >= coverageWei) {
      toast.error('Deductible must be less than coverage amount')
      return
    }

    const coveragePeriodSeconds = BigInt(periodNum) * 86400n

    if (chainParams) {
      if (coverageWei < chainParams.minCoverageWei || coverageWei > chainParams.maxCoverageWei) {
        toast.error(
          `Coverage must be between ${formatBalance(chainParams.minCoverageWei)} and ${formatBalance(chainParams.maxCoverageWei)} AGS (on-chain limits)`
        )
        return
      }
      if (coveragePeriodSeconds < chainParams.minPeriodSec || coveragePeriodSeconds > chainParams.maxPeriodSec) {
        toast.error(
          `Coverage period must be between ${minDaysAllowed} and ${maxDaysAllowed} whole days for this deployment`
        )
        return
      }
    } else {
      if (periodNum < 7 || periodNum > 365) {
        toast.error('Coverage period must be between 7 and 365 days (connect RPC to load exact on-chain bounds)')
        return
      }
    }

    if (market && market.coverageToPoolBps >= 9500n && coverageWei > market.pool / 10n) {
      toast.error(
        'Pool stress is very high (coverage vs pool). Choose a smaller coverage line or wait for recapitalization.'
      )
      return
    }

    if (mode === 'legacy') {
      toast.error('Legacy policy creation not available. Please use ZK mode.')
      return
    }

    setCreating(true)
    try {
      const contract = getInsuranceContract(signer)
      const protocolId = protocolIdBytes

      toast.loading('Creating policy...', { id: 'create-policy' })

      let zkProof: Uint8Array
      let insuredCommitment: string
      let nullifier: string

      if (proverUrl) {
        const res = await fetch(`${proverUrl}/insurance/create-policy/prove`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            insuranceType,
            protocolIdentifier: protocolId,
            coverageAmount: coverageWei.toString(),
            coveragePeriod: coveragePeriodSeconds.toString(),
            deductible: deductibleWei.toString(),
            recipient: address,
          }),
        })
        if (!res.ok) {
          const errText = await res.text().catch(() => '')
          throw new Error(`Proof service error (${res.status}): ${errText || res.statusText}`)
        }
        const data = (await res.json()) as {
          proof: string
          insuredCommitment?: string
          nullifier?: string
        }
        if (!data.proof) throw new Error('Proof service response missing proof')
        zkProof = hexToBytesStrict(data.proof, 256, 'ZK proof')
        if (!data.insuredCommitment || !data.nullifier) {
          throw new Error(
            'Proof service must return insuredCommitment and nullifier (bytes32 hex) alongside proof'
          )
        }
        insuredCommitment = data.insuredCommitment.startsWith('0x')
          ? data.insuredCommitment
          : `0x${data.insuredCommitment}`
        nullifier = data.nullifier.startsWith('0x') ? data.nullifier : `0x${data.nullifier}`
      } else {
        const insuredCommitmentBytes = randomBytes(32)
        const nullifierBytes = randomBytes(32)
        insuredCommitment = '0x' + Buffer.from(insuredCommitmentBytes).toString('hex')
        nullifier = '0x' + Buffer.from(nullifierBytes).toString('hex')

        toast.loading('Generating ZK proof (client-side)...', { id: 'create-policy' })
        const { proof } = await proveInsurance({
          insuredCommitment: BigInt(insuredCommitment).toString(),
          nullifier: BigInt(nullifier).toString(),
          insuranceType,
          protocolIdentifier: protocolId,
          coverageAmount: coverageWei.toString(),
          coveragePeriod: coveragePeriodSeconds.toString(),
          deductible: deductibleWei.toString(),
        })
        zkProof = groth16ProofBigintsToBytes256(proof)
      }

      toast.loading('Submitting transaction...', { id: 'create-policy' })
      const tx = await contract.createPolicy({
        insuranceType: getInsuranceTypeEnum(insuranceType),
        protocolIdentifier: protocolId,
        coverageAmount: coverageWei,
        coveragePeriod: coveragePeriodSeconds,
        deductible: deductibleWei,
        insuredCommitment,
        nullifier,
        zkProof,
      })
      toast.loading('Waiting for confirmation...', { id: 'create-policy' })
      await waitAndParseTransaction(tx, address!, provider!)
      toast.success('Policy created', { id: 'create-policy' })
      setCoverageAmount('')
      setCoveragePeriod('')
      setDeductible('')
      setProtocolIdentifier('')
      void queryClient.invalidateQueries({ queryKey: ['insurance-market-snapshot'] })
      void queryClient.invalidateQueries({ queryKey: ['insurance-premium-quote'], exact: false })
      void queryClient.invalidateQueries({ queryKey: INSURANCE_ACTIVE_POLICIES_KEY })
    } catch (error) {
      console.error('create policy failed', error)
      toast.error(error instanceof Error ? error.message : 'Policy creation failed', { id: 'create-policy' })
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="card">
        <h2 className="text-xl font-semibold mb-4">Create Policy</h2>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void handleCreatePolicy() }}>
          <div>
            <label className="block text-sm font-medium text-terminal-text-dim mb-2">
              Insurance Type
            </label>
            <select
              value={insuranceType}
              onChange={(e) => setInsuranceType(e.target.value as InsuranceType)}
              className="input-field w-full"
              disabled={creating}
            >
              <option value="SMART_CONTRACT">Smart Contract</option>
              <option value="DEFI_PROTOCOL">DeFi Protocol</option>
              <option value="STABLECOIN_DEPEG">Stablecoin Depeg</option>
              <option value="SLASHING">Slashing</option>
              <option value="BRIDGE">Bridge</option>
              <option value="HEALTH">Health (mutual)</option>
              <option value="CROP">Crop (mutual)</option>
              <option value="BUSINESS">Business interruption</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-terminal-text-dim mb-2">
              Protocol Identifier (optional)
            </label>
            <input
              type="text"
              value={protocolIdentifier}
              onChange={(e) => setProtocolIdentifier(e.target.value)}
              className="input-field w-full"
              placeholder="0x... (32-byte hex)"
              disabled={creating}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-terminal-text-dim mb-2">
              Coverage Amount (AGS)
            </label>
            <input
              type="number"
              step="0.001"
              min="0"
              value={coverageAmount}
              onChange={(e) => setCoverageAmount(e.target.value)}
              className="input-field w-full"
              placeholder="0.0"
              disabled={creating}
            />
            {chainParams ? (
              <p className="text-xs text-terminal-text-dim mt-1">
                On-chain bounds: {formatBalance(chainParams.minCoverageWei)} — {formatBalance(chainParams.maxCoverageWei)} AGS
              </p>
            ) : null}
          </div>
          <div>
            <label className="block text-sm font-medium text-terminal-text-dim mb-2">
              Coverage Period (whole days)
            </label>
            <input
              type="number"
              min={minDaysAllowed}
              max={maxDaysAllowed}
              value={coveragePeriod}
              onChange={(e) => setCoveragePeriod(e.target.value)}
              className="input-field w-full"
              placeholder="30"
              disabled={creating}
            />
            {chainParams ? (
              <p className="text-xs text-terminal-text-dim mt-1">
                Allowed: {minDaysAllowed} — {maxDaysAllowed} days (from contract seconds)
              </p>
            ) : (
              <p className="text-xs text-terminal-text-dim mt-1">Connect wallet to load exact day bounds from chain.</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-terminal-text-dim mb-2">
              Deductible (AGS)
            </label>
            <input
              type="number"
              step="0.001"
              min="0"
              value={deductible}
              onChange={(e) => setDeductible(e.target.value)}
              className="input-field w-full"
              placeholder="0.0"
              disabled={creating}
            />
          </div>
          <button
            type="submit"
            className="btn-primary w-full"
            disabled={!isConnected || creating || !coverageAmount || !coveragePeriod || !deductible || protocolIdBytes === null}
          >
            {creating ? 'Creating...' : mode === 'legacy' ? 'Create Policy (Public)' : 'Create Policy (Private ZK)'}
          </button>
        </form>
      </div>
      <div className="card">
        <h2 className="text-xl font-semibold mb-4">On-chain pricing & risk</h2>
        <div className="space-y-4 text-sm">
          <div>
            <div className="text-terminal-text-dim mb-1">Quoted premium (this quote)</div>
            <div className="font-semibold text-lg text-terminal-accent">
              {premiumQuote ? `${formatBalance(premiumQuote.premiumWei)} AGS` : '—'}
            </div>
            <p className="text-xs text-terminal-text-dim mt-1">
              From <code className="text-xs">calculatePremium</code> for the type, protocol id, coverage, and term you entered.
            </p>
          </div>
          <div>
            <div className="text-terminal-text-dim mb-1">Base rate (contract)</div>
            <div className="font-semibold">{premiumQuote ? `${premiumQuote.baseRateBps.toString()} bps-type floor` : '—'}</div>
          </div>
          {premiumQuote?.protoRisk ? (
            <div>
              <div className="text-terminal-text-dim mb-1">Protocol risk score (on-chain)</div>
              <div className="font-mono text-xs break-all">
                score: {premiumQuote.protoRisk.score.toString()} · assessment: {premiumQuote.protoRisk.assessment.toString()}
              </div>
            </div>
          ) : protocolIdBytes && protocolIdBytes !== ZeroHash ? (
            <p className="text-xs text-terminal-text-dim">Loading protocol risk…</p>
          ) : (
            <p className="text-xs text-terminal-text-dim">
              Set a protocol <code className="text-xs">bytes32</code> to pull <code className="text-xs">getProtocolRiskScore</code> for underwriting-style screening.
            </p>
          )}
          {market ? (
            <div className="pt-2 border-t border-terminal-border/40">
              <div className="text-terminal-text-dim mb-1">Pool stress (aggregate)</div>
              <div className="font-semibold">
                Coverage / pool {bpsToPercentLabel(market.coverageToPoolBps)} · Loss ratio {bpsToPercentLabel(market.lossRatioBps)}
              </div>
              {chainParams ? (
                <p className="text-xs text-terminal-text-dim mt-1">
                  Claim filing window after incident: {Number(chainParams.claimPeriodSec) / 86400} day(s) on-chain (
                  <code className="text-xs">CLAIM_PERIOD</code>).
                </p>
              ) : null}
            </div>
          ) : null}
          <div>
            <div className="text-terminal-text-dim mb-1">Coverage lines</div>
            <div className="space-y-1 text-xs">
              <div>• Smart contract, DeFi protocol, depeg, slashing, bridge — parametric; pool is hard cap.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ClaimsList({ mode }: { mode: 'legacy' | 'zk' }) {
  const queryClient = useQueryClient()
  const { provider, address, signer, isConnected } = useWalletStore()
  const { data: chainParams } = useInsuranceChainParams()
  const [submitting, setSubmitting] = useState(false)
  const [policyId, setPolicyId] = useState('')
  const [claimAmount, setClaimAmount] = useState('')
  const [incidentHash, setIncidentHash] = useState('')
  const [evidenceHash, setEvidenceHash] = useState('')
  const proverUrl = import.meta.env.VITE_PROVER_URL as string | undefined

  const { data: claims } = useQuery<InsuranceClaim[]>({
    queryKey: ['insurance-claims', 'on-chain'],
    queryFn: async () => {
      if (!provider) return []
      try {
        const contract = getInsuranceContract(provider)
        const filter = contract.filters.ClaimSubmitted()
        const logs = (await contract.queryFilter(filter, 0, 'latest')) as EventLog[]
        const statusNames: InsuranceClaim['status'][] = ['Pending', 'Approved', 'Rejected', 'Paid']
        const out: InsuranceClaim[] = []
        const seen = new Set<number>()

        for (const log of [...logs].reverse()) {
          const rawId = log.args?.claimId ?? log.args?.[0]
          const claimId = typeof rawId === 'bigint' ? Number(rawId) : Number(rawId)
          if (!claimId || seen.has(claimId)) continue
          seen.add(claimId)
          try {
            const row = await contract.getClaim(claimId)
            const st = Number(row.status)
            out.push({
              id: claimId,
              policyId: Number(row.policyId),
              amount: row.claimAmount,
              status: statusNames[st] ?? 'Pending',
            })
          } catch {
            continue
          }
          if (out.length >= 50) break
        }
        return out
      } catch (error) {
        console.error('insurance claims query failed', error)
        return []
      }
    },
    enabled: !!provider,
  })

  const handleSubmitClaim = async () => {
    try {
      checkRateLimit('api')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit exceeded')
      return
    }

    if (!signer || !isConnected || !provider || !policyId || !claimAmount) {
      toast.error('Please connect wallet (with RPC) and fill all required fields')
      return
    }

    if (mode === 'legacy') {
      toast.error('Legacy claim submission not available. Please use ZK mode.')
      return
    }

    const amountValidation = validateAmount(claimAmount)
    if (!amountValidation.valid) {
      toast.error(amountValidation.error || 'Invalid claim amount')
      return
    }

    if (detectAttackPattern(claimAmount) || detectAttackPattern(policyId)) {
      toast.error('Invalid input detected')
      return
    }

    const incident = parseBytes32Input(incidentHash)
    const evidence = parseBytes32Input(evidenceHash)
    if (!incident || !evidence) {
      toast.error('Incident hash and evidence hash are required (each exactly 32-byte hex / bytes32)')
      return
    }

    const pidStr = policyId.trim()
    if (!/^\d+$/.test(pidStr)) {
      toast.error('Policy ID must be a positive integer')
      return
    }
    const policyIdBn = BigInt(pidStr)
    if (policyIdBn < 1n) {
      toast.error('Policy ID must be at least 1')
      return
    }

    let amountWei: bigint
    try {
      amountWei = parseEther(claimAmount.trim())
    } catch {
      toast.error('Invalid claim amount')
      return
    }
    if (amountWei <= 0n) {
      toast.error('Claim amount must be greater than zero')
      return
    }

    const readContract = getInsuranceContract(provider)
    let policyRow
    try {
      policyRow = await readContract.getPolicy(policyIdBn)
    } catch {
      toast.error('Could not load policy from chain (invalid id or RPC error)')
      return
    }

    const policyStatus = Number(policyRow.status)
    if (policyStatus !== 0) {
      toast.error('Policy is not active on-chain; claims are only accepted for active policies')
      return
    }

    const maxClaim = BigInt(policyRow.maxClaimAmount)
    if (amountWei > maxClaim) {
      toast.error(
        `Claim exceeds policy max on-chain (${formatBalance(maxClaim)} AGS). Reduce amount or verify policy terms.`
      )
      return
    }

    const nowSec = BigInt(Math.floor(Date.now() / 1000))
    const startTime = BigInt(policyRow.startTime)
    const endTime = BigInt(policyRow.endTime)
    if (nowSec < startTime) {
      toast.error('This policy’s coverage window has not started yet.')
      return
    }
    if (nowSec > endTime) {
      toast.error(
        `Coverage for this policy ended on ${formatDate(Number(endTime))}. On-chain claims for this policy are unlikely to succeed.`
      )
      return
    }

    setSubmitting(true)
    try {
      const contract = getInsuranceContract(signer)
      const incidentTime = Math.floor(Date.now() / 1000)

      toast.loading('Submitting claim...', { id: 'submit-claim' })

      let zkProof: Uint8Array
      let claimantCommitment: string
      let nullifier: string

      if (proverUrl) {
        const res = await fetch(`${proverUrl}/insurance/submit-claim/prove`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            policyId: policyIdBn.toString(),
            claimAmount: amountWei.toString(),
            incidentHash: incident,
            evidenceHash: evidence,
            incidentTime,
            recipient: address,
          }),
        })
        if (!res.ok) {
          const errText = await res.text().catch(() => '')
          throw new Error(`Proof service error (${res.status}): ${errText || res.statusText}`)
        }
        const data = (await res.json()) as {
          proof: string
          claimantCommitment?: string
          nullifier?: string
        }
        if (!data.proof) throw new Error('Proof service response missing proof')
        zkProof = hexToBytesStrict(data.proof, 256, 'ZK proof')
        if (!data.claimantCommitment || !data.nullifier) {
          throw new Error(
            'Proof service must return claimantCommitment and nullifier (bytes32 hex) alongside proof'
          )
        }
        claimantCommitment = data.claimantCommitment.startsWith('0x')
          ? data.claimantCommitment
          : `0x${data.claimantCommitment}`
        nullifier = data.nullifier.startsWith('0x') ? data.nullifier : `0x${data.nullifier}`
      } else {
        const claimantCommitmentBytes = randomBytes(32)
        const nullifierBytes = randomBytes(32)
        claimantCommitment = '0x' + Buffer.from(claimantCommitmentBytes).toString('hex')
        nullifier = '0x' + Buffer.from(nullifierBytes).toString('hex')

        toast.loading('Generating ZK proof (client-side)...', { id: 'submit-claim' })
        const { proof } = await proveInsurance({
          claimantCommitment: BigInt(claimantCommitment).toString(),
          nullifier: BigInt(nullifier).toString(),
          policyId: policyIdBn.toString(),
          incidentHash: incident,
          claimAmount: amountWei.toString(),
          incidentTime: incidentTime.toString(),
          evidenceHash: evidence,
        })
        zkProof = groth16ProofBigintsToBytes256(proof)
      }

      toast.loading('Submitting transaction...', { id: 'submit-claim' })
      const tx = await contract.submitClaim({
        policyId: policyIdBn,
        incidentHash: incident,
        claimAmount: amountWei,
        incidentTime: BigInt(incidentTime),
        evidenceHash: evidence,
        claimantCommitment,
        nullifier,
        zkProof,
      })
      toast.loading('Waiting for confirmation...', { id: 'submit-claim' })
      await waitAndParseTransaction(tx, address!, provider!)
      toast.success('Claim submitted', { id: 'submit-claim' })
      setPolicyId('')
      setClaimAmount('')
      setIncidentHash('')
      setEvidenceHash('')
      void queryClient.invalidateQueries({ queryKey: ['insurance-claims', 'on-chain'] })
      void queryClient.invalidateQueries({ queryKey: ['insurance-market-snapshot'] })
      void queryClient.invalidateQueries({ queryKey: INSURANCE_ACTIVE_POLICIES_KEY })
    } catch (error) {
      console.error('submit claim failed', error)
      toast.error(error instanceof Error ? error.message : 'Claim submission failed', { id: 'submit-claim' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <h2 className="text-xl font-semibold mb-2">Submit Claim</h2>
        {chainParams ? (
          <p className="text-xs text-terminal-text-dim mb-4">
            Contract <code className="text-xs">CLAIM_PERIOD</code> is{' '}
            {(Number(chainParams.claimPeriodSec) / 86400).toLocaleString('en-US', { maximumFractionDigits: 2 })} day(s)
            — the proof and tx must satisfy on-chain timing rules relative to your incident timestamp.
          </p>
        ) : (
          <p className="text-xs text-terminal-text-dim mb-4">Connect RPC to show on-chain claim timing constants.</p>
        )}
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void handleSubmitClaim() }}>
          <div>
            <label className="block text-sm font-medium text-terminal-text-dim mb-2">
              Policy ID
            </label>
            <input
              type="number"
              min="1"
              value={policyId}
              onChange={(e) => setPolicyId(e.target.value)}
              className="input-field w-full"
              placeholder="1"
              disabled={submitting}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-terminal-text-dim mb-2">
              Claim Amount (AGS)
            </label>
            <input
              type="number"
              step="0.001"
              min="0"
              value={claimAmount}
              onChange={(e) => setClaimAmount(e.target.value)}
              className="input-field w-full"
              placeholder="0.0"
              disabled={submitting}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-terminal-text-dim mb-2">
              Incident Hash (required)
            </label>
            <input
              type="text"
              value={incidentHash}
              onChange={(e) => setIncidentHash(e.target.value)}
              className="input-field w-full"
              placeholder="0x + 64 hex (bytes32) — commit to your incident pack off-chain"
              disabled={submitting}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-terminal-text-dim mb-2">
              Evidence Hash (required)
            </label>
            <input
              type="text"
              value={evidenceHash}
              onChange={(e) => setEvidenceHash(e.target.value)}
              className="input-field w-full"
              placeholder="0x + 64 hex (bytes32) — e.g. hash of disclosure bundle / attestations"
              disabled={submitting}
            />
          </div>
          <button 
            type="submit" 
            className="btn-primary w-full" 
            disabled={
              !isConnected ||
              submitting ||
              !policyId ||
              !claimAmount ||
              !parseBytes32Input(incidentHash) ||
              !parseBytes32Input(evidenceHash)
            }
          >
            {submitting ? 'Submitting...' : mode === 'legacy' ? 'Submit Claim (Public)' : 'Submit Claim (Private ZK)'}
          </button>
        </form>
      </div>

      {claims && claims.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Your Claims</h3>
          {claims.map((claim) => (
            <div key={claim.id} className="card">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold">Claim #{claim.id}</div>
                  <div className="text-sm text-terminal-text-dim">
                    Policy #{claim.policyId} • Amount: {formatBalance(claim.amount)} AGS
                  </div>
                </div>
                <span className={`text-xs px-2 py-1 rounded ${
                  claim.status === 'Approved' ? 'bg-green-500/20 text-green-500' :
                  claim.status === 'Pending' ? 'bg-terminal-accent/20 text-terminal-accent' :
                  'bg-terminal-muted/20 text-terminal-text-dim'
                }`}>
                  {claim.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function getInsuranceTypeEnum(type: InsuranceType): number {
  const map: Record<InsuranceType, number> = {
    SMART_CONTRACT: 0,
    DEFI_PROTOCOL: 1,
    STABLECOIN_DEPEG: 2,
    SLASHING: 3,
    BRIDGE: 4,
    HEALTH: 5,
    CROP: 6,
    BUSINESS: 7,
  }
  return map[type]
}
