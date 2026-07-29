/**
 * Sonic Gateway programmatic bridge (Ethereum → Sonic).
 * @see https://docs.soniclabs.com/sonic/build-on-sonic/programmatic-gateway
 */
import {
  AbiCoder,
  BrowserProvider,
  Contract,
  Interface,
  JsonRpcProvider,
  Signer,
  ZeroAddress,
  encodeRlp,
  getBytes,
  hexlify,
  keccak256,
  toQuantity,
} from 'ethers'
import type { InjectedEip1193Provider } from '@/utils/injectedWallets'

export const ETH_CHAIN_ID = 1
export const SONIC_MAINNET_CHAIN_ID = 146

export const GATEWAY_MAINNET = {
  ethereum: {
    TOKEN_DEPOSIT: '0xa1E2481a9CD0Cb0447EeB1cbc26F1b3fff3bec20',
    TOKEN_PAIRS: '0xf2b1510c2709072C88C5b14db90Ec3b6297193e4',
    STATE_ORACLE: '0xB7e8CC3F5FeA12443136f0cc13D81F109B2dEd7f',
  },
  sonic: {
    BRIDGE: '0x9Ef7629F9B930168b76283AdD7120777b3c895b3',
    TOKEN_PAIRS: '0x134E4c207aD5A13549DE1eBF8D43c1f49b00ba94',
    STATE_ORACLE: '0x836664B0c0CB29B7877bCcF94159CC996528F2C3',
  },
} as const

const STATE_ORACLE_ABI = [
  'function lastBlockNum() external view returns (uint256)',
] as const

const TOKEN_PAIRS_ABI = [
  'function originalToMinted(address) external view returns (address)',
  'function mintedToOriginal(address) external view returns (address)',
] as const

const TOKEN_DEPOSIT_ABI = [
  'function deposit(uint96 uid, address token, uint256 amount) external',
  'event Deposit(uint256 indexed id, address indexed owner, address token, uint256 amount)',
] as const

const BRIDGE_ABI = [
  'function claim(uint256 id, address token, uint256 amount, bytes calldata proof) external',
] as const

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address owner) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
] as const

/** Fallback L1 addresses when on-chain pair lookup is unavailable. */
const ETH_MAINNET_TOKEN_FALLBACK: Record<string, { address: string; decimals: number }> = {
  USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
  USDT: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
  WETH: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18 },
  EURC: { address: '0x1aBaEA1f7817Bc9c719a32E70271C186c97Bc241', decimals: 6 },
}

export type BridgeTokenOption = {
  symbol: string
  sonicAddress: string
  ethereumAddress: string
  decimals: number
  settlementRail?: string
}

export type PendingBridgeDeposit = {
  depositId: string
  depositBlockNumber: number
  ethereumToken: string
  sonicToken: string
  symbol: string
  amount: string
  txHash: string
  createdAt: number
}

const PENDING_STORAGE_KEY = 'aegis_tge_gateway_pending_v1'

export function loadPendingDeposit(): PendingBridgeDeposit | null {
  try {
    const raw = localStorage.getItem(PENDING_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as PendingBridgeDeposit
  } catch {
    return null
  }
}

export function savePendingDeposit(p: PendingBridgeDeposit): void {
  localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(p))
}

export function clearPendingDeposit(): void {
  localStorage.removeItem(PENDING_STORAGE_KEY)
}

function ethRpcUrl(): string {
  const fromEnv = (import.meta.env.VITE_ETH_RPC_URL as string | undefined)?.trim()
  return fromEnv || 'https://ethereum.publicnode.com'
}

function sonicMainnetRpcUrl(): string {
  const fromEnv = (import.meta.env.VITE_SONIC_MAINNET_RPC_URL as string | undefined)?.trim()
  return fromEnv || 'https://rpc.soniclabs.com'
}

export function getEthReadProvider(): JsonRpcProvider {
  return new JsonRpcProvider(ethRpcUrl(), ETH_CHAIN_ID, { staticNetwork: true })
}

export function getSonicMainnetReadProvider(): JsonRpcProvider {
  return new JsonRpcProvider(sonicMainnetRpcUrl(), SONIC_MAINNET_CHAIN_ID, { staticNetwork: true })
}

export function browserProviderForChain(
  eip1193: InjectedEip1193Provider,
  chainId: number
): BrowserProvider {
  return new BrowserProvider(eip1193, chainId)
}

