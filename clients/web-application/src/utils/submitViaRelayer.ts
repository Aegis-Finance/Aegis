import {
  Contract,
  type ContractTransactionResponse,
  type Provider,
  type Signer,
  TypedDataEncoder,
  getBytes,
  hexlify,
  keccak256,
} from 'ethers'
import {
  postPrivacyRelay,
  preferGaslessExecutionRelay,
  resolveExecutionRelayAddress,
} from '@/utils/privacyRelay'

const EXECUTION_RELAY_ABI = [
  'function nonces(address user) view returns (uint256)',
  'function execute(address user, address target, bytes data, uint256 value, uint256 deadline, uint256 nonce, bytes signature) payable returns (bytes)',
]

const EXECUTION_DOMAIN = {
  name: 'AegisExecutionRelay',
  version: '1',
  chainId: 0,
  verifyingContract: '0x0000000000000000000000000000000000000000',
} as const

const EXECUTION_TYPES: Record<string, { name: string; type: string }[]> = {
  ExecutionIntent: [
    { name: 'user', type: 'address' },
    { name: 'target', type: 'address' },
    { name: 'dataHash', type: 'bytes32' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
}

export async function signExecutionIntent(args: {
  signer: Signer
  relayAddress: string
  chainId: number
  target: string
  data: string
  value: bigint
  nonce: bigint
  deadline: bigint
  userAddress: string
}): Promise<string> {
  const dataHash = keccak256(getBytes(args.data))
  const domain = { ...EXECUTION_DOMAIN, chainId: args.chainId, verifyingContract: args.relayAddress }
  return args.signer.signTypedData(domain, EXECUTION_TYPES, {
    user: args.userAddress,
    target: args.target,
    dataHash,
    value: args.value,
    nonce: args.nonce,
    deadline: args.deadline,
  })
}

const GAUGE_RELAY_METHODS: Record<string, { relayMethod: string; prependUser: boolean }> = {
  stake: { relayMethod: 'stakeFor', prependUser: true },
  getReward: { relayMethod: 'getRewardFor', prependUser: true },
  withdraw: { relayMethod: 'withdrawFor', prependUser: true },
}

function resolveRelayCall(
  method: string,
  walletAddress: string,
  methodArgs: unknown[],
): { method: string; args: unknown[] } {
  const mapped = GAUGE_RELAY_METHODS[method]
  if (!mapped) return { method, args: methodArgs }
  if (mapped.prependUser) {
    return { method: mapped.relayMethod, args: [walletAddress, ...methodArgs] }
  }
  return { method: mapped.relayMethod, args: methodArgs }
}

/**
 * Submit allowlisted contract call via `AegisExecutionRelay` HTTP relayer, or fall back to wallet tx.
 */
export async function submitViaRelayer(args: {
  signer: Signer
  provider: Provider
  walletAddress: string
  target: Contract
  method: string
  methodArgs: unknown[]
  value?: bigint
  fallbackTx?: () => Promise<ContractTransactionResponse>
}): Promise<ContractTransactionResponse> {
  const relayAddr = resolveExecutionRelayAddress()
  const useGasless = preferGaslessExecutionRelay() && Boolean(relayAddr)

  if (useGasless && relayAddr) {
    const iface = args.target.interface
    const { method: relayMethod, args: relayArgs } = resolveRelayCall(
      args.method,
      args.walletAddress,
      args.methodArgs,
    )
    const data = iface.encodeFunctionData(relayMethod, relayArgs)
    const value = args.value ?? 0n
    const relay = new Contract(relayAddr, EXECUTION_RELAY_ABI, args.provider)
    const block = await args.provider.getBlock('latest')
    if (!block) throw new Error('Could not read latest block')
    const deadline = BigInt(block.timestamp) + 7200n
    const nonce = await relay.nonces(args.walletAddress)
    const network = await args.provider.getNetwork()
    const sig = await signExecutionIntent({
      signer: args.signer,
      relayAddress: relayAddr,
      chainId: Number(network.chainId),
      target: await args.target.getAddress(),
      data,
      value,
      nonce,
      deadline,
      userAddress: args.walletAddress,
    })
    const { txHash } = await postPrivacyRelay('/v1/relay-execution', {
      user: args.walletAddress,
      target: await args.target.getAddress(),
      data: hexlify(getBytes(data)),
      value: value.toString(),
      deadline: deadline.toString(),
      nonce: nonce.toString(),
      signature: sig,
    })
    return { hash: txHash, wait: async () => ({ hash: txHash }) } as unknown as ContractTransactionResponse
  }

  if (args.fallbackTx) return args.fallbackTx()
  const fn = args.target.getFunction(args.method)
  const tx = await fn(...args.methodArgs, { value: args.value ?? 0n })
  return tx as ContractTransactionResponse
}

/** @deprecated use signExecutionIntent — exported for tests */
export function executionIntentDigest(
  relayAddress: string,
  chainId: number,
  user: string,
  target: string,
  data: string,
  value: bigint,
  nonce: bigint,
  deadline: bigint,
): string {
  const domain = { ...EXECUTION_DOMAIN, chainId, verifyingContract: relayAddress }
  const dataHash = keccak256(getBytes(data))
  return TypedDataEncoder.hash(domain, EXECUTION_TYPES, {
    user,
    target,
    dataHash,
    value,
    nonce,
    deadline,
  })
}
