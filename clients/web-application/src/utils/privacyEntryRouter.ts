/**
 * Client helpers for `PrivacyEntryRouter` (Aegis-contracts/contracts/privacy/PrivacyEntryRouter.sol).
 * EIP-712 domain name/version must match Solidity: EIP712("AegisPrivacyEntry", "1").
 */
import { AbiCoder, Contract, keccak256, type Signer } from 'ethers'
import type { InterfaceAbi } from 'ethers'
import routerArtifact from '@/abis/PrivacyEntryRouter.json'

export const PRIVACY_EIP712_NAME = 'AegisPrivacyEntry'
export const PRIVACY_EIP712_VERSION = '1'

/** Matches `keccak256(abi.encode(uint256[]))` on the router. */
export function publicInputsDigest(publicInputs: readonly bigint[]): string {
  const coder = AbiCoder.defaultAbiCoder()
  return keccak256(coder.encode(['uint256[]'], [publicInputs]))
}

export const TYPES_SHIELD = {
  ShieldIntent: [
    { name: 'depositor', type: 'address' },
    { name: 'publicInputsHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
}

export const TYPES_UNSHIELD = {
  /** On-chain EIP-712 identifier; product term is "transparent exit". */
  UnshieldIntent: [
    { name: 'recipient', type: 'address' },
    { name: 'publicInputsHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
}

export const TYPES_SHIELDED_TRANSFER = {
  ShieldedTransferIntent: [
    { name: 'authorizedSigner', type: 'address' },
    { name: 'publicInputsHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
}

export async function buildPrivacyEntryDomain(routerAddress: string, signer: Signer) {
  const p = signer.provider
  if (!p) throw new Error('Signer has no provider')
  const net = await p.getNetwork()
  return {
    name: PRIVACY_EIP712_NAME,
    version: PRIVACY_EIP712_VERSION,
    chainId: net.chainId,
    verifyingContract: routerAddress,
  } as const
}

export function getPrivacyEntryRouter(signer: Signer, routerAddress: string) {
  return new Contract(routerAddress, routerArtifact.abi as InterfaceAbi, signer)
}

export async function signShieldIntent(
  signer: Signer,
  routerAddress: string,
  publicInputs: bigint[],
  nonce: bigint,
  deadline: bigint
) {
  const addr = await signer.getAddress()
  const domain = await buildPrivacyEntryDomain(routerAddress, signer)
  const pih = publicInputsDigest(publicInputs)
  return signer.signTypedData(domain, TYPES_SHIELD, {
    depositor: addr,
    publicInputsHash: pih,
    nonce,
    deadline,
  })
}

export async function signUnshieldIntent(
  signer: Signer,
  routerAddress: string,
  publicInputs: bigint[],
  nonce: bigint,
  deadline: bigint
) {
  const addr = await signer.getAddress()
  const domain = await buildPrivacyEntryDomain(routerAddress, signer)
  const pih = publicInputsDigest(publicInputs)
  return signer.signTypedData(domain, TYPES_UNSHIELD, {
    recipient: addr,
    publicInputsHash: pih,
    nonce,
    deadline,
  })
}

/** Shield-first copy: same as {@link signUnshieldIntent} — EIP-712 struct name stays `UnshieldIntent` on-chain. */
export const signTransparentExitIntent = signUnshieldIntent

export async function signShieldedTransferIntent(
  signer: Signer,
  routerAddress: string,
  publicInputs: bigint[],
  nonce: bigint,
  deadline: bigint
) {
  const addr = await signer.getAddress()
  const domain = await buildPrivacyEntryDomain(routerAddress, signer)
  const pih = publicInputsDigest(publicInputs)
  return signer.signTypedData(domain, TYPES_SHIELDED_TRANSFER, {
    authorizedSigner: addr,
    publicInputsHash: pih,
    nonce,
    deadline,
  })
}
