import { create } from 'zustand'
import { BrowserProvider, JsonRpcProvider, Signer } from 'ethers'
import { DEFAULT_NETWORK, RPC_CONFIG, buildWalletAddChainRpcUrls } from '@/config/contracts'
import { fetchSonicChainPackPrimaryRpcs } from '@/config/sonicChainPack'
import {
  getFirstAvailableRpcProfile,
  getRpcProfile,
  isHostedSonicPublicRpcProfile,
  isTrustedRpcUrl,
} from '@/config/rpcProfiles'
import { isOperationalProfile } from '@/utils/operationalProfile'
import toast from 'react-hot-toast'
import type { InjectedEip1193Provider } from '@/utils/injectedWallets'

interface WalletState {
  provider: BrowserProvider | JsonRpcProvider | null
  signer: Signer | null
  address: string | null
  chainId: number | null
  isConnected: boolean
  isConnecting: boolean
  rpcUrl: string
  rpcProfileId: string
  customRpcUrl: string | null
  eip1193: InjectedEip1193Provider | null
  connectWithInjected: (injected: InjectedEip1193Provider) => Promise<void>
  disconnect: () => void
  switchNetwork: (chainId: number) => Promise<void>
  setRpcProfile: (profileId: string, customUrl?: string) => void
  checkConnection: () => Promise<void>
}

const initialProfile = getFirstAvailableRpcProfile()

export const useWalletStore = create<WalletState>((set, get) => ({
  provider: null,
  signer: null,
  address: null,
  chainId: null,
  isConnected: false,
  isConnecting: false,
  rpcUrl: initialProfile.url ?? RPC_CONFIG.default,
  rpcProfileId: initialProfile.id,
  customRpcUrl: null,
  eip1193: null,

  connectWithInjected: async (injected: InjectedEip1193Provider) => {
    try {
      set({ isConnecting: true })

      const desiredChainHex = `0x${DEFAULT_NETWORK.chainId.toString(16)}`
      const rpcUrlsForWallet = buildWalletAddChainRpcUrls(get().rpcUrl)

      const currentChainHex = (await injected.request({
        method: 'eth_chainId',
      })) as string | undefined

      if (!currentChainHex) {
        throw new Error('Unable to determine current chain ID')
      }

      if (currentChainHex.toLowerCase() !== desiredChainHex.toLowerCase()) {
        try {
          await injected.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: desiredChainHex }],
          })
        } catch (switchError) {
          const error = switchError as { code?: number }
          if (error?.code === 4902) {
            await injected.request({
              method: 'wallet_addEthereumChain',
              params: [
                {
                  chainId: desiredChainHex,
                  chainName: DEFAULT_NETWORK.name,
                  nativeCurrency: DEFAULT_NETWORK.nativeCurrency,
                  rpcUrls: rpcUrlsForWallet,
                  blockExplorerUrls: DEFAULT_NETWORK.blockExplorerUrls,
                },
              ],
            })
          } else {
            throw switchError
          }
        }
      }

      const provider = new BrowserProvider(injected)
      await provider.send('eth_requestAccounts', [])
      const signer = await provider.getSigner()
      const address = await signer.getAddress()
      const networkAfter = await provider.getNetwork()

      set({
        provider,
        signer,
        address,
        chainId: Number(networkAfter.chainId),
        isConnected: true,
        isConnecting: false,
        eip1193: injected,
      })

      toast.success('Wallet connected')
    } catch (error) {
      console.error('Wallet connection error:', error)
      const message = error instanceof Error ? error.message : 'Failed to connect wallet'
      toast.error(message)
      set({ isConnecting: false })
    }
  },

  disconnect: () => {
    set({
      provider: null,
      signer: null,
      address: null,
      chainId: null,
      isConnected: false,
      eip1193: null,
    })
    toast.success('Wallet disconnected')
  },

  switchNetwork: async (chainId: number) => {
    const { provider } = get()
    if (!provider || !('send' in provider)) return

    try {
      await (provider as BrowserProvider).send('wallet_switchEthereumChain', [
        { chainId: `0x${chainId.toString(16)}` },
      ])
    } catch (error) {
      console.error('Network switch error:', error)
      toast.error('Failed to switch network')
    }
  },

  setRpcProfile: (profileId: string, customUrl?: string) => {
    if (isOperationalProfile() && isHostedSonicPublicRpcProfile(profileId)) {
      toast.error('Public Sonic RPC is disabled in operational profile')
      return
    }

    const profile = getRpcProfile(profileId)

    if (!profile) {
      toast.error('Unknown RPC profile')
      return
    }

    if (profile.id === 'sonic-official-pack') {
      if (isOperationalProfile()) {
        toast.error('Chain-pack public RPC is disabled in operational profile')
        return
      }
      void fetchSonicChainPackPrimaryRpcs().then((urls) => {
        const fallback = 'https://rpc.soniclabs.com'
        const resolved = urls.find((u) => isTrustedRpcUrl(u)) ?? fallback
        if (!isTrustedRpcUrl(resolved)) {
          toast.error('No trusted RPC available from chain pack')
          return
        }
        const latest = get()
        set({
          rpcUrl: resolved,
          rpcProfileId: 'sonic-official-pack',
          customRpcUrl: null,
        })
        if (!latest.isConnected) {
          const provider = new JsonRpcProvider(resolved)
          provider.getNetwork().then((network) => {
            set({
              provider,
              chainId: Number(network.chainId),
            })
          })
        }
        toast.success(`RPC switched to ${profile.label}`)
      })
      return
    }

    if (profile.id === 'custom') {
      if (!customUrl || customUrl.trim().length === 0) {
        toast.error('Enter a valid RPC URL')
        return
      }
      const trimmed = customUrl.trim()
      if (!isTrustedRpcUrl(trimmed)) {
        toast.error(
          'RPC URL must be HTTPS on an allowed host (Sonic Labs, your configured DAO node, or trusted hosts), or http://127.0.0.1 / localhost'
        )
        return
      }
      set({
        rpcUrl: trimmed,
        rpcProfileId: profile.id,
        customRpcUrl: trimmed,
      })
      if (!get().isConnected) {
        const provider = new JsonRpcProvider(trimmed)
        provider.getNetwork().then((network) => {
          set({
            provider,
            chainId: Number(network.chainId),
          })
        })
      }
      toast.success('Custom RPC configured')
      return
    }

    if (!profile.url) {
      toast.error(
        profile.id === 'dao'
          ? 'DAO RPC is not available in this deployment'
          : 'RPC endpoint not configured for this profile'
      )
      return
    }

    set({
      rpcUrl: profile.url,
      rpcProfileId: profile.id,
      customRpcUrl: null,
    })

    if (!get().isConnected) {
      const provider = new JsonRpcProvider(profile.url)
      provider.getNetwork().then((network) => {
        set({
          provider,
          chainId: Number(network.chainId),
        })
      })
    }
    toast.success(`RPC switched to ${profile.label}`)
  },

  checkConnection: async () => {
    const { provider, address } = get()
    if (!provider || !address) return

    try {
      if ('send' in provider) {
        // Browser provider
        const accounts = await (provider as BrowserProvider).send('eth_accounts', [])
        if (accounts.length === 0) {
          get().disconnect()
        } else {
          const signer = await provider.getSigner()
          const newAddress = await signer.getAddress()
          if (newAddress !== address) {
            set({ address: newAddress, signer })
          }
        }
      }
    } catch (error) {
      console.error('Connection check error:', error)
    }
  },
}))

