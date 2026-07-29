import { useQuery } from '@tanstack/react-query'
import { ethers } from 'ethers'

import { ZERO_ADDRESS } from '@/config/contracts'
import { resolvePoolPriceValidatorAddress } from '@/utils/deploymentManifest'
import { useWalletStore } from '@/store/walletStore'

const VALIDATOR_ABI = [
  'function getPoolStatus(address pool) view returns (tuple(address poolAddress, address[] quoteOracles, address[] agsOracles, bool enabled, uint256 maxDeviationBps, uint32 twapWindow, uint16 observationCardinality, bool flashLoanProtectionEnabled) config, tuple, tuple, uint256)',
] as const

export function usePoolValidatorRegistration(poolAddress: string | null | undefined) {
  const { provider } = useWalletStore()
  const validatorAddress = resolvePoolPriceValidatorAddress()

  return useQuery({
    queryKey: ['pool-validator-registration', validatorAddress, poolAddress],
    queryFn: async (): Promise<boolean> => {
      if (!validatorAddress || !poolAddress || !provider) return false
      const validator = new ethers.Contract(validatorAddress, VALIDATOR_ABI, provider)
      try {
        const [config] = await validator.getPoolStatus(poolAddress)
        const addr = config?.poolAddress ?? config?.[0]
        return Boolean(addr && String(addr).toLowerCase() !== ZERO_ADDRESS.toLowerCase())
      } catch {
        return false
      }
    },
    enabled: Boolean(validatorAddress && poolAddress && provider),
    staleTime: 60_000,
  })
}
