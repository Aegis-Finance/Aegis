import { randomBytes } from 'ethers'
import { groth16ProofBigintsToBytes256 } from '@/utils/proofBytes'
import { isValidHex } from '@/utils/security'

export function randomBytes32Hex(): `0x${string}` {
  return (`0x${Buffer.from(randomBytes(32)).toString('hex')}`) as `0x${string}`
}

export function parseBytes32Field(raw: string): `0x${string}` | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const body = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed
  if (!isValidHex(body, 32)) return null
  return (`0x${body.padStart(64, '0')}`) as `0x${string}`
}

export function proofBytesFromBigints(proof: bigint[]): Uint8Array {
  return groth16ProofBigintsToBytes256(proof)
}

export function proverServiceUrl(): string | null {
  const url = (import.meta.env.VITE_PROVER_URL as string | undefined)?.trim()
  return url || null
}

export async function fetchProverJson<T>(path: string, body: unknown): Promise<T> {
  const base = proverServiceUrl()
  if (!base) throw new Error('VITE_PROVER_URL is not configured')
  const normalized = path.startsWith('/') ? path : `/${path}`
  const res = await fetch(`${base.replace(/\/+$/, '')}${normalized}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Prover request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

export async function proveViaService(
  path: string,
  body: unknown
): Promise<{ proof: bigint[]; publicInputs: bigint[] }> {
  const data = await fetchProverJson<{ proof?: string[]; publicInputs?: string[] }>(path, body)
  return {
    proof: (data.proof ?? []).map((x) => BigInt(x)),
    publicInputs: (data.publicInputs ?? []).map((x) => BigInt(x)),
  }
}
