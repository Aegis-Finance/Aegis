/**
 * Build a `derivative.circom` witness and pack Groth16 proof bytes for PrivateDerivatives.
 *
 * Public layout (must match ceremonied verifier nPublic=6):
 *   nullifierHash, merkleRoot, contractCommitment, collateralCommitment, derivativeType, valid
 *
 * On-chain packing: 8 × uint256 proof || 6 × uint256 publicInputs (448 bytes).
 */
import { poseidon2, poseidon3, poseidon4, randomFieldElement } from '@/utils/lendingPoseidon'
import { groth16ProofBigintsToBytes256 } from '@/utils/proofBytes'

const BN254_SCALAR = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617',
)
const MERKLE_DEPTH = 20

async function getPoseidon() {
  const { buildPoseidon } = await import('circomlibjs')
  const poseidon = await buildPoseidon()
  return { poseidon, F: poseidon.F }
}

async function poseidonN(inputs: bigint[]): Promise<bigint> {
  const { poseidon, F } = await getPoseidon()
  return BigInt(F.toString(poseidon(inputs)))
}

export async function poseidon6(
  a: bigint,
  b: bigint,
  c: bigint,
  d: bigint,
  e: bigint,
  f: bigint,
): Promise<bigint> {
  return poseidonN([a, b, c, d, e, f])
}

function toField(x: bigint | string | number): bigint {
  const v = typeof x === 'bigint' ? x : BigInt(x)
  return ((v % BN254_SCALAR) + BN254_SCALAR) % BN254_SCALAR
}

/** Build a depth-20 Merkle path with the note as the leftmost leaf (siblings = 0). */
async function buildLeftPath(leaf: bigint): Promise<{ root: bigint; pathElements: string[]; pathIndices: string[] }> {
  let current = leaf
  const pathElements: string[] = []
  const pathIndices: string[] = []
  for (let i = 0; i < MERKLE_DEPTH; i++) {
    const sibling = 0n
    pathElements.push(sibling.toString())
    pathIndices.push('0')
    // sel=0 → left=current, right=sibling
    current = await poseidon2(current, sibling)
  }
  return { root: current, pathElements, pathIndices }
}

export type DerivativeCreateWitnessParams = {
  derivativeType: number
  strikePrice: bigint
  expiryTime: bigint
  notionalAmount: bigint
  premium: bigint
  /** Seller collateral locked on-chain; must be ≥ notional/10 for the circuit. */
  collateralAmount?: bigint
}

export type DerivativeWitnessBundle = {
  input: Record<string, string | string[]>
  publicInputs: bigint[]
  /** bytes32 hex — set as createContract.buyerCommitment / exerciseCommitment */
  contractCommitment: `0x${string}`
  nullifierHash: `0x${string}`
  collateralCommitment: `0x${string}`
}

export async function buildDerivativeCreateWitness(
  params: DerivativeCreateWitnessParams,
): Promise<DerivativeWitnessBundle> {
  const derivativeType = BigInt(params.derivativeType)
  const strikePrice = toField(params.strikePrice)
  const expiryTime = toField(params.expiryTime)
  const notionalAmount = toField(params.notionalAmount)
  const premium = toField(params.premium)
  const minCollateral = notionalAmount / 10n + (notionalAmount % 10n === 0n ? 0n : 1n)
  const collateralAmount = toField(
    params.collateralAmount && params.collateralAmount >= minCollateral
      ? params.collateralAmount
      : notionalAmount > minCollateral
        ? notionalAmount
        : minCollateral,
  )

  const blinding = randomFieldElement()
  const nullifier = randomFieldElement()
  const userSecret = randomFieldElement()
  const contractBlinding = randomFieldElement()
  const collateralBlinding = randomFieldElement()

  const noteCommitment = await poseidon4(collateralAmount, blinding, nullifier, userSecret)
  const nullifierHash = await poseidon2(nullifier, derivativeType)
  const contractCommitment = await poseidon6(
    derivativeType,
    strikePrice,
    expiryTime,
    notionalAmount,
    premium,
    contractBlinding,
  )
  const collateralCommitment = await poseidon3(collateralAmount, derivativeType, collateralBlinding)
  const { root, pathElements, pathIndices } = await buildLeftPath(noteCommitment)

  const input = {
    nullifierHash: nullifierHash.toString(),
    merkleRoot: root.toString(),
    contractCommitment: contractCommitment.toString(),
    collateralCommitment: collateralCommitment.toString(),
    derivativeType: derivativeType.toString(),
    collateralAmount: collateralAmount.toString(),
    blinding: blinding.toString(),
    nullifier: nullifier.toString(),
    pathElements,
    pathIndices,
    strikePrice: strikePrice.toString(),
    expiryTime: expiryTime.toString(),
    notionalAmount: notionalAmount.toString(),
    premium: premium.toString(),
    contractBlinding: contractBlinding.toString(),
    collateralBlinding: collateralBlinding.toString(),
    userSecret: userSecret.toString(),
  }

  // snarkjs publicSignals order: declared publics then outputs
  const publicInputs = [
    nullifierHash,
    root,
    contractCommitment,
    collateralCommitment,
    derivativeType,
    1n, // valid
  ]

  const toBytes32 = (x: bigint): `0x${string}` =>
    `0x${x.toString(16).padStart(64, '0')}` as `0x${string}`

  return {
    input,
    publicInputs,
    contractCommitment: toBytes32(contractCommitment),
    nullifierHash: toBytes32(nullifierHash),
    collateralCommitment: toBytes32(collateralCommitment),
  }
}

/** Pack 8 proof limbs + 6 public inputs into the 448-byte blob PrivateDerivatives expects. */
export function packDerivativeProofBytes(proof: bigint[], publicInputs: bigint[]): Uint8Array {
  if (proof.length !== 8) throw new Error(`Expected 8 proof limbs, got ${proof.length}`)
  if (publicInputs.length !== 6) throw new Error(`Expected 6 public inputs, got ${publicInputs.length}`)
  const head = groth16ProofBigintsToBytes256(proof)
  const out = new Uint8Array(448)
  out.set(head, 0)
  for (let i = 0; i < 6; i++) {
    const p = publicInputs[i]
    if (p < 0n || p >= 2n ** 256n) throw new Error(`Public input ${i} out of uint256 range`)
    const hex = p.toString(16).padStart(64, '0')
    for (let j = 0; j < 32; j++) {
      out[256 + i * 32 + j] = parseInt(hex.slice(j * 2, j * 2 + 2), 16)
    }
  }
  return out
}
