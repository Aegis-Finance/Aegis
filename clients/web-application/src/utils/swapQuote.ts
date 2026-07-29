import { formatUnits, MaxUint256, parseUnits } from 'ethers'
import type { Contract, ContractTransactionResponse, Provider, Signer } from 'ethers'

import { CONTRACT_ADDRESSES } from '@/config/contracts'
import type { PublicPoolConfig } from '@/config/liquidity'
import { getErc20Contract, getPublicLiquidityPoolContract, getPublicPoolRouterContract } from '@/utils/contracts'
import {
  CANONICAL_ROUTE_V3,
  executeCanonicalSwap,
  quoteCanonicalSwap,
  usesCanonicalV3ForPool,
  wrappedNativeAddress,
} from '@/utils/canonicalSwap'
import { odosQuoteV3, type OdosSorQuoteV3 } from '@/utils/odosSor'
import { waitAndParseTransaction } from '@/utils/transactionHelper'

export type SwapDirection = 'AGS_TO_QUOTE' | 'QUOTE_TO_AGS'
export type SwapRoute = 'auto' | 'aegis' | 'odos'

export const AGS_DECIMALS = 18

export function applySlippage(amount: bigint, slippageBps: bigint): bigint {
  return (amount * (10_000n - slippageBps)) / 10_000n
}

export function slippageBpsFromPercent(pct: number): bigint {
  if (!Number.isFinite(pct) || pct <= 0) return 30n
  return BigInt(Math.round(pct * 100))
}

export function poolLabel(pool: PublicPoolConfig): string {
  return pool.tokenSymbol.replace(/\s*\(.*?\)\s*/g, '').trim() || pool.id
}

export function extractErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const err = error as { shortMessage?: string; data?: { message?: string }; message?: string }
    return err.shortMessage ?? err.data?.message ?? err.message ?? 'Transaction failed'
  }
  return 'Transaction failed'
}

export function isOdosEligible(pool: PublicPoolConfig | undefined): boolean {
  if (!pool) return false
  if (!pool.useNative && pool.tokenAddress) return true
  const ws = wrappedNativeAddress()
  if (pool.useNative) return Boolean(ws)
  if (ws && pool.tokenAddress?.toLowerCase() === ws.toLowerCase()) return true
  return false
}

export type AegisPoolQuote = {
  amountOutRaw: bigint
  amountOutFormatted: string
  outputDecimals: number
  quoteVia: 'router' | 'pool'
  winningPool?: string
}

export type SwapQuotePreview = {
  amountOutRaw: bigint
  amountOutFormatted: string
  outputDecimals: number
  routeUsed: 'router' | 'pool' | 'odos' | 'aegis' | 'canonical-v3'
  winningPool?: string
  odos?: Pick<OdosSorQuoteV3, 'pathId' | 'priceImpact' | 'gasEstimate' | 'quotedAt'>
  aegisAlternative?: AegisPoolQuote
  odosAlternative?: { amountOutRaw: bigint; amountOutFormatted: string }
  fallbackFromOdos?: boolean
  comparedRoutes?: boolean
}

async function publicPoolRouterQuoteIfEligible(
  router: Contract,
  selectedPool: PublicPoolConfig,
  direction: SwapDirection,
  parsedAmount: bigint
): Promise<{ bestOut: bigint; winningPool: string } | null> {
  try {
    const [agsTok, qTok, qNat, nPools] = await Promise.all([
      router.agsToken(),
      router.quoteToken(),
      router.quoteIsNative(),
      router.poolCount(),
    ])
    if (nPools === 0n) return null
    if (String(agsTok).toLowerCase() !== CONTRACT_ADDRESSES.TOKEN.toLowerCase()) return null
    const agsToQuote = direction === 'AGS_TO_QUOTE'
    if (!agsToQuote) {
      if (selectedPool.useNative !== Boolean(qNat)) return null
      if (
        !qNat &&
        (!selectedPool.tokenAddress ||
          String(qTok).toLowerCase() !== selectedPool.tokenAddress.toLowerCase())
      ) {
        return null
      }
    }
    const [winningPool, bestOut] = await router.bestQuote(agsToQuote, parsedAmount)
    return { bestOut: BigInt(bestOut as bigint), winningPool: String(winningPool) }
  } catch {
    return null
  }
}

