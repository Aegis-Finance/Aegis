import { ethers } from 'ethers'

/**
 * Leaf for `StagedCapitalVault.investorMerkleRoot` (OpenZeppelin merkle-tree address value).
 * Must match on-chain `computeInvestorLeaf(account)`.
 */
export function stagedCapitalInvestorLeaf(account: string): string {
  const inner = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['address'], [account]))
  return ethers.keccak256(ethers.concat([inner]))
}

/** Sorted commutative inner-node hash (OZ `Hashes.commutativeKeccak256`). */
export function stagedCapitalCommutativeHash(a: string, b: string): string {
  const aa = BigInt(a)
  const bb = BigInt(b)
  const [x, y] = aa < bb ? [a, b] : [b, a]
  return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['bytes32', 'bytes32'], [x, y]))
}
