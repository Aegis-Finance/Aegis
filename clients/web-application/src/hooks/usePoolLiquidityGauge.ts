import { useQuery } from '@tanstack/react-query'
import { getErc20Contract, getLiquidityMiningGaugeContract, getPublicLiquidityPoolContract } from '@/utils/contracts'
import { resolveGaugeAddressForPoolId } from '@/config/liquidityGauges'
import type { Provider } from 'ethers'
import {
  agsAprPerLpToken,
  annualAgsEmission,
  gaugeActiveRewardRate,
  liquidityBootstrapStatus,
  secondsUntilPeriodFinish,
  type GaugeSnapshot,
} from '@/utils/liquidityMiningMetrics'

export function usePoolLiquidityGauge(provider: Provider | null | undefined, poolId: string) {
  const gaugeAddress = resolveGaugeAddressForPoolId(poolId)

  return useQuery({
    queryKey: ['pool-gauge', poolId, gaugeAddress, provider],
    queryFn: async () => {
      if (!provider || !gaugeAddress) return null
      const gauge = getLiquidityMiningGaugeContract(provider, gaugeAddress)
      if (!gauge) return null

      const [rewardRate, periodFinish, totalStakedLp, paused, stakeToken, rewardToken] = await Promise.all([
        gauge.rewardRate(),
        gauge.periodFinish(),
        gauge.totalSupply(),
        gauge.paused(),
        gauge.STAKE_TOKEN(),
        gauge.REWARD_TOKEN(),
      ])

      const stakeErc = getErc20Contract(stakeToken as string, provider)
      const rewardErc = getErc20Contract(rewardToken as string, provider)
      const [stakeSymbol, rewardSymbol] = await Promise.all([
        stakeErc.symbol().catch(() => 'LP'),
        rewardErc.symbol().catch(() => 'AGS'),
      ])

      const snapshot: GaugeSnapshot = {
        rewardRate: rewardRate as bigint,
        periodFinish: periodFinish as bigint,
        totalStakedLp: totalStakedLp as bigint,
        stakeTokenSymbol: String(stakeSymbol),
        rewardTokenSymbol: String(rewardSymbol),
        paused: Boolean(paused),
      }

      const pool = getPublicLiquidityPoolContract(stakeToken as string, provider)
      const reserves = await pool.getReserves()
      const ags = reserves.reserveAgs ?? reserves[0]
      const quote = reserves.reserveQuote ?? reserves[1]
      const poolLive = (ags as bigint) > 0n && (quote as bigint) > 0n

      const apr = agsAprPerLpToken(snapshot.rewardRate, snapshot.periodFinish, snapshot.totalStakedLp)
      const status = liquidityBootstrapStatus({
        rewardRate: snapshot.rewardRate,
        periodFinish: snapshot.periodFinish,
        poolLive,
        totalStakedLp: snapshot.totalStakedLp,
      })

      return {
        gaugeAddress,
        snapshot,
        poolLive,
        aprAgsPercent: apr,
        annualAgs: annualAgsEmission(snapshot.rewardRate, snapshot.periodFinish),
        activeRate: gaugeActiveRewardRate(snapshot.rewardRate, snapshot.periodFinish),
        secondsLeft: secondsUntilPeriodFinish(snapshot.periodFinish),
        status,
      }
    },
    enabled: !!provider && !!gaugeAddress,
    refetchInterval: 12_000,
  })
}
