/**
 * Odos SOR helpers for TGE checkout — mirrors `frontend/src/utils/odosSor.ts`.
 */
import { getAddress } from 'ethers'

export type OdosSorQuoteV3InputToken = {
  tokenAddress: string
  amount: string
}

export type OdosSorQuoteV3OutputToken = {
  tokenAddress: string
  proportion: number
}

const ODOS_QUOTE_URL = 'https://api.odos.xyz/sor/quote/v3'
const ODOS_ASSEMBLE_URL = 'https://api.odos.xyz/sor/assemble'

export type OdosSorQuoteV3 = {
  pathId: string
  outAmounts: string[]
  outTokens: Array<{ tokenAddress: string; proportion: number }>
}

export type OdosAssembledTransaction = {
  to: string
  data: string
  value: string
  gas?: string
  gasPrice?: string
  nonce?: number
  chainId?: number
}

function normalizeAddress(a: string): string {
  return getAddress(a)
}

export async function odosQuoteV3(params: {
  chainId: number
  userAddr?: string
  inputTokenAddress: string
  inputAmount: string
  outputTokenAddress: string
  slippageLimitPercent: number
}): Promise<OdosSorQuoteV3> {
  type OdosQuoteBody = {
    chainId: number
    inputTokens: OdosSorQuoteV3InputToken[]
    outputTokens: OdosSorQuoteV3OutputToken[]
    userAddr?: string
    slippageLimitPercent: number
    compact: boolean
  }

  const body: OdosQuoteBody = {
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
    userAddr: params.userAddr ? normalizeAddress(params.userAddr) : undefined,
    slippageLimitPercent: params.slippageLimitPercent,
    compact: true,
  }

  if (!params.userAddr) delete body.userAddr

  const res = await fetch(ODOS_QUOTE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`Odos quote failed (${res.status}): ${t || res.statusText}`)
  }

  const json: unknown = await res.json()
  const j = json as { pathId?: unknown; outAmounts?: unknown; outTokens?: unknown }

  if (typeof j.pathId !== 'string' || !Array.isArray(j.outAmounts)) {
    throw new Error('Odos quote response missing pathId/outAmounts')
  }

  const outAmounts = j.outAmounts.map((v: unknown) => String(v))

  const outTokens: OdosSorQuoteV3['outTokens'] = []
  if (Array.isArray(j.outTokens)) {
    for (const t of j.outTokens) {
      const tt = t as { tokenAddress?: unknown; proportion?: unknown }
      if (typeof tt.tokenAddress !== 'string') continue
      const prop = tt.proportion
      if (typeof prop !== 'number') continue
      outTokens.push({ tokenAddress: normalizeAddress(tt.tokenAddress), proportion: prop })
    }
  }

  return { pathId: j.pathId, outAmounts, outTokens }
}

export async function odosAssemble(params: {
  userAddr: string
  pathId: string
  receiver?: string
}): Promise<{ transaction: OdosAssembledTransaction; simulation?: unknown }> {
  type OdosAssembleBody = {
    userAddr: string
    pathId: string
    receiver?: string
  }

  const body: OdosAssembleBody = {
    userAddr: normalizeAddress(params.userAddr),
    pathId: params.pathId,
    receiver: params.receiver ? normalizeAddress(params.receiver) : undefined,
  }

  const res = await fetch(ODOS_ASSEMBLE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`Odos assemble failed (${res.status}): ${t || res.statusText}`)
  }

  const json: unknown = await res.json()
  const j = json as {
    transaction?: { to?: unknown; data?: unknown; value?: unknown; gas?: unknown; gasPrice?: unknown }
    simulation?: unknown
  }
  const to = j.transaction?.to
  const data = j.transaction?.data
  if (typeof to !== 'string' || typeof data !== 'string') {
    throw new Error('Odos assemble response missing transaction.to/data')
  }

  const tx = j.transaction!
  const value = typeof tx.value === 'string' ? tx.value : String(tx.value ?? '0')
  const gas = typeof tx.gas === 'string' ? tx.gas : tx.gas != null ? String(tx.gas) : undefined
  const gasPrice =
    typeof tx.gasPrice === 'string' ? tx.gasPrice : tx.gasPrice != null ? String(tx.gasPrice) : undefined

  return {
    transaction: {
      to,
      data,
      value,
      gas,
      gasPrice,
    },
    simulation: j.simulation,
  }
}
