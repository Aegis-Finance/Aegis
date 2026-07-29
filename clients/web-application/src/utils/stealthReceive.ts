import { randomBytes } from 'ethers'
import { poseidon2, poseidon3, randomFieldElement } from '@/utils/lendingPoseidon'
import { proveStealthAddress } from '@/utils/prover'

export type StealthPaymentMaterial = {
  paymentTag: `0x${string}`
  viewTag: `0x${string}`
  spendingKeyHash: `0x${string}`
  secret: bigint
  nullifier: bigint
  commitmentHash: bigint
  nullifierHash: bigint
}

export function randomBytes32Hex(): `0x${string}` {
  const bytes = randomBytes(32)
  let hex = ''
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0')
  }
  return (`0x${hex}`) as `0x${string}`
}

export function bytes32ToField(hex: `0x${string}`): bigint {
  return BigInt(hex)
}

/** Derive stealth payment material matching `stealth-address.circom`. */
export async function buildStealthPaymentMaterial(args: {
  viewTag: `0x${string}`
  paymentTag?: `0x${string}`
}): Promise<StealthPaymentMaterial> {
  const paymentTag = args.paymentTag ?? randomBytes32Hex()
  const secret = randomFieldElement()
  const nullifier = randomFieldElement()
  const nullifierHash = await poseidon2(secret, nullifier)
  const commitmentHash = await poseidon3(secret, bytes32ToField(paymentTag), bytes32ToField(args.viewTag))
  return {
    paymentTag,
    viewTag: args.viewTag,
    spendingKeyHash: randomBytes32Hex(),
    secret,
    nullifier,
    commitmentHash,
    nullifierHash,
  }
}

export async function proveStealthClaim(material: StealthPaymentMaterial) {
  return proveStealthAddress({
    paymentTag: material.paymentTag,
    viewTag: material.viewTag,
    commitmentHash: material.commitmentHash.toString(),
    nullifierHash: material.nullifierHash.toString(),
    secret: material.secret.toString(),
    nullifier: material.nullifier.toString(),
  })
}

export function formatStealthPayInstructions(material: StealthPaymentMaterial): string {
  return [
    'Stealth pay instructions (payer):',
    `1. Share payment tag with payer: ${material.paymentTag}`,
    `2. Payer shields AGS to commitment derived from this tag + your view tag.`,
    `3. Commitment hash (for shield witness): ${material.commitmentHash.toString()}`,
    `4. After shield confirms, recipient claims with spending key.`,
  ].join('\n')
}
