/**
 * Browser witness + proof for `shielded-transfer.circom` / `PrivateTokenContract.shieldedTransfer`.
 */
import type { CommitmentRecord } from '@/utils/commitmentStorage'
import { poseidon2, poseidon3, randomFieldElement } from '@/utils/lendingPoseidon'
import { proveShieldedTransfer } from '@/utils/prover'
import { addressToField, bytes32ToField, fieldToBytes32 } from '@/utils/tokenPrivacyProof'

export type ShieldedNoteInput = {
  noteSecret: bigint
  nullifierNonce: bigint
  rIn: bigint
  commitment: bigint
  balance: bigint
}

export type ShieldedTransferResult = {
  proof: bigint[]
  publicInputs: bigint[]
  changeNote: {
    commitment: string
    noteSecret: bigint
    nullifierNonce: bigint
    amount: bigint
    outputTag: 1
  }
  paymentNote: {
    commitment: string
    noteSecret: bigint
    nullifierNonce: bigint
    amount: bigint
    outputTag: 2
  }
}

export function noteRInField(record: CommitmentRecord, ownerAddress: string): bigint {
  const tag = record.metadata?.shieldedOutputTag
  if (tag === 1 || tag === 2) return BigInt(tag)
  return addressToField(ownerAddress)
}

export async function verifyNoteOpening(
  record: CommitmentRecord,
  ownerAddress: string,
  balance: bigint
): Promise<ShieldedNoteInput> {
  const noteSecretRaw = record.metadata?.noteSecret
  const nullifierNonceRaw = record.metadata?.nullifierNonce
  if (!noteSecretRaw || !nullifierNonceRaw) {
    throw new Error('This note has no local secrets — shield or import it in this browser first.')
  }
  const noteSecret = BigInt(String(noteSecretRaw))
  const nullifierNonce = BigInt(String(nullifierNonceRaw))
  const rIn = noteRInField(record, ownerAddress)
  const commitment = bytes32ToField(record.commitment)
  const opening = await poseidon3(noteSecret, balance, rIn)
  if (opening !== commitment) {
    throw new Error('Note secrets do not match on-chain commitment')
  }
  return { noteSecret, nullifierNonce, rIn, commitment, balance }
}

export async function proveShieldedTransferInBrowser(params: {
  input1: ShieldedNoteInput
  input2: ShieldedNoteInput
  paymentAmount: bigint
}): Promise<ShieldedTransferResult> {
  const { input1, input2, paymentAmount } = params
  if (input1.commitment === input2.commitment) {
    throw new Error('Choose two different notes')
  }
  const totalAmount = input1.balance + input2.balance
  if (paymentAmount <= 0n || paymentAmount > totalAmount) {
    throw new Error('Invalid send amount')
  }
  const changeAmount = totalAmount - paymentAmount

  const inputNullifier1 = await poseidon2(input1.noteSecret, input1.nullifierNonce)
  const inputNullifier2 = await poseidon2(input2.noteSecret, input2.nullifierNonce)

  const changeSecret = randomFieldElement()
  const changeNonce = randomFieldElement()
  const paymentSecret = randomFieldElement()
  const paymentNonce = randomFieldElement()

  const outputCommitment1 = await poseidon3(changeSecret, changeAmount, 1n)
  const outputCommitment2 = await poseidon3(paymentSecret, paymentAmount, 2n)

  const witness = {
    s1: input1.noteSecret.toString(),
    nn1: input1.nullifierNonce.toString(),
    rIn1: input1.rIn.toString(),
    s2: input2.noteSecret.toString(),
    nn2: input2.nullifierNonce.toString(),
    rIn2: input2.rIn.toString(),
    os1: changeSecret.toString(),
    oa1: changeAmount.toString(),
    os2: paymentSecret.toString(),
    oa2: paymentAmount.toString(),
    inputNullifier1: inputNullifier1.toString(),
    inputNullifier2: inputNullifier2.toString(),
    outputCommitment1: outputCommitment1.toString(),
    outputCommitment2: outputCommitment2.toString(),
    totalAmount: totalAmount.toString(),
    inputCommitment1: input1.commitment.toString(),
    inputCommitment2: input2.commitment.toString(),
    balanceIn1: input1.balance.toString(),
    balanceIn2: input2.balance.toString(),
    outputAmount1: changeAmount.toString(),
    outputAmount2: paymentAmount.toString(),
  }

  const { proof, publicInputs } = await proveShieldedTransfer(witness)

  return {
    proof,
    publicInputs,
    changeNote: {
      commitment: fieldToBytes32(outputCommitment1),
      noteSecret: changeSecret,
      nullifierNonce: changeNonce,
      amount: changeAmount,
      outputTag: 1,
    },
    paymentNote: {
      commitment: fieldToBytes32(outputCommitment2),
      noteSecret: paymentSecret,
      nullifierNonce: paymentNonce,
      amount: paymentAmount,
      outputTag: 2,
    },
  }
}

export function encodePaymentReceipt(payload: {
  commitment: string
  noteSecret: bigint
  nullifierNonce: bigint
  amount: bigint
  recipientHint?: string
}): string {
  return JSON.stringify({
    v: 1,
    commitment: payload.commitment,
    noteSecret: payload.noteSecret.toString(),
    nullifierNonce: payload.nullifierNonce.toString(),
    outputTag: 2,
    amount: payload.amount.toString(),
    to: payload.recipientHint ?? '',
  })
}

export function parsePaymentReceipt(raw: string): {
  commitment: string
  noteSecret: string
  nullifierNonce: string
  amount: string
  outputTag: number
} {
  const parsed = JSON.parse(raw.trim()) as Record<string, unknown>
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid receipt')
  const commitment = String(parsed.commitment ?? '')
  const noteSecret = String(parsed.noteSecret ?? '')
  const nullifierNonce = String(parsed.nullifierNonce ?? '')
  const amount = String(parsed.amount ?? '0')
  if (!commitment.startsWith('0x') || !noteSecret || !nullifierNonce) {
    throw new Error('Invalid receipt fields')
  }
  return {
    commitment,
    noteSecret,
    nullifierNonce,
    amount,
    outputTag: Number(parsed.outputTag ?? 2),
  }
}
