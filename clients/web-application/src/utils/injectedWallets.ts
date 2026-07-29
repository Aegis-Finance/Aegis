/**
 * EIP-6963 multi-wallet discovery (Rabby, MetaMask, OKX, Trust, etc. all announce here).
 * @see https://eips.ethereum.org/EIPS/eip-6963
 */

export type InjectedEip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
}

export type Eip6963ProviderInfo = {
  uuid: string
  name: string
  icon: string
  rdns: string
}

export type InjectedWalletOption = {
  info: Eip6963ProviderInfo
  provider: InjectedEip1193Provider
}

type AnnounceDetail = {
  info: Eip6963ProviderInfo
  provider: InjectedEip1193Provider
}

function isAnnounceDetail(d: unknown): d is AnnounceDetail {
  if (!d || typeof d !== 'object') return false
  const o = d as Record<string, unknown>
  const info = o.info
  if (!info || typeof info !== 'object') return false
  const i = info as Record<string, unknown>
  if (typeof i.uuid !== 'string' || typeof i.name !== 'string' || typeof i.rdns !== 'string') return false
  const p = o.provider
  if (!p || typeof p !== 'object') return false
  if (typeof (p as InjectedEip1193Provider).request !== 'function') return false
  return true
}

function normalizeAnnounce(detail: AnnounceDetail): InjectedWalletOption {
  const icon = typeof detail.info.icon === 'string' ? detail.info.icon : ''
  return {
    info: { ...detail.info, icon },
    provider: detail.provider,
  }
}

/**
 * Collect injected wallets after a short discovery window.
 * Dedupes by `uuid`. Adds a legacy `window.ethereum` entry only if it is not reference-equal to any announced provider.
 */
export function requestInjectedWalletOptions(timeoutMs = 450): Promise<InjectedWalletOption[]> {
  if (typeof window === 'undefined') {
    return Promise.resolve([])
  }

  return new Promise((resolve) => {
    const byUuid = new Map<string, InjectedWalletOption>()

    const onAnnounce = (event: Event) => {
      const custom = event as CustomEvent<unknown>
      const detail = custom.detail
      if (!isAnnounceDetail(detail)) return
      const normalized = normalizeAnnounce(detail)
      byUuid.set(normalized.info.uuid, normalized)
    }

    window.addEventListener('eip6963:announceProvider', onAnnounce)
    window.dispatchEvent(new Event('eip6963:requestProvider'))

    window.setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce)
      const list = [...byUuid.values()]

      const eth = window.ethereum as InjectedEip1193Provider | undefined
      if (eth && typeof eth.request === 'function') {
        const already = list.some((w) => w.provider === eth)
        if (!already) {
          list.push({
            info: {
              uuid: 'legacy-window-ethereum',
              name: 'Browser wallet (injected)',
              icon: '',
              rdns: 'eip1193.legacy',
            },
            provider: eth,
          })
        }
      }

      list.sort((a, b) => a.info.name.localeCompare(b.info.name))
      resolve(list)
    }, timeoutMs)
  })
}
