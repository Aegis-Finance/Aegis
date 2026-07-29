import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { parseEther } from 'ethers'

import { useWalletStore } from '@/store/walletStore'
import { getLendingContract } from '@/utils/contracts'
import { formatBalance } from '@/utils/format'
import {
  proveLendingLiquidity,
  proveLendingTenor,
  proveLendingRepay,
  proveLendingWithdraw,
  proveLendingLiquidate,
} from '@/utils/prover'
import { poseidon2, poseidon3, poseidon4, randomFieldElement } from '@/utils/lendingPoseidon'
import { validateAmount, detectAttackPattern, checkRateLimit } from '@/utils/security'
import {
  getLoans,
  removeLoan,
  getSupplyCommitments,
} from '@/utils/commitmentStorage'
import { waitAndParseTransaction } from '@/utils/transactionHelper'
import { submitViaRelayer } from '@/utils/submitViaRelayer'
import CommitmentLocalStorageWarning from '@/components/CommitmentLocalStorageWarning'
import { CONTRACT_ADDRESSES } from '@/config/contracts'
import { isContractConfigured } from '@/utils/productReadiness'

type UserLoan = {
  loanId: string
  amount: bigint
  collateral: bigint
  interest: number
  timestamp: number
  liquidatable?: boolean
  currentDebt?: bigint
}

type PoolStats = {
  totalLiquidity: bigint
  liquidityPool: bigint
  totalBorrowed: bigint
  utilizationRate: number
  spotBorrowAprPercent: number
}

type LendingTab = 'supply' | 'borrow' | 'loans'

/** Seconds — must match on-chain allowed tenors */
const LENDING_TENOR_CHOICES = [
  { label: '30 days', seconds: 2592000n },
  { label: '90 days', seconds: 7776000n },
  { label: '365 days', seconds: 31536000n },
] as const

const lendingLive = isContractConfigured(CONTRACT_ADDRESSES.LENDING)

async function fetchPoolStats(provider: NonNullable<ReturnType<typeof useWalletStore.getState>['provider']>): Promise<PoolStats> {
  try {
    const contract = getLendingContract(provider)
    const [totalLiquidity, liquidityPool, totalBorrowed, utilizationRate] = await contract.getPoolStats()
    let spotBorrowBps = 500n
    try {
      spotBorrowBps = await contract.currentAggregateBorrowRateBps()
    } catch {
      spotBorrowBps = await contract.INTEREST_RATE().catch(() => 500n)
    }
    return {
      totalLiquidity: BigInt(totalLiquidity || 0),
      liquidityPool: BigInt(liquidityPool || 0),
      totalBorrowed: BigInt(totalBorrowed || 0),
      utilizationRate: Number(utilizationRate || 0) / 100,
      spotBorrowAprPercent: Number(spotBorrowBps || 0) / 100,
    }
  } catch (error) {
    console.error('Error fetching lending stats:', error)
    return {
      totalLiquidity: 0n,
      liquidityPool: 0n,
      totalBorrowed: 0n,
      utilizationRate: 0,
      spotBorrowAprPercent: 0,
    }
  }
}

