import { useState } from 'react'
import toast from 'react-hot-toast'
import { parseUnits } from 'ethers'

import { useWalletStore } from '@/store/walletStore'
import { getDerivativesContract } from '@/utils/contracts'
import {
  DERIVATIVE_TYPE,
  getDefaultUnderlyingAssetId,
  type DerivativeTypeId,
} from '@/utils/derivativePricing'
import { proveDerivative } from '@/utils/prover'
import { buildDerivativeCreateWitness, packDerivativeProofBytes } from '@/utils/derivativeWitness'
import { groth16ProofBigintsToBytes256 } from '@/utils/proofBytes'
import { checkRateLimit } from '@/utils/security'
import { waitAndParseTransaction } from '@/utils/transactionHelper'
import { parseBytes32Field, proveViaService, proverServiceUrl, randomBytes32Hex } from '@/utils/zkHelpers'

type Tab = 'create' | 'exercise' | 'settle'

const TAB_META: Record<Tab, { label: string; summary: string }> = {
  create: {
    label: 'Open option',
    summary: 'Both parties agree off-chain, then lock collateral in a new shielded contract.',
  },
  exercise: {
    label: 'Exercise',
    summary: 'Holder exercises an in-the-money option before expiry and receives the payoff.',
  },
  settle: {
    label: 'Settle expired',
    summary: 'After expiry, finalize contracts that were never exercised.',
  },
}

