import type { TypedDataDomain, TypedDataField } from 'ethers'

/** Must match `StagedCapitalVault` constructor `EIP712("AegisStagedCapital", "1")`. */
export const STAGED_CAPITAL_EIP712_TYPES: Record<string, TypedDataField[]> = {
  MilestoneAttestation: [
    { name: 'roundId', type: 'uint256' },
    { name: 'milestoneIndex', type: 'uint256' },
    { name: 'evidenceHash', type: 'bytes32' },
  ],
}

export function stagedCapitalTypedDomain(vaultAddress: string, chainId: bigint | number): TypedDataDomain {
  const cid = typeof chainId === 'bigint' ? Number(chainId) : chainId
  return {
    name: 'AegisStagedCapital',
    version: '1',
    chainId: cid,
    verifyingContract: vaultAddress,
  }
}
