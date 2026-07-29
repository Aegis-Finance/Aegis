/**
 * Browser witnesses for `mint-optimized` (shield) and `transfer-unshield` (transparent exit).
 * Secrets stay in the client; matches circom templates + PrivateTokenContract public I/O order.
 */

import { poseidon2, poseidon3, randomFieldElement } from '@/utils/lendingPoseidon'
import { proveMintOptimized, proveTransferUnshield } from '@/utils/prover'

const BN254_SCALAR = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617',
)

export function addressToField(address: string): bigint {
  return BigInt(address)
}

export function bytes32ToField(hex: string): bigint {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  const x = BigInt(`0x${clean.padStart(64, '0')}`)
  return x % BN254_SCALAR || 1n
}

export function fieldToBytes32(n: bigint): string {
  return `0x${(n % BN254_SCALAR).toString(16).padStart(64, '0')}`
}

export type MintShieldSecrets = {
  depositSecret: bigint
  depositNonce: bigint
  noteSecret: bigint
  nullifierNonce: bigint
  depositNullifier: bigint
  outputCommitment: bigint
  depositorField: bigint
}

export async function buildMintShieldSecrets(depositor: string, amountWei: bigint): Promise<MintShieldSecrets> {
  const depositSecret = randomFieldElement()
  const depositNonce = randomFieldElement()
  const noteSecret = randomFieldElement()
  const nullifierNonce = randomFieldElement()
  const depositorField = addressToField(depositor)
  const depositNullifier = await poseidon2(depositSecret, depositNonce)
  const outputCommitment = await poseidon3(noteSecret, amountWei, depositorField)
  return {
    depositSecret,
    depositNonce,
    noteSecret,
    nullifierNonce,
    depositNullifier,
    outputCommitment,
    depositorField,
  }
}

export async function mintShieldWitnessFromSecrets(secrets: MintShieldSecrets, amountWei: bigint) {
  return {
    depositSecret: secrets.depositSecret.toString(),
    depositNonce: secrets.depositNonce.toString(),
    noteSecret: secrets.noteSecret.toString(),
    depositNullifier: secrets.depositNullifier.toString(),
    outputCommitment: secrets.outputCommitment.toString(),
    amount: amountWei.toString(),
    depositor: secrets.depositorField.toString(),
  }
}

export async function proveMintShieldInBrowser(depositor: string, amountWei: bigint) {
  const secrets = await buildMintShieldSecrets(depositor, amountWei)
  const witness = await mintShieldWitnessFromSecrets(secrets, amountWei)
  const { proof, publicInputs } = await proveMintOptimized(witness)
  return { proof, publicInputs, secrets }
}

export async function proveTransferUnshieldInBrowser(params: {
  noteSecret: bigint
  nullifierNonce: bigint
  recipient: string
  amountWei: bigint
  inputCommitment: bigint
}) {
  const recipientField = addressToField(params.recipient)
  const nullifier = await poseidon2(params.noteSecret, params.nullifierNonce)
  const witness = {
    noteSecret: params.noteSecret.toString(),
    nullifierNonce: params.nullifierNonce.toString(),
    nullifier: nullifier.toString(),
    recipient: recipientField.toString(),
    amount: params.amountWei.toString(),
    inputCommitment: params.inputCommitment.toString(),
  }
  return proveTransferUnshield(witness)
}

export async function fetchMintShieldProofRemote(
  proverUrl: string,
  body: { depositNullifier: string; depositor: string; amount: string },
) {
  const res = await fetch(`${proverUrl.replace(/\/+$/, '')}/mint/shield/prove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(t || `Proof service error (${res.status})`)
  }
  const data = (await res.json()) as { proof?: string[]; publicInputs?: string[] }
  const proof = (data.proof ?? []).map((x) => BigInt(x))
  const publicInputs = (data.publicInputs ?? []).map((x) => BigInt(x))
  if (proof.length !== 8 || publicInputs.length !== 4) {
    throw new Error('Invalid proof response from prover (expected proof[8] and publicInputs[4])')
  }
  return { proof, publicInputs }
}

export async function fetchTransferUnshieldProofRemote(
  proverUrl: string,
  body: { nullifier: string; recipient: string; amount: string; commitment: string },
) {
  const res = await fetch(`${proverUrl.replace(/\/+$/, '')}/transfer/unshield/prove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('Proof service error')
  const data = (await res.json()) as { proof?: string[]; publicInputs?: string[] }
  return {
    proof: (data.proof ?? []).map((x) => BigInt(x)),
    publicInputs: (data.publicInputs ?? []).map((x) => BigInt(x)),
  }
}
