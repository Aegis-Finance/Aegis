import { useQuery } from '@tanstack/react-query'
import { ENV } from '../config'
import { getPublicProvider } from '../utils/contracts'
import { defaultPayRails, fetchPayRails, type PayRail } from '../utils/auctionPayment'

export function useAuctionPayRails(): {
  rails: PayRail[]
  isLoading: boolean
  isError: boolean
} {
  const q = useQuery({
    queryKey: ['auction-pay-rails', ENV.auctionAddress, ENV.chainId],
    queryFn: async () => fetchPayRails(getPublicProvider(), ENV.auctionAddress, ENV.chainId),
    staleTime: 60_000,
    refetchInterval: 120_000,
  })
  return {
    rails: q.data ?? defaultPayRails(ENV.chainId),
    isLoading: q.isLoading,
    isError: q.isError,
  }
}