export async function quoteAegisPoolSwap(
  provider: Provider,
  selectedPool: PublicPoolConfig,
  direction: SwapDirection,
  parsedAmount: bigint,
  outputDecimals: number
): Promise<AegisPoolQuote | null> {
  const agsToQuote = direction === 'AGS_TO_QUOTE'
  if (await usesCanonicalV3ForPool(provider, selectedPool)) {
    const canonical = await quoteCanonicalSwap(provider, selectedPool, agsToQuote, parsedAmount, outputDecimals)
    if (canonical) {
      return {
        amountOutRaw: canonical.amountOutRaw,
        amountOutFormatted: formatUnits(canonical.amountOutRaw, outputDecimals),
        outputDecimals,
        quoteVia: canonical.route === CANONICAL_ROUTE_V3 ? 'router' : 'pool',
        winningPool: canonical.route === CANONICAL_ROUTE_V3 ? 'uniswap-v3' : selectedPool.poolAddress,
      }
    }
  }

  const router = getPublicPoolRouterContract(provider)
  if (router) {
    const routed = await publicPoolRouterQuoteIfEligible(router, selectedPool, direction, parsedAmount)
    if (routed) {
      return {
        amountOutRaw: routed.bestOut,
        amountOutFormatted: formatUnits(routed.bestOut, outputDecimals),
        outputDecimals,
        quoteVia: 'router',
        winningPool: routed.winningPool,
      }
    }
  }

  const poolContract = getPublicLiquidityPoolContract(selectedPool.poolAddress, provider)
  const amountOutRaw = (await poolContract.quoteSwap(direction === 'AGS_TO_QUOTE', parsedAmount)) as bigint
  if (!amountOutRaw || amountOutRaw <= 0n) return null
  return {
    amountOutRaw,
    amountOutFormatted: formatUnits(amountOutRaw, outputDecimals),
    outputDecimals,
    quoteVia: 'pool',
  }
}

export async function fetchSwapQuote(params: {
  provider: Provider
  selectedPool: PublicPoolConfig
  poolMeta: { quoteSymbol: string; quoteDecimals: number }
  direction: SwapDirection
  amountIn: string
  route: SwapRoute
  userAddr?: string
  slippagePercent: number
}): Promise<SwapQuotePreview | null> {
  const { provider, selectedPool, poolMeta, direction, amountIn, route, userAddr, slippagePercent } = params
  if (!amountIn || Number(amountIn) <= 0) return null

  const inputDecimals = direction === 'AGS_TO_QUOTE' ? AGS_DECIMALS : poolMeta.quoteDecimals
  const outputDecimals = direction === 'AGS_TO_QUOTE' ? poolMeta.quoteDecimals : AGS_DECIMALS
  const parsedAmount = parseUnits(amountIn, inputDecimals)
  if (parsedAmount <= 0n) return null

  const aegisQuote = await quoteAegisPoolSwap(provider, selectedPool, direction, parsedAmount, outputDecimals)

  let odosQuote: OdosSorQuoteV3 | null = null
  const odosInputToken =
    direction === 'AGS_TO_QUOTE'
      ? CONTRACT_ADDRESSES.TOKEN
      : selectedPool.useNative
        ? wrappedNativeAddress() ?? selectedPool.tokenAddress
        : selectedPool.tokenAddress
  const odosOutputToken =
    direction === 'AGS_TO_QUOTE'
      ? selectedPool.useNative
        ? wrappedNativeAddress() ?? selectedPool.tokenAddress
        : selectedPool.tokenAddress
      : CONTRACT_ADDRESSES.TOKEN

  if (isOdosEligible(selectedPool) && userAddr && odosInputToken && odosOutputToken) {
    try {
      const net = await provider.getNetwork()
      odosQuote = await odosQuoteV3({
        chainId: Number(net.chainId),
        userAddr,
        inputTokenAddress: odosInputToken,
        inputAmount: parsedAmount.toString(),
        outputTokenAddress: odosOutputToken,
        slippageLimitPercent: slippagePercent,
      })
    } catch {
      odosQuote = null
    }
  }

  const odosOutRaw = odosQuote ? BigInt(odosQuote.outAmounts[0] ?? '0') : 0n
  const odosValid = odosOutRaw > 0n

  const pickAegis = (): SwapQuotePreview | null => {
    if (!aegisQuote) return null
    const canonicalV3 = aegisQuote.winningPool === 'uniswap-v3'
    return {
      amountOutRaw: aegisQuote.amountOutRaw,
      amountOutFormatted: aegisQuote.amountOutFormatted,
      outputDecimals: aegisQuote.outputDecimals,
      routeUsed: canonicalV3 ? 'canonical-v3' : aegisQuote.quoteVia,
      winningPool: aegisQuote.winningPool,
      odosAlternative: odosValid
        ? { amountOutRaw: odosOutRaw, amountOutFormatted: formatUnits(odosOutRaw, outputDecimals) }
        : undefined,
      comparedRoutes: Boolean(odosValid),
    }
  }

  const pickOdos = (fallback = false): SwapQuotePreview | null => {
    if (!odosValid || !odosQuote) {
      const fb = pickAegis()
      return fb ? { ...fb, fallbackFromOdos: fallback } : null
    }
    return {
      amountOutRaw: odosOutRaw,
      amountOutFormatted: formatUnits(odosOutRaw, outputDecimals),
      outputDecimals,
      routeUsed: 'odos',
      odos: {
        pathId: odosQuote.pathId,
        priceImpact: odosQuote.priceImpact,
        gasEstimate: odosQuote.gasEstimate,
        quotedAt: odosQuote.quotedAt,
      },
      aegisAlternative: aegisQuote ?? undefined,
      fallbackFromOdos: fallback,
      comparedRoutes: Boolean(aegisQuote),
    }
  }

  if (route === 'aegis') return pickAegis()
  if (route === 'odos') return pickOdos(true)

  const v3ForPool = await usesCanonicalV3ForPool(provider, selectedPool)
  if (route === 'auto' && !v3ForPool && isOdosEligible(selectedPool) && odosValid) {
    if (!aegisQuote || odosOutRaw >= aegisQuote.amountOutRaw) return pickOdos()
  }

  if (odosValid && aegisQuote) {
    if (odosOutRaw >= aegisQuote.amountOutRaw) return pickOdos()
    return pickAegis()
  }
  if (odosValid) return pickOdos()
  return pickAegis()
}

