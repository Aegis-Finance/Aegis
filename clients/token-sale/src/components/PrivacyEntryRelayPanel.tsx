import { useState } from 'react'
import toast from 'react-hot-toast'
import { Contract, JsonRpcProvider } from 'ethers'
import type { Signer } from 'ethers'
import { ENV } from '../config'
import {
  getPrivacyEntryRouter,
  publicInputsDigest,
  signShieldIntent,
  signShieldedTransferIntent,
  signTransparentExitIntent,
} from '../utils/privacyEntryRouter'
import routerArtifact from '../abis/PrivacyEntryRouter.json'
import type { InterfaceAbi } from 'ethers'
import { formatContractErrorForToast } from '../utils/zkRevertHints'

/** Shield-first: primary rail → private transfer → transparent exit last (on-chain still `relayUnshield`). */
type Mode = 'shield' | 'shieldedTransfer' | 'transparentExit'

/** Small random delay before broadcast to reduce trivial timing batching (on-chain visibility unchanged). */
function privacyRelaySubmitJitter(): Promise<void> {
  const ms = 60 + Math.floor(Math.random() * 340)
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseBigintArray(raw: string, label: string, len?: number): bigint[] {
  let v: unknown
  try {
    v = JSON.parse(raw.trim() || '[]')
  } catch {
    throw new Error(`${label}: invalid JSON`)
  }
  if (!Array.isArray(v)) throw new Error(`${label}: expected JSON array`)
  const out = v.map((x, i) => {
    try {
      if (typeof x === 'bigint') return x
      if (typeof x === 'number' && Number.isFinite(x)) return BigInt(Math.trunc(x))
      if (typeof x === 'string' && x.trim() !== '') return BigInt(x.trim())
    } catch {
      /* fall through */
    }
    throw new Error(`${label}[${i}]: expected integer string or number`)
  })
  if (len !== undefined && out.length !== len) {
    throw new Error(`${label}: expected length ${len}, got ${out.length}`)
  }
  return out
}

type Props = {
  signer: Signer
  address: string
  /** When true, omit outer panel chrome (nested under Advanced). */
  embedded?: boolean
}

const MODE_ORDER: readonly Mode[] = ['shield', 'shieldedTransfer', 'transparentExit'] as const

function modeLabel(m: Mode): string {
  if (m === 'shieldedTransfer') return 'Shielded transfer'
  if (m === 'transparentExit') return 'Transparent exit (legacy)'
  return 'Shield'
}

/**
 * Advanced: sign EIP-712 intents and call `PrivacyEntryRouter` relay functions from **this** wallet
 * (you pay gas). Proof + `publicInputs` must come from your prover / tooling — not generated here.
 */
export default function PrivacyEntryRelayPanel({ signer, address, embedded = false }: Props) {
  const routerAddr = ENV.privacyEntryRouterAddress
  const [mode, setMode] = useState<Mode>('shield')
  const [proofJson, setProofJson] = useState('[]')
  const [inputsJson, setInputsJson] = useState('[]')
  const [deadlineSec, setDeadlineSec] = useState('900')
  const [busy, setBusy] = useState(false)

  if (!routerAddr) return null

  const publicInputsLen = mode === 'shield' || mode === 'transparentExit' ? 4 : 11

  const run = async () => {
    setBusy(true)
    const id = 'privacy-relay'
    try {
      const proof = parseBigintArray(proofJson, 'proof', 8)
      const publicInputs = parseBigintArray(inputsJson, 'publicInputs', publicInputsLen)

      const offset = BigInt(deadlineSec.trim() || '900')
      const prov = signer.provider
      if (!prov) throw new Error('No provider on signer')
      const block = await prov.getBlock('latest')
      const deadline = BigInt(block!.timestamp) + offset

      const routerRead = new Contract(routerAddr, routerArtifact.abi as InterfaceAbi, prov as JsonRpcProvider)
      const router = getPrivacyEntryRouter(signer, routerAddr)
      const feeWei = (await routerRead.relayFeeWei()) as bigint

      if (mode === 'shield') {
        const nonce = await routerRead.nonces(address)
        toast.loading('Sign shield intent…', { id })
        const sig = await signShieldIntent(signer, routerAddr, publicInputs, nonce, deadline)
        await privacyRelaySubmitJitter()
        toast.loading('Submit relayShield…', { id })
        const tx = await router.relayShield(proof, publicInputs, deadline, nonce, sig, { value: feeWei })
        await tx.wait()
        toast.success(`relayShield confirmed (${tx.hash})`, { id })
        return
      }

      if (mode === 'transparentExit') {
        const nonce = await routerRead.nonces(address)
        toast.loading('Sign transparent exit intent…', { id })
        const sig = await signTransparentExitIntent(signer, routerAddr, publicInputs, nonce, deadline)
        await privacyRelaySubmitJitter()
        toast.loading('Submit transparent exit relay…', { id })
        const tx = await router.relayUnshield(proof, publicInputs, deadline, nonce, sig, { value: feeWei })
        await tx.wait()
        toast.success(`Transparent exit confirmed (${tx.hash})`, { id })
        return
      }

      const nonce = await routerRead.nonces(address)
      toast.loading('Sign shielded transfer intent…', { id })
      const sig = await signShieldedTransferIntent(signer, routerAddr, publicInputs, nonce, deadline)
      await privacyRelaySubmitJitter()
      toast.loading('Submit relayShieldedTransfer…', { id })
      const tx = await router.relayShieldedTransfer(proof, publicInputs, deadline, nonce, address, sig, {
        value: feeWei,
      })
      await tx.wait()
      toast.success(`relayShieldedTransfer confirmed (${tx.hash})`, { id })
    } catch (e) {
      toast.error(formatContractErrorForToast(e, 'Relay failed'), { id })
    } finally {
      setBusy(false)
    }
  }

  let digestPreview = '—'
  try {
    const publicInputs = parseBigintArray(inputsJson, 'publicInputs', publicInputsLen)
    digestPreview = publicInputsDigest(publicInputs)
  } catch {
    digestPreview = '(fix publicInputs JSON)'
  }

  return (
    <section className={embedded ? 'tge-privacy-relay-embedded' : 'panel'} style={embedded ? undefined : { marginTop: 'var(--space-lg)' }}>
      {!embedded ? <h2>Privacy entry (EIP-712)</h2> : null}
      <p className="muted" style={{ lineHeight: 1.6 }}>
        <code>PrivacyEntryRouter</code> at <code style={{ wordBreak: 'break-all' }}>{routerAddr}</code>. Paste a valid
        ZK <strong>proof</strong> (8 field elements) and <strong>publicInputs</strong> from your prover or dev scripts.
        Default journey is <strong>shield → shielded transfer</strong>; transparent exit is the compatibility leg (
        <code>relayUnshield</code> on-chain). The connected wallet signs the intent and sends the relay transaction (gas
        from this wallet). If the router owner set a native relay fee, this panel forwards <code>relayFeeWei</code> in{' '}
        <code>msg.value</code> (overpay is refunded by the contract). For a separate relayer EOA, use{' '}
        <code>npm run ops:privacy-entry-relayer --prefix Aegis-contracts</code> or your own backend with the same
        calldata and value. On-chain, <code>PrivateTokenContract</code> uses a <strong>dedicated</strong> Groth16 verifier per rail (
        <code>mint-optimized</code>, <code>transfer-unshield</code>, <code>shielded-transfer</code>, …); if those factory slots are unset, the token reverts{' '}
        <code>InvalidVerifier</code> (see <code>Aegis-contracts/docs/CIRCUIT_TO_CONTRACT_MAP.md</code>).
      </p>
      <p className="muted" style={{ lineHeight: 1.6, fontSize: '0.8rem', marginTop: '8px' }}>
        Residual risk: the chain still sees your wallet as <code>tx.from</code>, calldata shape, and timing. EIP-712 +
        router only moves authorization off the hot path when a third party relays; it does not make the L1 tx
        invisible.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
        {MODE_ORDER.map((m) => (
          <button
            key={m}
            type="button"
            className={mode === m ? 'primary' : 'ghost'}
            style={{ borderRadius: '8px', padding: '6px 12px' }}
            onClick={() => setMode(m)}
          >
            {modeLabel(m)}
          </button>
        ))}
      </div>

      <label className="muted" style={{ fontSize: '0.85rem', display: 'block', marginBottom: '4px' }}>
        proof (JSON array, length 8)
      </label>
      <textarea
        value={proofJson}
        onChange={(e) => setProofJson(e.target.value)}
        rows={3}
        style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.8rem', marginBottom: '10px' }}
        spellCheck={false}
      />

      <label className="muted" style={{ fontSize: '0.85rem', display: 'block', marginBottom: '4px' }}>
        publicInputs (JSON array — length {publicInputsLen})
      </label>
      <textarea
        value={inputsJson}
        onChange={(e) => setInputsJson(e.target.value)}
        rows={4}
        style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.8rem', marginBottom: '10px' }}
        spellCheck={false}
      />

      <p className="muted" style={{ fontSize: '0.8rem', wordBreak: 'break-all', marginBottom: '10px' }}>
        Digest <code>keccak256(abi.encode(publicInputs))</code>: {digestPreview}
      </p>

      <label className="muted" style={{ fontSize: '0.85rem', display: 'block', marginBottom: '4px' }}>
        Deadline = latest block timestamp + (seconds)
      </label>
      <input
        type="text"
        inputMode="numeric"
        value={deadlineSec}
        onChange={(e) => setDeadlineSec(e.target.value)}
        style={{ width: '120px', marginBottom: '12px', padding: '6px 8px' }}
      />

      <div>
        <button type="button" className="primary" disabled={busy} onClick={() => void run()}>
          {busy ? 'Working…' : 'Sign intent + submit relay'}
        </button>
      </div>
    </section>
  )
}
