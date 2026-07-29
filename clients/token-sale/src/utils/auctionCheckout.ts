/**
 * Normalize non-S/wS auction payments to wS via Odos before ZK purchase.
 */
import { Contract, type Signer } from 'ethers'
import { odosAssemble, odosQuoteV3 } from './odosSor'
import {
  agsOutFromPayment,
  approveErc20ForAuction,
  fetchErc20Allowance,
  type PayRail,
  type PayRailSymbol,
} from './auctionPayment'

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
] as const

export type PreparedAuctionPayment =
  | {
      route: 'native'
      payAmountWei: bigint
      minTokensOut: bigint
    }
  | {
      route: 'erc20'
      paymentToken: string
      paymentAmountWei: bigint
      minTokensOut: bigint
      swappedViaOdos: boolean
    }

/** Pay tokens that must route through wS before the auction ERC-20 purchase path. */
export function needsWsNormalization(symbol: PayRailSymbol): boolean {
  return symbol !== 'S' && symbol !== 'wS'
}

async function ensureErc20Allowance(
  signer: Signer,
  tokenAddress: string,
  owner: string,
  spender: string,
  amount: bigint
): Promise<void> {
  const provider = signer.provider
  if (!provider) throw new Error('Signer has no provider')
  const allowance = await fetchErc20Allowance(provider, tokenAddress, owner, spender)
  if (allowance >= amount) return
  const token = new Contract(tokenAddress, ERC20_ABI, signer)
  const tx = await token.approve(spender, amount)
  await tx.wait()
}

export async function prepareAuctionPayment(params: {
  signer: Signer
  userAddress: string
  chainId: number
  paySymbol: PayRailSymbol
  payAmountWei: bigint
  payRail: PayRail
  wsTokenAddress: string | null
  auctionAddress: string
  currentPriceWeiPerAgs: bigint
  slippageBps: number
}): Promise<PreparedAuctionPayment> {
  const {
    signer,
    userAddress,
    chainId,
    paySymbol,
    payAmountWei,
    payRail,
    wsTokenAddress,
    auctionAddress,
    currentPriceWeiPerAgs,
    slippageBps,
  } = params

  const minFromAmount = (amountWei: bigint, symbol: PayRailSymbol) => {
    const expected = agsOutFromPayment(symbol, amountWei, currentPriceWeiPerAgs)
    const bps = BigInt(10000 - slippageBps)
    return (expected * bps) / 10000n
  }

  if (paySymbol === 'S') {
    return {
      route: 'native',
      payAmountWei,
      minTokensOut: minFromAmount(payAmountWei, 'S'),
    }
  }

  if (!payRail.tokenAddress) {
    throw new Error(`${paySymbol} pay rail is not configured`)
  }

  if (paySymbol === 'wS') {
    return {
      route: 'erc20',
      paymentToken: payRail.tokenAddress,
      paymentAmountWei: payAmountWei,
      minTokensOut: minFromAmount(payAmountWei, 'wS'),
      swappedViaOdos: false,
    }
  }

  if (!wsTokenAddress) {
    throw new Error('wS pay rail is not configured on-chain — cannot normalize stable/WETH checkout')
  }

  const slippageLimitPercent = slippageBps / 100

  const quote = await odosQuoteV3({
    chainId,
    userAddr: userAddress,
    inputTokenAddress: payRail.tokenAddress,
    inputAmount: payAmountWei.toString(),
    outputTokenAddress: wsTokenAddress,
    slippageLimitPercent,
  })

  const assembled = await odosAssemble({
    userAddr: userAddress,
    pathId: quote.pathId,
  })

  const txObj = assembled.transaction
  await ensureErc20Allowance(signer, payRail.tokenAddress, userAddress, txObj.to, payAmountWei)

  const swapTx = await signer.sendTransaction({
    to: txObj.to,
    data: txObj.data,
    value: BigInt(txObj.value ?? '0'),
    gasLimit: txObj.gas ? BigInt(txObj.gas) : undefined,
    gasPrice: txObj.gasPrice ? BigInt(txObj.gasPrice) : undefined,
  })
  await swapTx.wait()

  const wsOut = quote.outAmounts[0] ? BigInt(quote.outAmounts[0]) : 0n
  if (wsOut === 0n) {
    throw new Error('Odos swap returned zero wS')
  }

  const allowance = await fetchErc20Allowance(signer.provider!, wsTokenAddress, userAddress, auctionAddress)
  if (allowance < wsOut) {
    await approveErc20ForAuction(signer, wsTokenAddress, auctionAddress, wsOut)
  }

  return {
    route: 'erc20',
    paymentToken: wsTokenAddress,
    paymentAmountWei: wsOut,
    minTokensOut: minFromAmount(wsOut, 'wS'),
    swappedViaOdos: true,
  }
}