export default function Lending() {
  const { address, isConnected, provider } = useWalletStore()
  const [activeTab, setActiveTab] = useState<LendingTab>('supply')

  const { data: poolStats } = useQuery({
    queryKey: ['lending-pool-stats'],
    queryFn: async () => {
      if (!provider) return null
      return fetchPoolStats(provider)
    },
    enabled: !!provider && lendingLive,
    refetchInterval: 30000,
  })

  if (!lendingLive) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold text-terminal-text md:text-3xl">Lending</h1>
          <p className="text-sm text-terminal-text-dim max-w-2xl leading-relaxed">
            Supply AGS to earn yield from borrowers, or post collateral to borrow against the pool — privately, with
            zero-knowledge proofs.
          </p>
        </header>
        <div className="card text-sm text-terminal-text-dim">
          Lending is not live on this network yet. You can still{' '}
          <Link to="/wallet" className="text-terminal-accent underline">
            shield AGS
          </Link>{' '}
          or explore{' '}
          <Link to="/liquidity" className="text-terminal-accent underline">
            liquidity pools
          </Link>{' '}
          in the meantime.
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-terminal-text md:text-3xl">Lending</h1>
        <p className="text-sm text-terminal-text-dim max-w-2xl leading-relaxed">
          Deposit AGS to earn when others borrow, or lock collateral to take a fixed-term loan. Positions are private —
          proofs settle on-chain without exposing your full balance history.
        </p>
        <p className="text-xs text-terminal-text-dim">
          Rates move with pool utilization. Undercollateralized loans can be liquidated — borrow responsibly.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <StepCard
          step="1"
          title="Supply & earn"
          body="Deposit AGS into the lending pool. You earn a share of borrow interest as utilization rises."
        />
        <StepCard
          step="2"
          title="Borrow with collateral"
          body="Post at least 150% collateral, choose a term, and receive a private loan from available liquidity."
        />
        <StepCard
          step="3"
          title="Repay or manage"
          body="Pay back before maturity to reclaim collateral. Track open loans and repay from the My loans tab."
        />
      </div>

      <PoolStatsStrip poolStats={poolStats} />

      <CommitmentLocalStorageWarning walletAddress={address} variant="lending" />

      <div className="flex rounded-lg border border-terminal-border/40 p-1 bg-terminal-bg/40">
        {(
          [
            { id: 'supply' as const, label: 'Supply & earn' },
            { id: 'borrow' as const, label: 'Borrow' },
            { id: 'loans' as const, label: 'My loans' },
          ] as const
        ).map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={`flex-1 rounded-md py-2.5 text-sm font-medium ${
              activeTab === id ? 'bg-terminal-surface text-terminal-text shadow-sm' : 'text-terminal-text-dim'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'supply' && <SupplyLiquidity poolStats={poolStats} isConnected={isConnected} />}
      {activeTab === 'borrow' && <BorrowForm poolStats={poolStats} isConnected={isConnected} />}
      {activeTab === 'loans' && (
        <MyLoans isConnected={isConnected} onGoBorrow={() => setActiveTab('borrow')} />
      )}
    </div>
  )
}

function PoolStatsStrip({ poolStats }: { poolStats: PoolStats | null | undefined }) {
  if (!poolStats) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-lg border border-terminal-border/40 bg-terminal-bg/50 px-4 py-3 animate-pulse">
            <div className="h-3 w-16 bg-terminal-border/40 rounded mb-2" />
            <div className="h-5 w-24 bg-terminal-border/30 rounded" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard label="Pool size" value={`${formatBalance(poolStats.totalLiquidity)} AGS`} />
      <StatCard label="Available to borrow" value={`${formatBalance(poolStats.liquidityPool)} AGS`} accent />
      <StatCard label="Outstanding borrows" value={`${formatBalance(poolStats.totalBorrowed)} AGS`} />
      <StatCard
        label="Utilization"
        value={`${poolStats.utilizationRate.toFixed(1)}%`}
        hint={`Borrow APR ~${poolStats.spotBorrowAprPercent.toFixed(2)}% at current utilization`}
      />
    </div>
  )
}

function SupplyLiquidity({
  poolStats,
  isConnected,
}: {
  poolStats: PoolStats | null | undefined
  isConnected: boolean
}) {
  const { provider, signer, address } = useWalletStore()
  const [amount, setAmount] = useState('')
  const [supplying, setSupplying] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const proverUrl = import.meta.env.VITE_PROVER_URL as string | undefined

  const { data: userSupply } = useQuery({
    queryKey: ['user-supply', address],
    queryFn: async () => {
      if (!provider || !address) return { supplied: 0n, shares: 0n }
      try {
        const supplyCommitments = getSupplyCommitments(address)
        const contract = getLendingContract(provider)
        const [totalLiquidity, liquidityPool] = await contract.getPoolStats()

        let totalSupplied = 0n
        let totalShares = 0n

        for (const commitment of supplyCommitments) {
          const commitmentHex = commitment.commitment.startsWith('0x')
            ? commitment.commitment
            : `0x${commitment.commitment}`

          try {
            const shares = await contract.liquidityShares(commitmentHex)
            if (shares > 0n) {
              totalShares += BigInt(shares.toString())
              if (totalLiquidity > 0n) {
                const estimatedAmount =
                  (BigInt(shares.toString()) * BigInt(liquidityPool.toString())) / BigInt(totalLiquidity.toString())
                totalSupplied += estimatedAmount
              }
            }
          } catch {
            // Commitment may not exist on-chain yet
          }
        }

        return { supplied: totalSupplied, shares: totalShares }
      } catch (error) {
        console.error('Failed to query user supply:', error)
        return { supplied: 0n, shares: 0n }
      }
    },
    enabled: !!address && !!provider,
    refetchInterval: 30000,
  })

  const handleSupply = async () => {
    try {
      checkRateLimit('api')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit exceeded')
      return
    }

    if (!signer || !amount || !isConnected) {
      toast.error('Connect your wallet and enter an amount')
      return
    }

    const amountValidation = validateAmount(amount)
    if (!amountValidation.valid) {
      toast.error(amountValidation.error || 'Invalid amount')
      return
    }

    if (detectAttackPattern(amount)) {
      toast.error('Invalid input detected')
      return
    }

    setSupplying(true)
    try {
      const contract = getLendingContract(signer)
      const amountWei = parseEther(amount)

      toast.loading('Building proof…', { id: 'supply' })

      let proof: bigint[]
      let publicInputs: bigint[]

      if (proverUrl) {
        const res = await fetch(`${proverUrl}/lending/provide-liquidity/prove`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: amountWei.toString(),
            recipient: address,
          }),
        })
        if (!res.ok) throw new Error('Proof service error')
        const data = await res.json()
        proof = (data.proof ?? []).map((x: string) => BigInt(x))
        publicInputs = (data.publicInputs ?? []).map((x: string) => BigInt(x))
      } else {
        const secret = randomFieldElement()
        const nullifier = randomFieldElement()
        const inputNullifier = await poseidon2(secret, nullifier)
        const outputCommitment = await poseidon3(secret, amountWei, nullifier)

        const result = await proveLendingLiquidity({
          nullifierHash: inputNullifier.toString(),
          outputCommitment: outputCommitment.toString(),
          amount: amountWei.toString(),
          secret: secret.toString(),
          nullifier: nullifier.toString(),
        })
        proof = result.proof
        publicInputs = result.publicInputs
      }

      toast.loading('Confirm in wallet…', { id: 'supply' })
      const tx = await submitViaRelayer({
        signer: signer!,
        provider: provider!,
        walletAddress: address!,
        target: contract,
        method: 'provideLiquidity',
        methodArgs: [proof, publicInputs],
        fallbackTx: () => contract.provideLiquidity(proof, publicInputs),
      })
      await waitAndParseTransaction(tx, address!, provider!)
      toast.success('Deposited to lending pool', { id: 'supply' })
      setAmount('')
    } catch (error) {
      console.error('supply failed', error)
      toast.error(error instanceof Error ? error.message : 'Deposit failed', { id: 'supply' })
    } finally {
      setSupplying(false)
    }
  }

  const handleWithdraw = async () => {
    try {
      checkRateLimit('api')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit exceeded')
      return
    }

    if (!signer || !withdrawAmount || !isConnected) {
      toast.error('Connect your wallet and enter an amount')
      return
    }

    const amountValidation = validateAmount(withdrawAmount)
    if (!amountValidation.valid) {
      toast.error(amountValidation.error || 'Invalid amount')
      return
    }

    setWithdrawing(true)
    try {
      const contract = getLendingContract(signer)
      const amountWei = parseEther(withdrawAmount)

      toast.loading('Building proof…', { id: 'withdraw' })

      let proof: bigint[]
      let publicInputs: bigint[]

      if (proverUrl) {
        const res = await fetch(`${proverUrl}/lending/withdraw-liquidity/prove`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: amountWei.toString(),
            recipient: address,
          }),
        })
        if (!res.ok) throw new Error('Proof service error')
        const data = await res.json()
        proof = (data.proof ?? []).map((x: string) => BigInt(x))
        publicInputs = (data.publicInputs ?? []).map((x: string) => BigInt(x))
      } else {
        const secret = randomFieldElement()
        const nullifier = randomFieldElement()
        const liquidityNullifier = await poseidon2(secret, nullifier)
        const outputCommitment = await poseidon4(secret, amountWei, amountWei, nullifier)

        const result = await proveLendingWithdraw({
          liquidityNullifier: liquidityNullifier.toString(),
          outputCommitment: outputCommitment.toString(),
          shares: amountWei.toString(),
          amount: amountWei.toString(),
          secret: secret.toString(),
          nullifier: nullifier.toString(),
        })
        proof = result.proof
        publicInputs = result.publicInputs
      }

      toast.loading('Confirm in wallet…', { id: 'withdraw' })
      const tx = await contract.withdrawLiquidity(proof, publicInputs)
      await waitAndParseTransaction(tx, address!, provider!)
      toast.success('Withdrawn from pool', { id: 'withdraw' })
      setWithdrawAmount('')
    } catch (error) {
      console.error('withdraw failed', error)
      toast.error(error instanceof Error ? error.message : 'Withdrawal failed', { id: 'withdraw' })
    } finally {
      setWithdrawing(false)
    }
  }

  if (!isConnected) {
    return (
      <div className="card text-center py-10 space-y-2">
        <p className="text-terminal-text font-medium">Connect your wallet</p>
        <p className="text-sm text-terminal-text-dim">Deposit AGS to earn yield or withdraw your supply position.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard
          label="Your deposit"
          value={`${formatBalance(userSupply?.supplied ?? 0n)} AGS`}
          hint="Estimated from your pool shares"
        />
        <StatCard
          label="Current earn rate"
          value={poolStats ? `~${poolStats.spotBorrowAprPercent.toFixed(2)}% APR` : '—'}
          hint="Tracks pool borrow demand"
          accent
        />
      </div>

      <div className="card border border-terminal-border/60 bg-terminal-surface/80 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-terminal-text">Deposit to pool</h2>
          <p className="text-xs text-terminal-text-dim mt-1">Add AGS liquidity. Withdraw anytime while the pool has capacity.</p>
        </div>
        <Field label="Amount (AGS)" value={amount} onChange={setAmount} placeholder="0.0" />
        <button
          type="button"
          className="btn-primary w-full py-3"
          disabled={supplying || !amount || parseFloat(amount) <= 0}
          onClick={() => void handleSupply()}
        >
          {supplying ? 'Confirm in wallet…' : 'Deposit to pool'}
        </button>
      </div>

      <div className="card border border-terminal-border/50 bg-terminal-bg/40 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-terminal-text">Withdraw</h2>
          <p className="text-xs text-terminal-text-dim mt-1">Pull AGS back from the pool using your supply commitment.</p>
        </div>
        <Field label="Amount (AGS)" value={withdrawAmount} onChange={setWithdrawAmount} placeholder="0.0" />
        <button
          type="button"
          className="btn-secondary w-full"
          disabled={withdrawing || !withdrawAmount || parseFloat(withdrawAmount) <= 0}
          onClick={() => void handleWithdraw()}
        >
          {withdrawing ? 'Confirm in wallet…' : 'Withdraw from pool'}
        </button>
      </div>
    </div>
  )
}

function BorrowForm({
  poolStats,
  isConnected,
}: {
  poolStats: PoolStats | null | undefined
  isConnected: boolean
}) {
  const { provider, signer, address } = useWalletStore()
  const [collateral, setCollateral] = useState('')
  const [loanAmount, setLoanAmount] = useState('')
  const [tenorSeconds, setTenorSeconds] = useState<string>('31536000')
  const [borrowing, setBorrowing] = useState(false)
  const proverUrl = import.meta.env.VITE_PROVER_URL as string | undefined

  const collateralRatio =
    collateral && loanAmount && parseFloat(loanAmount) > 0
      ? ((parseFloat(collateral) / parseFloat(loanAmount)) * 100).toFixed(0)
      : null
  const ratioOk =
    collateral && loanAmount
      ? parseFloat(collateral) / parseFloat(loanAmount) >= 1.5
      : null

  const handleBorrow = async () => {
    try {
      checkRateLimit('api')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit exceeded')
      return
    }

    if (!signer || !collateral || !loanAmount || !isConnected) {
      toast.error('Connect your wallet and fill in both amounts')
      return
    }

    const collateralValidation = validateAmount(collateral)
    if (!collateralValidation.valid) {
      toast.error(collateralValidation.error || 'Invalid collateral amount')
      return
    }

    const loanValidation = validateAmount(loanAmount)
    if (!loanValidation.valid) {
      toast.error(loanValidation.error || 'Invalid loan amount')
      return
    }

    if (detectAttackPattern(collateral) || detectAttackPattern(loanAmount)) {
      toast.error('Invalid input detected')
      return
    }

    const collateralWei = parseEther(collateral)
    const loanWei = parseEther(loanAmount)

    if (collateralWei * 100n < loanWei * 150n) {
      toast.error('Collateral must be at least 150% of the loan amount.')
      return
    }

    setBorrowing(true)
    try {
      const contract = getLendingContract(signer)

      toast.loading('Building proof…', { id: 'borrow' })

      let proof: bigint[]
      let publicInputs: bigint[]

      if (proverUrl) {
        const res = await fetch(`${proverUrl}/lending/borrow/prove`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            collateralAmount: collateralWei.toString(),
            loanAmount: loanWei.toString(),
            tenorSeconds,
            recipient: address,
          }),
        })
        if (!res.ok) throw new Error('Proof service error')
        const data = await res.json()
        proof = (data.proof ?? []).map((x: string) => BigInt(x))
        publicInputs = (data.publicInputs ?? []).map((x: string) => BigInt(x))
      } else {
        const secret = randomFieldElement()
        const nullifier = randomFieldElement()
        const tenor = BigInt(tenorSeconds)
        const nullifierHash = await poseidon2(secret, nullifier)
        const collateralCommitment = await poseidon3(secret, collateralWei, nullifier)
        const loanCommitment = await poseidon4(secret, loanWei, nullifier, tenor)

        const result = await proveLendingTenor({
          nullifierHash: nullifierHash.toString(),
          collateralCommitment: collateralCommitment.toString(),
          loanCommitment: loanCommitment.toString(),
          collateralAmount: collateralWei.toString(),
          loanAmount: loanWei.toString(),
          tenorSeconds: tenor.toString(),
          secret: secret.toString(),
          nullifier: nullifier.toString(),
        })
        proof = result.proof
        publicInputs = result.publicInputs
      }

      toast.loading('Confirm in wallet…', { id: 'borrow' })
      const tx = await contract.borrowWithCollateral(proof, publicInputs)
      await waitAndParseTransaction(tx, address!, provider!)
      toast.success('Loan opened', { id: 'borrow' })
      setCollateral('')
      setLoanAmount('')
    } catch (error) {
      console.error('borrow failed', error)
      toast.error(error instanceof Error ? error.message : 'Borrow failed', { id: 'borrow' })
    } finally {
      setBorrowing(false)
    }
  }

  if (!isConnected) {
    return (
      <div className="card text-center py-10 space-y-2">
        <p className="text-terminal-text font-medium">Connect your wallet</p>
        <p className="text-sm text-terminal-text-dim">Post collateral and borrow AGS from the pool.</p>
      </div>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="card border border-terminal-border/60 bg-terminal-surface/80 space-y-4 lg:col-span-3">
        <div>
          <h2 className="text-lg font-semibold text-terminal-text">Open a loan</h2>
          <p className="text-xs text-terminal-text-dim mt-1">
            Minimum 150% collateral. Interest accrues until you repay or the term ends.
          </p>
        </div>
        <Field label="Collateral (AGS)" value={collateral} onChange={setCollateral} placeholder="0.0" />
        <Field label="Borrow amount (AGS)" value={loanAmount} onChange={setLoanAmount} placeholder="0.0" />
        <label className="block space-y-1.5 text-sm min-w-0">
          <span className="text-xs text-terminal-text-dim">Loan term</span>
          <select
            className="input-field w-full min-w-0"
            value={tenorSeconds}
            onChange={(e) => setTenorSeconds(e.target.value)}
            disabled={borrowing}
          >
            {LENDING_TENOR_CHOICES.map((t) => (
              <option key={t.seconds.toString()} value={t.seconds.toString()}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn-primary w-full py-3"
          disabled={borrowing || !collateral || !loanAmount}
          onClick={() => void handleBorrow()}
        >
          {borrowing ? 'Confirm in wallet…' : 'Open loan'}
        </button>
      </div>

      <aside className="lg:col-span-2 space-y-3">
        <div className="card border border-terminal-border/40 bg-terminal-bg/50 space-y-3 text-sm">
          <h3 className="font-semibold text-terminal-text">Loan summary</h3>
          <div className="flex justify-between">
            <span className="text-terminal-text-dim">Required collateral</span>
            <span className="font-medium">150% minimum</span>
          </div>
          <div className="flex justify-between">
            <span className="text-terminal-text-dim">Borrow APR (pool)</span>
            <span className="font-medium text-terminal-accent">
              {poolStats ? `~${poolStats.spotBorrowAprPercent.toFixed(2)}%` : '—'}
            </span>
          </div>
          {collateralRatio ? (
            <div
              className={`rounded-lg px-3 py-2 text-sm ${
                ratioOk
                  ? 'border border-emerald-500/30 bg-emerald-500/10'
                  : 'border border-amber-500/30 bg-amber-500/10'
              }`}
            >
              <div className="text-xs text-terminal-text-dim">Your collateral ratio</div>
              <div className="font-semibold text-terminal-text">{collateralRatio}%</div>
              {!ratioOk && (
                <p className="text-xs text-terminal-text-dim mt-1">Add more collateral or reduce the loan amount.</p>
              )}
            </div>
          ) : null}
        </div>
        <p className="text-xs text-terminal-text-dim px-1">
          If collateral falls too low or the term expires unpaid, the loan may be liquidated by third parties.
        </p>
      </aside>
    </div>
  )
}

function MyLoans({ isConnected, onGoBorrow }: { isConnected: boolean; onGoBorrow: () => void }) {
  const { provider, address, signer } = useWalletStore()
  const [repaying, setRepaying] = useState<string | null>(null)
  const [liquidating, setLiquidating] = useState<string | null>(null)
  const [repayAmount, setRepayAmount] = useState('')
  const proverUrl = import.meta.env.VITE_PROVER_URL as string | undefined

  const { data: loans } = useQuery<UserLoan[]>({
    queryKey: ['user-loans', address],
    queryFn: async () => {
      if (!provider || !address) return []
      try {
        const storedLoans = getLoans(address)
        const contract = getLendingContract(provider)
        const userLoans: UserLoan[] = []

        for (const storedLoan of storedLoans) {
          try {
            const loanInfo = await contract.getLoanInfo(storedLoan.loanId)
            if (loanInfo && loanInfo.active) {
              const currentDebt = await contract.calculateCurrentDebt(storedLoan.loanId)
              const principal = loanInfo.principal
              const interest = currentDebt > principal ? currentDebt - principal : 0n
              const interestPercent =
                principal > 0n ? Number((BigInt(interest) * 10000n) / principal) / 100 : 0
              let liquidatable = false
              try {
                liquidatable = await contract.isLiquidatable(storedLoan.loanId)
              } catch {
                liquidatable = false
              }

              userLoans.push({
                loanId: storedLoan.loanId,
                amount: loanInfo.principal,
                collateral: loanInfo.collateralAmount,
                interest: interestPercent,
                timestamp: Number(loanInfo.timestamp),
                liquidatable,
                currentDebt,
              })
            }
          } catch (error) {
            console.error(`Failed to query loan ${storedLoan.loanId}:`, error)
            userLoans.push({
              loanId: storedLoan.loanId,
              amount: BigInt(storedLoan.principal),
              collateral: BigInt(storedLoan.collateralAmount),
              interest: 0,
              timestamp: storedLoan.timestamp,
            })
          }
        }

        return userLoans
      } catch (error) {
        console.error('Failed to query loans:', error)
        return []
      }
    },
    enabled: !!provider && !!address,
    refetchInterval: 30000,
  })

  const handleRepay = async (loanId: string) => {
    if (!address || !provider) {
      toast.error('Connect your wallet')
      return
    }

    try {
      checkRateLimit('api')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit exceeded')
      return
    }

    if (!signer || !isConnected || !repayAmount) {
      toast.error('Enter a repayment amount')
      return
    }

    const amountValidation = validateAmount(repayAmount)
    if (!amountValidation.valid) {
      toast.error(amountValidation.error || 'Invalid amount')
      return
    }

    setRepaying(loanId)
    try {
      const contract = getLendingContract(signer)
      const amountWei = parseEther(repayAmount)

      toast.loading('Building proof…', { id: 'repay' })

      let proof: bigint[]
      let publicInputs: bigint[]

      if (proverUrl) {
        const res = await fetch(`${proverUrl}/lending/repay/prove`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            loanId,
            repaymentAmount: amountWei.toString(),
            recipient: address,
          }),
        })
        if (!res.ok) throw new Error('Proof service error')
        const data = await res.json()
        proof = (data.proof ?? []).map((x: string) => BigInt(x))
        publicInputs = (data.publicInputs ?? []).map((x: string) => BigInt(x))
      } else {
        const secret = randomFieldElement()
        const nullifierLoan = randomFieldElement()
        const nullifierRepay = randomFieldElement()
        const loanNullifier = await poseidon2(secret, nullifierLoan)
        const repaymentNullifier = await poseidon2(secret, nullifierRepay)
        const collateralOutputCommitment = await poseidon3(secret, amountWei, nullifierRepay)
        const loanIdField = BigInt(loanId).toString()

        const result = await proveLendingRepay({
          loanNullifier: loanNullifier.toString(),
          repaymentNullifier: repaymentNullifier.toString(),
          collateralOutputCommitment: collateralOutputCommitment.toString(),
          loanId: loanIdField,
          repaymentAmount: amountWei.toString(),
          secret: secret.toString(),
          nullifierLoan: nullifierLoan.toString(),
          nullifierRepay: nullifierRepay.toString(),
        })
        proof = result.proof
        publicInputs = result.publicInputs
      }

      toast.loading('Confirm in wallet…', { id: 'repay' })
      const tx = await submitViaRelayer({
        signer: signer!,
        provider: provider!,
        walletAddress: address!,
        target: contract,
        method: 'repayLoan',
        methodArgs: [proof, publicInputs],
        fallbackTx: () => contract.repayLoan(proof, publicInputs),
      })
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Repayment submitted', { id: 'repay' })
      setRepayAmount('')

      if (address) {
        removeLoan(address, loanId)
      }
    } catch (error) {
      console.error('repay failed', error)
      toast.error(error instanceof Error ? error.message : 'Repayment failed', { id: 'repay' })
    } finally {
      setRepaying(null)
    }
  }

  const handleLiquidate = async (loan: UserLoan) => {
    if (!address || !provider) {
      toast.error('Connect your wallet')
      return
    }

    try {
      checkRateLimit('api')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit exceeded')
      return
    }

    if (!signer || !isConnected) {
      toast.error('Connect your wallet')
      return
    }

    if (!loan.liquidatable || loan.currentDebt === undefined) {
      toast.error('This loan cannot be liquidated right now')
      return
    }

    setLiquidating(loan.loanId)
    try {
      const contract = getLendingContract(signer)
      const can = await contract.isLiquidatable(loan.loanId)
      if (!can) {
        toast.error('Loan is no longer liquidatable', { id: 'liq' })
        return
      }

      const currentDebt = await contract.calculateCurrentDebt(loan.loanId)
      const loanInfo = await contract.getLoanInfo(loan.loanId)
      const collateral = loanInfo.collateralAmount
      const penaltyBps = 110n
      const maxLiquidation = (collateral * 100n) / penaltyBps
      let liquidationWei = currentDebt <= maxLiquidation ? currentDebt : maxLiquidation
      if (liquidationWei === 0n) {
        toast.error('Computed liquidation amount is zero', { id: 'liq' })
        return
      }

      toast.loading('Building proof…', { id: 'liq' })

      let proof: bigint[]
      let publicInputs: bigint[]

      if (proverUrl) {
        const res = await fetch(`${proverUrl}/lending/liquidate/prove`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            loanId: loan.loanId,
            liquidationAmount: liquidationWei.toString(),
            liquidator: address,
          }),
        })
        if (!res.ok) throw new Error('Proof service error')
        const data = await res.json()
        proof = (data.proof ?? []).map((x: string) => BigInt(x))
        publicInputs = (data.publicInputs ?? []).map((x: string) => BigInt(x))
      } else {
        const secret = randomFieldElement()
        const nullifier = randomFieldElement()
        const liquidatorNullifier = await poseidon2(secret, nullifier)
        const liquidatorCommitment = await poseidon3(secret, liquidationWei, nullifier)
        const loanIdField = BigInt(loan.loanId).toString()

        const result = await proveLendingLiquidate({
          liquidatorNullifier: liquidatorNullifier.toString(),
          liquidatorCommitment: liquidatorCommitment.toString(),
          loanId: loanIdField,
          liquidationAmount: liquidationWei.toString(),
          secret: secret.toString(),
          nullifier: nullifier.toString(),
        })
        proof = result.proof
        publicInputs = result.publicInputs
      }

      toast.loading('Confirm in wallet…', { id: 'liq' })
      const tx = await contract.liquidateLoan(proof, publicInputs)
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Loan liquidated', { id: 'liq' })

      if (address) {
        removeLoan(address, loan.loanId)
      }
    } catch (error) {
      console.error('liquidate failed', error)
      toast.error(error instanceof Error ? error.message : 'Liquidation failed', { id: 'liq' })
    } finally {
      setLiquidating(null)
    }
  }

  if (!isConnected) {
    return (
      <div className="card text-center py-10 space-y-2">
        <p className="text-terminal-text font-medium">Connect your wallet</p>
        <p className="text-sm text-terminal-text-dim">View and repay loans tracked for this browser.</p>
      </div>
    )
  }

  if (!loans || loans.length === 0) {
    return (
      <div className="card text-center py-10 space-y-3">
        <p className="text-terminal-text font-medium">No open loans</p>
        <p className="text-sm text-terminal-text-dim max-w-sm mx-auto">
          Loans opened from this browser appear here. Open one from the Borrow tab to get started.
        </p>
        <button type="button" className="btn-secondary text-sm mx-auto" onClick={onGoBorrow}>
          Go to Borrow
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {loans.map((loan) => (
        <div key={loan.loanId} className="card border border-terminal-border/60 bg-terminal-surface/80 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Borrowed" value={`${formatBalance(loan.amount)} AGS`} />
            <StatCard label="Collateral locked" value={`${formatBalance(loan.collateral)} AGS`} />
            <StatCard
              label="Accrued interest"
              value={`${loan.interest.toFixed(2)}%`}
              hint={
                loan.currentDebt != null
                  ? `Total owed ~${formatBalance(loan.currentDebt)} AGS`
                  : undefined
              }
              accent
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <div className="flex-1 min-w-0">
              <Field
                label="Repayment amount (AGS)"
                value={repayAmount}
                onChange={setRepayAmount}
                placeholder="0.0"
              />
            </div>
            <button
              type="button"
              className="btn-primary shrink-0 px-6 py-2.5 sm:mb-0"
              onClick={() => void handleRepay(loan.loanId)}
              disabled={repaying === loan.loanId || !repayAmount || parseFloat(repayAmount) <= 0}
            >
              {repaying === loan.loanId ? 'Confirm in wallet…' : 'Repay loan'}
            </button>
          </div>

          {loan.liquidatable && (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-terminal-border/40 pt-4">
              <p className="text-xs text-terminal-text-dim max-w-xl">
                This loan is undercollateralized or past maturity. Anyone can close it and receive a liquidation reward
                from the collateral.
              </p>
              <button
                type="button"
                className="btn-secondary whitespace-nowrap shrink-0 border-terminal-warning/40"
                onClick={() => void handleLiquidate(loan)}
                disabled={liquidating === loan.loanId}
              >
                {liquidating === loan.loanId ? 'Confirm in wallet…' : 'Liquidate loan'}
              </button>
            </div>
          )}
        </div>
      ))}
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

function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string
  value: string
  hint?: string
  accent?: boolean
}) {
  return (
    <div className="rounded-lg border border-terminal-border/40 bg-terminal-bg/50 px-4 py-3">
      <div className="text-[11px] text-terminal-text-dim uppercase tracking-wide">{label}</div>
      <div
        className={`text-base font-semibold mt-1 tabular-nums ${
          accent ? 'text-terminal-accent' : 'text-terminal-text'
        }`}
      >
        {value}
      </div>
      {hint ? <div className="text-[10px] text-terminal-text-dim mt-1">{hint}</div> : null}
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
      <span className="text-xs text-terminal-text-dim">{label}</span>
      <input
        className="input-field w-full min-w-0"
        type="number"
        min="0"
        step="any"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}
