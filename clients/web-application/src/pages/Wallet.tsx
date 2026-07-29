import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { parseEther, randomBytes } from 'ethers'
import { useWalletStore } from '@/store/walletStore'
import { formatBalance, formatAddress } from '@/utils/format'
import { getTokenContract } from '@/utils/contracts'
import { signShieldIntent, signShieldedTransferIntent, signTransparentExitIntent } from '@/utils/privacyEntryRouter'
import { submitPrivacyEntryAction } from '@/utils/privacyEntrySubmit'
import { resolvePrivacyEntryRouterAddress } from '@/utils/privacyRelay'
import { validateAmount, detectAttackPattern, checkRateLimit } from '@/utils/security'
import { waitAndParseTransaction } from '@/utils/transactionHelper'
import { getCommitments, saveCommitment } from '@/utils/commitmentStorage'
import { formatContractErrorForToast } from '@/utils/zkRevertHints'
import SonicGatewayConverter from '@/components/SonicGatewayConverter'
import StealthReceivePanel from '@/components/StealthReceivePanel'
import CommitmentLocalStorageWarning from '@/components/CommitmentLocalStorageWarning'
import CommitmentVaultControls from '@/components/CommitmentVaultControls'
import {
  formatLocalPrivacySummaryLine,
  getLocalPrivacyMetrics,
  isTelemetryOptIn,
  maybeSendPrivacyTelemetryBeacon,
  recordShieldStarted,
  recordShieldSucceeded,
  recordUnshieldStarted,
  recordUnshieldSucceeded,
  resetLocalPrivacyMetrics,
  setTelemetryOptIn,
} from '@/utils/localPrivacyMetrics'
import { allowPrivacyTelemetry } from '@/utils/operationalProfile'
import {
  bytes32ToField,
  fieldToBytes32,
  fetchMintShieldProofRemote,
  fetchTransferUnshieldProofRemote,
  proveMintShieldInBrowser,
  proveTransferUnshieldInBrowser,
} from '@/utils/tokenPrivacyProof'
import {
  encodePaymentReceipt,
  parsePaymentReceipt,
  proveShieldedTransferInBrowser,
  verifyNoteOpening,
} from '@/utils/shieldedNoteTransfer'
import { sleepPrivacyRelaySubmitJitter } from '@/utils/privacyRelay'

