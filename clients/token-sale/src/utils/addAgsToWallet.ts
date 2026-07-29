import toast from 'react-hot-toast'
import type { InjectedEip1193Provider } from './injectedWallets'
import {
  AGS_TOKEN_DECIMALS,
  AGS_TOKEN_SYMBOL,
  resolveAgsTokenAddress,
} from './agsTokenAddress'

function tokenListImageUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    return new URL('/favicon.ico', window.location.origin).href
  } catch {
    return undefined
  }
}

/**
 * Prompt the user's wallet to add AGS (EIP-747 `wallet_watchAsset`).
 * Uses the connected EIP-6963 provider when available; otherwise `window.ethereum`.
 */
export async function addAgsToWallet(injected?: InjectedEip1193Provider | null): Promise<void> {
  const eth =
    injected ??
    (typeof window !== 'undefined' && window.ethereum ? window.ethereum : null)

  if (!eth || typeof eth.request !== 'function') {
    throw new Error('Connect a wallet first (MetaMask, Rabby, OKX, etc.)')
  }

  const address = await resolveAgsTokenAddress()
  if (!address) {
    throw new Error('AGS token address is not configured for this network')
  }

  const options: Record<string, string | number> = {
    address,
    symbol: AGS_TOKEN_SYMBOL,
    decimals: AGS_TOKEN_DECIMALS,
  }
  const image = tokenListImageUrl()
  if (image) options.image = image

  const added = (await (
    eth.request as (args: { method: string; params?: unknown }) => Promise<unknown>
  )({
    method: 'wallet_watchAsset',
    params: {
      type: 'ERC20',
      options,
    },
  })) as boolean | null

  if (added === false) {
    throw new Error('Wallet declined to add AGS')
  }
}

export async function addAgsToWalletWithToast(injected?: InjectedEip1193Provider | null): Promise<void> {
  try {
    await addAgsToWallet(injected)
    toast.success('AGS added to your wallet')
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Could not add AGS'
    if (msg.toLowerCase().includes('reject') || msg.toLowerCase().includes('denied')) {
      toast.error('Add token cancelled')
      return
    }
    toast.error(msg)
    throw error
  }
}
