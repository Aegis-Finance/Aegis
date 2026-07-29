import { useQuery } from '@tanstack/react-query'

import { getPublicPoolConfigs } from '@/config/liquidity'
import { useWalletStore } from '@/store/walletStore'
import { fetchAgsReferencePrice, type AgsReferencePrice } from '@/utils/agsPriceReference'

function nativeBootstrapPoolAddress(): string | undefined {
  const native = getPublicPoolConfigs().find((p) => p.useNative)
  return native?.poolAddress
}

export function useAgsReferencePrice() {
  const { provider } = useWalletStore()
  const bootstrap = nativeBootstrapPoolAddress()

  return useQuery({
    queryKey: ['ags-reference-price', bootstrap, provider ? 'on' : 'off'],
    queryFn: async (): Promise<AgsReferencePrice> => {
      if (!provider) {
        return {
          agsPerOneNative: null,
          nativePerOneAgs: null,
          source: 'none',
          sourceLabel: 'Connect wallet',
          detail: 'Connect your wallet to load the AGS reference price.',
        }
      }
      return fetchAgsReferencePrice(provider, bootstrap)
    },
    enabled: !!provider,
    refetchInterval: 20_000,
    staleTime: 8_000,
  })
}
