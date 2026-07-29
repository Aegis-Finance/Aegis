import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Contract, parseEther, randomBytes } from 'ethers'
import type { Signer } from 'ethers'
import { ENV } from '../config'
import { formatToken } from '../utils/format'
import { validateAmount, detectAttackPattern, checkRateLimit } from '../utils/security'
import { criticalFetch } from '../utils/protectedFetch'
import { waitAndParseTransaction } from '../utils/transactionHelper'
import { formatContractErrorForToast } from '../utils/zkRevertHints'
import { getPrivacyEntryRouter, signShieldIntent } from '../utils/privacyEntryRouter'
import routerArtifact from '../abis/PrivacyEntryRouter.json'
import { preferGaslessPrivacyRelay, postPrivacyRelay } from '../utils/privacyRelay'
import PrivacyEntryRelayPanel from './PrivacyEntryRelayPanel'
import type { InterfaceAbi } from 'ethers'

const ERC20_ABI = ['function balanceOf(address) view returns (uint256)']
const TOKEN_ENTRY_ABI = ['function publicEntryEnabled() view returns (bool)', 'function shield(uint256[8],uint256[])']

function privacyRelaySubmitJitter(): Promise<void> {
  const ms = 60 + Math.floor(Math.random() * 340)
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type Props = {
  signer: Signer | null
  address: string | null
  isConnected: boolean
  onConnectWallet: () => void
}

export default function TgePrivacyEntryPanel({ signer, address, isConnected, onConnectWallet }: Props) {
  const routerAddr = ENV.privacyEntryRouterAddress
  const tokenAddr = ENV.tokenAddress
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)

  const { data: agsBalance, refetch: refetchBalance } = useQuery({
    queryKey: ['td-ags-balance', address, tokenAddr],
    queryFn: async () => {
      if (!signer || !address || !tokenAddr) return 0n
      const c = new Contract(tokenAddr, ERC20_ABI, signer)
      return (await c.balanceOf(address)) as bigint
    },
    enabled: Boolean(signer && address && tokenAddr),
    refetchInterval: 20_000,
  })

  if (!routerAddr) {
    return (
      <section className="card space-y-3">
        <h2 className="text-lg font-semibold text-terminal-text">Privacy entry</h2>
        <p className="text-sm text-terminal-text-dim">
          Privacy entry is not available on this deployment yet.
        </p>
      </section>
    )
  }

  const handleShield = async () => {
    if (!signer || !address || !tokenAddr) {
      toast.error('Connect your wallet first')
      return
    }
    try {
      checkRateLimit('critical')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit exceeded')
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

    const proverUrl = ENV.proverUrl?.trim()
    if (!proverUrl) {
      toast.error('Shield proof service is not available on this deployment.')
      return
    }

    setBusy(true)
    const id = 'td-shield'
    try {
      const amountWei = parseEther(amount)
      const token = new Contract(tokenAddr, ERC20_ABI, signer)
      const balance = (await token.balanceOf(address)) as bigint
      if (balance < amountWei) {
        toast.error('Insufficient visible AGS balance')
        return
      }

      const depositNullifier = '0x' + Buffer.from(randomBytes(32)).toString('hex')
      toast.loading('Generating shield proof…', { id })
      const res = await criticalFetch(`${proverUrl.replace(/\/+$/, '')}/mint/shield/prove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          depositNullifier,
          depositor: address,
          amount: amountWei.toString(),
        }),
      })
      if (!res.ok) {
        const t = await res.text().catch(() => '')
        throw new Error(t || `Proof service error (${res.status})`)
      }
      const data = (await res.json()) as { proof?: string[]; publicInputs?: string[] }
      const proof = (data.proof ?? []).map((x) => BigInt(x))
      const publicInputs = (data.publicInputs ?? []).map((x) => BigInt(x))
      if (proof.length !== 8 || publicInputs.length !== 4) {
        throw new Error('Invalid proof response (expected proof[8] and publicInputs[4])')
      }

      const prov = signer.provider
      if (!prov) throw new Error('No provider on signer')
      const block = await prov.getBlock('latest')
      if (!block) throw new Error('Could not read latest block')
      const deadline = BigInt(block.timestamp) + 7200n

      let txHash: string
      const useGasless = preferGaslessPrivacyRelay()

      if (useGasless) {
        const routerRead = new Contract(routerAddr, routerArtifact.abi as InterfaceAbi, prov)
        const nonce = await routerRead.nonces(address)
        toast.loading('Sign shield intent (gasless relayer)…', { id })
        const sig = await signShieldIntent(signer, routerAddr, publicInputs, nonce, deadline)
        await privacyRelaySubmitJitter()
        toast.loading('Submitting via relayer…', { id })
        const { txHash: h } = await postPrivacyRelay('/v1/relay-shield', {
          proof: proof.map(String),
          publicInputs: publicInputs.map(String),
          deadline: deadline.toString(),
          nonce: nonce.toString(),
          signature: sig,
        })
        txHash = h
        toast.success(`Shield submitted (${txHash.slice(0, 10)}…)`, { id })
      } else {
        const tokenEntry = new Contract(tokenAddr, TOKEN_ENTRY_ABI, signer)
        let publicEntryOpen = false
        try {
          publicEntryOpen = Boolean(await tokenEntry.publicEntryEnabled())
        } catch {
          publicEntryOpen = false
        }

        if (publicEntryOpen) {
          toast.loading('Submitting shield…', { id })
          const tx = await tokenEntry.shield(proof, publicInputs)
          await waitAndParseTransaction(tx, address, prov)
          txHash = tx.hash
        } else {
          const router = getPrivacyEntryRouter(signer, routerAddr)
          const routerRead = new Contract(routerAddr, routerArtifact.abi as InterfaceAbi, prov)
          const feeWei = (await routerRead.relayFeeWei()) as bigint
          const nonce = await routerRead.nonces(address)
          toast.loading('Sign shield intent…', { id })
          const sig = await signShieldIntent(signer, routerAddr, publicInputs, nonce, deadline)
          await privacyRelaySubmitJitter()
          toast.loading('Submitting relayShield…', { id })
          const tx = await router.relayShield(proof, publicInputs, deadline, nonce, sig, { value: feeWei })
          await waitAndParseTransaction(tx, address, prov)
          txHash = tx.hash
        }
        toast.success(`Shielded ${amount} AGS (${txHash.slice(0, 10)}…)`, { id })
      }

      setAmount('')
      void refetchBalance()
    } catch (e) {
      toast.error(formatContractErrorForToast(e, 'Shield failed'), { id })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section className="card space-y-4 tge-privacy-entry">
        <h2 className="text-lg font-semibold text-terminal-text">Privacy entry</h2>
        <p className="text-sm text-terminal-text-dim tge-privacy-entry-lead">
          You didn&apos;t come here to perform your wealth for strangers. The auction puts AGS in your wallet where the
          world can see it. This is where you close the door — same proof, same router, same standard as the main Aegis
          wallet. One tab. One move. What&apos;s yours stays yours.
        </p>

        {!tokenAddr ? (
          <p className="muted">
            AGS token address is missing from site configuration — refresh env from{' '}
            <code>Aegis-contracts</code> if you are an operator.
          </p>
        ) : null}

        {!isConnected ? (
          <button type="button" className="btn-primary" onClick={onConnectWallet}>
            Connect wallet — step inside
          </button>
        ) : (
          <div className="form" style={{ maxWidth: '28rem' }}>
            {agsBalance != null ? (
              <p className="muted" style={{ marginBottom: 'var(--space-sm)' }}>
                Still on the glass: <strong>{formatToken(agsBalance)} AGS</strong>
              </p>
            ) : null}
            <label htmlFor="shield-amount">How much moves off the record?</label>
            <input
              id="shield-amount"
              type="number"
              min="0"
              step="0.0001"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0"
            />
            <button type="button" className="btn-primary w-full" disabled={busy || !amount} onClick={() => void handleShield()}>
              {busy ? 'Closing the door…' : 'Shield AGS'}
            </button>
            {!ENV.proverUrl ? (
              <p className="muted" style={{ marginTop: 'var(--space-sm)', fontSize: 'var(--font-size-sm)' }}>
                Shield proof generation is unavailable — prover URL missing from site configuration.
              </p>
            ) : null}
          </div>
        )}
      </section>

      {isConnected && signer && address ? (
        <details className="card tge-privacy-advanced">
          <summary>Advanced relay (transfer / exit, paste proof JSON)</summary>
          <PrivacyEntryRelayPanel signer={signer} address={address} embedded />
        </details>
      ) : null}
    </>
  )
}