export async function switchWalletChain(
  eip1193: InjectedEip1193Provider,
  chainId: number,
  addParams?: Record<string, unknown>
): Promise<void> {
  const desiredHex = `0x${chainId.toString(16)}`
  try {
    await eip1193.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: desiredHex }],
    })
  } catch (err) {
    const code = (err as { code?: number }).code
    if (code === 4902 && addParams) {
      await eip1193.request({
        method: 'wallet_addEthereumChain',
        params: [addParams],
      })
    } else {
      throw err
    }
  }
}

export async function resolveEthereumToken(
  symbol: string,
  sonicAddress: string
): Promise<{ address: string; decimals: number }> {
  const sonicPairs = new Contract(
    GATEWAY_MAINNET.sonic.TOKEN_PAIRS,
    TOKEN_PAIRS_ABI,
    getSonicMainnetReadProvider()
  )
  let ethAddr: string = ZeroAddress
  try {
    ethAddr = await sonicPairs.mintedToOriginal(sonicAddress)
  } catch {
    /* fall through */
  }

  if (!ethAddr || ethAddr === ZeroAddress) {
    const fb = ETH_MAINNET_TOKEN_FALLBACK[symbol]
    if (fb) return fb
    throw new Error(`${symbol} is not mapped on the Gateway token pairs contract`)
  }

  const ethPairs = new Contract(
    GATEWAY_MAINNET.ethereum.TOKEN_PAIRS,
    TOKEN_PAIRS_ABI,
    getEthReadProvider()
  )
  let minted = ZeroAddress
  try {
    minted = await ethPairs.originalToMinted(ethAddr)
  } catch {
    /* RPC flake — fall back to documented L1 token below */
  }

  if (!minted || minted === ZeroAddress) {
    const fb = ETH_MAINNET_TOKEN_FALLBACK[symbol]
    if (fb) {
      let decimals = fb.decimals
      try {
        const token = new Contract(ethAddr, ERC20_ABI, getEthReadProvider())
        decimals = Number(await token.decimals())
      } catch {
        /* keep fallback decimals */
      }
      return { address: ethAddr, decimals }
    }
    throw new Error(`${symbol} is not supported for Ethereum → Sonic deposits`)
  }

  const token = new Contract(ethAddr, ERC20_ABI, getEthReadProvider())
  let decimals = ETH_MAINNET_TOKEN_FALLBACK[symbol]?.decimals ?? 18
  try {
    decimals = Number(await token.decimals())
  } catch {
    /* keep fallback */
  }
  return { address: ethAddr, decimals }
}

export async function buildBridgeTokenOptions(
  rows: { tokenSymbol: string; tokenAddress: string; settlementRail?: string }[]
): Promise<BridgeTokenOption[]> {
  const out: BridgeTokenOption[] = []
  for (const row of rows) {
    try {
      const { address, decimals } = await resolveEthereumToken(row.tokenSymbol, row.tokenAddress)
      out.push({
        symbol: row.tokenSymbol,
        sonicAddress: row.tokenAddress,
        ethereumAddress: address,
        decimals,
        settlementRail: row.settlementRail,
      })
    } catch (e) {
      const fb = ETH_MAINNET_TOKEN_FALLBACK[row.tokenSymbol]
      if (fb) {
        console.warn(`Using documented L1 fallback for ${row.tokenSymbol}:`, e)
        out.push({
          symbol: row.tokenSymbol,
          sonicAddress: row.tokenAddress,
          ethereumAddress: fb.address,
          decimals: fb.decimals,
          settlementRail: row.settlementRail,
        })
      } else {
        console.warn(`Skipping bridge token ${row.tokenSymbol}:`, e)
      }
    }
  }
  return out
}

export async function fetchEthTokenBalance(
  tokenAddress: string,
  owner: string
): Promise<bigint> {
  const token = new Contract(tokenAddress, ERC20_ABI, getEthReadProvider())
  return token.balanceOf(owner)
}

export async function fetchEthAllowance(
  tokenAddress: string,
  owner: string,
  spender: string
): Promise<bigint> {
  const token = new Contract(tokenAddress, ERC20_ABI, getEthReadProvider())
  return token.allowance(owner, spender)
}

export async function approveOnEthereum(
  signer: Signer,
  tokenAddress: string,
  amount: bigint
): Promise<string> {
  const token = new Contract(tokenAddress, ERC20_ABI, signer)
  const tx = await token.approve(GATEWAY_MAINNET.ethereum.TOKEN_DEPOSIT, amount)
  const receipt = await tx.wait()
  return receipt.hash as string
}

