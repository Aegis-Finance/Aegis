/**
 * Auction Groth16 witness + commitment/nullifier for private purchases.
 * Circuit public inputs come from on-chain `getAuctionVerifierPublicInputs`.
 */
import { randomBytes } from 'ethers'
import { getAuctionContract, getPublicProvider } from './contracts'
import { proveAuction } from './prover'

export type AuctionWitness = {
  startPrice: string
  reservePrice: string
  startTime: string
  duration: string
  currentTime: string
  priceDecayRate: string
  bidAmount: string
  maxPrice: string
}

export async function fetchAuctionWitness(): Promise<AuctionWitness> {
  const provider = getPublicProvider()
  const contract = getAuctionContract(provider)
  const block = await provider.getBlock('latest')
  if (!block) throw new Error('Could not read latest block')
  const pub = await contract.getAuctionVerifierPublicInputs(block.timestamp)
  const currentPrice = await contract.getCurrentPrice()
  const startPrice = pub[0] as bigint
  return {
    startPrice: startPrice.toString(),
    reservePrice: (pub[1] as bigint).toString(),
    startTime: (pub[2] as bigint).toString(),
    duration: (pub[3] as bigint).toString(),
    currentTime: (pub[4] as bigint).toString(),
    priceDecayRate: (pub[5] as bigint).toString(),
    bidAmount: (currentPrice as bigint).toString(),
    maxPrice: startPrice.toString(),
  }
}

export function freshCommitmentNullifier(): { commitment: bigint; nullifier: bigint } {
  const commitment = BigInt(`0x${Buffer.from(randomBytes(32)).toString('hex')}`)
  const nullifier = BigInt(`0x${Buffer.from(randomBytes(32)).toString('hex')}`)
  return { commitment, nullifier }
}

export async function proveAuctionPurchase(opts?: {
  proverUrl?: string
  manualCommitment?: string
  manualNullifier?: string
}): Promise<{ proof: bigint[]; commitment: bigint; nullifier: bigint }> {
  if (opts?.manualCommitment && opts?.manualNullifier) {
    const raw = localStorage.getItem('auction_proof') || ''
    const proofParts = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => BigInt(s))
    if (proofParts.length !== 8) {
      throw new Error('Circuit artifacts not available and no stored proof found.')
    }
    return {
      proof: proofParts,
      commitment: BigInt(opts.manualCommitment),
      nullifier: BigInt(opts.manualNullifier),
    }
  }

  const witness = await fetchAuctionWitness()
  let { commitment, nullifier } = freshCommitmentNullifier()

  if (opts?.proverUrl) {
    try {
      const res = await fetch(`${opts.proverUrl.replace(/\/+$/, '')}/auction/prove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(witness),
      })
      if (!res.ok) throw new Error('Proof service error')
      const data = await res.json()
      const proof = (data.proof ?? []).map((x: string) => BigInt(x))
      if (proof.length !== 8) throw new Error('Invalid proof from prover service')
      if (data.commitment) commitment = BigInt(data.commitment)
      if (data.nullifier) nullifier = BigInt(data.nullifier)
      return { proof, commitment, nullifier }
    } catch {
      // Fall through to local proving
    }
  }

  const result = await proveAuction(witness)
  return { proof: result.proof, commitment, nullifier }
}
