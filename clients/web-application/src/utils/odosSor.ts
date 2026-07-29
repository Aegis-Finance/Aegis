import { getAddress } from 'ethers'
import type { ContractTransactionResponse, Provider, Signer, TransactionResponse } from 'ethers'

import { getErc20Contract } from '@/utils/contracts'
import { waitAndParseTransaction } from '@/utils/transactionHelper'

/** Odos quotes expire after 60s — assemble must use a fresh pathId. */
export const ODOS_PATH_TTL_MS = 55_000

export type OdosSorQuoteV3InputToken = {
  tokenAddress: string
  amount: string
}

export type OdosSorQuoteV3OutputToken = {
  tokenAddress: string
  proportion: number
}

export type OdosSorQuoteV3 = {
  pathId: string
  outAmounts: string[]
  outTokens: Array<{ tokenAddress: string; proportion: number }>
  priceImpact?: number
  gasEstimate?: number
  gasEstimateValue?: number
  percentDiff?: number
  quotedAt: number
}

export type OdosAssembledTransaction = {
  to: string
  data: string
  value: string
  gas?: string
  chainId?: number
}

export type OdosAssembleResult = {
  transaction: OdosAssembledTransaction
  simulation?: {
    isSuccess?: boolean
    amountsOut?: string[]
    simGasUsed?: number
    simulationError?: { type?: string; message?: string } | null
  }
}

const ODOS_QUOTE_URL = 'https://api.odos.xyz/sor/quote/v3'
const ODOS_ASSEMBLE_URL = 'https://api.odos.xyz/sor/assemble'

function odosApiKey(): string | undefined {
  const key = (import.meta.env.VITE_ODOS_API_KEY as string | undefined)?.trim()
  return key || undefined
}

function odosHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const key = odosApiKey()
  if (key) headers['x-api-key'] = key
  return headers
}

function normalizeAddress(a: string): string {
  return getAddress(a)
}

async function parseOdosError(res: Response, label: string): Promise<never> {
  let detail = res.statusText
  try {
    const json = (await res.json()) as { detail?: string; message?: string; error?: string }
    detail = json.detail ?? json.message ?? json.error ?? detail
  } catch {
    const text = await res.text().catch(() => '')
    if (text) detail = text.slice(0, 240)
  }
  throw new Error(`${label} (${res.status}): ${detail}`)
}

/**
 * Step 1 — POST /sor/quote/v3
 * @see https://docs.odos.xyz/api/sor/quote
 */
export async function odosQuoteV3(params: {
  chainId: number
  userAddr: string
  inputTokenAddress: string
  inputAmount: string
  outputTokenAddress: string
  slippageLimitPercent: number
}): Promise<OdosSorQuoteV3> {
  const body = {
    chainId: params.chainId,
    inputTokens: [
      {
        tokenAddress: normalizeAddress(params.inputTokenAddress),
        amount: params.inputAmount,
      },
    ],
    outputTokens: [
      {
        tokenAddress: normalizeAddress(params.outputTokenAddress),
        proportion: 1,
      },
    ],
    userAddr: normalizeAddress(params.userAddr),
    slippageLimitPercent: params.slippageLimitPercent,
    compact: true,
  }

  const res = await fetch(ODOS_QUOTE_URL, {
    method: 'POST',
    headers: odosHeaders(),
    body: JSON.stringify(body),
  })

  if (!res.ok) await parseOdosError(res, 'Odos quote failed')

  const json = (await res.json()) as {
    pathId?: unknown
    outAmounts?: unknown
    outTokens?: unknown
    priceImpact?: unknown
    gasEstimate?: unknown
    gasEstimateValue?: unknown
    percentDiff?: unknown
  }

  if (typeof json.pathId !== 'string' || !Array.isArray(json.outAmounts)) {
    throw new Error('Odos quote response missing pathId or outAmounts')
  }

  const outAmounts = json.outAmounts.map((v) => String(v))
  const outTokens: OdosSorQuoteV3['outTokens'] = []
  if (Array.isArray(json.outTokens)) {
    for (const t of json.outTokens) {
      const tt = t as { tokenAddress?: unknown; proportion?: unknown }
      if (typeof tt.tokenAddress !== 'string') continue
      const prop = tt.proportion
      if (typeof prop !== 'number') continue
      outTokens.push({ tokenAddress: normalizeAddress(tt.tokenAddress), proportion: prop })
    }
  }

  return {
    pathId: json.pathId,
    outAmounts,
    outTokens,
    priceImpact: typeof json.priceImpact === 'number' ? json.priceImpact : undefined,
    gasEstimate: typeof json.gasEstimate === 'number' ? json.gasEstimate : undefined,
    gasEstimateValue: typeof json.gasEstimateValue === 'number' ? json.gasEstimateValue : undefined,
    percentDiff: typeof json.percentDiff === 'number' ? json.percentDiff : undefined,
    quotedAt: Date.now(),
  }
}