export default function DerivativesTradePanel({ derivativesAddress }: { derivativesAddress: string }) {
  const [tab, setTab] = useState<Tab>('create')
  const { signer, address, provider } = useWalletStore()

  return (
    <section className="card space-y-5 border border-terminal-border/60 bg-terminal-surface/80 overflow-hidden">
      <div>
        <h2 className="text-lg font-semibold text-terminal-text">On-chain actions</h2>
        <p className="text-sm text-terminal-text-dim mt-1">{TAB_META[tab].summary}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(Object.keys(TAB_META) as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
              tab === t
                ? 'border-terminal-accent bg-terminal-accent/10 text-terminal-accent font-medium'
                : 'border-terminal-border/50 text-terminal-text-dim hover:text-terminal-text'
            }`}
          >
            {TAB_META[t].label}
          </button>
        ))}
      </div>

      {tab === 'create' && (
        <CreateContractForm derivativesAddress={derivativesAddress} signer={signer} address={address} provider={provider} />
      )}
      {tab === 'exercise' && (
        <ExerciseForm derivativesAddress={derivativesAddress} signer={signer} address={address} provider={provider} />
      )}
      {tab === 'settle' && (
        <SettleForm derivativesAddress={derivativesAddress} signer={signer} address={address} provider={provider} />
      )}
    </section>
  )
}

function CreateContractForm({
  derivativesAddress: _derivativesAddress,
  signer,
  address,
  provider,
}: {
  derivativesAddress: string
  signer: ReturnType<typeof useWalletStore.getState>['signer']
  address: string | null
  provider: ReturnType<typeof useWalletStore.getState>['provider']
}) {
  const [derivativeType, setDerivativeType] = useState<DerivativeTypeId>(DERIVATIVE_TYPE.CALL_OPTION)
  const [strike, setStrike] = useState('1.0')
  const [premium, setPremium] = useState('')
  const [notional, setNotional] = useState('100')
  const [expiryDays, setExpiryDays] = useState('30')
  const [buyerCommitment, setBuyerCommitment] = useState('')
  const [sellerCommitment, setSellerCommitment] = useState('')
  const [showCommitments, setShowCommitments] = useState(false)
  const [busy, setBusy] = useState(false)

  const handleCreate = async () => {
    try {
      checkRateLimit('critical')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit')
      return
    }
    if (!signer || !address || !provider) {
      toast.error('Connect your wallet first.')
      return
    }
    const contract = getDerivativesContract(signer)
    if (!contract) {
      toast.error('Options contract is not configured.')
      return
    }

    let strikeWei: bigint
    let premiumWei: bigint
    let notionalWei: bigint
    try {
      strikeWei = parseUnits(strike, 18)
      premiumWei = parseUnits(premium || '0', 18)
      notionalWei = parseUnits(notional, 18)
    } catch {
      toast.error('Check your numbers — strike, premium, and size must be valid.')
      return
    }
    if (notionalWei <= 0n) {
      toast.error('Size must be greater than zero.')
      return
    }

    const days = Number(expiryDays)
    const expiryTime = BigInt(Math.floor(Date.now() / 1000) + (Number.isFinite(days) && days > 0 ? days : 30) * 86400)
    const requestTimestamp = BigInt(Math.floor(Date.now() / 1000))
    const underlyingAsset = getDefaultUnderlyingAssetId()

    setBusy(true)
    try {
      toast.loading('Generating privacy proof…', { id: 'deriv-create' })
      const witness = await buildDerivativeCreateWitness({
        derivativeType,
        strikePrice: strikeWei,
        expiryTime,
        notionalAmount: notionalWei,
        premium: premiumWei,
      })
      const buyer = witness.contractCommitment
      const seller = parseBytes32Field(sellerCommitment) ?? randomBytes32Hex()

      let zkProofBytes: Uint8Array
      const proverUrl = proverServiceUrl()
      if (proverUrl) {
        const result = await proveViaService('/derivatives/create/prove', witness.input)
        const pubs =
          result.publicInputs.length === 6 ? result.publicInputs : witness.publicInputs
        zkProofBytes = packDerivativeProofBytes(result.proof, pubs)
      } else {
        const { proof, publicInputs } = await proveDerivative(witness.input)
        const pubs = publicInputs.length === 6 ? publicInputs : witness.publicInputs
        zkProofBytes = packDerivativeProofBytes(proof, pubs)
      }

      toast.loading('Confirm in wallet…', { id: 'deriv-create' })
      const tx = await contract.createContract({
        derivativeType,
        optionStyle: 0,
        underlyingAsset,
        strikePrice: strikeWei,
        premium: premiumWei,
        notionalAmount: notionalWei,
        expiryTime,
        requestTimestamp,
        buyerCommitment: buyer,
        sellerCommitment: seller,
        zkProof: zkProofBytes,
      })
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Option opened on Sonic.', { id: 'deriv-create' })
      setPremium('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not open option.', { id: 'deriv-create' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setDerivativeType(DERIVATIVE_TYPE.CALL_OPTION)}
          className={`flex-1 rounded-lg border py-2 text-sm ${
            derivativeType === DERIVATIVE_TYPE.CALL_OPTION
              ? 'border-terminal-accent bg-terminal-accent/10 text-terminal-accent'
              : 'border-terminal-border/50 text-terminal-text-dim'
          }`}
          disabled={busy}
        >
          Call
        </button>
        <button
          type="button"
          onClick={() => setDerivativeType(DERIVATIVE_TYPE.PUT_OPTION)}
          className={`flex-1 rounded-lg border py-2 text-sm ${
            derivativeType === DERIVATIVE_TYPE.PUT_OPTION
              ? 'border-terminal-accent bg-terminal-accent/10 text-terminal-accent'
              : 'border-terminal-border/50 text-terminal-text-dim'
          }`}
          disabled={busy}
        >
          Put
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Strike (AGS)" value={strike} onChange={setStrike} disabled={busy} />
        <Field label="Premium (AGS)" value={premium} onChange={setPremium} disabled={busy} />
        <Field label="Size / notional (AGS)" value={notional} onChange={setNotional} disabled={busy} />
        <Field label="Days to expiry" value={expiryDays} onChange={setExpiryDays} disabled={busy} />
      </div>

      <button
        type="button"
        onClick={() => setShowCommitments((v) => !v)}
        className="text-xs text-terminal-accent hover:underline"
      >
        {showCommitments ? 'Hide' : 'Show'} shielded commitments (optional)
      </button>

      {showCommitments ? (
        <div className="grid gap-3 sm:grid-cols-2 rounded-lg border border-terminal-border/30 bg-terminal-bg/40 p-3">
          <Field
            label="Buyer commitment"
            value={buyerCommitment}
            onChange={setBuyerCommitment}
            disabled={busy}
            mono
            placeholder="Auto-generated if empty"
          />
          <Field
            label="Seller commitment"
            value={sellerCommitment}
            onChange={setSellerCommitment}
            disabled={busy}
            mono
            placeholder="Auto-generated if empty"
          />
        </div>
      ) : null}

      <button type="button" className="btn-primary w-full py-3" disabled={busy || !address} onClick={() => void handleCreate()}>
        {busy ? 'Confirm in wallet…' : !address ? 'Connect wallet' : 'Open option'}
      </button>
    </div>
  )
}

function ExerciseForm({
  signer,
  address,
  provider,
}: {
  derivativesAddress: string
  signer: ReturnType<typeof useWalletStore.getState>['signer']
  address: string | null
  provider: ReturnType<typeof useWalletStore.getState>['provider']
}) {
  const [contractId, setContractId] = useState('')
  const [exerciseCommitment, setExerciseCommitment] = useState('')
  const [nullifier, setNullifier] = useState('')
  const [busy, setBusy] = useState(false)

  const handleExercise = async () => {
    if (!signer || !address || !provider) return toast.error('Connect your wallet first.')
    const id = parseInt(contractId, 10)
    if (!Number.isFinite(id) || id < 0) return toast.error('Enter a valid contract ID.')
    const exercise = parseBytes32Field(exerciseCommitment) ?? randomBytes32Hex()
    const nullifierHex = parseBytes32Field(nullifier) ?? randomBytes32Hex()
    const contract = getDerivativesContract(signer)
    if (!contract) return toast.error('Options contract is not configured.')

    setBusy(true)
    try {
      toast.loading('Generating privacy proof…', { id: 'deriv-exercise' })
      let zkProofBytes: Uint8Array
      if (proverServiceUrl()) {
        const { proof } = await proveViaService('/derivatives/exercise/prove', {
          contractId: id,
          exerciseCommitment: exercise,
          nullifier: nullifierHex,
        })
        zkProofBytes = groth16ProofBigintsToBytes256(proof)
      } else {
        const { proof } = await proveDerivative({
          contractId: id.toString(),
          exerciseCommitment: exercise,
          nullifier: nullifierHex,
          action: 'exercise',
        })
        zkProofBytes = groth16ProofBigintsToBytes256(proof)
      }
      toast.loading('Confirm in wallet…', { id: 'deriv-exercise' })
      const tx = await contract.exerciseOption({
        contractId: id,
        exerciseCommitment: exercise,
        nullifier: nullifierHex,
        zkProof: zkProofBytes,
      })
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Option exercised.', { id: 'deriv-exercise' })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Exercise failed.', { id: 'deriv-exercise' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <Field label="Contract ID" value={contractId} onChange={setContractId} disabled={busy} placeholder="e.g. 1" />
      <p className="text-xs text-terminal-text-dim">
        Use the ID from when the option was opened. Exercise only works before expiry while the option is in the money.
      </p>
      <details className="text-xs text-terminal-text-dim">
        <summary className="cursor-pointer text-terminal-accent">Advanced: commitment fields</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Exercise commitment" value={exerciseCommitment} onChange={setExerciseCommitment} disabled={busy} mono />
          <Field label="Nullifier" value={nullifier} onChange={setNullifier} disabled={busy} mono />
        </div>
      </details>
      <button type="button" className="btn-primary w-full py-3" disabled={busy || !contractId} onClick={() => void handleExercise()}>
        {busy ? 'Confirm in wallet…' : 'Exercise option'}
      </button>
    </div>
  )
}

function SettleForm({
  signer,
  address,
  provider,
}: {
  derivativesAddress: string
  signer: ReturnType<typeof useWalletStore.getState>['signer']
  address: string | null
  provider: ReturnType<typeof useWalletStore.getState>['provider']
}) {
  const [contractId, setContractId] = useState('')
  const [busy, setBusy] = useState(false)

  const handleSettle = async () => {
    if (!signer || !address || !provider) return toast.error('Connect your wallet first.')
    const id = parseInt(contractId, 10)
    if (!Number.isFinite(id) || id < 0) return toast.error('Enter a valid contract ID.')
    const contract = getDerivativesContract(signer)
    if (!contract) return toast.error('Options contract is not configured.')
    setBusy(true)
    try {
      toast.loading('Confirm in wallet…', { id: 'deriv-settle' })
      const tx = await contract.settleExpiredContract(id)
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Expired contract settled.', { id: 'deriv-settle' })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Settlement failed.', { id: 'deriv-settle' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <Field label="Contract ID" value={contractId} onChange={setContractId} disabled={busy} placeholder="e.g. 1" />
      <p className="text-xs text-terminal-text-dim leading-relaxed">
        Callable after expiry for options that were never exercised. Collateral returns according to the contract rules.
      </p>
      <button type="button" className="btn-primary w-full py-3" disabled={busy || !contractId} onClick={() => void handleSettle()}>
        {busy ? 'Confirm in wallet…' : 'Settle expired option'}
      </button>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  disabled,
  mono,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  mono?: boolean
  placeholder?: string
}) {
  return (
    <label className="block space-y-1.5 min-w-0">
      <span className="text-xs text-terminal-text-dim">{label}</span>
      <input
        className={`input-field w-full min-w-0 ${mono ? 'font-mono text-xs' : 'text-sm'}`}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </label>
  )
}