export type DepositResult = {
  txHash: string
  depositId: bigint
  depositBlockNumber: number
  mintedToken: string
}

export async function depositOnEthereum(
  signer: Signer,
  ethereumToken: string,
  amount: bigint
): Promise<DepositResult> {
  const pairs = new Contract(
    GATEWAY_MAINNET.ethereum.TOKEN_PAIRS,
    TOKEN_PAIRS_ABI,
    signer
  )
  const mintedToken = await pairs.originalToMinted(ethereumToken)
  if (!mintedToken || mintedToken === ZeroAddress) {
    throw new Error('Token not supported on Ethereum Gateway')
  }

  const deposit = new Contract(
    GATEWAY_MAINNET.ethereum.TOKEN_DEPOSIT,
    TOKEN_DEPOSIT_ABI,
    signer
  )
  const uid = BigInt(Date.now()) & ((1n << 96n) - 1n)
  const tx = await deposit.deposit(uid, ethereumToken, amount)
  const receipt = await tx.wait()
  if (!receipt) throw new Error('Deposit transaction failed')

  const iface = new Interface(TOKEN_DEPOSIT_ABI)
  let depositId: bigint | null = null
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log)
      if (parsed?.name === 'Deposit') {
        depositId = parsed.args.id as bigint
        break
      }
    } catch {
      /* not our event */
    }
  }
  if (depositId === null) {
    throw new Error('Deposit succeeded but deposit id was not found in logs')
  }

  return {
    txHash: receipt.hash,
    depositId,
    depositBlockNumber: receipt.blockNumber,
    mintedToken,
  }
}

export async function sonicStateOracleCoversBlock(depositBlockNumber: number): Promise<boolean> {
  const oracle = new Contract(
    GATEWAY_MAINNET.sonic.STATE_ORACLE,
    STATE_ORACLE_ABI,
    getSonicMainnetReadProvider()
  )
  const last = await oracle.lastBlockNum()
  return BigInt(last) >= BigInt(depositBlockNumber)
}

export async function waitForSonicStateOracle(
  depositBlockNumber: number,
  onTick?: (lastBlock: bigint) => void,
  signal?: AbortSignal
): Promise<bigint> {
  const oracle = new Contract(
    GATEWAY_MAINNET.sonic.STATE_ORACLE,
    STATE_ORACLE_ABI,
    getSonicMainnetReadProvider()
  )
  while (true) {
    if (signal?.aborted) throw new Error('Cancelled')
    const last = (await oracle.lastBlockNum()) as bigint
    onTick?.(last)
    if (last >= BigInt(depositBlockNumber)) return last
    await new Promise((r) => setTimeout(r, 15_000))
  }
}

type EthProofResponse = {
  accountProof: string[]
  storageProof: { proof: string[] }[]
}

export async function generateDepositProof(
  depositId: bigint,
  blockNum: bigint
): Promise<string> {
  const storageSlot = keccak256(
    AbiCoder.defaultAbiCoder().encode(['uint256', 'uint8'], [depositId, 7])
  )
  const eth = getEthReadProvider()
  const proof = (await eth.send('eth_getProof', [
    GATEWAY_MAINNET.ethereum.TOKEN_DEPOSIT,
    [storageSlot],
    toQuantity(blockNum),
  ])) as EthProofResponse

  if (!proof?.accountProof?.length || !proof.storageProof?.[0]?.proof?.length) {
    throw new Error('eth_getProof returned an empty proof — try another Ethereum RPC (set VITE_ETH_RPC_URL)')
  }

  return hexlify(
    getBytes(
      encodeRlp([
        encodeRlp(proof.accountProof),
        encodeRlp(proof.storageProof[0].proof),
      ])
    )
  )
}

export async function claimOnSonic(
  signer: Signer,
  depositId: bigint,
  ethereumToken: string,
  amount: bigint,
  proof: string
): Promise<string> {
  const bridge = new Contract(GATEWAY_MAINNET.sonic.BRIDGE, BRIDGE_ABI, signer)
  const tx = await bridge.claim(depositId, ethereumToken, amount, proof)
  const receipt = await tx.wait()
  if (!receipt) throw new Error('Claim transaction failed')
  return receipt.hash as string
}
