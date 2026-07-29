import { BrowserProvider, JsonRpcSigner } from 'ethers'
import { create } from 'zustand'
import toast from 'react-hot-toast'
import { ENV, walletAddChainParamsForEnv } from '../config'
import { getBrowserProvider } from '../utils/contracts'
import type { InjectedEip1193Provider } from '../utils/injectedWallets'

type WalletProvider = BrowserProvider | null

type WalletState = {
  provider: WalletProvider
  signer: JsonRpcSigner | null
  address: string | null
  chainId: number | null
  isConnected: boolean
  isConnecting: boolean
  /** Last EIP-1193 provider used for signing (EIP-6963 or legacy `window.ethereum`). */
  eip1193: InjectedEip1193Provider | null
  connectWithInjected: (injected: InjectedEip1193Provider) => Promise<void>
  disconnect: () => void
  checkConnection: () => Promise<void>
}

export const useWalletStore = create<WalletState>((set, get) => ({
  provider: null,
  signer: null,
  address: null,
  chainId: null,
  isConnected: false,
  isConnecting: false,
  eip1193: null,

  connectWithInjected: async (injected: InjectedEip1193Provider) => {
    if (get().isConnecting) return
    set({ isConnecting: true })
    try {
      const desiredHex = `0x${ENV.chainId.toString(16)}`
      const currentHex = (await injected.request({ method: 'eth_chainId' })) as string | undefined
      if (!currentHex) {
        throw new Error('Unable to determine current chain ID')
      }

      if (currentHex.toLowerCase() !== desiredHex.toLowerCase()) {
        try {
          await injected.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: desiredHex }],
          })
        } catch (switchError) {
          const code = (switchError as { code?: number }).code
          if (code === 4902) {
            const p = walletAddChainParamsForEnv()
            await injected.request({
              method: 'wallet_addEthereumChain',
              params: [
                {
                  chainId: p.chainId,
                  chainName: p.chainName,
                  nativeCurrency: p.nativeCurrency,
                  rpcUrls: p.rpcUrls,
                  blockExplorerUrls: p.blockExplorerUrls,
                },
              ],
            })
          } else {
            throw switchError
          }
        }
      }

      const browserProvider = new BrowserProvider(injected, ENV.chainId)
      const accounts = (await browserProvider.send('eth_requestAccounts', [])) as string[]
      if (!accounts || accounts.length === 0) {
        throw new Error('Wallet connection rejected')
      }

      const signer = await browserProvider.getSigner()
      const chainIdHex = (await browserProvider.send('eth_chainId', [])) as string

      set({
        provider: browserProvider,
        signer,
        address: accounts[0],
        chainId: parseInt(chainIdHex, 16),
        isConnected: true,
        isConnecting: false,
        eip1193: injected,
      })
      toast.success('Wallet connected')
    } catch (error) {
      console.error('Wallet connection error', error)
      toast.error(error instanceof Error ? error.message : 'Failed to connect wallet')
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
      isConnecting: false,
      eip1193: null,
    })
  },

  checkConnection: async () => {
    try {
      const injected = (get().eip1193 ?? window.ethereum) as InjectedEip1193Provider | undefined
      if (!injected || typeof injected.request !== 'function') {
        set({
          provider: null,
          signer: null,
          address: null,
          chainId: null,
          isConnected: false,
          eip1193: null,
        })
        return
      }
      const provider = getBrowserProvider(injected)
      const accounts = (await provider.send('eth_accounts', [])) as string[]
      if (!accounts || accounts.length === 0) {
        set({
          provider: null,
          signer: null,
          address: null,
          chainId: null,
          isConnected: false,
          eip1193: null,
        })
        return
      }
      const signer = await provider.getSigner()
      const chainIdHex = await provider.send('eth_chainId', [])
      set({
        provider,
        signer,
        address: accounts[0],
        chainId: parseInt(chainIdHex as string, 16),
        isConnected: true,
        eip1193: injected,
      })
    } catch (error) {
      console.warn('checkConnection failed', error)
    }
  },
}))