export default function Wallet() {
  const { address, isConnected, provider, signer } = useWalletStore()
  const [shieldAmount, setShieldAmount] = useState('')
  const [unshieldAmount, setUnshieldAmount] = useState('')
  const [selectedCommitment, setSelectedCommitment] = useState<string>('')
  const [isShielding, setIsShielding] = useState(false)
  const [isUnshielding, setIsUnshielding] = useState(false)
  const [isSendingPrivate, setIsSendingPrivate] = useState(false)
  const [sendNote1, setSendNote1] = useState('')
  const [sendNote2, setSendNote2] = useState('')
  const [sendAmount, setSendAmount] = useState('')
  const [sendRecipient, setSendRecipient] = useState('')
  const [paymentReceipt, setPaymentReceipt] = useState<string | null>(null)
  const [showCommitmentsModal, setShowCommitmentsModal] = useState(false)

  const { data: balance } = useQuery({
    queryKey: ['wallet-balance', address],
    queryFn: async () => {
      if (!provider || !address) return 0n
      try {
        return await provider.getBalance(address)
      } catch {
        return 0n
      }
    },
    enabled: !!provider && !!address,
  })

  const { data: tokenBalance } = useQuery({
    queryKey: ['token-balance', address],
    queryFn: async () => {
      if (!provider || !address) return 0n
      try {
        const contract = getTokenContract(provider)
        return await contract.balanceOf(address)
      } catch {
        return 0n
      }
    },
    enabled: !!provider && !!address,
  })

  const { data: commitments } = useQuery({
    queryKey: ['wallet-commitments', address],
    queryFn: async () => {
      if (!address) return []
      return getCommitments(address)
    },
    enabled: !!address,
  })

  const { data: publicEntryEnabled = true } = useQuery({
    queryKey: ['token-public-entry-enabled', provider],
    queryFn: async () => {
      if (!provider) return true
      const c = getTokenContract(provider)
      return (await c.publicEntryEnabled()) as boolean
    },
    enabled: !!provider,
    staleTime: 30_000,
  })

  const publicEntryOpen = publicEntryEnabled !== false
  const privacyRouterAddr = resolvePrivacyEntryRouterAddress()
  const proverUrl = (import.meta.env.VITE_PROVER_URL as string | undefined)?.trim()
  const canShield = publicEntryOpen || Boolean(privacyRouterAddr)
  const canUnshieldEntry = publicEntryOpen || Boolean(privacyRouterAddr)
  const canPrivateSend = canShield && (commitments?.length ?? 0) >= 2

  const showLocalPrivacyStats = allowPrivacyTelemetry()
  const privacyTelemetryEndpoint = (import.meta.env.VITE_PRIVACY_TELEMETRY_ENDPOINT as string | undefined)?.trim()
  const [telemetryOptInUi, setTelemetryOptInUi] = useState(false)
  const [localStatsNonce, setLocalStatsNonce] = useState(0)

  useEffect(() => {
    setTelemetryOptInUi(isTelemetryOptIn())
  }, [])

  const localPrivacySnapshot = useMemo(
    () => (showLocalPrivacyStats ? getLocalPrivacyMetrics() : null),
    [showLocalPrivacyStats, localStatsNonce]
  )

  const handleShield = async () => {
    try {
      checkRateLimit('critical')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit exceeded')
      return
    }

    if (!signer || !address || !shieldAmount) {
      toast.error('Please connect wallet and enter amount')
      return
    }

    const amountValidation = validateAmount(shieldAmount)
    if (!amountValidation.valid) {
      toast.error(amountValidation.error || 'Invalid amount')
      return
    }

    if (detectAttackPattern(shieldAmount)) {
      toast.error('Invalid input detected')
      return
    }

    if (!publicEntryOpen && !privacyRouterAddr) {
      toast.error(
        'Direct shield and transparent exit are paused on-chain. Use the privacy entry router when it is deployed, or another authorized on-ramp.',
        { id: 'shield' }
      )
      return
    }

    setIsShielding(true)
    try {
      const contract = getTokenContract(signer)
      const amountWei = parseEther(shieldAmount)

      // Check balance
      const balance = await contract.balanceOf(address)
      if (balance < amountWei) {
        toast.error('Insufficient balance')
        return
      }

      recordShieldStarted()

      let proof: bigint[]
      let publicInputs: bigint[]

      if (!proverUrl?.trim()) {
        toast.loading('Generating mint proof in your browser…', { id: 'shield' })
        const browser = await proveMintShieldInBrowser(address, amountWei)
        proof = browser.proof
        publicInputs = browser.publicInputs
        saveCommitment(address, {
          commitment: fieldToBytes32(browser.secrets.outputCommitment),
          contractType: 'staking',
          action: 'stake',
          amount: amountWei.toString(),
          timestamp: Math.floor(Date.now() / 1000),
          metadata: {
            event: 'Shield',
            noteSecret: browser.secrets.noteSecret.toString(),
            nullifierNonce: browser.secrets.nullifierNonce.toString(),
            depositNullifier: fieldToBytes32(browser.secrets.depositNullifier),
            browserProven: true,
          },
        })
      } else {
        const depositNullifier = '0x' + Buffer.from(randomBytes(32)).toString('hex')
        toast.loading('Generating mint proof…', { id: 'shield' })
        const remote = await fetchMintShieldProofRemote(proverUrl, {
          depositNullifier,
          depositor: address,
          amount: amountWei.toString(),
        })
        proof = remote.proof
        publicInputs = remote.publicInputs
      }

      toast.loading('Submitting…', { id: 'shield' })
      if (!provider) throw new Error('Wallet not connected')
      const tx = await submitPrivacyEntryAction({
        signer,
        provider,
        walletAddress: address,
        publicEntryOpen,
        proof,
        publicInputs,
        relayPath: '/v1/relay-shield',
        directMethod: 'shield',
        signIntent: signShieldIntent,
        beforeSubmit: sleepPrivacyRelaySubmitJitter,
      })
      toast.loading('Waiting for confirmation...', { id: 'shield' })
      
      // Wait and automatically parse events to save commitment
      await waitAndParseTransaction(tx, address, provider)

      recordShieldSucceeded()
      maybeSendPrivacyTelemetryBeacon()

      toast.success(`Shielded ${shieldAmount} AGS`, { id: 'shield' })
      setShieldAmount('')
      setLocalStatsNonce((n) => n + 1)
    } catch (error) {
      console.error('shield failed', error)
      toast.error(formatContractErrorForToast(error, 'Shielding failed'), { id: 'shield' })
    } finally {
      setIsShielding(false)
    }
  }

  const handleUnshield = async () => {
    try {
      checkRateLimit('critical')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit exceeded')
      return
    }

    if (!signer || !address || !selectedCommitment || !unshieldAmount) {
      toast.error('Please select a commitment and enter amount')
      return
    }

    const amountValidation = validateAmount(unshieldAmount)
    if (!amountValidation.valid) {
      toast.error(amountValidation.error || 'Invalid amount')
      return
    }

    if (!publicEntryOpen && !privacyRouterAddr) {
      toast.error(
        'Direct shield and transparent exit are paused on-chain. Use the privacy entry router when it is deployed, or another authorized on-ramp.',
        { id: 'transparent-exit' }
      )
      return
    }

    setIsUnshielding(true)
    try {
      const userCommitments = getCommitments(address)
      const commitmentRecord = userCommitments.find(
        c => c.commitment.toLowerCase() === selectedCommitment.toLowerCase()
      )

      if (!commitmentRecord) {
        toast.error('Commitment not found')
        return
      }

      const noteSecretRaw = commitmentRecord.metadata?.noteSecret
      const nullifierNonceRaw = commitmentRecord.metadata?.nullifierNonce
      const amountWei = parseEther(unshieldAmount)

      let proof: bigint[]
      let publicInputs: bigint[]

      if (noteSecretRaw && nullifierNonceRaw) {
        toast.loading('Generating transparent exit proof in your browser…', { id: 'transparent-exit' })
        const browser = await proveTransferUnshieldInBrowser({
          noteSecret: BigInt(String(noteSecretRaw)),
          nullifierNonce: BigInt(String(nullifierNonceRaw)),
          recipient: address,
          amountWei,
          inputCommitment: bytes32ToField(selectedCommitment),
        })
        proof = browser.proof
        publicInputs = browser.publicInputs
      } else if (proverUrl?.trim()) {
        const nullifierBytes = randomBytes(32)
        const nullifier = '0x' + Buffer.from(nullifierBytes).toString('hex')
        toast.loading('Generating transparent exit proof…', { id: 'transparent-exit' })
        const remote = await fetchTransferUnshieldProofRemote(proverUrl, {
          nullifier,
          recipient: address,
          amount: amountWei.toString(),
          commitment: selectedCommitment,
        })
        proof = remote.proof
        publicInputs = remote.publicInputs
      } else {
        toast.error(
          'This commitment has no local note secrets. Shield again from Wallet in this browser so secrets are saved for exit.',
          { id: 'transparent-exit' },
        )
        return
      }

      recordUnshieldStarted()

      toast.loading('Submitting…', { id: 'transparent-exit' })
      if (!provider) throw new Error('Wallet not connected')
      const tx = await submitPrivacyEntryAction({
        signer,
        provider,
        walletAddress: address,
        publicEntryOpen,
        proof,
        publicInputs,
        relayPath: '/v1/relay-transparent-exit',
        directMethod: 'unshield',
        signIntent: signTransparentExitIntent,
        beforeSubmit: sleepPrivacyRelaySubmitJitter,
      })
      toast.loading('Waiting for confirmation...', { id: 'transparent-exit' })
      
      // Wait and automatically parse events
      await waitAndParseTransaction(tx, address, provider)

      recordUnshieldSucceeded()
      maybeSendPrivacyTelemetryBeacon()

      toast.success(`Moved ${unshieldAmount} AGS to public balance`, { id: 'transparent-exit' })
      setUnshieldAmount('')
      setSelectedCommitment('')
      setLocalStatsNonce((n) => n + 1)
    } catch (error) {
      console.error('transparent exit failed', error)
      toast.error(formatContractErrorForToast(error, 'Transparent exit failed'), { id: 'transparent-exit' })
    } finally {
      setIsUnshielding(false)
    }
  }

  const handlePrivateSend = async () => {
    try {
      checkRateLimit('critical')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit exceeded')
      return
    }

    if (!signer || !address || !provider || !sendNote1 || !sendNote2 || !sendAmount) {
      toast.error('Select two notes and an amount')
      return
    }

    const amountValidation = validateAmount(sendAmount)
    if (!amountValidation.valid) {
      toast.error(amountValidation.error || 'Invalid amount')
      return
    }

    if (!publicEntryOpen && !privacyRouterAddr) {
      toast.error('Private send is unavailable right now', { id: 'private-send' })
      return
    }

    const userCommitments = getCommitments(address)
    const rec1 = userCommitments.find((c) => c.commitment.toLowerCase() === sendNote1.toLowerCase())
    const rec2 = userCommitments.find((c) => c.commitment.toLowerCase() === sendNote2.toLowerCase())
    if (!rec1 || !rec2) {
      toast.error('Note not found in this browser')
      return
    }

    setIsSendingPrivate(true)
    setPaymentReceipt(null)
    const toastId = 'private-send'
    try {
      const token = getTokenContract(provider)
      const bal1 = (await token.commitmentBalances(rec1.commitment)) as bigint
      const bal2 = (await token.commitmentBalances(rec2.commitment)) as bigint
      const paymentWei = parseEther(sendAmount)

      const input1 = await verifyNoteOpening(rec1, address, bal1)
      const input2 = await verifyNoteOpening(rec2, address, bal2)

      toast.loading('Generating proof…', { id: toastId })
      const transfer = await proveShieldedTransferInBrowser({ input1, input2, paymentAmount: paymentWei })

      toast.loading('Submitting…', { id: toastId })
      const tx = await submitPrivacyEntryAction({
        signer,
        provider,
        walletAddress: address,
        publicEntryOpen,
        proof: transfer.proof,
        publicInputs: transfer.publicInputs,
        relayPath: '/v1/relay-shielded-transfer',
        directMethod: 'shieldedTransfer',
        signIntent: signShieldedTransferIntent,
        beforeSubmit: sleepPrivacyRelaySubmitJitter,
      })

      toast.loading('Waiting for confirmation…', { id: toastId })
      await waitAndParseTransaction(tx, address, provider)

      saveCommitment(address, {
        commitment: transfer.changeNote.commitment,
        contractType: 'staking',
        action: 'stake',
        amount: transfer.changeNote.amount.toString(),
        timestamp: Math.floor(Date.now() / 1000),
        metadata: {
          event: 'ShieldedTransfer',
          noteSecret: transfer.changeNote.noteSecret.toString(),
          nullifierNonce: transfer.changeNote.nullifierNonce.toString(),
          shieldedOutputTag: transfer.changeNote.outputTag,
          browserProven: true,
        },
      })

      const receipt = encodePaymentReceipt({
        commitment: transfer.paymentNote.commitment,
        noteSecret: transfer.paymentNote.noteSecret,
        nullifierNonce: transfer.paymentNote.nullifierNonce,
        amount: transfer.paymentNote.amount,
        recipientHint: sendRecipient.trim() || undefined,
      })
      setPaymentReceipt(receipt)

      toast.success('Sent privately', { id: toastId })
      setSendAmount('')
      setLocalStatsNonce((n) => n + 1)
    } catch (error) {
      console.error('private send failed', error)
      toast.error(formatContractErrorForToast(error, 'Send failed'), { id: toastId })
    } finally {
      setIsSendingPrivate(false)
    }
  }

  const handleImportPaymentNote = (raw: string) => {
    if (!address) return
    try {
      const note = parsePaymentReceipt(raw)
      saveCommitment(address, {
        commitment: note.commitment,
        contractType: 'staking',
        action: 'stake',
        amount: note.amount,
        timestamp: Math.floor(Date.now() / 1000),
        metadata: {
          event: 'ShieldedTransfer',
          noteSecret: note.noteSecret,
          nullifierNonce: note.nullifierNonce,
          shieldedOutputTag: note.outputTag,
          imported: true,
        },
      })
      toast.success('Private note imported')
      setLocalStatsNonce((n) => n + 1)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Invalid note')
    }
  }

  if (!isConnected || !address) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold text-terminal-text md:text-3xl">Wallet</h1>
          <p className="text-sm text-terminal-text-dim max-w-2xl leading-relaxed">
            Hold AGS in a shielded balance on Sonic — private by default. Connect your wallet to shield tokens, view
            commitments, or move funds back to a public balance when you need to swap or pay gas.
          </p>
        </header>
        <div className="grid gap-3 sm:grid-cols-3">
          <StepCard step="1" title="Get AGS" body="Bridge or buy AGS on Sonic. You need a little native S for transaction fees." />
          <StepCard step="2" title="Shield" body="Move public AGS into a private commitment. Only you can spend it with a zero-knowledge proof." />
          <StepCard step="3" title="Use or withdraw" body="Keep value shielded for DeFi and governance, or move back to public when you need visible rails." />
        </div>
        <div className="card text-center py-12 space-y-3">
          <p className="text-terminal-text font-medium">Connect your wallet to continue</p>
          <p className="text-sm text-terminal-text-dim">Use the Connect button in the header — Sonic-compatible wallets supported.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-terminal-text md:text-3xl">Wallet</h1>
        <p className="text-sm text-terminal-text-dim max-w-2xl leading-relaxed">
          Your shielded AGS lives in private commitments on Sonic. Shield from your public balance, spend shielded value
          across the app, or withdraw to public AGS when you need transparent rails.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <StepCard step="1" title="Shield" body="Convert public AGS into a private commitment — the default way to hold value in Aegis." />
        <StepCard step="2" title="Spend privately" body="Use shielded balances in swap, staking, lending, and governance without exposing your full history." />
        <StepCard step="3" title="Withdraw" body="Move AGS back to your public wallet balance when you need visible tokens (e.g. for certain pools)." />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <BalanceCard label="Native S (gas)" value={`${formatBalance(balance || 0n)} S`} />
        <BalanceCard label="Public AGS" value={`${formatBalance(tokenBalance || 0n)} AGS`} accent />
        <BalanceCard
          label="Shielded notes"
          value={String(commitments?.length ?? 0)}
          hint={commitments?.length ? 'Saved in this browser' : 'Shield to create one'}
        />
      </div>

      <div className="rounded-lg border border-terminal-border/40 bg-terminal-surface/40 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-terminal-text-dim">Connected</div>
          <div className="font-mono text-sm text-terminal-text truncate">{formatAddress(address)}</div>
        </div>
        <button type="button" className="btn-secondary text-xs shrink-0" onClick={() => setShowCommitmentsModal(true)}>
          All notes ({commitments?.length || 0})
        </button>
      </div>

      <CommitmentLocalStorageWarning walletAddress={address} variant="wallet" />

      <details className="rounded-lg border border-terminal-border/30 bg-terminal-surface/30 px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium text-terminal-text">Device backup &amp; encrypted cache</summary>
        <div className="mt-3">
          <CommitmentVaultControls walletAddress={address} />
        </div>
      </details>

      <WalletTabs
        canShield={canShield}
        canWithdraw={canUnshieldEntry}
        hasCommitments={Boolean(commitments?.length)}
        shieldAmount={shieldAmount}
        setShieldAmount={setShieldAmount}
        tokenBalance={tokenBalance || 0n}
        isShielding={isShielding}
        onShield={() => void handleShield()}
        unshieldAmount={unshieldAmount}
        setUnshieldAmount={setUnshieldAmount}
        selectedCommitment={selectedCommitment}
        setSelectedCommitment={setSelectedCommitment}
        commitments={commitments ?? []}
        isUnshielding={isUnshielding}
        onUnshield={() => void handleUnshield()}
        canPrivateSend={canPrivateSend}
        sendNote1={sendNote1}
        setSendNote1={setSendNote1}
        sendNote2={sendNote2}
        setSendNote2={setSendNote2}
        sendAmount={sendAmount}
        setSendAmount={setSendAmount}
        sendRecipient={sendRecipient}
        setSendRecipient={setSendRecipient}
        isSendingPrivate={isSendingPrivate}
        onPrivateSend={() => void handlePrivateSend()}
        paymentReceipt={paymentReceipt}
        onImportPaymentNote={handleImportPaymentNote}
      />

      <details className="rounded-lg border border-terminal-border/30 bg-terminal-surface/30 px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium text-terminal-text">Bridge public tokens to AGS</summary>
        <div className="mt-4">
          <SonicGatewayConverter compact useChainPackList />
        </div>
      </details>

      {showLocalPrivacyStats && localPrivacySnapshot ? (
        <details className="rounded-lg border border-terminal-border/30 bg-terminal-surface/30 px-4 py-3 text-sm text-terminal-text-dim">
          <summary className="cursor-pointer font-medium text-terminal-text">Privacy activity (this browser)</summary>
          <div className="mt-3 space-y-2">
            <p>{formatLocalPrivacySummaryLine(localPrivacySnapshot)}</p>
            {privacyTelemetryEndpoint ? (
              <label className="flex items-start gap-2 cursor-pointer text-terminal-text text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={telemetryOptInUi}
                  onChange={(e) => {
                    const on = e.target.checked
                    setTelemetryOptIn(on)
                    setTelemetryOptInUi(on)
                  }}
                />
                <span>Share anonymous aggregate counts with the DAO telemetry endpoint (optional, no wallet address).</span>
              </label>
            ) : null}
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => {
                resetLocalPrivacyMetrics()
                setLocalStatsNonce((n) => n + 1)
              }}
            >
              Reset local counts
            </button>
          </div>
        </details>
      ) : null}

      {showCommitmentsModal ? (
        <CommitmentsModal
          commitments={commitments ?? []}
          onClose={() => setShowCommitmentsModal(false)}
        />
      ) : null}
    </div>
  )
}