let chainPackRpcBootstrapScheduled = false

/**
 * Prefer the first trusted HTTPS URL from `public/config/sonic-chain-pack.json` when the user
 * is still on the static default Sonic public profile (before they pick Blaze, custom, etc.).
 */
export function scheduleChainPackRpcBootstrap(): void {
  if (isOperationalProfile()) return
  if (chainPackRpcBootstrapScheduled) return
  chainPackRpcBootstrapScheduled = true

  void (async () => {
    const s0 = useWalletStore.getState()
    if (s0.rpcProfileId !== 'sonic-public-mainnet') {
      return
    }

    const urls = await fetchSonicChainPackPrimaryRpcs()
    const fallback = 'https://rpc.soniclabs.com'
    const resolved = urls.find((u) => isTrustedRpcUrl(u)) ?? fallback
    if (!isTrustedRpcUrl(resolved)) return

    const s1 = useWalletStore.getState()
    if (s1.rpcProfileId !== 'sonic-public-mainnet') {
      return
    }

    useWalletStore.setState({
      rpcUrl: resolved,
      rpcProfileId: 'sonic-official-pack',
      customRpcUrl: null,
    })

    if (!s1.isConnected) {
      try {
        const provider = new JsonRpcProvider(resolved)
        const network = await provider.getNetwork()
        useWalletStore.setState({
          provider,
          chainId: Number(network.chainId),
        })
      } catch (e) {
        console.error('[chain-pack-rpc] bootstrap failed', e)
      }
    }
  })()
}

// Extend Window interface for MetaMask
declare global {
  interface EthereumProvider {
    request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  }

  interface Window {
    ethereum?: EthereumProvider
  }
}

