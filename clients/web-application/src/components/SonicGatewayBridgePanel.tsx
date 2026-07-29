import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { formatUnits, parseUnits } from 'ethers'
import toast from 'react-hot-toast'
import { DEFAULT_NETWORK } from '@/config/contracts'
import { useWalletStore } from '@/store/walletStore'
import {
  ETH_CHAIN_ID,
  SONIC_MAINNET_CHAIN_ID,
  approveOnEthereum,
  browserProviderForChain,
  buildBridgeTokenOptions,
  claimOnSonic,
  clearPendingDeposit,
  depositOnEthereum,
  fetchEthAllowance,
  fetchEthTokenBalance,
  generateDepositProof,
  loadPendingDeposit,
  savePendingDeposit,
  sonicStateOracleCoversBlock,
  switchWalletChain,
  waitForSonicStateOracle,
  type BridgeTokenOption,
  type PendingBridgeDeposit,
} from '@/utils/sonicProgrammaticGateway'

const SONIC_GATEWAY_APP = 'https://gateway.soniclabs.com'
const DOC_SONIC_GATEWAY = 'https://docs.soniclabs.com/sonic/sonic-gateway'
const DOC_PROGRAMMATIC_GATEWAY = 'https://docs.soniclabs.com/sonic/build-on-sonic/programmatic-gateway'

const TGE_BRIDGE_SYMBOLS = new Set(['USDC', 'EURC', 'USDT', 'WETH'])

const TOKEN_DISPLAY_NAME: Record<string, string> = {
  wS: 'Wrapped Sonic',
  USDC: 'USD Coin',
  EURC: 'Euro Coin',
  USDT: 'Tether',
  WETH: 'Wrapped Ether',
}

const ZERO = '0x0000000000000000000000000000000000000000'

type PackRow = {
  tokenSymbol: string
  tokenAddress: string
  enabled?: boolean
  settlementRail?: string
}

type ChainPackSlice = {
  chainId: number
  blockExplorer?: string
  bridgeTokens?: PackRow[]
}

async function fetchBridgeContext(): Promise<{
  layer: ChainPackSlice | undefined
  isTestnet: boolean
}> {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/')
  const res = await fetch(`${base}config/sonic-chain-pack.json`, { cache: 'default' })
  if (!res.ok) {
    return { layer: undefined, isTestnet: DEFAULT_NETWORK.chainId === 14601 }
  }
  const j = (await res.json()) as {
    sonicMainnet?: ChainPackSlice
    sonicTestnet?: ChainPackSlice
  }
  const isTestnet = DEFAULT_NETWORK.chainId === 14601
  const layer = isTestnet ? j.sonicTestnet : j.sonicMainnet
  return { layer, isTestnet }
}

function railLabel(rail: string | undefined): string {
  if (!rail) return 'Sonic Gateway'
  if (rail === 'circle-cctp-v2') return 'Circle CCTP V2'
  if (rail === 'sonic-gateway-native') return 'Sonic Gateway'
  return rail
}

function formatAmount(value: bigint, decimals: number): string {
  const s = formatUnits(value, decimals)
  const n = Number(s)
  if (!Number.isFinite(n)) return s
  if (n === 0) return '0'
  if (n < 0.0001) return s
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 })
}