type WalletTab = 'shield' | 'send' | 'withdraw' | 'receive'

function WalletTabs({
  canShield,
  canWithdraw,
  canPrivateSend,
  hasCommitments,
  shieldAmount,
  setShieldAmount,
  tokenBalance,
  isShielding,
  onShield,
  unshieldAmount,
  setUnshieldAmount,
  selectedCommitment,
  setSelectedCommitment,
  commitments,
  isUnshielding,
  onUnshield,
  sendNote1,
  setSendNote1,
  sendNote2,
  setSendNote2,
  sendAmount,
  setSendAmount,
  sendRecipient,
  setSendRecipient,
  isSendingPrivate,
  onPrivateSend,
  paymentReceipt,
  onImportPaymentNote,
}: {
  canShield: boolean
  canWithdraw: boolean
  canPrivateSend: boolean
  hasCommitments: boolean
  shieldAmount: string
  setShieldAmount: (v: string) => void
  tokenBalance: bigint
  isShielding: boolean
  onShield: () => void
  unshieldAmount: string
  setUnshieldAmount: (v: string) => void
  selectedCommitment: string
  setSelectedCommitment: (v: string) => void
  commitments: Array<{ commitment: string; contractType: string; action: string }>
  isUnshielding: boolean
  onUnshield: () => void
  sendNote1: string
  setSendNote1: (v: string) => void
  sendNote2: string
  setSendNote2: (v: string) => void
  sendAmount: string
  setSendAmount: (v: string) => void
  sendRecipient: string
  setSendRecipient: (v: string) => void
  isSendingPrivate: boolean
  onPrivateSend: () => void
  paymentReceipt: string | null
  onImportPaymentNote: (raw: string) => void
}) {
  const [tab, setTab] = useState<WalletTab>('shield')
  const [importNoteRaw, setImportNoteRaw] = useState('')

  const noteOptions = commitments.filter(
    (c, i, arr) => arr.findIndex((x) => x.commitment.toLowerCase() === c.commitment.toLowerCase()) === i
  )

  return (
    <div className="card border border-terminal-border/60 bg-terminal-surface/80 space-y-4 overflow-hidden">
      <div className="flex rounded-lg border border-terminal-border/40 p-1 bg-terminal-bg/40 overflow-x-auto">
        {(
          [
            ['shield', 'Shield'],
            ['send', 'Send'],
            ['withdraw', 'Withdraw'],
            ['receive', 'Receive'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
              tab === id
                ? id === 'shield'
                  ? 'bg-terminal-accent text-white shadow-sm'
                  : 'bg-terminal-surface text-terminal-text shadow-sm'
                : 'text-terminal-text-dim hover:text-terminal-text'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'shield' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-terminal-text">Shield AGS</h2>
            <p className="text-xs text-terminal-text-dim mt-1">
              Move tokens from your public balance into a private note.
            </p>
          </div>
          <label className="block space-y-1.5">
            <span className="text-xs text-terminal-text-dim">Amount (AGS)</span>
            <input
              type="number"
              step="0.001"
              min="0"
              value={shieldAmount}
              onChange={(e) => setShieldAmount(e.target.value)}
              className="input-field w-full min-w-0 text-right text-lg font-mono tabular-nums"
              placeholder="0.0"
            />
            <p className="text-[11px] text-terminal-text-dim">Available: {formatBalance(tokenBalance)} AGS</p>
          </label>
          <button
            type="button"
            className="btn-primary w-full py-3"
            onClick={onShield}
            disabled={isShielding || !canShield || !shieldAmount || parseFloat(shieldAmount) <= 0}
          >
            {isShielding ? 'Confirm in wallet…' : !canShield ? 'Shielding unavailable' : 'Shield AGS'}
          </button>
        </div>
      )}

      {tab === 'send' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-terminal-text">Send privately</h2>
            <p className="text-xs text-terminal-text-dim mt-1">
              Move shielded AGS to someone else. Uses two of your notes; share the receipt with the recipient.
            </p>
          </div>
          {!canPrivateSend ? (
            <p className="text-sm text-terminal-text-dim rounded-lg border border-terminal-border/30 bg-terminal-bg/40 p-4">
              You need at least two private notes. Shield again to create another note.
            </p>
          ) : (
            <>
              <label className="block space-y-1.5">
                <span className="text-xs text-terminal-text-dim">Note A</span>
                <select
                  value={sendNote1}
                  onChange={(e) => setSendNote1(e.target.value)}
                  className="input-field w-full min-w-0 text-sm"
                >
                  <option value="">Choose…</option>
                  {noteOptions.map((c, index) => (
                    <option key={`a-${index}`} value={c.commitment}>
                      {formatAddress(c.commitment)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs text-terminal-text-dim">Note B</span>
                <select
                  value={sendNote2}
                  onChange={(e) => setSendNote2(e.target.value)}
                  className="input-field w-full min-w-0 text-sm"
                >
                  <option value="">Choose…</option>
                  {noteOptions
                    .filter((c) => c.commitment.toLowerCase() !== sendNote1.toLowerCase())
                    .map((c, index) => (
                      <option key={`b-${index}`} value={c.commitment}>
                        {formatAddress(c.commitment)}
                      </option>
                    ))}
                </select>
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs text-terminal-text-dim">Amount (AGS)</span>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  value={sendAmount}
                  onChange={(e) => setSendAmount(e.target.value)}
                  className="input-field w-full min-w-0 text-right text-lg font-mono tabular-nums"
                  placeholder="0.0"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs text-terminal-text-dim">Recipient (optional label)</span>
                <input
                  type="text"
                  value={sendRecipient}
                  onChange={(e) => setSendRecipient(e.target.value)}
                  className="input-field w-full min-w-0 text-sm font-mono"
                  placeholder="0x…"
                />
              </label>
              <button
                type="button"
                className="btn-primary w-full py-3"
                onClick={onPrivateSend}
                disabled={
                  isSendingPrivate ||
                  !sendNote1 ||
                  !sendNote2 ||
                  sendNote1.toLowerCase() === sendNote2.toLowerCase() ||
                  !sendAmount ||
                  parseFloat(sendAmount) <= 0
                }
              >
                {isSendingPrivate ? 'Working…' : 'Send'}
              </button>
              {paymentReceipt ? (
                <div className="rounded-lg border border-terminal-border/40 bg-terminal-bg/40 p-3 space-y-2">
                  <p className="text-xs text-terminal-text-dim">Share this receipt with the recipient (secure channel):</p>
                  <textarea
                    readOnly
                    value={paymentReceipt}
                    rows={4}
                    className="input-field w-full text-[11px] font-mono"
                  />
                  <button
                    type="button"
                    className="btn-secondary text-xs w-full"
                    onClick={() => void navigator.clipboard.writeText(paymentReceipt).then(() => toast.success('Copied'))}
                  >
                    Copy receipt
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      )}

      {tab === 'withdraw' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-terminal-text">Withdraw to public balance</h2>
            <p className="text-xs text-terminal-text-dim mt-1">
              Move AGS from a private note back to your public wallet balance.
            </p>
          </div>
          {!hasCommitments ? (
            <p className="text-sm text-terminal-text-dim rounded-lg border border-terminal-border/30 bg-terminal-bg/40 p-4">
              No shielded notes yet. Shield AGS first, then you can withdraw here.
            </p>
          ) : (
            <>
              <label className="block space-y-1.5">
                <span className="text-xs text-terminal-text-dim">Shielded note</span>
                <select
                  value={selectedCommitment}
                  onChange={(e) => setSelectedCommitment(e.target.value)}
                  className="input-field w-full min-w-0 text-sm"
                >
                  <option value="">Choose a note…</option>
                  {commitments.map((c, index) => (
                    <option key={index} value={c.commitment}>
                      {formatAddress(c.commitment)} · {c.contractType}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs text-terminal-text-dim">Amount (AGS)</span>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  value={unshieldAmount}
                  onChange={(e) => setUnshieldAmount(e.target.value)}
                  className="input-field w-full min-w-0 text-right text-lg font-mono tabular-nums"
                  placeholder="0.0"
                />
              </label>
              <button
                type="button"
                className="btn-primary w-full py-3"
                onClick={onUnshield}
                disabled={
                  isUnshielding ||
                  !canWithdraw ||
                  !selectedCommitment ||
                  !unshieldAmount ||
                  parseFloat(unshieldAmount) <= 0
                }
              >
                {isUnshielding ? 'Confirm in wallet…' : 'Withdraw to public'}
              </button>
            </>
          )}
        </div>
      )}

      {tab === 'receive' && (
        <div className="space-y-4">
          <details className="rounded-lg border border-terminal-border/30 bg-terminal-bg/40 px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium text-terminal-text">Import private note</summary>
            <div className="mt-3 space-y-2">
              <textarea
                value={importNoteRaw}
                onChange={(e) => setImportNoteRaw(e.target.value)}
                rows={4}
                className="input-field w-full text-[11px] font-mono"
                placeholder="Paste payment receipt JSON"
              />
              <button
                type="button"
                className="btn-secondary text-xs w-full"
                onClick={() => {
                  onImportPaymentNote(importNoteRaw)
                  setImportNoteRaw('')
                }}
              >
                Import
              </button>
            </div>
          </details>
          <StealthReceivePanel />
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

function BalanceCard({
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
      <div className={`text-lg font-semibold mt-1 tabular-nums ${accent ? 'text-terminal-accent' : 'text-terminal-text'}`}>
        {value}
      </div>
      {hint ? <div className="text-[10px] text-terminal-text-dim mt-1">{hint}</div> : null}
    </div>
  )
}

function CommitmentsModal({
  commitments,
  onClose,
}: {
  commitments: Array<{
    commitment: string
    contractType: string
    action: string
    nullifier?: string
    amount?: string
  }>
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="card max-w-2xl w-full max-h-[85vh] overflow-y-auto space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-terminal-text">Shielded notes</h2>
          <button type="button" className="text-terminal-text-dim hover:text-terminal-text text-xl leading-none" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {commitments.length > 0 ? (
          <div className="space-y-2">
            {commitments.map((commitment, index) => (
              <div key={index} className="rounded-lg border border-terminal-border/30 bg-terminal-bg/40 p-4 text-xs space-y-2">
                <div>
                  <div className="text-terminal-text-dim">Note ID</div>
                  <div className="text-terminal-text font-mono break-all">{commitment.commitment}</div>
                </div>
                <div className="flex flex-wrap gap-4">
                  <div>
                    <div className="text-terminal-text-dim">Source</div>
                    <div className="text-terminal-text">{commitment.contractType} · {commitment.action}</div>
                  </div>
                  {commitment.amount && commitment.amount !== '0' ? (
                    <div>
                      <div className="text-terminal-text-dim">Amount</div>
                      <div className="text-terminal-text">{formatBalance(BigInt(commitment.amount))} AGS</div>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-terminal-text-dim text-center py-8">No shielded notes in this browser yet.</p>
        )}
      </div>
    </div>
  )
}
