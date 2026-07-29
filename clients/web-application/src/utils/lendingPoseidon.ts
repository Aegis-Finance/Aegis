/**
 * Poseidon over BN254 scalar field (matches circomlib `Poseidon(n)` in lending circuits).
 * Used so browser witnesses satisfy in-circuit hash constraints for local `snarkjs.groth16.fullProve`.
 */

const BN254_SCALAR = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617',
)

let poseidonPromise: Promise<{
  poseidon: (inputs: bigint[]) => unknown
  F: { toString: (x: unknown) => string }
}> | null = null

async function getPoseidon() {
  if (!poseidonPromise) {
    poseidonPromise = (async () => {
      const { buildPoseidon } = await import('circomlibjs')
      const poseidon = await buildPoseidon()
      return { poseidon, F: poseidon.F }
    })()
  }
  return poseidonPromise
}

export function randomFieldElement(): bigint {
  const buf = new Uint8Array(32)
  crypto.getRandomValues(buf)
  let x = 0n
  for (const b of buf) x = (x << 8n) + BigInt(b)
  return x % BN254_SCALAR || 1n
}

export async function poseidon2(a: bigint, b: bigint): Promise<bigint> {
  const { poseidon, F } = await getPoseidon()
  const h = poseidon([a, b])
  return BigInt(F.toString(h))
}

export async function poseidon3(a: bigint, b: bigint, c: bigint): Promise<bigint> {
  const { poseidon, F } = await getPoseidon()
  const h = poseidon([a, b, c])
  return BigInt(F.toString(h))
}

export async function poseidon4(a: bigint, b: bigint, c: bigint, d: bigint): Promise<bigint> {
  const { poseidon, F } = await getPoseidon()
  const h = poseidon([a, b, c, d])
  return BigInt(F.toString(h))
}
