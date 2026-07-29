/**
 * Pack a Groth16 proof as 8 × uint256 (32-byte big-endian each) for contracts
 * that expect `bytes` of length 256 (see e.g. DecentralizedInsurance._convertProofData).
 */
export function groth16ProofBigintsToBytes256(proof: bigint[]): Uint8Array {
  if (proof.length !== 8) {
    throw new Error(`Groth16 proof must contain 8 field elements, got ${proof.length}`)
  }
  const out = new Uint8Array(256)
  for (let i = 0; i < 8; i++) {
    const p = proof[i]
    if (p < 0n || p >= 2n ** 256n) {
      throw new Error(`Proof element ${i} out of uint256 range`)
    }
    const hex = p.toString(16).padStart(64, '0')
    for (let j = 0; j < 32; j++) {
      out[i * 32 + j] = parseInt(hex.slice(j * 2, j * 2 + 2), 16)
    }
  }
  return out
}

/** Decode hex string (with or without 0x) to Uint8Array; validates length. */
export function hexToBytesStrict(hex: string, expectedLen: number, label = 'hex'): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (clean.length !== expectedLen * 2 || !/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error(`${label} must be ${expectedLen} bytes (${expectedLen * 2} hex chars)`)
  }
  const buf = new Uint8Array(expectedLen)
  for (let i = 0; i < expectedLen; i++) {
    buf[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return buf
}
