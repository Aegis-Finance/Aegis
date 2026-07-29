import { Contract } from 'ethers'
import type { Provider } from 'ethers'

import QuoterV2Abi from '@/abis/QuoterV2.json'

const UNISWAP_POOL_FEE = Number((import.meta.env.VITE_UNISWAP_V3_POOL_FEE as string | undefined) ?? '3000')

function quoterAddress(): string | null {
  const fromEnv = (import.meta.env.VITE_UNISWAP_V3_QUOTER_ADDRESS as string | undefined)?.trim()
  if (fromEnv) return fromEnv
  return null
}

/**
 * Exact single-hop quote via Uniswap v3 QuoterV2 (eth_call; reverts with return data).
 */
export async function quoteUniswapV3SingleHop(args: {
  provider: Provider
  agsToQuote: boolean
  amountIn: bigint
  agsToken: string
  weth9: string
}): Promise<bigint> {
  const quoterAddr = quoterAddress()
  if (!quoterAddr) return 0n

  const tokenIn = args.agsToQuote ? args.agsToken : args.weth9
  const tokenOut = args.agsToQuote ? args.weth9 : args.agsToken
  const quoter = new Contract(quoterAddr, QuoterV2Abi, args.provider)

  try {
    const result = await quoter.quoteExactInputSingle.staticCall({
      tokenIn,
      tokenOut,
      amountIn: args.amountIn,
      fee: UNISWAP_POOL_FEE,
      sqrtPriceLimitX96: 0,
    })
    const amountOut = Array.isArray(result) ? result[0] : result
    return BigInt(amountOut as bigint)
  } catch {
    return 0n
  }
}
