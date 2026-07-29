import { useState, useMemo, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { randomBytes } from 'ethers'
import { useQuery } from '@tanstack/react-query'
import { useWalletStore } from '@/store/walletStore'
import { getSonicGatewayWrapperContract, getTokenContract, getErc20Contract } from '@/utils/contracts'
import { getBridgeTokenConfigs, type BridgeTokenConfig } from '@/config/bridge'
import { fetchSonicChainPackBridgeTokensOrFallback } from '@/config/sonicChainPack'
import {
  buildMintShieldSecrets,
  fetchMintShieldProofRemote,
  fieldToBytes32,
  proveMintShieldInBrowser,
} from '@/utils/tokenPrivacyProof'
import { usePublicLiquidityPools } from '@/hooks/usePublicLiquidityPools'
import { setBridgeSwapIntent } from '@/utils/bridgeSwapIntent'
import { CONTRACT_ADDRESSES, DEFAULT_NETWORK } from '@/config/contracts'
import { formatBalance } from '@/utils/format'
import toast from 'react-hot-toast'
import {
  explorerAddressUrl,
  explorerEthMainnetAddressUrl,
  getEthGatewayTokenDepositAddress,
  getEthGatewayTokenPairsAddress,
  getEthGatewayStateOracleAddress,
  getSonicGatewayBridgeAddress,
  getSonicGatewayTokenPairsAddress,
  getSonicGatewayStateOracleAddress,
  SONIC_GATEWAY_DOCS,
} from '@/config/sonicInfra'

export type SonicGatewayConverterProps = {
  /** Minimal chrome: no doc links, no CCTP callout, no extra helper copy. */
  compact?: boolean
  /** Token list from `public/config/sonic-chain-pack.json` (falls back to `bridge-tokens.json`). */
  useChainPackList?: boolean
}

/**
 * @title SonicGatewayConverter
 * @notice Converts tokens already on Sonic (after Gateway claim) into private commitments via the wrapper.
 */
export default function SonicGatewayConverter({
  compact = false,
  useChainPackList = true,
}: SonicGatewayConverterProps = {}) {
  const { provider, signer, address, isConnected } = useWalletStore()

  const { data: bridgeTokens } = useQuery({
    queryKey: ['bridge-tokens-ui', useChainPackList, DEFAULT_NETWORK.chainId],
    queryFn: async () =>
      useChainPackList ? fetchSonicChainPackBridgeTokensOrFallback() : getBridgeTokenConfigs(),
    staleTime: 60 * 60 * 1000,
    placeholderData: getBridgeTokenConfigs(),
  })
  const bridgeTokenList = bridgeTokens ?? getBridgeTokenConfigs()

  const [selectedToken, setSelectedToken] = useState<BridgeTokenConfig | null>(null)

  useEffect(() => {
    if (!bridgeTokenList.length) return
    setSelectedToken((prev) => {
      if (prev && bridgeTokenList.some((t) => t.id === prev.id)) return prev
      return bridgeTokenList.find((t) => t.tokenSymbol === 'AGS') ?? bridgeTokenList[0] ?? null
    })
  }, [bridgeTokenList])
  
  const [amount, setAmount] = useState('')
  const [commitment, setCommitment] = useState('')
  const [isConverting, setIsConverting] = useState(false)

  const { pools: publicPools } = usePublicLiquidityPools()
  const swapPoolId = useMemo(() => {
    if (!selectedToken || selectedToken.tokenSymbol === 'AGS' || !selectedToken.tokenAddress) return null
    const addr = selectedToken.tokenAddress.toLowerCase()
    const hit = publicPools.find((p) => p.tokenAddress && p.tokenAddress.toLowerCase() === addr)
    return hit?.id ?? null
  }, [publicPools, selectedToken])
  
  // Get token address - use AGS contract address if AGS, otherwise use token address
  const tokenAddress = useMemo(() => {
    if (!selectedToken) return null
    if (selectedToken.tokenSymbol === 'AGS') {
      return CONTRACT_ADDRESSES.TOKEN
    }
    return selectedToken.tokenAddress
  }, [selectedToken])
  
  // Get token contract (ERC20 for all tokens, including AGS)
  const tokenContract = useMemo(() => {
    if (!provider || !tokenAddress) return null
    if (selectedToken?.tokenSymbol === 'AGS') {
      return getTokenContract(provider)
    }
    return getErc20Contract(tokenAddress, provider)
  }, [provider, tokenAddress, selectedToken])

  // Fetch wrapper contract info for selected token
  const { data: wrapperInfo } = useQuery({
    queryKey: ['sonic-gateway-wrapper-info', tokenAddress],
    queryFn: async () => {
      if (!provider || !tokenAddress) return null
      try {
        const wrapper = getSonicGatewayWrapperContract(provider)
        const [supported, rate, feeBps] = await wrapper.getConversionInfo(tokenAddress)
        
        return {
          supported,
          rateBps: Number(rate),
          feeBps: Number(feeBps),
          feePercent: Number(feeBps) / 100,
        }
      } catch (error) {
        console.error('Error fetching wrapper info:', error)
        return null
      }
    },
    enabled: !!provider && !!tokenAddress,
    refetchInterval: 12_000,
    staleTime: 4_000,
  })

  // Fetch user's token balance
  const { data: tokenBalance } = useQuery({
    queryKey: ['token-balance', address, tokenAddress, selectedToken?.tokenSymbol],
    queryFn: async () => {
      if (!provider || !address || !tokenContract) return 0n
      try {
        return await tokenContract.balanceOf(address)
      } catch {
        return 0n
      }
    },
    enabled: !!provider && !!address && !!tokenContract,
    refetchInterval: 12_000,
  })

  // Fetch token decimals
  const { data: tokenDecimals } = useQuery({
    queryKey: ['token-decimals', tokenAddress],
    queryFn: async () => {
      if (!provider || !tokenContract) return 18
      try {
        return await tokenContract.decimals()
      } catch {
        return 18
      }
    },
    enabled: !!provider && !!tokenContract,
  })

  // Fetch allowance
  const { data: allowance } = useQuery({
    queryKey: ['wrapper-allowance', address, tokenAddress],
    queryFn: async () => {
      if (!provider || !address || !tokenContract) return 0n
      try {
        const wrapper = getSonicGatewayWrapperContract(provider)
        const wrapperAddress = await wrapper.getAddress()
        return await tokenContract.allowance(address, wrapperAddress)
      } catch {
        return 0n
      }
    },
    enabled: !!provider && !!address && !!tokenContract,
    refetchInterval: 12_000,
  })

  const handleApprove = async () => {
    if (!signer || !address || !amount || !tokenDecimals || !tokenAddress) return

    try {
      const wrapper = getSonicGatewayWrapperContract(signer)
      const wrapperAddress = await wrapper.getAddress()
      const amountWei = BigInt(amount) * (10n ** BigInt(tokenDecimals))

      const writeToken =
        selectedToken?.tokenSymbol === 'AGS'
          ? getTokenContract(signer)
          : getErc20Contract(tokenAddress, signer)

      const tx = await writeToken.approve(wrapperAddress, amountWei)
      toast.loading('Approving tokens...', { id: 'approve' })
      await tx.wait()
      toast.success('Tokens approved', { id: 'approve' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Approval failed'
      toast.error(message, { id: 'approve' })
    }
  }

  async function handleGenerateCommitment() {
    if (!provider || !tokenAddress || !amount) {
      toast.error('Enter an amount first')
      return
    }
    try {
      const wrapper = getSonicGatewayWrapperContract(provider)
      const wrapperAddress = await wrapper.getAddress()
      const amountWei = BigInt(amount) * (10n ** BigInt(tokenDecimals ?? 18))
      const [, rateBps, feeBps] = await wrapper.getConversionInfo(tokenAddress)
      const convertedAmount = (amountWei * BigInt(rateBps)) / 10000n
      const fee = (convertedAmount * BigInt(feeBps)) / 10000n
      const netAmount = convertedAmount - fee
      const secrets = await buildMintShieldSecrets(wrapperAddress, netAmount)
      setCommitment(fieldToBytes32(secrets.outputCommitment))
      toast.success('Commitment generated locally — proof secrets stay in this browser')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not generate commitment')
    }
  }

  const handleConvert = async () => {
    if (!provider || !signer || !address || !amount || !tokenAddress || !tokenDecimals) return

    setIsConverting(true)
    try {
      const wrapper = getSonicGatewayWrapperContract(signer)
      const wrapperAddress = await wrapper.getAddress()
      const amountWei = BigInt(amount) * (10n ** BigInt(tokenDecimals))

      const [, rateBps, feeBps] = await wrapper.getConversionInfo(tokenAddress)
      const convertedAmount = (amountWei * BigInt(rateBps)) / 10000n
      const fee = (convertedAmount * BigInt(feeBps)) / 10000n
      const netAmount = convertedAmount - fee

      const proverUrl = (import.meta.env.VITE_PROVER_URL as string | undefined)?.trim()

      let proof: bigint[]
      let publicInputs: bigint[]
      let commitmentBytes: string

      if (!proverUrl) {
        toast.loading('Generating mint proof in your browser…', { id: 'convert' })
        const browser = await proveMintShieldInBrowser(wrapperAddress, netAmount)
        const generated = fieldToBytes32(browser.secrets.outputCommitment)
        if (commitment.trim()) {
          const userCommit = commitment.startsWith('0x') ? commitment : `0x${commitment}`
          if (userCommit.toLowerCase() !== generated.toLowerCase()) {
            throw new Error(
              'Commitment does not match a local proof. Clear the field and convert again, or use Generate commitment.',
            )
          }
          commitmentBytes = userCommit
        } else {
          commitmentBytes = generated
          setCommitment(generated)
        }
        proof = browser.proof
        publicInputs = browser.publicInputs
      } else {
        if (!commitment.trim()) {
          throw new Error('Enter a commitment, or use browser proving (leave remote prover unset).')
        }
        commitmentBytes = commitment.startsWith('0x') ? commitment : `0x${commitment}`
        if (commitmentBytes.length !== 66) {
          throw new Error('Invalid commitment format (must be 32 bytes hex)')
        }
        const depositNullifier = '0x' + Buffer.from(randomBytes(32)).toString('hex')
        toast.loading('Generating mint proof…', { id: 'convert' })
        const remote = await fetchMintShieldProofRemote(proverUrl, {
          depositNullifier,
          depositor: wrapperAddress,
          amount: netAmount.toString(),
        })
        proof = remote.proof
        publicInputs = remote.publicInputs
      }

      toast.loading('Converting to private commitment...', { id: 'convert' })

      const tx = await wrapper.convertToPrivate(
        tokenAddress,
        amountWei,
        commitmentBytes,
        proof,
        publicInputs
      )
      
      await tx.wait()
      toast.success('Successfully converted to private commitment!', { id: 'convert' })
      
      // Reset form
      setAmount('')
      setCommitment('')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Conversion failed'
      toast.error(message, { id: 'convert' })
    } finally {
      setIsConverting(false)
    }
  }

  const decimals = tokenDecimals ?? 18
  const amountWei = amount ? BigInt(amount) * (10n ** BigInt(decimals)) : 0n
  const needsApproval = amountWei > 0n && (allowance || 0n) < amountWei
  const hasBalance = (tokenBalance || 0n) >= amountWei

  /** Matches `SonicGatewayWrapper.convertToPrivate`: converted = amount * rateBps / 10000, fee on converted, net = converted - fee */
  const conversionPreview = useMemo(() => {
    if (!amountWei || !wrapperInfo) return null
    const rateBps = BigInt(wrapperInfo.rateBps)
    const feeBps = BigInt(wrapperInfo.feeBps)
    const converted = (amountWei * rateBps) / 10000n
    const feeAmt = (converted * feeBps) / 10000n
    return { converted, feeAmt, net: converted - feeAmt }
  }, [amountWei, wrapperInfo])

  if (!isConnected) {
    return (
      <div className={compact ? 'py-6 text-center text-sm text-terminal-text-dim' : 'card text-center py-8'}>
        <p className="text-terminal-text-dim">Connect your wallet to continue.</p>
      </div>
    )
  }

  return (
    <div className={compact ? 'space-y-4' : 'card'}>
      {!compact && (
        <div className="mb-6">
          <h2 className="text-xl font-semibold mb-2">Sonic Gateway Converter</h2>
          <p className="text-sm text-terminal-text-dim">
            After you complete the official Sonic Gateway flow (deposit → heartbeat → claim), move claimed tokens
            into a private commitment here. See{' '}
            <a className="underline hover:text-terminal-accent" href={SONIC_GATEWAY_DOCS.userGuide} target="_blank" rel="noopener noreferrer">
              Sonic Gateway
            </a>
            ,{' '}
            <a className="underline hover:text-terminal-accent" href={SONIC_GATEWAY_DOCS.programmatic} target="_blank" rel="noopener noreferrer">
              Programmatic Gateway
            </a>
            , and{' '}
            <a className="underline hover:text-terminal-accent" href={SONIC_GATEWAY_DOCS.contractAddresses} target="_blank" rel="noopener noreferrer">
              contract addresses
            </a>
            .
          </p>
          {(getSonicGatewayBridgeAddress() || getEthGatewayTokenDepositAddress()) && (
            <p className="text-xs text-terminal-text-dim mt-2 flex flex-wrap gap-x-3 gap-y-1 items-center">
              <span className="font-medium text-terminal-text/80 shrink-0">Mainnet infra (explorers):</span>
              {getEthGatewayTokenDepositAddress() && (
                <a
                  className="underline hover:text-terminal-accent"
                  href={explorerEthMainnetAddressUrl(getEthGatewayTokenDepositAddress()!)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Eth TokenDeposit
                </a>
              )}
              {getEthGatewayTokenPairsAddress() && (
                <a
                  className="underline hover:text-terminal-accent"
                  href={explorerEthMainnetAddressUrl(getEthGatewayTokenPairsAddress()!)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Eth TokenPairs
                </a>
              )}
              {getEthGatewayStateOracleAddress() && (
                <a
                  className="underline hover:text-terminal-accent"
                  href={explorerEthMainnetAddressUrl(getEthGatewayStateOracleAddress()!)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Eth StateOracle
                </a>
              )}
              {getSonicGatewayBridgeAddress() && (
                <a
                  className="underline hover:text-terminal-accent"
                  href={explorerAddressUrl(getSonicGatewayBridgeAddress()!)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Sonic Bridge
                </a>
              )}
              {getSonicGatewayTokenPairsAddress() && (
                <a
                  className="underline hover:text-terminal-accent"
                  href={explorerAddressUrl(getSonicGatewayTokenPairsAddress()!)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Sonic TokenPairs
                </a>
              )}
              {getSonicGatewayStateOracleAddress() && (
                <a
                  className="underline hover:text-terminal-accent"
                  href={explorerAddressUrl(getSonicGatewayStateOracleAddress()!)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Sonic StateOracle
                </a>
              )}
            </p>
          )}
        </div>
      )}

      {/* Token Selector */}
      {bridgeTokenList.length > 0 && (
        <div className={compact ? 'mb-3' : 'mb-6'}>
          <p
            className="mb-2 rounded border border-dashed border-terminal-border/70 bg-terminal-muted/15 px-3 py-2 text-center text-xs font-semibold tracking-[0.14em] text-terminal-text"
            aria-label="Assets commonly bridged from Ethereum to Sonic"
          >
            <span className="text-terminal-text-dim">Ethereum → Sonic · </span>
            <span className="text-terminal-accent normal-case tracking-normal">WETH · USDC · USDT</span>
          </p>
          <label className="block text-sm font-medium text-terminal-text mb-2">
            {compact ? 'Token' : 'Select Token'}
          </label>
          <select
            value={selectedToken?.id || ''}
            onChange={(e) => {
              const token = bridgeTokenList.find((t) => t.id === e.target.value)
              if (token) {
                setSelectedToken(token)
                setAmount('')
              }
            }}
            className="input-field w-full"
          >
            {bridgeTokenList.map((token) => (
              <option key={token.id} value={token.id}>
                {compact ? token.tokenSymbol : `${token.tokenSymbol}${token.description ? ` — ${token.description}` : ''}`}
              </option>
            ))}
          </select>
          {!compact && selectedToken?.description && (
            <p className="text-xs text-terminal-text-dim mt-1">{selectedToken.description}</p>
          )}
        </div>
      )}

      {!compact && selectedToken?.settlementRail === 'circle-cctp-v2' && (
        <div className="mb-6 rounded-lg border border-sky-500/35 bg-sky-500/[0.07] p-4 text-sm text-terminal-text space-y-2">
          <p className="font-semibold text-terminal-text">USDC and Sonic Gateway (CCTP V2)</p>
          <p className="text-terminal-text-dim leading-relaxed">
            Sonic documents that USDC moves through the official Sonic Gateway using{' '}
            <a
              className="underline hover:text-terminal-accent"
              href={SONIC_GATEWAY_DOCS.circleCctp}
              target="_blank"
              rel="noopener noreferrer"
            >
              Circle&apos;s Cross-Chain Transfer Protocol
            </a>
            . Complete the standard Gateway steps (deposit, heartbeat, claim — see the{' '}
            <a
              className="underline hover:text-terminal-accent"
              href={SONIC_GATEWAY_DOCS.userGuide}
              target="_blank"
              rel="noopener noreferrer"
            >
              Sonic Gateway guide
            </a>
            ) so USDC is in your wallet on Sonic first. This converter does <strong>not</strong> submit CCTP or Gateway
            transactions; it only moves <strong>already-claimed</strong> Sonic USDC through the Aegis wrapper into a
            private commitment (mint proof + <code className="text-terminal-accent">convertToPrivate</code>).
          </p>
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            <a
              className="underline hover:text-terminal-accent"
              href={SONIC_GATEWAY_DOCS.gatewayApp}
              target="_blank"
              rel="noopener noreferrer"
            >
              gateway.soniclabs.com
            </a>
            <span className="text-terminal-text-muted">·</span>
            <a
              className="underline hover:text-terminal-accent"
              href={SONIC_GATEWAY_DOCS.programmatic}
              target="_blank"
              rel="noopener noreferrer"
            >
              Programmatic Gateway
            </a>
          </p>
        </div>
      )}

      {/* Info */}
      {wrapperInfo && (
        <div className={`${compact ? 'mb-3 p-3' : 'mb-6 p-4'} bg-terminal-bg-secondary rounded border border-terminal-border`}>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-terminal-text-dim">Conversion rate:</span>
              <span className="ml-2 font-semibold">
                {(wrapperInfo.rateBps / 10000).toFixed(4)}× ({wrapperInfo.rateBps} bps)
              </span>
            </div>
            <div>
              <span className="text-terminal-text-dim">Fee:</span>
              <span className="ml-2 font-semibold">{wrapperInfo.feePercent}%</span>
            </div>
            <div className="col-span-2">
              {!wrapperInfo.supported && (
                <span className="text-xs text-red-500">
                  This token is not supported by the wrapper contract.
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Balance */}
      <div className={compact ? 'mb-3' : 'mb-6'}>
        <div className="text-sm text-terminal-text-dim mb-1">
          Balance ({selectedToken?.tokenSymbol || '—'})
        </div>
        <div className={`${compact ? 'text-xl' : 'text-2xl'} font-bold text-terminal-accent`}>
          {formatBalance(tokenBalance || 0n)} {selectedToken?.tokenSymbol || ''}
        </div>
      </div>

      {swapPoolId && selectedToken && selectedToken.tokenSymbol !== 'AGS' && (
        <div className={`${compact ? '-mt-2 mb-3' : 'mb-4'} flex justify-end`}>
          <Link
            to={`/swap?pool=${encodeURIComponent(swapPoolId)}&direction=QUOTE_TO_AGS`}
            onClick={() => {
              setBridgeSwapIntent({
                poolId: swapPoolId,
                tokenSymbol: selectedToken.tokenSymbol,
                tokenAddress: selectedToken.tokenAddress,
                amount: amount.trim() || undefined,
                direction: 'QUOTE_TO_AGS',
              })
            }}
            className="text-xs font-medium text-terminal-accent hover:underline"
          >
            Swap to AGS
          </Link>
        </div>
      )}

      {/* Form */}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-terminal-text mb-2">
            {compact ? 'Amount' : 'Amount to Convert'}
          </label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0"
            className="input-field w-full"
            min="0"
            step="0.000000000000000001"
          />
          {amount && !hasBalance && (
            <p className="text-xs text-red-500 mt-1">Insufficient balance</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-terminal-text mb-2">
            {compact ? 'Commitment' : 'Private commitment (optional)'}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={commitment}
              onChange={(e) => setCommitment(e.target.value)}
              placeholder="Auto-generated on convert if empty"
              className="input-field w-full font-mono text-sm"
            />
            <button type="button" className="btn-secondary shrink-0 text-xs px-3" onClick={handleGenerateCommitment}>
              Generate
            </button>
          </div>
          {!compact && (
            <p className="text-xs text-terminal-text-dim mt-1">
              Proofs run in your browser. Leave empty to create a fresh commitment when you convert.
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          {needsApproval ? (
            <button
              onClick={handleApprove}
              className="btn-primary flex-1"
              disabled={!amount || !hasBalance}
            >
              Approve Tokens
            </button>
          ) : (
            <button
              onClick={handleConvert}
              className="btn-primary flex-1"
              disabled={!amount || !hasBalance || isConverting}
            >
              {isConverting ? '…' : compact ? 'Shield' : 'Convert to Private'}
            </button>
          )}
        </div>

        {amount && wrapperInfo && selectedToken && conversionPreview && (
          <div className="p-3 bg-terminal-bg-secondary rounded text-sm">
            <div className="flex justify-between mb-1">
              <span className="text-terminal-text-dim">After rate ({wrapperInfo.rateBps} bps):</span>
              <span>{formatBalance(conversionPreview.converted)} {selectedToken.tokenSymbol}</span>
            </div>
            <div className="flex justify-between mb-1">
              <span className="text-terminal-text-dim">Fee ({wrapperInfo.feePercent}%):</span>
              <span>-{formatBalance(conversionPreview.feeAmt)} {selectedToken.tokenSymbol}</span>
            </div>
            <div className="flex justify-between font-semibold pt-2 border-t border-terminal-border">
              <span>Net to shield (ZK debit on wrapper):</span>
              <span className="text-terminal-accent">
                {formatBalance(conversionPreview.net)} {selectedToken.tokenSymbol}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