/**
 * Step 2 — POST /sor/assemble
 * @see https://docs.odos.xyz/api/sor/assemble
 */
export async function odosAssemble(params: {
  userAddr: string
  pathId: string
  receiver?: string
  simulate?: boolean
}): Promise<OdosAssembleResult> {
  const body: {
    userAddr: string
    pathId: string
    receiver?: string
    simulate: boolean
  } = {
    userAddr: normalizeAddress(params.userAddr),
    pathId: params.pathId,
    simulate: params.simulate ?? true,
  }
  if (params.receiver) body.receiver = normalizeAddress(params.receiver)

  const res = await fetch(ODOS_ASSEMBLE_URL, {
    method: 'POST',
    headers: odosHeaders(),
    body: JSON.stringify(body),
  })

  if (!res.ok) await parseOdosError(res, 'Odos assemble failed')

  const json = (await res.json()) as {
    transaction?: {
      to?: unknown
      data?: unknown
      value?: unknown
      gas?: unknown
      chainId?: unknown
    }
    simulation?: OdosAssembleResult['simulation']
  }

  const tx = json.transaction
  if (!tx || typeof tx.to !== 'string' || typeof tx.data !== 'string') {
    throw new Error('Odos assemble response missing transaction.to/data')
  }

  const value = typeof tx.value === 'string' ? tx.value : String(tx.value ?? '0')
  const gas = typeof tx.gas === 'string' ? tx.gas : tx.gas != null ? String(tx.gas) : undefined
  const chainId = typeof tx.chainId === 'number' ? tx.chainId : undefined

  return {
    transaction: { to: tx.to, data: tx.data, value, gas, chainId },
    simulation: json.simulation,
  }
}

async function ensureErc20Allowance(
  tokenAddress: string,
  owner: string,
  spender: string,
  amount: bigint,
  signer: Signer,
  provider: Provider
): Promise<void> {
  const token = getErc20Contract(tokenAddress, signer)
  const allowance = (await token.allowance(owner, spender)) as bigint
  if (allowance >= amount) return

  const { MaxUint256 } = await import('ethers')
  const tx = await token.approve(spender, MaxUint256)
  await waitAndParseTransaction(tx, owner, provider)
}

/**
 * Steps 1–3 — quote, assemble (simulated), wallet execute.
 * Always re-quotes at execution time so pathId is fresh (&lt;60s).
 * @see https://docs.odos.xyz/api/sor/execute
 */
export async function executeOdosSwap(params: {
  signer: Signer
  provider: Provider
  userAddr: string
  chainId: number
  inputTokenAddress: string
  inputAmount: bigint
  outputTokenAddress: string
  slippageLimitPercent: number
  onStage?: (stage: 'quote' | 'assemble' | 'approve' | 'send') => void
}): Promise<{ ok: boolean; hash?: string }> {
  params.onStage?.('quote')
  const quote = await odosQuoteV3({
    chainId: params.chainId,
    userAddr: params.userAddr,
    inputTokenAddress: params.inputTokenAddress,
    inputAmount: params.inputAmount.toString(),
    outputTokenAddress: params.outputTokenAddress,
    slippageLimitPercent: params.slippageLimitPercent,
  })

  params.onStage?.('assemble')
  const assembled = await odosAssemble({
    userAddr: params.userAddr,
    pathId: quote.pathId,
    simulate: true,
  })

  if (assembled.simulation?.isSuccess === false) {
    const msg = assembled.simulation.simulationError?.message ?? 'Route simulation failed'
    throw new Error(`Odos route would revert: ${msg}`)
  }

  const txObj = assembled.transaction
  const value = BigInt(txObj.value ?? '0')

  if (value === 0n) {
    params.onStage?.('approve')
    await ensureErc20Allowance(
      params.inputTokenAddress,
      params.userAddr,
      txObj.to,
      params.inputAmount,
      params.signer,
      params.provider
    )
  }

  params.onStage?.('send')
  const txResponse = (await params.signer.sendTransaction({
    to: txObj.to,
    data: txObj.data,
    value,
    gasLimit: txObj.gas ? BigInt(txObj.gas) : undefined,
  })) as TransactionResponse

  const receipt = await waitAndParseTransaction(
    txResponse as unknown as ContractTransactionResponse,
    params.userAddr,
    params.provider
  )
  if (receipt?.status === 1) {
    return { ok: true, hash: receipt.hash }
  }
  return { ok: false }
}
