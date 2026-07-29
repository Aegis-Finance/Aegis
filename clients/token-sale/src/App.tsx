import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { parseEther } from 'ethers'
import toast from 'react-hot-toast'

import { useWalletStore } from './store/walletStore'
import { getAuctionContract, getPublicProvider } from './utils/contracts'
import { ENV, SONIC_WALLET_DOCS_URL, AEGIS_COMMUNITY, isCompactTgeUi } from './config'
import { formatCountdown, formatPriceWei, formatToken } from './utils/format'
import { validateAmount, validateSlippage, isValidHex, detectAttackPattern, checkRateLimit } from './utils/security'
import { protectedFetch, criticalFetch } from './utils/protectedFetch'
import { waitAndParseTransaction } from './utils/transactionHelper'
import {
  getPurchaseCommitments,
} from './utils/commitmentStorage'
import { describeAuctionCurve } from './utils/auctionEconomics'
import {
  agsOutFromPayment,
  approveErc20ForAuction,
  fetchErc20Allowance,
  parsePayAmount,
  PAY_TOKEN_LABELS,
  resolvePurchaseRoute,
  type PayRailSymbol,
} from './utils/auctionPayment'
import { needsWsNormalization, prepareAuctionPayment } from './utils/auctionCheckout'
import { useAuctionPayRails } from './hooks/useAuctionPayRails'
import SecurityProvider from './components/SecurityProvider'
import AddAgsToWalletButton from './components/AddAgsToWalletButton'
import DutchTgeWalletBalances from './components/DutchTgeWalletBalances'
import SonicGatewayBridgePanel from './components/SonicGatewayBridgePanel'
import TgePrivacyEntryPanel from './components/TgePrivacyEntryPanel'
import TgeLayout from './components/TgeLayout'
import AuctionDailyPricePanel from './components/AuctionDailyPricePanel'
import { useAuctionSaleInfo } from './hooks/useAuctionSaleInfo'
import { requestInjectedWalletOptions, type InjectedWalletOption } from './utils/injectedWallets'
import { walletPickerInitial } from './utils/walletPickerInitial'