export default function SonicGatewayBridgePanel() {
  const eip1193 = useWalletStore((s) => s.eip1193)
  const address = useWalletStore((s) => s.address)
  const chainId = useWalletStore((s) => s.chainId)
  const isConnected = useWalletStore((s) => s.isConnected)
  const queryClient = useQueryClient()

  const [selectedSymbol, setSelectedSymbol] = useState('USDC')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState<'deposit' | 'approve' | 'claim' | null>(null)
  const [oracleStatus, setOracleStatus] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingBridgeDeposit | null>(() => loadPendingDeposit())

  const q = useQuery({
    queryKey: ['sonic-gateway-bridge', DEFAULT_NETWORK.chainId],
    queryFn: fetchBridgeContext,
    staleTime: 60_000,
  })

  const packRows = useMemo(
    () =>
      q.data?.layer?.bridgeTokens?.filter(
        (r) =>
          r.enabled !== false &&
          TGE_BRIDGE_SYMBOLS.has(r.tokenSymbol) &&
          r.tokenAddress &&
          r.tokenAddress.toLowerCase() !== ZERO
      ) ?? [],
    [q.data?.layer?.bridgeTokens]
  )

  const tokensQ = useQuery({
    queryKey: ['bridge-token-options', packRows.map((r) => r.tokenSymbol).join(',')],
    queryFn: () => buildBridgeTokenOptions(packRows),
    enabled: packRows.length > 0,
    staleTime: 5 * 60_000,
  })

  const bridgeTokens = tokensQ.data ?? []
  const selected: BridgeTokenOption | undefined =
    bridgeTokens.find((t) => t.symbol === selectedSymbol) ?? bridgeTokens[0]

  useEffect(() => {
    if (bridgeTokens.length && !bridgeTokens.some((t) => t.symbol === selectedSymbol)) {
      setSelectedSymbol(bridgeTokens[0].symbol)
    }
  }, [bridgeTokens, selectedSymbol])

  const balanceQ = useQuery({
    queryKey: ['eth-bridge-balance', address, selected?.ethereumAddress],
    queryFn: () => fetchEthTokenBalance(selected!.ethereumAddress, address!),
    enabled: !!address && !!selected,
    refetchInterval: 20_000,
  })

  const allowanceQ = useQuery({
    queryKey: ['eth-bridge-allowance', address, selected?.ethereumAddress],
    queryFn: () =>
      fetchEthAllowance(
        selected!.ethereumAddress,
        address!,
        '0xa1E2481a9CD0Cb0447EeB1cbc26F1b3fff3bec20'
      ),
    enabled: !!address && !!selected,
    refetchInterval: 20_000,
  })

  const amountWei = useMemo(() => {
    if (!selected || !amount.trim()) return null
    try {
      return parseUnits(amount.trim(), selected.decimals)
    } catch {
      return null
    }
  }, [amount, selected])

  const needsApproval =
    amountWei != null && amountWei > 0n && (allowanceQ.data ?? 0n) < amountWei

  const onEthereum = chainId === ETH_CHAIN_ID
  const onSonicMainnet = chainId === SONIC_MAINNET_CHAIN_ID

  const switchToEthereum = async () => {
    if (!eip1193) {
      toast.error('Connect your wallet first')
      return
    }
    await switchWalletChain(eip1193, ETH_CHAIN_ID)
    toast.success('Switched to Ethereum')
  }

  const switchToSonicMainnet = async () => {
    if (!eip1193) {
      toast.error('Connect your wallet first')
      return
    }
    await switchWalletChain(eip1193, SONIC_MAINNET_CHAIN_ID, {
      chainId: '0x92',
      chainName: 'Sonic',
      nativeCurrency: { name: 'Sonic', symbol: 'S', decimals: 18 },
      rpcUrls: ['https://rpc.soniclabs.com'],
      blockExplorerUrls: ['https://sonicscan.org'],
    })
    toast.success('Switched to Sonic')
  }

  const handleApprove = async () => {
    if (!eip1193 || !address || !selected || !amountWei || amountWei <= 0n) return
    setBusy('approve')
    try {
      await switchToEthereum()
      const provider = browserProviderForChain(eip1193, ETH_CHAIN_ID)
      const signer = await provider.getSigner()
      const hash = await approveOnEthereum(signer, selected.ethereumAddress, amountWei)
      toast.success(`Approved — ${hash.slice(0, 10)}…`)
      await queryClient.invalidateQueries({ queryKey: ['eth-bridge-allowance'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Approval failed')
    } finally {
      setBusy(null)
    }
  }

  const handleDeposit = async () => {
    if (!eip1193 || !address || !selected || !amountWei || amountWei <= 0n) return
    if (needsApproval) {
      toast.error('Approve the token on Ethereum first')
      return
    }
    if (balanceQ.data != null && amountWei > balanceQ.data) {
      toast.error('Insufficient balance on Ethereum')
      return
    }
    setBusy('deposit')
    try {
      await switchToEthereum()
      const provider = browserProviderForChain(eip1193, ETH_CHAIN_ID)
      const signer = await provider.getSigner()
      const result = await depositOnEthereum(signer, selected.ethereumAddress, amountWei)
      const record: PendingBridgeDeposit = {
        depositId: result.depositId.toString(),
        depositBlockNumber: result.depositBlockNumber,
        ethereumToken: selected.ethereumAddress,
        sonicToken: selected.sonicAddress,
        symbol: selected.symbol,
        amount: amountWei.toString(),
        txHash: result.txHash,
        createdAt: Date.now(),
      }
      savePendingDeposit(record)
      setPending(record)
      setAmount('')
      toast.success('Deposit submitted on Ethereum — claim on Sonic when the heartbeat catches up')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Deposit failed')
    } finally {
      setBusy(null)
    }
  }

  const handleClaim = async () => {
    if (!eip1193 || !pending) return
    setBusy('claim')
    setOracleStatus('Checking Sonic state oracle…')
    try {
      const ready = await sonicStateOracleCoversBlock(pending.depositBlockNumber)
      let oracleBlock: bigint
      if (ready) {
        oracleBlock = BigInt(pending.depositBlockNumber)
      } else {
        setOracleStatus('Waiting for Sonic heartbeat (~10 min after Ethereum finality)…')
        oracleBlock = await waitForSonicStateOracle(pending.depositBlockNumber, (last) => {
          setOracleStatus(`Sonic oracle at block ${last} (need ≥ ${pending.depositBlockNumber})`)
        })
      }

      setOracleStatus('Building deposit proof…')
      const proof = await generateDepositProof(BigInt(pending.depositId), oracleBlock)

      await switchToSonicMainnet()
      const provider = browserProviderForChain(eip1193, SONIC_MAINNET_CHAIN_ID)
      const signer = await provider.getSigner()
      setOracleStatus('Submitting claim on Sonic…')
      const hash = await claimOnSonic(
        signer,
        BigInt(pending.depositId),
        pending.ethereumToken,
        BigInt(pending.amount),
        proof
      )
      clearPendingDeposit()
      setPending(null)
      setOracleStatus(null)
      toast.success(`Claimed on Sonic — ${hash.slice(0, 10)}…`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Claim failed'
      setOracleStatus(msg)
      toast.error(msg)
    } finally {
      setBusy(null)
    }
  }

  const bridgeSymbolHint = ['USDC', 'EURC', 'USDT', 'WETH']
    .filter((s) => bridgeTokens.some((t) => t.symbol === s))
    .join(' · ')

  const layer = q.data?.layer

  return (
    <div className="td-bridge-panel">
      <h2>Ethereum ⇌ Sonic bridge</h2>
      {bridgeSymbolHint ? <p className="td-bridge-token-hint">{bridgeSymbolHint}</p> : null}
      <p className="muted td-bridge-lead">
        Bring <strong>USDC</strong>, <strong>EURC</strong>, <strong>USDT</strong>, or <strong>WETH</strong> from
        Ethereum, then buy AGS on <strong>Token sale</strong> with the same token. You can also bridge via the{' '}
        <a href={SONIC_GATEWAY_APP} target="_blank" rel="noopener noreferrer">
          Sonic Gateway
        </a>
        .
      </p>

      {!isConnected ? (
        <p className="td-bridge-connect-hint">Connect your wallet in the header to bridge.</p>
      ) : (
        <section className="td-bridge-form">
          <div className="td-bridge-form-row">
            <label className="td-bridge-label">
              <span className="td-bridge-token-name">{TOKEN_DISPLAY_NAME[selected?.symbol ?? ''] ?? 'Token'}</span>
              <select
                className="td-bridge-select"
                value={selected?.symbol ?? ''}
                onChange={(e) => setSelectedSymbol(e.target.value)}
                disabled={!bridgeTokens.length}
              >
                {bridgeTokens.map((t) => (
                  <option key={t.symbol} value={t.symbol}>
                    {t.symbol}
                  </option>
                ))}
              </select>
            </label>
            <label className="td-bridge-label td-bridge-label--grow">
              Amount
              <input
                className="td-bridge-input"
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
          </div>

          {selected && address ? (
            <p className="muted td-bridge-balance">
              Ethereum balance:{' '}
              {balanceQ.isLoading
                ? '…'
                : `${formatAmount(balanceQ.data ?? 0n, selected.decimals)} ${selected.symbol}`}
              {!onEthereum ? (
                <>
                  {' '}
                  ·{' '}
                  <button type="button" className="td-bridge-link-btn" onClick={() => void switchToEthereum()}>
                    Switch to Ethereum
                  </button>
                </>
              ) : null}
            </p>
          ) : null}

          <div className="td-bridge-actions">
            {needsApproval ? (
              <button
                type="button"
                className="ghost"
                disabled={busy !== null || !amountWei}
                onClick={() => void handleApprove()}
              >
                {busy === 'approve' ? 'Approving…' : `1. Approve ${selected?.symbol ?? 'token'} on Ethereum`}
              </button>
            ) : null}
            <button
              type="button"
              className="primary"
              disabled={busy !== null || !amountWei || amountWei <= 0n}
              onClick={() => void handleDeposit()}
            >
              {busy === 'deposit' ? 'Depositing…' : needsApproval ? '2. Deposit on Ethereum' : 'Deposit on Ethereum'}
            </button>
          </div>
        </section>
      )}

      {pending ? (
        <section className="td-bridge-pending">
          <h3>Pending bridge</h3>
          <p className="muted">
            {pending.symbol} deposit #{pending.depositId} · Ethereum tx{' '}
            <a
              href={`https://etherscan.io/tx/${pending.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {pending.txHash.slice(0, 10)}…
            </a>
          </p>
          {oracleStatus ? <p className="td-bridge-oracle-status">{oracleStatus}</p> : null}
          <div className="td-bridge-actions">
            <button
              type="button"
              className="primary"
              disabled={busy !== null}
              onClick={() => void handleClaim()}
            >
              {busy === 'claim' ? 'Claiming…' : onSonicMainnet ? 'Claim on Sonic' : 'Claim on Sonic (switches network)'}
            </button>
            <button
              type="button"
              className="ghost"
              disabled={busy !== null}
              onClick={() => {
                clearPendingDeposit()
                setPending(null)
                setOracleStatus(null)
              }}
            >
              Dismiss
            </button>
          </div>
        </section>
      ) : null}

      <details className="td-bridge-details">
        <summary>How it works &amp; backup</summary>
        <ol className="td-bridge-steps">
          <li>Deposit on Ethereum (~15 min finality per Sonic docs).</li>
          <li>Heartbeat releases value in batches (~10 min Ethereum → Sonic).</li>
          <li>Claim minted tokens on Sonic. USDC uses Circle CCTP V2.</li>
        </ol>
        <p className="muted">
          Prefer the official UI?{' '}
          <a href={SONIC_GATEWAY_APP} target="_blank" rel="noopener noreferrer">
            Open Sonic Gateway
          </a>{' '}
          ·{' '}
          <a href={DOC_SONIC_GATEWAY} target="_blank" rel="noopener noreferrer">
            Gateway guide
          </a>{' '}
          ·{' '}
          <a href={DOC_PROGRAMMATIC_GATEWAY} target="_blank" rel="noopener noreferrer">
            Programmatic Gateway
          </a>
        </p>
        {layer && bridgeTokens.length > 0 ? (
          <div className="td-bridge-table-wrap">
            <table className="td-bridge-table">
              <thead>
                <tr>
                  <th>Token</th>
                  <th>On Sonic</th>
                  <th>Rail</th>
                </tr>
              </thead>
              <tbody>
                {bridgeTokens.map((t) => (
                  <tr key={t.symbol}>
                    <td>
                      <div className="td-bridge-token-cell">
                        <span className="td-bridge-token-name">{TOKEN_DISPLAY_NAME[t.symbol] ?? t.symbol}</span>
                        <span className="td-bridge-token-symbol">{t.symbol}</span>
                      </div>
                    </td>
                    <td className="td-bridge-mono">
                      {layer.blockExplorer ? (
                        <a
                          href={`${layer.blockExplorer.replace(/\/$/, '')}/token/${t.sonicAddress}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {t.sonicAddress}
                        </a>
                      ) : (
                        t.sonicAddress
                      )}
                    </td>
                    <td>{railLabel(t.settlementRail)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <p className="muted td-bridge-footnote">
          After claim, buy AGS on <strong>Token sale</strong> with the token you bridged. For gas, keep a little native S or unwrap wS.
        </p>
      </details>
    </div>
  )
}
