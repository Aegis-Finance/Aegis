import { useState } from 'react'
import toast from 'react-hot-toast'
import { useWalletStore } from '@/store/walletStore'
import { CONTRACT_ADDRESSES, ZERO_ADDRESS } from '@/config/contracts'
import { getStealthAddressHubContract } from '@/utils/contracts'
import { isValidHex, checkRateLimit } from '@/utils/security'
import { waitAndParseTransaction } from '@/utils/transactionHelper'
import { formatAddress } from '@/utils/format'
import { isCircuitProvingReady } from '@/config/circuitReadiness'
import {
  buildStealthPaymentMaterial,
  formatStealthPayInstructions,
  proveStealthClaim,
  randomBytes32Hex,
} from '@/utils/stealthReceive'
import { submitViaRelayer } from '@/utils/submitViaRelayer'

function parseBytes32(raw: string): `0x${string}` | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const body = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed
  if (!isValidHex(body, 32)) return null
  return (`0x${body.padStart(64, '0')}`) as `0x${string}`
}

type Mode = 'register' | 'pay' | 'claim'

export default function StealthReceivePanel() {
  const { signer, address, provider } = useWalletStore()
  const [mode, setMode] = useState<Mode>('register')
  const [viewTag, setViewTag] = useState('')
  const [spendingKeyHash, setSpendingKeyHash] = useState('')
  const [paymentTag, setPaymentTag] = useState('')
  const [payMaterialJson, setPayMaterialJson] = useState('')
  const [registering, setRegistering] = useState(false)
  const [claiming, setClaiming] = useState(false)

  const hubConfigured =
    CONTRACT_ADDRESSES.STEALTH_ADDRESS_HUB &&
    CONTRACT_ADDRESSES.STEALTH_ADDRESS_HUB !== ZERO_ADDRESS
  const zkReady = isCircuitProvingReady('stealth-address')

  const generateTags = () => {
    setViewTag(randomBytes32Hex())
    setSpendingKeyHash(randomBytes32Hex())
    toast.success('Random view tag and spending key generated')
  }

  const handleRegister = async () => {
    try {
      checkRateLimit('critical')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit exceeded')
      return
    }
    if (!signer || !address) {
      toast.error('Connect wallet first')
      return
    }
    const vt = parseBytes32(viewTag)
    const sk = parseBytes32(spendingKeyHash)
    if (!vt || !sk) {
      toast.error('View tag and spending key hash must be 32-byte hex')
      return
    }
    const hub = getStealthAddressHubContract(signer)
    if (!hub) {
      toast.error('Stealth receive is not available on this network deployment yet.')
      return
    }
    setRegistering(true)
    try {
      toast.loading('Registering stealth meta…', { id: 'stealth-meta' })
      const tx = await hub.registerStealthMeta(vt, sk)
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Stealth receive rail registered', { id: 'stealth-meta' })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Registration failed', { id: 'stealth-meta' })
    } finally {
      setRegistering(false)
    }
  }

  const handleGeneratePayMaterial = async () => {
    const vt = parseBytes32(viewTag)
    if (!vt) {
      toast.error('Set a view tag first (register tab)')
      return
    }
    const pt = paymentTag ? parseBytes32(paymentTag) : undefined
    if (paymentTag && !pt) {
      toast.error('Payment tag must be 32-byte hex')
      return
    }
    const material = await buildStealthPaymentMaterial({ viewTag: vt, paymentTag: pt ?? undefined })
    setPayMaterialJson(JSON.stringify(material, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2))
    toast.success('Payment material generated — share payment tag with payer')
  }

  const handleClaim = async () => {
    if (!signer || !address || !provider) {
      toast.error('Connect wallet first')
      return
    }
    if (!zkReady) {
      toast.error('Stealth ZK circuit not loaded')
      return
    }
    let material
    try {
      material = JSON.parse(payMaterialJson)
    } catch {
      toast.error('Paste valid payment material JSON from the pay step')
      return
    }
    const hub = getStealthAddressHubContract(signer)
    if (!hub) {
      toast.error('Stealth hub not configured')
      return
    }
    setClaiming(true)
    try {
      toast.loading('Generating stealth claim proof…', { id: 'stealth-claim' })
      const normalized = {
        ...material,
        secret: BigInt(material.secret),
        nullifier: BigInt(material.nullifier),
        commitmentHash: BigInt(material.commitmentHash),
        nullifierHash: BigInt(material.nullifierHash),
      }
      const { proof, publicInputs } = await proveStealthClaim(normalized)
      toast.loading('Submitting claim…', { id: 'stealth-claim' })
      const tx = await submitViaRelayer({
        signer,
        provider,
        walletAddress: address,
        target: hub,
        method: 'claimStealthPayment',
        methodArgs: [proof, publicInputs],
        fallbackTx: () => hub.claimStealthPayment(proof, publicInputs),
      })
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Stealth payment claimed', { id: 'stealth-claim' })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Claim failed', { id: 'stealth-claim' })
    } finally {
      setClaiming(false)
    }
  }

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-terminal-accent">Stealth receive</h2>
        <p className="text-sm text-terminal-text-dim mt-1">
          Get paid without linking your main wallet to every deposit. Register once, share pay details with senders,
          then claim when funds arrive in the stealth pool.
        </p>
      </div>

      {!hubConfigured ? (
        <p className="text-sm text-amber-700">Stealth receive is not available on this deployment yet.</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {(['register', 'pay', 'claim'] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            className={`btn-secondary text-sm capitalize ${mode === m ? 'ring-1 ring-terminal-accent' : ''}`}
            onClick={() => setMode(m)}
          >
            {m}
          </button>
        ))}
      </div>

      {mode === 'register' && (
        <>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary text-sm" onClick={generateTags}>
              Generate random tags
            </button>
          </div>
          <div>
            <label className="block text-sm font-medium text-terminal-text-dim mb-1">View tag (share with payers)</label>
            <input
              className="input-field w-full font-mono text-xs"
              value={viewTag}
              onChange={(e) => setViewTag(e.target.value)}
              placeholder="0x… (32 bytes)"
              disabled={registering}
            />
            {viewTag && parseBytes32(viewTag) ? (
              <p className="text-xs text-terminal-text-dim mt-1">Short: {formatAddress(viewTag)}</p>
            ) : null}
          </div>
          <div>
            <label className="block text-sm font-medium text-terminal-text-dim mb-1">Spending key hash (keep private)</label>
            <input
              className="input-field w-full font-mono text-xs"
              value={spendingKeyHash}
              onChange={(e) => setSpendingKeyHash(e.target.value)}
              placeholder="0x… (32 bytes)"
              disabled={registering}
            />
          </div>
          <button
            type="button"
            className="btn-primary w-full sm:w-auto"
            disabled={!hubConfigured || registering || !viewTag || !spendingKeyHash}
            onClick={() => void handleRegister()}
          >
            {registering ? 'Registering…' : 'Register stealth meta'}
          </button>
        </>
      )}

      {mode === 'pay' && (
        <>
          <p className="text-sm text-terminal-text-dim">
            Generate payment material for one incoming payment. Give the payer the <strong>payment tag</strong> and
            commitment hash; they shield via Wallet → Shield using your shared derivation.
          </p>
          <div>
            <label className="block text-sm font-medium text-terminal-text-dim mb-1">View tag (registered)</label>
            <input className="input-field w-full font-mono text-xs" value={viewTag} onChange={(e) => setViewTag(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-terminal-text-dim mb-1">Payment tag (optional — auto-generated)</label>
            <input className="input-field w-full font-mono text-xs" value={paymentTag} onChange={(e) => setPaymentTag(e.target.value)} />
          </div>
          <button type="button" className="btn-primary" onClick={() => void handleGeneratePayMaterial()}>
            Generate pay material
          </button>
          {payMaterialJson ? (
            <pre className="text-xs bg-terminal-bg/60 p-3 rounded overflow-x-auto whitespace-pre-wrap">{payMaterialJson}</pre>
          ) : null}
          {payMaterialJson ? (
            <p className="text-xs text-terminal-text-dim whitespace-pre-wrap">
              {formatStealthPayInstructions(JSON.parse(payMaterialJson) as never)}
            </p>
          ) : null}
        </>
      )}

      {mode === 'claim' && (
        <>
          <p className="text-sm text-terminal-text-dim">
            After the payer shields to your commitment, paste the payment material JSON and claim. Requires registered
            view tag on-chain.
          </p>
          <textarea
            className="input-field w-full font-mono text-xs min-h-[120px]"
            value={payMaterialJson}
            onChange={(e) => setPayMaterialJson(e.target.value)}
            placeholder="Paste payment material JSON…"
          />
          <button
            type="button"
            className="btn-primary"
            disabled={claiming || !payMaterialJson}
            onClick={() => void handleClaim()}
          >
            {claiming ? 'Claiming…' : 'Claim stealth payment'}
          </button>
        </>
      )}
    </div>
  )
}
