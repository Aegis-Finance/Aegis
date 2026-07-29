import { Contract, type ContractTransactionResponse, type Provider, type Signer } from 'ethers'
import { ABIS } from '@/abis'
import { getTokenContract } from '@/utils/contracts'
import {
  postPrivacyRelay,
  preferGaslessPrivacyRelay,
  resolvePrivacyEntryRouterAddress,
  type PrivacyRelayPath,
} from '@/utils/privacyRelay'

export type PrivacyEntryDirectMethod = 'shield' | 'unshield' | 'shieldedTransfer'

export async function submitPrivacyEntryAction(args: {
  signer: Signer
  provider: Provider
  walletAddress: string
  publicEntryOpen: boolean
  proof: bigint[]
  publicInputs: bigint[]
  relayPath: PrivacyRelayPath
  directMethod: PrivacyEntryDirectMethod
  signIntent: (
    signer: Signer,
    routerAddress: string,
    publicInputs: bigint[],
    nonce: bigint,
    deadline: bigint
  ) => Promise<string>
  beforeSubmit?: () => Promise<void>
}): Promise<ContractTransactionResponse> {
  const routerAddr = resolvePrivacyEntryRouterAddress()
  const useGasless = preferGaslessPrivacyRelay() && Boolean(routerAddr)

  if (useGasless && routerAddr) {
    const router = new Contract(routerAddr, ABIS.PrivacyEntryRouter, args.provider)
    const block = await args.provider.getBlock('latest')
    if (!block) throw new Error('Could not read latest block')
    const deadline = BigInt(block.timestamp) + 7200n
    const nonce = await router.nonces(args.walletAddress)
    const sig = await args.signIntent(args.signer, routerAddr, args.publicInputs, nonce, deadline)
    await args.beforeSubmit?.()
    const body = {
      proof: args.proof.map(String),
      publicInputs: args.publicInputs.map(String),
      deadline: deadline.toString(),
      nonce: nonce.toString(),
      signature: sig,
      ...(args.relayPath === '/v1/relay-shielded-transfer'
        ? { authorizedSigner: args.walletAddress }
        : {}),
    }
    const { txHash } = await postPrivacyRelay(args.relayPath, body)
    return { hash: txHash, wait: async () => ({ hash: txHash }) } as unknown as ContractTransactionResponse
  }

  const token = getTokenContract(args.signer)
  if (args.publicEntryOpen) {
    await args.beforeSubmit?.()
    const tx = await token[args.directMethod](args.proof, args.publicInputs)
    return tx
  }

  if (!routerAddr) throw new Error('Privacy entry is unavailable')
  const router = new Contract(routerAddr, ABIS.PrivacyEntryRouter, args.signer)
  const feeWei = await router.relayFeeWei()
  const block = await args.provider.getBlock('latest')
  if (!block) throw new Error('Could not read latest block')
  const deadline = BigInt(block.timestamp) + 7200n
  const nonce = await router.nonces(args.walletAddress)
  const sig = await args.signIntent(args.signer, routerAddr, args.publicInputs, nonce, deadline)
  await args.beforeSubmit?.()

  if (args.directMethod === 'shield') {
    return router.relayShield(args.proof, args.publicInputs, deadline, nonce, sig, { value: feeWei })
  }
  if (args.directMethod === 'unshield') {
    return router.relayUnshield(args.proof, args.publicInputs, deadline, nonce, sig, { value: feeWei })
  }
  return router.relayShieldedTransfer(
    args.proof,
    args.publicInputs,
    deadline,
    nonce,
    args.walletAddress,
    sig,
    { value: feeWei }
  )
}