function useDeferredSettlement() {
  return useQuery({
    queryKey: ['deferred-settlement', ENV.auctionAddress, ENV.rpcUrl],
    queryFn: async () => {
      const contract = getAuctionContract(getPublicProvider())
      return Boolean(await contract.isDeferredSettlement())
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  })
}

function useSaleConfig() {
  return useQuery({
    queryKey: ['sale-config', ENV.auctionAddress, ENV.rpcUrl],
    queryFn: async () => {
      const contract = getAuctionContract(getPublicProvider())
      const [minPurchase, maxPerAddress, startPrice, reservePrice, auctionStartTime, auctionEndTime, auctionDuration] =
        await Promise.all([
        contract.minPurchase(),
        contract.maxPerAddress(),
        contract.startPrice(),
        contract.reservePrice(),
        contract.auctionStartTime(),
        contract.auctionEndTime(),
        contract.auctionDuration(),
      ])
      const startSec = Number(auctionStartTime)
      const endSec = Number(auctionEndTime)
      return {
        minPurchase: BigInt(minPurchase),
        maxPerAddress: BigInt(maxPerAddress),
        startPrice: BigInt(startPrice),
        reservePrice: BigInt(reservePrice),
        auctionStartTime: startSec,
        auctionEndTime: endSec,
        auctionDuration: Number(auctionDuration),
        startTime: startSec * 1000,
        endTime: endSec * 1000,
      }
    },
    staleTime: 60_000,
  })
}
function useUserInfo(address: string | null) {
  const { signer } = useWalletStore()
  return useQuery({
    queryKey: ['user-info', address],
    queryFn: async () => {
      if (!address || !signer) return null
      const contract = getAuctionContract(signer)
      const [purchased, remaining, canPurchase, nextPurchaseTime] = await contract.getUserPurchaseInfo(address)
      return {
        purchased: BigInt(purchased),
        remaining: BigInt(remaining),
        canPurchase: Boolean(canPurchase),
        nextPurchaseTime: Number(nextPurchaseTime) * 1000,
      }
    },
    enabled: Boolean(address && signer),
    refetchInterval: 30_000,
  })
}

function useClaimInfo(address: string | null) {
  const { provider } = useWalletStore()
  return useQuery({
    queryKey: ['claim-info', address],
    queryFn: async () => {
      if (!address || !provider) return null
      const contract = getAuctionContract(provider)
      
      // Fetch public state
      const [deferred, finalizedAt, saleFinalized, legacyAmount, saleInfo] = await Promise.all([
        contract.isDeferredSettlement(),
        contract.finalizedAt(),
        contract.saleFinalized(),
        contract.legacyEntitlement(address).catch(() => 0n),
        contract.getSaleInfo(),
      ])

      // Fetch private entitlements for all stored commitments
      const storedPurchases = getPurchaseCommitments(address)
      const privateEntitlements = await Promise.all(
        storedPurchases.map(async (p) => {
          try {
            const amount = await contract.privateEntitlement(p.commitment)
            return { ...p, amount: BigInt(amount) }
          } catch {
            return { ...p, amount: 0n }
          }
        })
      )

      const availablePrivate = privateEntitlements.filter(p => p.amount > 0n)
      const totalPrivateAmount = availablePrivate.reduce((sum, p) => sum + p.amount, 0n)

      const isEnded = Boolean(saleInfo[3])
      const finalTime = Number(finalizedAt) > 0 ? Number(finalizedAt) : (saleInfo[2] ? Number(saleInfo[2]) : 0)
      const gateTime = finalTime + 86400 // 24 hours after finalization
      
      const hasLegacy = legacyAmount > 0n
      const hasPrivate = totalPrivateAmount > 0n
      const canClaim = Boolean(deferred) && isEnded && (saleFinalized || finalTime > 0) && Date.now() >= gateTime * 1000 && (hasLegacy || hasPrivate)

      return {
        deferred: Boolean(deferred),
        finalizedAt: Number(finalizedAt),
        saleFinalized: Boolean(saleFinalized),
        legacyAmount: BigInt(legacyAmount),
        privatePurchases: availablePrivate,
        totalPrivateAmount,
        canClaim,
        gateTime: gateTime * 1000,
        isEnded,
      }
    },
    enabled: Boolean(address && provider),
    refetchInterval: 15_000,
  })
}

export default function App() {
  const saleInfo = useAuctionSaleInfo()
  const saleConfig = useSaleConfig()
  const deferredSettlement = useDeferredSettlement()
  const { provider, signer, address, isConnected, isConnecting, connectWithInjected, disconnect, checkConnection } =
    useWalletStore()
  const [walletPickerOpen, setWalletPickerOpen] = useState(false)
  const [walletChoices, setWalletChoices] = useState<InjectedWalletOption[]>([])
  const [payAmount, setPayAmount] = useState('')
  const [paySymbol, setPaySymbol] = useState<PayRailSymbol>('S')
  const [slippageBps, setSlippageBps] = useState(100) // default 1%
  const payRails = useAuctionPayRails()
  const [zkCommitment, setZkCommitment] = useState('')
  const [zkNullifier, setZkNullifier] = useState('')
  const [appView, setAppView] = useState<'sale' | 'bridge' | 'privacy'>('sale')

  useEffect(() => {
    checkConnection().catch(() => undefined)
  }, [checkConnection])

  const runWalletConnect = useCallback(async () => {
    const wallets = await requestInjectedWalletOptions(500)
    if (wallets.length === 0) {
      toast.error(
        `No browser wallet found. Install a Sonic-compatible wallet (${SONIC_WALLET_DOCS_URL}) and refresh.`,
        { duration: 8000 }
      )
      return
    }
    if (wallets.length === 1) {
      await connectWithInjected(wallets[0].provider)
      return
    }
    setWalletChoices(wallets)
    setWalletPickerOpen(true)
  }, [connectWithInjected])

  const pickWallet = useCallback(
    async (w: InjectedWalletOption) => {
      setWalletPickerOpen(false)
      setWalletChoices([])
      await connectWithInjected(w.provider)
    },
    [connectWithInjected]
  )

  const userInfo = useUserInfo(address)
  const claimInfo = useClaimInfo(address)

  const selectedPayRail = useMemo(
    () => payRails.rails.find((r) => r.symbol === paySymbol) ?? payRails.rails[0],
    [payRails.rails, paySymbol]
  )
  const wsPayRail = useMemo(() => payRails.rails.find((r) => r.symbol === 'wS'), [payRails.rails])

  const purchaseRoute = useMemo(
    () => resolvePurchaseRoute(paySymbol, selectedPayRail?.tokenAddress),
    [paySymbol, selectedPayRail?.tokenAddress]
  )

  const payAmountWei = useMemo(() => {
    if (!payAmount.trim()) return null
    return parsePayAmount(payAmount, paySymbol)
  }, [payAmount, paySymbol])

  const tokensPreview = useMemo(() => {
    if (!saleInfo.data || !payAmountWei || payAmountWei <= 0n) return 0n
    return agsOutFromPayment(paySymbol, payAmountWei, saleInfo.data.currentPrice)
  }, [saleInfo.data, payAmountWei, paySymbol])

  const minTokensOut = useMemo(() => {
    if (!tokensPreview) return 0n
    // floor(tokensPreview * (1 - slippageBps/10000))
    const bps = BigInt(10000 - slippageBps)
    return (tokensPreview * bps) / 10000n
  }, [tokensPreview, slippageBps])

  const minPurchaseTokens = useMemo(() => saleInfo.data?.minPurchase ?? 0n, [saleInfo.data])
  const maxPerAddressTokens = useMemo(() => saleInfo.data?.maxPerAddress ?? 0n, [saleInfo.data])
  const remainingAllowance = useMemo(() => (userInfo.data ? userInfo.data.remaining : maxPerAddressTokens), [userInfo.data, maxPerAddressTokens])
  const isUnlimited = useMemo(() => remainingAllowance > 10n ** 27n, [remainingAllowance])
  const belowMin = useMemo(() => tokensPreview > 0n && minPurchaseTokens > 0n && tokensPreview < minPurchaseTokens, [tokensPreview, minPurchaseTokens])
  const aboveMax = useMemo(() => tokensPreview > 0n && !isUnlimited && tokensPreview > remainingAllowance, [tokensPreview, remainingAllowance, isUnlimited])

  const progress = useMemo(() => {
    if (!saleInfo.data) return 0
    const { tokensSold, totalTokens } = saleInfo.data
    if (totalTokens === 0n) return 0
    return Number((tokensSold * 10_000n) / totalTokens) / 100
  }, [saleInfo.data])

  const allowanceQ = useQuery({
    queryKey: ['auction-pay-allowance', address, selectedPayRail?.tokenAddress, ENV.auctionAddress],
    queryFn: async () => {
      if (!address || !selectedPayRail?.tokenAddress) return 0n
      return fetchErc20Allowance(
        getPublicProvider(),
        selectedPayRail.tokenAddress,
        address,
        ENV.auctionAddress
      )
    },
    enabled: Boolean(address && selectedPayRail?.tokenAddress),
    refetchInterval: 15_000,
  })

  const needsErc20Approval =
    purchaseRoute === 'private-erc20' &&
    !!selectedPayRail?.tokenAddress &&
    !needsWsNormalization(paySymbol) &&
    payAmountWei != null &&
    payAmountWei > 0n &&
    (allowanceQ.data ?? 0n) < payAmountWei

  const handlePurchase = async () => {
    // Security checks with DDoS protection
    try {
      checkRateLimit('critical') // Use 'critical' for purchase operations (financial transactions)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit exceeded. Please wait before trying again.')
      return
    }

    if (!saleInfo.data) {
      toast.error('Sale data unavailable')
      return
    }
    if (!isConnected || !signer) {
      await runWalletConnect()
      return
    }

    // Input validation
    const amountValidation = validateAmount(payAmount)
    if (!amountValidation.valid) {
      toast.error(amountValidation.error || 'Invalid amount')
      return
    }
    if (!payAmountWei || payAmountWei <= 0n) {
      toast.error('Invalid amount')
      return
    }
    if (belowMin) {
      toast.error(`Amount below minimum: ${formatToken(minPurchaseTokens)} AGS`)
      return
    }
    if (aboveMax) {
      const maxText = isUnlimited ? 'Unlimited' : `${formatToken(remainingAllowance)} AGS`
      toast.error(`Amount exceeds your remaining allowance: ${maxText}`)
      return
    }

    const slippageValidation = validateSlippage(slippageBps / 100)
    if (!slippageValidation.valid) {
      toast.error(slippageValidation.error || 'Invalid slippage')
      return
    }

    // Attack pattern detection
    if (detectAttackPattern(payAmount) || detectAttackPattern(zkCommitment) || detectAttackPattern(zkNullifier)) {
      toast.error('Invalid input detected')
      return
    }

    if (zkCommitment && !isValidHex(zkCommitment, 32)) {
      toast.error('Invalid commitment format (must be 32-byte hex)')
      return
    }
    if (zkNullifier && !isValidHex(zkNullifier, 32)) {
      toast.error('Invalid nullifier format (must be 32-byte hex)')
      return
    }
    try {
      const contract = getAuctionContract(signer)
      if (!address) {
        toast.error('Wallet address unavailable')
        return
      }
      toast.loading('Processing purchase...', { id: 'purchase' })

      if (needsWsNormalization(paySymbol)) {
        toast.loading(`Routing ${paySymbol} → wS via Odos…`, { id: 'odos-swap' })
      }

      const prepared = await prepareAuctionPayment({
        signer,
        userAddress: address,
        chainId: ENV.chainId,
        paySymbol,
        payAmountWei,
        payRail: selectedPayRail!,
        wsTokenAddress: wsPayRail?.tokenAddress ?? null,
        auctionAddress: ENV.auctionAddress,
        currentPriceWeiPerAgs: saleInfo.data.currentPrice,
        slippageBps,
      })

      if (needsWsNormalization(paySymbol)) {
        toast.success('Payment normalized to wS', { id: 'odos-swap' })
      } else if (
        prepared.route === 'erc20' &&
        selectedPayRail?.tokenAddress &&
        needsErc20Approval
      ) {
        toast.loading(`Approving ${paySymbol}…`, { id: 'approve' })
        await approveErc20ForAuction(
          signer,
          selectedPayRail.tokenAddress,
          ENV.auctionAddress,
          payAmountWei
        )
        toast.success('Approved', { id: 'approve' })
        allowanceQ.refetch()
      }

      toast.loading('Generating ZK proof for private purchase...', { id: 'zk-proof' })
      const { proveAuctionPurchase } = await import('./utils/auctionProof')
      const proverUrl = (ENV as { proverUrl?: string }).proverUrl
      const { proof, commitment, nullifier } = await proveAuctionPurchase({
        proverUrl,
        manualCommitment: zkCommitment || undefined,
        manualNullifier: zkNullifier || undefined,
      })
      toast.success('ZK proof ready', { id: 'zk-proof' })

      toast.loading('Submitting private purchase...', { id: 'purchase' })
      let tx
      if (prepared.route === 'erc20') {
        tx = await contract.purchaseTokensWithErc20(
          proof,
          commitment,
          nullifier,
          prepared.paymentToken,
          prepared.paymentAmountWei,
          prepared.minTokensOut
        )
      } else {
        tx = await contract.purchaseTokens(proof, commitment, nullifier, prepared.minTokensOut, {
          value: prepared.payAmountWei,
        })
      }
      toast.loading('Waiting for confirmation...', { id: 'purchase' })
      const { address: userAddress, provider: userProvider } = useWalletStore.getState()
      if (userAddress && userProvider) {
        await waitAndParseTransaction(tx, userAddress, userProvider)
      } else {
        await tx.wait()
      }
      toast.success('Purchase completed', { id: 'purchase' })
      setPayAmount('')
      saleInfo.refetch()
      userInfo.refetch()
    } catch (error) {
      console.error('purchase failed', error)
      const message = error instanceof Error ? error.message : 'Purchase failed'
      toast.error(message, { id: 'purchase' })
    }
  }

  const saleReady = Boolean(saleInfo.data)
  const salePending = saleInfo.isPending
  const saleLoadFailed = saleInfo.isError && !saleReady
  const isNotStarted =
    saleReady && (!saleInfo.data!.isActive || saleInfo.data!.auctionStartTime === 0)
  const isEnded = saleReady && saleInfo.data!.isCompleted
  const isStarted = saleReady && !isNotStarted && !isEnded
  const activeCountdown = saleInfo.data?.timeRemaining ?? 0
  const compact = isCompactTgeUi()

  const headerActions = (
    <>
      <AddAgsToWalletButton compact />
      {isConnected ? (
        <>
          <span className="text-sm font-mono text-terminal-text-dim">
            {address?.slice(0, 6)}…{address?.slice(-4)}
          </span>
          <button type="button" className="btn-secondary text-sm" onClick={disconnect}>
            Disconnect
          </button>
        </>
      ) : (
        <button
          type="button"
          className="btn-primary text-sm"
          disabled={isConnecting}
          onClick={() => void runWalletConnect()}
        >
          {isConnecting ? 'Connecting…' : 'Connect wallet'}
        </button>
      )}
    </>
  )

  return (
    <SecurityProvider>
      <TgeLayout appView={appView} onViewChange={setAppView} headerActions={headerActions}>
      {walletPickerOpen && walletChoices.length > 0 && (
        <>
          <div
            role="presentation"
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 1000,
              background: 'rgba(0,0,0,0.65)',
            }}
            onClick={() => {
              setWalletPickerOpen(false)
              setWalletChoices([])
            }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="td-wallet-picker-title"
            style={{
              position: 'fixed',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 1001,
              width: 'min(100vw - 2rem, 22rem)',
              maxHeight: 'min(70vh, 24rem)',
              overflow: 'auto',
              padding: '1rem',
              borderRadius: '8px',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
            }}
          >
            <h2 id="td-wallet-picker-title" style={{ margin: 0, fontSize: '1rem' }}>
              Choose wallet
            </h2>
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
              Multiple extensions detected (EIP-6963). Same wallets as on{' '}
              <a href={SONIC_WALLET_DOCS_URL} target="_blank" rel="noreferrer" style={{ color: 'var(--color-accent)' }}>
                Sonic
              </a>
              .
            </p>
            <ul style={{ listStyle: 'none', margin: '0.75rem 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {walletChoices.map((w) => (
                <li key={w.info.uuid}>
                  <button
                    type="button"
                    onClick={() => void pickWallet(w)}
                    style={{
                      display: 'flex',
                      width: '100%',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '10px 12px',
                      borderRadius: '6px',
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-surface)',
                      color: 'var(--color-text)',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <span
                      style={{
                        width: 36,
                        height: 36,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '6px',
                        border: '1px solid var(--color-accent)',
                        background: 'rgba(0, 122, 255, 0.08)',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        color: 'var(--color-accent)',
                      }}
                      aria-hidden
                    >
                      {walletPickerInitial(w.info.name)}
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem' }}>{w.info.name}</span>
                      <span style={{ display: 'block', fontSize: '10px', color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.info.rdns}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="ghost"
              style={{ marginTop: '12px', width: '100%' }}
              onClick={() => {
                setWalletPickerOpen(false)
                setWalletChoices([])
              }}
            >
              Cancel
            </button>
          </div>
        </>
      )}

        {appView === 'bridge' ? (
          <section className="card">
            <SonicGatewayBridgePanel />
          </section>
        ) : appView === 'privacy' ? (
          <TgePrivacyEntryPanel
            signer={signer}
            address={address}
            isConnected={isConnected}
            onConnectWallet={() => void runWalletConnect()}
          />
        ) : (
          <>
        <AuctionDailyPricePanel />

        {!compact ? (
          <section className="card space-y-3">
            <h1 className="text-xl font-semibold text-terminal-text">ZK-native Dutch sale</h1>
            <p className="text-sm text-terminal-text-dim leading-relaxed">
              Primary AGS issuance on Sonic via <strong className="text-terminal-text">AutomatedDutchAuction</strong>.
              Pay with S, wS, or bridged stablecoins. Optional Groth16 private purchase mode uses the same linear schedule.
            </p>
            {saleInfo.data ? (
              <p className="text-sm text-terminal-text-dim">
                <strong className="text-terminal-text">On-chain supply:</strong>{' '}
                <span className="font-mono">{formatToken(saleInfo.data.tokensSold)}</span> sold ·{' '}
                <span className="font-mono">{formatToken(saleInfo.data.remainingTokens)}</span> remaining (of{' '}
                <span className="font-mono">{formatToken(saleInfo.data.totalTokens)}</span> offered).
              </p>
            ) : null}
            <p className="text-xs text-terminal-text-dim">
              <a href={AEGIS_COMMUNITY.x} target="_blank" rel="noopener noreferrer" className="text-terminal-accent hover:underline">
                X
              </a>
              {' · '}
              <a href={AEGIS_COMMUNITY.telegram} target="_blank" rel="noopener noreferrer" className="text-terminal-accent hover:underline">
                Telegram
              </a>
              {' · '}
              <a href={AEGIS_COMMUNITY.github} target="_blank" rel="noopener noreferrer" className="text-terminal-accent hover:underline">
                GitHub
              </a>
              {ENV.saleDocsUrl ? (
                <>
                  {' · '}
                  <a href={ENV.saleDocsUrl} target="_blank" rel="noopener noreferrer" className="text-terminal-accent hover:underline">
                    Sale docs
                  </a>
                </>
              ) : null}
            </p>
          </section>
        ) : null}

        <section className="card space-y-4">
          <h2 className="text-lg font-semibold text-terminal-text">Auction status</h2>
          {salePending && <p className="muted">Loading...</p>}
          {saleLoadFailed && (
            <p className="muted">
              Unable to load auction data from RPC. Check your network / RPC setting and refresh.
              <button type="button" className="ghost" style={{ marginLeft: '0.5rem' }} onClick={() => void saleInfo.refetch()}>
                Retry
              </button>
            </p>
          )}
          {saleInfo.data && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <Metric 
                label="Current ask" 
                value={`${formatPriceWei(saleInfo.data.currentPrice, 6)} S`} 
                helper="Discovery rule per AGS (spot at next fill)" 
              />
              <Metric 
                label="Progress" 
                value={`${progress.toFixed(1)}%`} 
                helper={`${formatToken(saleInfo.data.tokensSold)} of ${formatToken(saleInfo.data.totalTokens)} sold`} 
              />
              <Metric 
                label="Sold" 
                value={`${formatToken(saleInfo.data.tokensSold)} AGS`} 
                helper="Cumulative sold" 
              />
              <Metric 
                label="Remaining" 
                value={`${formatToken(saleInfo.data.remainingTokens)} AGS`} 
                helper="Tokens available" 
              />
              <Metric
                label="Days Left"
                value={`${Math.ceil((saleInfo.data.timeRemaining || 0) / 86400)} days`}
                helper="Until sale end"
              />
              <Metric
                label="Status"
                value={isNotStarted ? 'Not started' : isEnded ? 'Ended' : 'Active'}
                helper={isNotStarted
                  ? 'Awaiting on-chain activation'
                  : isEnded
                    ? 'Final price determined'
                    : `${formatCountdown(activeCountdown)} remaining`}
              />
              <Metric
                label="Price Range"
                value={`${formatPriceWei(saleInfo.data.reservePrice, 6)} - ${formatPriceWei(saleInfo.data.startPrice, 6)}`}
                helper="Reserve to start price"
              />
              <Metric
                label="Purchase Limits"
                value={`${formatToken(saleInfo.data.minPurchase)} min`}
                helper={saleInfo.data.limitsExpired ? 'No maximum' : `Max ${formatToken(saleInfo.data.maxPerAddress)} per address`}
              />
              <Metric
                label="Mean fill (VWAP)"
                value={
                  saleInfo.data.meanPrice > 0n
                    ? `${formatPriceWei(saleInfo.data.meanPrice, 6)} S`
                    : '—'
                }
                helper="S per AGS implied by aggregate fills"
              />
              <Metric
                label="On-chain curve"
                value={`ID ${saleInfo.data.curveId}`}
                helper={describeAuctionCurve(saleInfo.data.curveId)}
              />
            </div>
          )}
        </section>

        <section className="card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-terminal-text">Purchase AGS</h2>
            {ENV.explorerUrl && ENV.auctionAddress && (
              <a 
                href={`${ENV.explorerUrl}/address/${ENV.auctionAddress}`} 
                target="_blank" 
                rel="noopener noreferrer"
              >
                View Contract
              </a>
            )}
          </div>
          <div className={compact ? 'participate participate--single' : 'participate'}>
            <div className="form">
              <fieldset className="td-pay-field">
                <legend className="td-pay-legend">Pay with</legend>
                <div className="td-pay-rail-grid" role="radiogroup" aria-label="Payment token">
                  {payRails.rails.map((rail) => {
                    const active = paySymbol === rail.symbol
                    return (
                      <button
                        key={rail.symbol}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        className={active ? 'td-pay-rail td-pay-rail--active' : 'td-pay-rail'}
                        title={PAY_TOKEN_LABELS[rail.symbol]}
                        onClick={() => {
                          setPaySymbol(rail.symbol)
                          setPayAmount('')
                        }}
                      >
                        <span className="td-pay-rail-symbol">{rail.symbol}</span>
                        <span className="td-pay-rail-name">{PAY_TOKEN_LABELS[rail.symbol]}</span>
                      </button>
                    )
                  })}
                </div>
                {needsWsNormalization(paySymbol) ? (
                  <p className="td-pay-hint" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginTop: '0.5rem' }}>
                    {paySymbol} checkout routes through wS (Odos) before the private auction fill.
                  </p>
                ) : null}
              </fieldset>
              <>
                <label htmlFor="pay-input">Amount ({paySymbol})</label>
                <input
                  id="pay-input"
                  type="number"
                  min="0"
                  step={paySymbol === 'USDC' || paySymbol === 'USDT' || paySymbol === 'EURC' ? '0.01' : '0.001'}
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  placeholder="0.0"
                  disabled={salePending || saleLoadFailed || !saleReady || isNotStarted || isEnded}
                />
              </>
              <label htmlFor="slip-input">Slippage tolerance (%)</label>
              <input
                id="slip-input"
                type="number"
                min="0"
                max="5"
                step="0.1"
                value={(slippageBps / 100).toString()}
                onChange={(e) => {
                  const v = Math.max(0, Math.min(500, Math.floor(parseFloat(e.target.value || '0') * 100)))
                  setSlippageBps(Number.isFinite(v) ? v : 100)
                }}
              />
              <div className="preview">
                <span>You will receive</span>
                <strong>{formatToken(tokensPreview)} AGS</strong>
              </div>
              <DutchTgeWalletBalances provider={getPublicProvider()} address={address} />
              <details className="zk-box">
                <summary>Advanced (optional): restore a saved purchase</summary>
                <p className="zk-box-intro">
                  You can ignore this on a normal buy — the app generates everything when you click Buy AGS.
                </p>
                <label htmlFor="zk-commitment">Commitment</label>
                <p className="zk-field-hint">
                  Your private purchase receipt. Leave empty for a new buy; paste only if you are restoring from a backup saved in this browser.
                </p>
                <input
                  id="zk-commitment"
                  type="text"
                  placeholder="0x... (32-byte hex)"
                  value={zkCommitment}
                  onChange={(e) => setZkCommitment(e.target.value)}
                />
                <label htmlFor="zk-nullifier">Nullifier</label>
                <p className="zk-field-hint">
                  A one-time spend tag paired with your commitment. Leave empty for a new buy; paste only together with the matching commitment from backup.
                </p>
                <input
                  id="zk-nullifier"
                  type="text"
                  placeholder="0x... (32-byte hex)"
                  value={zkNullifier}
                  onChange={(e) => setZkNullifier(e.target.value)}
                />
              </details>
              <button 
                className="btn-primary w-full" 
                onClick={handlePurchase}
                disabled={
                  salePending ||
                  saleLoadFailed ||
                  !saleReady ||
                  isNotStarted ||
                  isEnded ||
                  (!payAmount || parseFloat(payAmount) <= 0) ||
                  belowMin ||
                  aboveMax ||
                  Boolean(userInfo.data && !userInfo.data.canPurchase)
                }
              >
                {salePending
                  ? 'Loading…'
                  : saleLoadFailed
                    ? 'Sale data unavailable'
                  : !isConnected
                  ? 'Connect Wallet to Buy'
                  : isNotStarted
                    ? 'Auction not started yet'
                    : isEnded
                      ? 'Auction ended'
                      : 'Buy AGS'}
              </button>
              {(belowMin || aboveMax) && (
                <p className="muted">
                  {belowMin && `Minimum purchase is ${formatToken(minPurchaseTokens)} AGS.`}
                  {aboveMax && ` Maximum allowed now: ${isUnlimited ? 'Unlimited' : `${formatToken(remainingAllowance)} AGS`}.`}
                </p>
              )}
              {isNotStarted && saleInfo.data && (
                <p className="muted">
                  The Dutch sale has not been activated on-chain yet. Purchases unlock when the operator opens the window.
                </p>
              )}
              {isEnded && saleInfo.data && (
                <p className="muted">Sale window closed on-chain. Final accounting follows contract state (see explorer).</p>
              )}
            </div>
            {!compact ? (
            <aside className="context">
              <h3>Your allowance</h3>
              {userInfo.data ? (
                <div className="user-stats">
                  <p>Purchased: {formatToken(userInfo.data.purchased)} AGS</p>
                  <p>
                    Remaining: {userInfo.data.remaining > 10n ** 27n
                      ? 'Unlimited'
                      : `${formatToken(userInfo.data.remaining)} AGS`}
                  </p>
                  {!userInfo.data.canPurchase && userInfo.data.nextPurchaseTime > Date.now() && (
                    <p className="muted">
                      Next buy after {new Date(userInfo.data.nextPurchaseTime).toLocaleTimeString()}
                    </p>
                  )}
                </div>
              ) : (
                <p className="muted">Connect your wallet to see your live purchase allowance.</p>
              )}
              <p className="muted" style={{ marginTop: 'var(--space-md)' }}>
                Sale rules, tokenomics, and how delivery works are summarized below the purchase form.
              </p>
            </aside>
            ) : null}
          </div>
        </section>

        <SaleGuideSection
          saleInfo={saleInfo.data}
          saleConfig={saleConfig.data}
          deferred={deferredSettlement.data}
          isStarted={isStarted}
          isEnded={Boolean(isEnded)}
        />

        {deferredSettlement.data ? (
          <ClaimSection
            claimInfo={claimInfo.data}
            address={address}
            isConnected={isConnected}
          />
        ) : saleInfo.data && isEnded ? (
          <section className="card space-y-3">
            <h2 className="text-lg font-semibold text-terminal-text">Your AGS</h2>
            <p className="text-sm text-terminal-text-dim">
              This sale delivers AGS in the same transaction when you buy — there is no separate claim step.
              Check your wallet balance if you purchased during the window.
            </p>
            <AddAgsToWalletButton />
          </section>
        ) : null}

          </>
        )}
      </TgeLayout>
    </SecurityProvider>
  )
}

type MetricProps = {
  label: string
  value: string
  helper?: string
}

function Metric({ label, value, helper }: MetricProps) {
  return (
    <div className="rounded-lg border border-terminal-border bg-terminal-bg/50 p-3">
      <span className="text-xs uppercase tracking-wide text-terminal-text-dim">{label}</span>
      <strong className="block mt-1 text-sm font-semibold text-terminal-text tabular-nums">{value}</strong>
      {helper ? <span className="block mt-1 text-xs text-terminal-text-dim">{helper}</span> : null}
    </div>
  )
}

type SaleGuideSectionProps = {
  saleInfo: ReturnType<typeof useAuctionSaleInfo>['data']
  saleConfig: ReturnType<typeof useSaleConfig>['data']
  deferred: boolean | undefined
  isStarted: boolean
  isEnded: boolean
}

/** Production defaults when chain reads are unavailable (matches deploy scripts + docs). */
const SALE_DEFAULTS = {
  durationDays: 30,
  saleTokensLabel: '9.5M',
  minAgs: '100',
  dailyCapAgs: '2,000',
  totalCapAgs: '10,000',
  supplyCap: '21,000,000',
} as const

function SaleGuideSection({ saleInfo, saleConfig, deferred, isStarted, isEnded }: SaleGuideSectionProps) {
  const cfg = saleInfo ?? saleConfig
  const durationDays =
    saleInfo?.auctionDuration && saleInfo.auctionDuration > 0
      ? Math.max(1, Math.round(saleInfo.auctionDuration / 86_400))
      : cfg && cfg.endTime > cfg.startTime && cfg.startTime > 0
      ? Math.max(1, Math.round((cfg.endTime - cfg.startTime) / 86_400_000))
      : SALE_DEFAULTS.durationDays
  const minPurchase = saleInfo?.minPurchase ?? saleConfig?.minPurchase
  const maxPerAddress = saleInfo?.maxPerAddress ?? saleConfig?.maxPerAddress
  const totalOffered = saleInfo?.totalTokens
  const priceLow = cfg?.reservePrice
  const priceHigh = cfg?.startPrice
  const deferredOn = deferred === true

  const receiveAnswer = deferredOn
    ? 'This deployment uses deferred settlement: your entitlement is recorded on-chain during the sale — AGS is not sent in the buy transaction. After the window closes and a 24-hour safety period, return with the same wallet; the Claim section below handles delivery (including the short ZK claim proof when configured).'
    : 'Yours the moment you buy — AGS in your wallet in the same transaction. No claim ticket. No calendar reminder. No second trip.'

  const statusNote = !isStarted
    ? ' The sale has not been activated on-chain yet — buys unlock after the operator calls activate().'
    : isEnded
      ? ' The sale window has ended — new purchases are closed.'
      : ''

  return (
    <section className="card space-y-4 tge-sale-guide">
      <h2 className="text-lg font-semibold text-terminal-text">About this sale</h2>
      <dl className="sale-faq">
        <div className="sale-faq-item">
          <dt>What kind of sale is this?</dt>
          <dd>
            A <strong>Dutch auction</strong> — primary AGS issuance designed to <strong>discover market price</strong>, not
            a fixed discount list. The ask starts high and falls on a published schedule until the window ends or every
            offered AGS is sold. You pay the <strong>spot price at the second your transaction confirms</strong>, not an
            average of what others paid.{statusNote}
          </dd>
        </div>
        <div className="sale-faq-item">
          <dt>How long does it run?</dt>
          <dd>
            About <strong>{durationDays} day{durationDays === 1 ? '' : 's'}</strong> once activated
            {cfg?.endTime ? (
              <>
                {' '}
                (scheduled end: <strong>{new Date(cfg.endTime).toLocaleString()}</strong>, chain time)
              </>
            ) : (
              <> — default production window is {SALE_DEFAULTS.durationDays} days</>
            )}
            .
          </dd>
        </div>
        <div className="sale-faq-item">
          <dt>How much AGS is offered?</dt>
          <dd>
            {totalOffered ? (
              <>
                <strong>{formatToken(totalOffered)} AGS</strong> in this auction tranche
                {saleInfo ? (
                  <> — {formatToken(saleInfo.tokensSold)} sold so far, {formatToken(saleInfo.remainingTokens)} remaining</>
                ) : null}
                . About <strong>1M AGS</strong> from the broader allocation is reserved to seed public liquidity after the
                sale completes.
              </>
            ) : (
              <>
                About <strong>{SALE_DEFAULTS.saleTokensLabel} AGS</strong> in the auction, with roughly <strong>1M AGS</strong>{' '}
                reserved to seed liquidity when the sale finishes.
              </>
            )}
          </dd>
        </div>
        <div className="sale-faq-item">
          <dt>How can I pay?</dt>
          <dd>
            Native Sonic (<strong>S</strong>), wrapped Sonic (<strong>wS</strong>), <strong>WETH</strong>,{' '}
            <strong>USDC</strong>, <strong>USDT</strong>, or <strong>EURC</strong> — select a rail in the form above.
            Coming from Ethereum? Use the <strong>Ethereum ⇌ Sonic bridge</strong> tab, then buy with the same asset on
            Sonic.
          </dd>
        </div>
        <div className="sale-faq-item">
          <dt>What are the purchase limits?</dt>
          <dd>
            Minimum <strong>{minPurchase ? `${formatToken(minPurchase)} AGS` : `${SALE_DEFAULTS.minAgs} AGS`}</strong> per
            transaction.
            {maxPerAddress ? (
              <>
                {' '}
                Per wallet: up to <strong>{SALE_DEFAULTS.dailyCapAgs} AGS per 24 hours</strong> and{' '}
                <strong>{SALE_DEFAULTS.totalCapAgs} AGS for the entire sale</strong> (TimeLock + sybil protection on
                production deploys); the auction also enforces a per-address ceiling of{' '}
                <strong>{formatToken(maxPerAddress)} AGS</strong> — your wallet panel shows the live remainder.
              </>
            ) : (
              <>
                {' '}
                Per wallet on production: up to <strong>{SALE_DEFAULTS.dailyCapAgs} AGS per 24 hours</strong> and{' '}
                <strong>{SALE_DEFAULTS.totalCapAgs} AGS total</strong>, plus a <strong>one-hour cooldown</strong> between
                buys from the same address.
              </>
            )}
          </dd>
        </div>
        {priceLow != null && priceHigh != null ? (
          <div className="sale-faq-item">
            <dt>What price will I pay?</dt>
            <dd>
              The live ask moves down over time between{' '}
              <strong>{formatPriceWei(priceLow, 6)} S</strong> (reserve floor) and{' '}
              <strong>{formatPriceWei(priceHigh, 6)} S</strong> (starting ceiling) per AGS — see{' '}
              <strong>Current ask</strong> above for the spot right now. Stablecoin and WETH rails convert at TGE pegs
              before the Dutch rule applies.
            </dd>
          </div>
        ) : null}
        <div className="sale-faq-item">
          <dt>Who sees you buy?</dt>
          <dd>
            Not the crowd. Your purchase is proved in zero knowledge — no ranked buyer list, no checkout that turns
            your wallet into a billboard. What arrives afterward is different: AGS lands in your{' '}
            <strong>visible balance</strong>, where anyone with a block explorer can count it. The buy is discreet. Where
            you keep it is your choice.
          </dd>
        </div>
        <div className="sale-faq-item">
          <dt>The buy is private. Should your holdings be?</dt>
          <dd>
            The auction hands you AGS in the open — that&apos;s the handshake. <strong>Privacy entry</strong> is the door
            that closes behind you. Same site, one tab: connect, name an amount, step off the glass. What you earned stops
            being everyone else&apos;s business. The main Aegis wallet offers the same path if you prefer to live there
            full-time.
          </dd>
        </div>
        <div className="sale-faq-item">
          <dt>When do I receive AGS?</dt>
          <dd>{receiveAnswer}</dd>
        </div>
        <div className="sale-faq-item">
          <dt>What happens after the sale?</dt>
          <dd>
            Unsold tokens and proceeds follow <strong>DAO-directed policy</strong> into public liquidity, treasury, and
            ecosystem programs — not a discretionary off-chain decision. Liquidity seeding and post-sale routing are
            governed on-chain.
          </dd>
        </div>
        <div className="sale-faq-item">
          <dt>AGS supply &amp; allocation</dt>
          <dd>
            <strong>{SALE_DEFAULTS.supplyCap} AGS — fixed forever</strong> (hard cap, no hidden inflation). Broad
            allocation design: <strong>50%</strong> public sale + liquidity, <strong>30%</strong> ecosystem rewards,{' '}
            <strong>20%</strong> development — no special insider carve-out in the published split. This sale is how AGS
            finds its opening market price; early participants enter the same private financial system the protocol ships
            afterward.
          </dd>
        </div>
      </dl>
    </section>
  )
}

type ClaimSectionProps = {
  claimInfo: ReturnType<typeof useClaimInfo>['data']
  address: string | null
  isConnected: boolean
}

function ClaimSection({ claimInfo, address, isConnected }: ClaimSectionProps) {
  const { signer } = useWalletStore()
  const [claimMode, setClaimMode] = useState<'legacy' | 'zk'>('legacy')
  const [selectedCommitment, setSelectedCommitment] = useState<string | 'public'>('public')
  const [claiming, setClaiming] = useState(false)

  useEffect(() => {
    if (!claimInfo) return
    if (claimInfo.legacyAmount > 0n) {
      setClaimMode('legacy')
      setSelectedCommitment('public')
    } else if (claimInfo.privatePurchases.length > 0) {
      setClaimMode('zk')
      setSelectedCommitment(claimInfo.privatePurchases[0].commitment)
    }
  }, [claimInfo?.legacyAmount, claimInfo?.privatePurchases])

  const handleClaim = async () => {
    if (!claimInfo) return
    try {
      checkRateLimit('critical')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit exceeded')
      return
    }

    if (!isConnected || !signer || !address) {
      toast.error('Please connect wallet')
      return
    }

    setClaiming(true)
    try {
      const contract = getAuctionContract(signer)
      toast.loading('Processing claim...', { id: 'claim' })
      
      if (claimMode === 'legacy' || selectedCommitment === 'public') {
        const tx = await contract.claim()
        toast.loading('Waiting for confirmation...', { id: 'claim' })
        const { address: userAddress, provider: userProvider } = useWalletStore.getState()
        if (userAddress && userProvider) {
          await waitAndParseTransaction(tx, userAddress, userProvider)
        } else {
          await tx.wait()
        }
        toast.success('Claim completed', { id: 'claim' })
      } else {
        // ZK claim path for a specific commitment
        const record = claimInfo.privatePurchases.find(p => p.commitment === selectedCommitment)
        if (!record) throw new Error('Selected purchase record not found')

        const proverUrl = (ENV as any).proverUrl as string | undefined
        let proof: bigint[]
        let publicInputs: bigint[]

        toast.loading('Generating ZK proof for private claim...', { id: 'zk-claim-proof' })

        if (proverUrl) {
          try {
            const res = await criticalFetch(`${proverUrl}/auction/claim/prove`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                recipient: address,
                commitment: record.commitment,
                // Secret should be handled securely, usually stored locally with the record
                secret: record.metadata?.secret || '0x0' 
              }),
            })
            if (!res.ok) throw new Error('Proof service error')
            const data = await res.json()
            proof = (data.proof ?? []).map((x: string) => BigInt(x))
            publicInputs = (data.publicInputs ?? []).map((x: string) => BigInt(x))
            toast.success('ZK proof generated!', { id: 'zk-claim-proof' })
          } catch (error) {
            toast.error('Service error, falling back to local proving.', { id: 'zk-claim-proof' })
            const { proveAuctionClaim } = await import('./utils/prover')
            const result = await proveAuctionClaim({ 
              recipient: address,
              commitment: record.commitment,
              secret: record.metadata?.secret || '0x0'
            })
            proof = result.proof
            publicInputs = result.publicInputs
          }
        } else {
          try {
            const { proveAuctionClaim } = await import('./utils/prover')
            const result = await proveAuctionClaim({ 
              recipient: address,
              commitment: record.commitment,
              secret: record.metadata?.secret || '0x0'
            })
            proof = result.proof
            publicInputs = result.publicInputs
            toast.success('ZK proof generated locally!', { id: 'zk-claim-proof' })
          } catch (error) {
            throw new Error('Failed to generate proof locally.')
          }
        }

        toast.loading('Submitting private claim...', { id: 'claim' })
        const tx = await contract.claimPrivate(selectedCommitment as `0x${string}`, proof, publicInputs)
        toast.loading('Waiting for confirmation...', { id: 'claim' })
        const { address: userAddress, provider: userProvider } = useWalletStore.getState()
        if (userAddress && userProvider) {
          await waitAndParseTransaction(tx, userAddress, userProvider)
        } else {
          await tx.wait()
        }
        toast.success('Private claim completed', { id: 'claim' })
      }
    } catch (error) {
      console.error('claim failed', error)
      toast.error(error instanceof Error ? error.message : 'Claim failed', { id: 'claim' })
    } finally {
      setClaiming(false)
    }
  }

  if (!claimInfo) {
    return (
      <section className="card space-y-3 tge-claim-panel">
        <h2 className="text-lg font-semibold text-terminal-text">Claim your AGS</h2>
        <p className="text-sm text-terminal-text-dim">
          {isConnected
            ? 'Loading your entitlement…'
            : 'Connect the wallet you used to buy. After the sale ends and the 24-hour safety window, your Claim AGS button appears here.'}
        </p>
      </section>
    )
  }

  const totalAvailable = claimInfo.legacyAmount + claimInfo.totalPrivateAmount

  return (
    <section className="card space-y-4 tge-claim-panel">
      <h2 className="text-lg font-semibold text-terminal-text">Claim your AGS</h2>
      {!isConnected ? (
        <p className="text-sm text-terminal-text-dim">Connect the same wallet you used to buy. Your claim button appears here — tokens are not sent automatically.</p>
      ) : claimInfo.isEnded ? (
        <>
          {claimInfo.canClaim ? (
            <>
              <p className="muted" style={{ marginBottom: '1rem' }}>
                Total available to claim: {formatToken(totalAvailable)} AGS
              </p>
              
              <div style={{ marginBottom: '1rem' }}>
                <label>Select entitlement to claim:</label>
                <select 
                  value={selectedCommitment} 
                  onChange={(e) => {
                    const val = e.target.value
                    setSelectedCommitment(val)
                    setClaimMode(val === 'public' ? 'legacy' : 'zk')
                  }}
                  style={{ width: '100%', padding: '8px', marginTop: '4px' }}
                >
                  {claimInfo.legacyAmount > 0n && (
                    <option value="public">Wallet purchase ({formatToken(claimInfo.legacyAmount)} AGS)</option>
                  )}
                  {claimInfo.privatePurchases.map((p, i) => (
                    <option key={p.commitment} value={p.commitment}>
                      Private purchase #{i + 1} ({formatToken(p.amount)} AGS)
                    </option>
                  ))}
                </select>
              </div>

              <button
                className="btn-primary w-full"
                onClick={handleClaim}
                disabled={!isConnected || claiming}
                style={{ width: '100%' }}
              >
                {claiming
                  ? 'Claiming...'
                  : selectedCommitment === 'public'
                    ? 'Claim AGS'
                    : 'Claim AGS (private)'}
              </button>
            </>
          ) : (
            <p className="muted">
              {totalAvailable > 0n
                ? `Your ${formatToken(totalAvailable)} AGS unlock for claim on ${new Date(claimInfo.gateTime).toLocaleString()} (24 hours after the sale finalizes).`
                : 'No AGS entitlement found for this wallet. If you bought with a private commitment, unlock your commitment vault or use the same browser profile.'}
            </p>
          )}
        </>
      ) : (
        <p className="muted">
          {totalAvailable > 0n
            ? `You are registered for ${formatToken(totalAvailable)} AGS. When the sale ends, wait 24 hours after finalization, then claim here — the button activates automatically.`
            : 'After you buy during the sale, your entitlement shows here. Claim opens when the sale ends plus a 24-hour safety window.'}
        </p>
      )}
    </section>
  )
}
