import { Contract, formatUnits, MaxUint256, parseUnits } from 'ethers'
import type { ContractTransactionResponse, Provider, Signer } from 'ethers'

import { CONTRACT_ADDRESSES } from '@/config/contracts'
import type { PublicPoolConfig } from '@/config/liquidity'
import { getErc20Contract } from '@/utils/contracts'
import { waitAndParseTransaction } from '@/utils/transactionHelper'
import AegisCanonicalSwapRouterAbi from '@/abis/AegisCanonicalSwapRouter.json'
import { quoteUniswapV3SingleHop } from '@/utils/uniswapV3Quote'

export const CANONICAL_ROUTE_V3 = 1
export const CANONICAL_ROUTE_POOL = 2

const WRAPPED_NATIVE_ENV = (import.meta.env.VITE_WRAPPED_NATIVE_ADDRESS as string | undefined)?.trim()

export function getCanonicalSwapRouterContract(provider: Provider | Signer): Contract | null {
  const address = CONTRACT_ADDRESSES.CANONICAL_SWAP_ROUTER
  if (!address) return null
  return new Contract(address, AegisCanonicalSwapRouterAbi.abi, provider)
}

export function wrappedNativeAddress(): string | null {
  return WRAPPED_NATIVE_ENV || null
}

export function isNativeOrWsQuotePool(pool: PublicPoolConfig): boolean {
  if (pool.useNative) return true
  const ws = wrappedNativeAddress()
  if (!ws || !pool.tokenAddress) return false
  return pool.tokenAddress.toLowerCase() === ws.toLowerCase()
}

export async function isCanonicalV3Active(provider: Provider): Promise<boolean> {
  const router = getCanonicalSwapRouterContract(provider)
  if (!router) return false
  try {
    return Boolean(await router.v3Seeded())
  } catch {
    return false
  }
}

export async function usesCanonicalV3ForPool(provider: Provider, pool: PublicPoolConfig): Promise<boolean> {
  if (!isNativeOrWsQuotePool(pool)) return false
  const router = getCanonicalSwapRouterContract(provider)
  if (!router) return false
  try {
    const ws = wrappedNativeAddress() ?? ''
    return Boolean(await router.usesCanonicalV3(ws, pool.useNative))
  } catch {
    return false
  }
}

export async function quoteCanonicalSwap(
  provider: Provider,
  pool: PublicPoolConfig,
  agsToQuote: boolean,
  parsedAmount: bigint,
  _outputDecimals: number
): Promise<{ route: number; amountOutRaw: bigint } | null> {
  const router = getCanonicalSwapRouterContract(provider)
  if (!router) return null

  const quoteToken = pool.useNative ? pool.tokenAddress ?? '' : pool.tokenAddress ?? ''
  const quoteIsNative = pool.useNative

  const v3 = await usesCanonicalV3ForPool(provider, pool)
  if (v3) {
    const ws = wrappedNativeAddress()
    if (!ws) return null
    const amountOutRaw = await quoteUniswapV3SingleHop({
      provider,
      agsToQuote,
      amountIn: parsedAmount,
      agsToken: CONTRACT_ADDRESSES.TOKEN,
      weth9: ws,
    })
    if (!amountOutRaw || amountOutRaw <= 0n) return null
    return { route: CANONICAL_ROUTE_V3, amountOutRaw }
  }

  const [route, amountOutRaw] = (await router.quote(agsToQuote, quoteToken, quoteIsNative, parsedAmount)) as [
    bigint,
    bigint,
  ]
  const routeNum = Number(route)
  const out = BigInt(amountOutRaw)
  if (!out || out <= 0n) return null
  return { route: routeNum, amountOutRaw: out }
}

export async function fetchCanonicalAgsPerWs(provider: Provider): Promise<string | null> {
  const router = getCanonicalSwapRouterContract(provider)
  if (!router) return null
  try {
    if (!(await router.v3Seeded())) return null
    const wad = (await router.canonicalAgsPerWsWad()) as bigint
    if (!wad || wad === 0n) return null
    return formatUnits(wad, 18)
  } catch {
    return null
  }
}

export async function executeCanonicalSwap(
  signer: Signer,
  address: string,
  provider: Provider,
  pool: PublicPoolConfig,
  agsToQuote: boolean,
  parsedAmountIn: bigint,
  minOut: bigint,
  route: number
): Promise<boolean> {
  const router = getCanonicalSwapRouterContract(signer)
  if (!router) return false

  const runConfirmed = async (tx: ContractTransactionResponse) => {
    const receipt = await waitAndParseTransaction(tx, address, provider)
    return receipt?.status === 1
  }

  const routerAddr = await router.getAddress()
  const quoteToken = pool.tokenAddress ?? ''
  const quoteIsNative = pool.useNative

  if (route === CANONICAL_ROUTE_V3) {
    if (agsToQuote) {
      const token = getErc20Contract(CONTRACT_ADDRESSES.TOKEN, signer)
      const allowance = (await token.allowance(address, routerAddr)) as bigint
      if (allowance < parsedAmountIn) {
        const tx = await token.approve(routerAddr, MaxUint256)
        await waitAndParseTransaction(tx, address, provider)
      }
    } else if (!quoteIsNative && pool.tokenAddress) {
      const token = getErc20Contract(pool.tokenAddress, signer)
      const allowance = (await token.allowance(address, routerAddr)) as bigint
      if (allowance < parsedAmountIn) {
        const tx = await token.approve(routerAddr, MaxUint256)
        await waitAndParseTransaction(tx, address, provider)
      }
    }

    const tx = await router.swapExactInput(agsToQuote, quoteToken, quoteIsNative, parsedAmountIn, minOut, address, {
      value: !agsToQuote && quoteIsNative ? parsedAmountIn : 0n,
    })
    return runConfirmed(tx)
  }

  if (agsToQuote) {
    const token = getErc20Contract(CONTRACT_ADDRESSES.TOKEN, signer)
    const allowance = (await token.allowance(address, routerAddr)) as bigint
    if (allowance < parsedAmountIn) {
      const tx = await token.approve(routerAddr, MaxUint256)
      await waitAndParseTransaction(tx, address, provider)
    }
  } else if (quoteIsNative) {
    // native handled via msg.value below
  } else if (pool.tokenAddress) {
    const token = getErc20Contract(pool.tokenAddress, signer)
    const allowance = (await token.allowance(address, routerAddr)) as bigint
    if (allowance < parsedAmountIn) {
      const tx = await token.approve(routerAddr, MaxUint256)
      await waitAndParseTransaction(tx, address, provider)
    }
  }

  const tx = await router.swapExactInput(agsToQuote, quoteToken, quoteIsNative, parsedAmountIn, minOut, address, {
    value: !agsToQuote && quoteIsNative ? parsedAmountIn : 0n,
  })
  return runConfirmed(tx)
}

/** One canonical wS/S reference price for UI when v3 is live. */
export async function canonicalSpotAgsForOneQuote(
  provider: Provider,
  pool: PublicPoolConfig
): Promise<string | null> {
  if (!(await usesCanonicalV3ForPool(provider, pool))) return null
  const one = parseUnits('1', 18)
  const q = await quoteCanonicalSwap(provider, pool, false, one, 18)
  if (!q) return null
  return formatUnits(q.amountOutRaw, 18)
}
