import { useQuery } from '@tanstack/react-query'

import { ENV } from '../config'
import { getAuctionContract, getPublicProvider } from '../utils/contracts'

export type AuctionSaleInfo = {
  currentPrice: bigint
  remainingTokens: bigint
  timeRemaining: number
  isCompleted: boolean
  limitsExpired: boolean
  totalTokens: bigint
  tokensSold: bigint
  auctionStartTime: number
  auctionEndTime: number
  startTime: number
  endTime: number
  isActive: boolean
  auctionDuration: number
  startPrice: bigint
  reservePrice: bigint
  maxPerAddress: bigint
  minPurchase: bigint
  curveId: number
  meanPrice: bigint
}

export function useAuctionSaleInfo() {
  return useQuery({
    queryKey: ['sale-info', ENV.auctionAddress, ENV.rpcUrl],
    queryFn: async (): Promise<AuctionSaleInfo> => {
      const contract = getAuctionContract(getPublicProvider())
      const [currentPrice, remainingTokens, timeRemaining, isCompleted, limitsExpired] =
        await contract.getSaleInfo()
      const [
        totalTokens,
        tokensSold,
        auctionStartTime,
        auctionEndTime,
        startPrice,
        reservePrice,
        maxPerAddress,
        minPurchase,
        curveId,
        meanPrice,
        isActive,
        auctionDuration,
      ] = await Promise.all([
        contract.totalTokens(),
        contract.tokensSold(),
        contract.auctionStartTime(),
        contract.auctionEndTime(),
        contract.startPrice(),
        contract.reservePrice(),
        contract.maxPerAddress(),
        contract.minPurchase(),
        contract.AUCTION_PRICE_CURVE_ID(),
        contract.getMeanPrice(),
        contract.isActive(),
        contract.auctionDuration(),
      ])

      const startSec = Number(auctionStartTime)
      const endSec = Number(auctionEndTime)

      return {
        currentPrice: BigInt(currentPrice),
        remainingTokens: BigInt(remainingTokens),
        timeRemaining: Number(timeRemaining),
        isCompleted: Boolean(isCompleted),
        limitsExpired,
        totalTokens: BigInt(totalTokens),
        tokensSold: BigInt(tokensSold),
        auctionStartTime: startSec,
        auctionEndTime: endSec,
        startTime: startSec * 1000,
        endTime: endSec * 1000,
        isActive: Boolean(isActive),
        auctionDuration: Number(auctionDuration),
        startPrice: BigInt(startPrice),
        reservePrice: BigInt(reservePrice),
        maxPerAddress: BigInt(maxPerAddress),
        minPurchase: BigInt(minPurchase),
        curveId: Number(curveId),
        meanPrice: BigInt(meanPrice),
      }
    },
    refetchInterval: 12_000,
  })
}