export async function executeAegisPoolSwap(
  signer: Signer,
  address: string,
  provider: Provider,
  selectedPool: PublicPoolConfig,
  _poolMeta: { quoteSymbol: string },
  direction: SwapDirection,
  parsedAmountIn: bigint,
  minOut: bigint,
  quoteVia: 'router' | 'pool' | 'canonical-v3'
): Promise<boolean> {
  const runConfirmedSwap = async (tx: ContractTransactionResponse) => {
    const receipt = await waitAndParseTransaction(tx, address, provider)
    return receipt?.status === 1
  }

  if (quoteVia === 'canonical-v3' || (await usesCanonicalV3ForPool(provider, selectedPool))) {
    const agsToQuote = direction === 'AGS_TO_QUOTE'
    const quoted = await quoteCanonicalSwap(provider, selectedPool, agsToQuote, parsedAmountIn, 18)
    const route = quoted?.route ?? CANONICAL_ROUTE_V3
    return executeCanonicalSwap(signer, address, provider, selectedPool, agsToQuote, parsedAmountIn, minOut, route)
  }

  const router = getPublicPoolRouterContract(signer)
  const useRouter = quoteVia === 'router' && router !== null

  if (useRouter && router) {
    const routerAddr = await router.getAddress()
    if (direction === 'AGS_TO_QUOTE') {
      const token = getErc20Contract(CONTRACT_ADDRESSES.TOKEN, signer)
      const allowance = (await token.allowance(address, routerAddr)) as bigint
      if (allowance < parsedAmountIn) {
        const tx = await token.approve(routerAddr, MaxUint256)
        await waitAndParseTransaction(tx, address, provider)
      }
      const tx = await router.swapExactInputOnBest(true, parsedAmountIn, minOut, address)
      return runConfirmedSwap(tx)
    }
    if (selectedPool.useNative) {
      const tx = await router.swapExactInputOnBest(false, parsedAmountIn, minOut, address, {
        value: parsedAmountIn,
      })
      return runConfirmedSwap(tx)
    }
    if (selectedPool.tokenAddress) {
      const token = getErc20Contract(selectedPool.tokenAddress, signer)
      const allowance = (await token.allowance(address, routerAddr)) as bigint
      if (allowance < parsedAmountIn) {
        const tx = await token.approve(routerAddr, MaxUint256)
        await waitAndParseTransaction(tx, address, provider)
      }
      const tx = await router.swapExactInputOnBest(false, parsedAmountIn, minOut, address)
      return runConfirmedSwap(tx)
    }
    return false
  }

  const poolContract = getPublicLiquidityPoolContract(selectedPool.poolAddress, signer)
  if (direction === 'AGS_TO_QUOTE') {
    const token = getErc20Contract(CONTRACT_ADDRESSES.TOKEN, signer)
    const allowance = (await token.allowance(address, selectedPool.poolAddress)) as bigint
    if (allowance < parsedAmountIn) {
      const tx = await token.approve(selectedPool.poolAddress, MaxUint256)
      await waitAndParseTransaction(tx, address, provider)
    }
    const tx = await poolContract.swapExactInput(true, parsedAmountIn, minOut, address)
    return runConfirmedSwap(tx)
  }
  if (selectedPool.useNative) {
    const tx = await poolContract.swapExactInput(false, parsedAmountIn, minOut, address, {
      value: parsedAmountIn,
    })
    return runConfirmedSwap(tx)
  }
  if (selectedPool.tokenAddress) {
    const token = getErc20Contract(selectedPool.tokenAddress, signer)
    const allowance = (await token.allowance(address, selectedPool.poolAddress)) as bigint
    if (allowance < parsedAmountIn) {
      const tx = await token.approve(selectedPool.poolAddress, MaxUint256)
      await waitAndParseTransaction(tx, address, provider)
    }
    const tx = await poolContract.swapExactInput(false, parsedAmountIn, minOut, address)
    return runConfirmedSwap(tx)
  }
  return false
}
