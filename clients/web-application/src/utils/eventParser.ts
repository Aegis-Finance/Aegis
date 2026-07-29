/**
 * Event Parser for Commitment Tracking
 * Parses transaction receipts to extract commitments and nullifiers from all contract events
 * Ensures complete tracking of user's privacy-preserving positions
 */

import { TransactionReceipt, EventLog, Log } from 'ethers'
import { 
  getTokenContract, 
  getStakingContract, 
  getLendingContract, 
  getYieldFarmingContract,
  getPrivateAmmContract,
  getInsuranceContract,
} from './contracts'
import { CONTRACT_ADDRESSES } from '@/config/contracts'
import {
  saveCommitment,
  saveLoan,
  saveStakingPosition,
  saveUnstakeRequest,
  removeLoan,
  removeUnstakeRequest,
  generatePositionId,
  type LoanRecord,
  type StakingRecord,
  type UnstakeRequest,
} from './commitmentStorage'

/**
 * Parse all events from a transaction receipt and save commitments
 */
export async function parseTransactionEvents(
  receipt: TransactionReceipt,
  userAddress: string,
  provider: any
): Promise<void> {
  if (!receipt || !receipt.logs || receipt.logs.length === 0) {
    return
  }

  const tokenAddress = CONTRACT_ADDRESSES.TOKEN
  const stakingAddress = CONTRACT_ADDRESSES.STAKING
  const lendingAddress = CONTRACT_ADDRESSES.LENDING
  const yieldFarmingAddress = CONTRACT_ADDRESSES.YIELD_FARMING
  const ammAddress = CONTRACT_ADDRESSES.PRIVATE_AMM
  const insuranceAddress = CONTRACT_ADDRESSES.INSURANCE

  const timestamp = Math.floor(Date.now() / 1000)

  for (const log of receipt.logs) {
    try {
      const logAddress = (log.address || '').toLowerCase()

      // Parse PrivateTokenContract events
      if (logAddress === tokenAddress?.toLowerCase()) {
        await parseTokenEvents(log, userAddress, timestamp, provider)
      }
      // Parse PrivateStakingContract events
      else if (logAddress === stakingAddress?.toLowerCase()) {
        await parseStakingEvents(log, userAddress, timestamp, provider)
      }
      // Parse PrivateLendingContract events
      else if (logAddress === lendingAddress?.toLowerCase()) {
        await parseLendingEvents(log, userAddress, timestamp, provider)
      }
      // Parse PrivateYieldFarming events
      else if (logAddress === yieldFarmingAddress?.toLowerCase()) {
        await parseYieldFarmingEvents(log, userAddress, timestamp, provider)
      }
      // Parse PrivateAMMContract events
      else if (logAddress === ammAddress?.toLowerCase()) {
        await parseAmmEvents(log, userAddress, timestamp, provider)
      }
      // Parse DecentralizedInsurance events
      else if (logAddress === insuranceAddress?.toLowerCase()) {
        await parseInsuranceEvents(log, userAddress, timestamp, provider)
      }
    } catch (error) {
      // Silently skip events we can't parse (may be from other contracts)
      console.debug('Failed to parse event log:', error)
    }
  }
}

/**
 * Parse PrivateTokenContract events
 */
async function parseTokenEvents(
  log: Log | EventLog,
  userAddress: string,
  timestamp: number,
  provider: any
): Promise<void> {
  try {
    const tokenContract = getTokenContract(provider)
    const parsedLog = tokenContract.interface.parseLog({
      topics: log.topics as string[],
      data: typeof log.data === 'string' ? log.data : (log as any).data || '0x',
    })

    if (!parsedLog) return

    switch (parsedLog.name) {
      case 'Shield': {
        // Event Shield(address indexed from, bytes32 indexed commitment, uint256 indexed amount)
        const commitment = parsedLog.args[1] as string
        const from = parsedLog.args[0] as string | undefined
        const amount = parsedLog.args[2] ? String(parsedLog.args[2]) : '0'
        
        if (from && from.toLowerCase() === userAddress.toLowerCase()) {
          saveCommitment(userAddress, {
            commitment,
            contractType: 'staking', // Shielded tokens are tracked as staking type
            action: 'stake',
            amount,
            timestamp,
            metadata: { event: 'Shield', from },
          })
        }
        break
      }

      case 'Unshield': {
        // Event Unshield(bytes32 indexed nullifier)
        const nullifier = parsedLog.args[0] as string
        
        // Remove any commitments that used this nullifier
        // Note: We can't directly map nullifier to commitment, but we track nullifiers
        saveCommitment(userAddress, {
          commitment: '0x0',
          nullifier,
          contractType: 'staking',
          action: 'unstake',
          amount: '0',
          timestamp,
          metadata: { event: 'Unshield', nullifier },
        })
        break
      }

      case 'ShieldedTransfer': {
        // Event ShieldedTransfer(bytes32 indexed inputNullifier1, bytes32 indexed inputNullifier2, bytes32 indexed outputCommitment1, bytes32 outputCommitment2)
        const inputNullifier1 = parsedLog.args[0] as string
        const inputNullifier2 = parsedLog.args[1] as string | null
        const outputCommitment1 = parsedLog.args[2] as string
        const outputCommitment2 = parsedLog.args[3] as string | null

        // Save output commitments
        saveCommitment(userAddress, {
          commitment: outputCommitment1,
          nullifier: inputNullifier1,
          contractType: 'amm',
          action: 'swap',
          amount: '0',
          timestamp,
          metadata: { 
            event: 'ShieldedTransfer', 
            inputNullifiers: [inputNullifier1, inputNullifier2].filter(Boolean),
            outputCommitments: [outputCommitment1, outputCommitment2].filter(Boolean),
          },
        })

        if (outputCommitment2) {
          saveCommitment(userAddress, {
            commitment: outputCommitment2,
            nullifier: inputNullifier2 || inputNullifier1,
            contractType: 'amm',
            action: 'swap',
            amount: '0',
            timestamp,
            metadata: { event: 'ShieldedTransfer' },
          })
        }
        break
      }

      case 'CommitmentAdded': {
        // Event CommitmentAdded(bytes32 indexed commitment, uint256 indexed timestamp)
        const commitment = parsedLog.args[0] as string
        const eventTimestamp = Number(parsedLog.args[1] || timestamp)

        saveCommitment(userAddress, {
          commitment,
          contractType: 'staking',
          action: 'stake',
          amount: '0',
          timestamp: eventTimestamp,
          metadata: { event: 'CommitmentAdded' },
        })
        break
      }

      case 'NullifierUsed': {
        // Event NullifierUsed(bytes32 indexed nullifier, uint256 indexed timestamp)
        const nullifier = parsedLog.args[0] as string
        
        // Track nullifier usage (commitment was spent)
        saveCommitment(userAddress, {
          commitment: '0x0',
          nullifier,
          contractType: 'staking',
          action: 'withdraw',
          amount: '0',
          timestamp,
          metadata: { event: 'NullifierUsed', nullifier },
        })
        break
      }
    }
  } catch (error) {
    console.debug('Failed to parse token event:', error)
  }
}

/**
 * Parse PrivateStakingContract events
 */
async function parseStakingEvents(
  log: Log | EventLog,
  userAddress: string,
  timestamp: number,
  provider: any
): Promise<void> {
  try {
    const stakingContract = getStakingContract(provider)
    const parsedLog = stakingContract.interface.parseLog({
      topics: log.topics as string[],
      data: typeof log.data === 'string' ? log.data : (log as any).data || '0x',
    })

    if (!parsedLog) return

    switch (parsedLog.name) {
      case 'Staked': {
        // Event Staked(bytes32 indexed commitment, uint256 indexed epoch, uint256 indexed timestamp)
        const commitment = parsedLog.args[0] as string
        const epoch = Number(parsedLog.args[1] || 0)
        const eventTimestamp = Number(parsedLog.args[2] || timestamp)

        const positionId = generatePositionId(commitment, 'staking')
        const stakingRecord: StakingRecord = {
          commitment,
          contractType: 'staking',
          action: 'stake',
          amount: '0', // Would need to query on-chain
          timestamp: eventTimestamp,
          positionId,
          stakingCommitment: commitment,
          epoch,
          metadata: { event: 'Staked', epoch },
        }

        saveStakingPosition(userAddress, stakingRecord)
        break
      }

      case 'UnstakeRequested': {
        // Event UnstakeRequested(bytes32 indexed nullifier, uint256 indexed unlockTime)
        const nullifier = parsedLog.args[0] as string
        const unlockTime = Number(parsedLog.args[1] || 0)

        const unstakeRequest: UnstakeRequest = {
          nullifier,
          timestamp: unlockTime,
          canComplete: Math.floor(Date.now() / 1000) >= unlockTime,
        }

        saveUnstakeRequest(userAddress, unstakeRequest)
        break
      }

      case 'UnstakeCompleted': {
        // Event UnstakeCompleted(bytes32 indexed nullifier, bytes32 indexed outputCommitment)
        const nullifier = parsedLog.args[0] as string
        const outputCommitment = parsedLog.args[1] as string

        // Remove unstake request
        removeUnstakeRequest(userAddress, nullifier)

        // Save new commitment from unstaking
        saveCommitment(userAddress, {
          commitment: outputCommitment,
          nullifier,
          contractType: 'staking',
          action: 'unstake',
          amount: '0',
          timestamp,
          metadata: { event: 'UnstakeCompleted' },
        })
        break
      }

      case 'RewardsClaimed': {
        // Event RewardsClaimed(bytes32 indexed nullifier, bytes32 indexed newCommitment, uint256 indexed epoch)
        const nullifier = parsedLog.args[0] as string
        const newCommitment = parsedLog.args[1] as string
        const epoch = Number(parsedLog.args[2] || 0)

        saveCommitment(userAddress, {
          commitment: newCommitment,
          nullifier,
          contractType: 'staking',
          action: 'claim',
          amount: '0',
          timestamp,
          metadata: { event: 'RewardsClaimed', epoch },
        })
        break
      }
    }
  } catch (error) {
    console.debug('Failed to parse staking event:', error)
  }
}

/**
 * Parse PrivateLendingContract events
 */
async function parseLendingEvents(
  log: Log | EventLog,
  userAddress: string,
  timestamp: number,
  provider: any
): Promise<void> {
  try {
    const lendingContract = getLendingContract(provider)
    const parsedLog = lendingContract.interface.parseLog({
      topics: log.topics as string[],
      data: typeof log.data === 'string' ? log.data : (log as any).data || '0x',
    })

    if (!parsedLog) return

    switch (parsedLog.name) {
      case 'LiquidityProvided': {
        // Event LiquidityProvided(bytes32 indexed commitment, uint256 indexed amount, uint256 indexed shares)
        const commitment = parsedLog.args[0] as string
        const amount = String(parsedLog.args[1] || 0n)
        const shares = String(parsedLog.args[2] || 0n)

        saveCommitment(userAddress, {
          commitment,
          contractType: 'lending',
          action: 'supply',
          amount,
          timestamp,
          metadata: { event: 'LiquidityProvided', shares },
        })
        break
      }

      case 'LiquidityWithdrawn': {
        // Event LiquidityWithdrawn(bytes32 indexed nullifier, bytes32 indexed outputCommitment, uint256 indexed amount)
        const nullifier = parsedLog.args[0] as string
        const outputCommitment = parsedLog.args[1] as string
        const amount = String(parsedLog.args[2] || 0n)

        saveCommitment(userAddress, {
          commitment: outputCommitment,
          nullifier,
          contractType: 'lending',
          action: 'withdraw',
          amount,
          timestamp,
          metadata: { event: 'LiquidityWithdrawn' },
        })
        break
      }

      case 'LoanIssued': {
        // Event LoanIssued(bytes32 indexed loanId, bytes32 indexed collateralCommitment, bytes32 indexed loanCommitment, uint256 principal, uint256 collateralAmount, uint256 tenorSeconds)
        const loanId = parsedLog.args[0] as string
        const collateralCommitment = parsedLog.args[1] as string
        const loanCommitment = parsedLog.args[2] as string
        const principal = String(parsedLog.args[3] || 0n)
        const collateralAmount = String(parsedLog.args[4] || 0n)
        const tenorSeconds = String(parsedLog.args[5] ?? 0n)

        const loanRecord: LoanRecord = {
          commitment: loanCommitment,
          contractType: 'loan',
          action: 'borrow',
          amount: principal,
          timestamp,
          loanId,
          collateralCommitment,
          loanCommitment,
          principal,
          collateralAmount,
          metadata: { event: 'LoanIssued', tenorSeconds },
        }

        saveLoan(userAddress, loanRecord)
        break
      }

      case 'LoanRepaid': {
        // Event LoanRepaid(bytes32 indexed loanId, bytes32 indexed repaymentNullifier, uint256 indexed amount)
        const loanId = parsedLog.args[0] as string
        const repaymentNullifier = parsedLog.args[1] as string
        const amount = String(parsedLog.args[2] || 0n)

        // Remove loan from storage (fully repaid)
        removeLoan(userAddress, loanId)

        saveCommitment(userAddress, {
          commitment: '0x0',
          nullifier: repaymentNullifier,
          contractType: 'loan',
          action: 'borrow',
          amount,
          timestamp,
          metadata: { event: 'LoanRepaid', loanId },
        })
        break
      }
    }
  } catch (error) {
    console.debug('Failed to parse lending event:', error)
  }
}

/**
 * Parse PrivateYieldFarming events
 */
async function parseYieldFarmingEvents(
  log: Log | EventLog,
  userAddress: string,
  timestamp: number,
  provider: any
): Promise<void> {
  try {
    const yieldFarmingContract = getYieldFarmingContract(provider)
    const parsedLog = yieldFarmingContract.interface.parseLog({
      topics: log.topics as string[],
      data: typeof log.data === 'string' ? log.data : (log as any).data || '0x',
    })

    if (!parsedLog) return

    switch (parsedLog.name) {
      case 'Staked': {
        // Event Staked(uint256 indexed poolId, bytes32 indexed positionId, bytes32 indexed staker, uint256 amount, uint256 lockDuration)
        const poolId = String(parsedLog.args[0] || 0n)
        const positionId = parsedLog.args[1] as string
        const staker = parsedLog.args[2] as string
        const amount = String(parsedLog.args[3] || 0n)
        const lockDuration = Number(parsedLog.args[4] || 0)

        saveCommitment(userAddress, {
          commitment: staker,
          contractType: 'yield',
          action: 'stake',
          amount,
          timestamp,
          poolId,
          positionId,
          metadata: { event: 'Staked', poolId, lockDuration },
        })
        break
      }

      case 'Unstaked': {
        // Event Unstaked(uint256 indexed poolId, bytes32 indexed positionId, bytes32 indexed staker, uint256 amount, uint256 penalty)
        const poolId = String(parsedLog.args[0] || 0n)
        const positionId = parsedLog.args[1] as string
        const staker = parsedLog.args[2] as string
        const amount = String(parsedLog.args[3] || 0n)

        saveCommitment(userAddress, {
          commitment: staker,
          contractType: 'yield',
          action: 'unstake',
          amount,
          timestamp,
          poolId,
          positionId,
          metadata: { event: 'Unstaked', poolId },
        })
        break
      }

      case 'RewardsClaimed': {
        // Event RewardsClaimed(uint256 indexed poolId, bytes32 indexed positionId, bytes32 indexed staker, uint256 amount)
        const poolId = String(parsedLog.args[0] || 0n)
        const positionId = parsedLog.args[1] as string
        const staker = parsedLog.args[2] as string
        const amount = String(parsedLog.args[3] || 0n)

        saveCommitment(userAddress, {
          commitment: staker,
          contractType: 'yield',
          action: 'claim',
          amount,
          timestamp,
          poolId,
          positionId,
          metadata: { event: 'RewardsClaimed', poolId },
        })
        break
      }
    }
  } catch (error) {
    console.debug('Failed to parse yield farming event:', error)
  }
}

/**
 * Parse PrivateAMMContract events
 */
async function parseAmmEvents(
  log: Log | EventLog,
  userAddress: string,
  timestamp: number,
  provider: any
): Promise<void> {
  try {
    const ammContract = getPrivateAmmContract(provider)
    const parsedLog = ammContract.interface.parseLog({
      topics: log.topics as string[],
      data: typeof log.data === 'string' ? log.data : (log as any).data || '0x',
    })

    if (!parsedLog) return

    switch (parsedLog.name) {
      case 'SwapExecuted': {
        // Event SwapExecuted(bytes32 indexed poolId, bytes32 indexed inputNullifier, bytes32 indexed outputCommitment, uint256 amountIn, uint256 amountOut, bool isAToB)
        const poolId = parsedLog.args[0] as string
        const inputNullifier = parsedLog.args[1] as string
        const outputCommitment = parsedLog.args[2] as string
        const amountIn = String(parsedLog.args[3] || 0n)
        const amountOut = String(parsedLog.args[4] || 0n)

        saveCommitment(userAddress, {
          commitment: outputCommitment,
          nullifier: inputNullifier,
          contractType: 'amm',
          action: 'swap',
          amount: amountOut,
          timestamp,
          metadata: { 
            event: 'SwapExecuted', 
            poolId, 
            amountIn, 
            amountOut,
            isAToB: parsedLog.args[5],
          },
        })
        break
      }

      case 'LiquidityAdded': {
        // Event LiquidityAdded(bytes32 indexed poolId, bytes32 indexed commitment, uint256 indexed amountA, uint256 amountB, uint256 liquidity)
        const poolId = parsedLog.args[0] as string
        const commitment = parsedLog.args[1] as string
        const amountA = String(parsedLog.args[2] || 0n)
        const amountB = String(parsedLog.args[3] || 0n)
        const liquidity = String(parsedLog.args[4] || 0n)

        saveCommitment(userAddress, {
          commitment,
          contractType: 'amm',
          action: 'provide_liquidity',
          amount: liquidity,
          timestamp,
          poolId,
          metadata: { 
            event: 'LiquidityAdded', 
            poolId, 
            amountA, 
            amountB, 
            liquidity,
          },
        })
        break
      }

      case 'LiquidityRemoved': {
        // Event LiquidityRemoved(bytes32 indexed poolId, bytes32 indexed nullifier, bytes32 indexed outputCommitmentA, bytes32 outputCommitmentB, uint256 amountA, uint256 amountB)
        const poolId = parsedLog.args[0] as string
        const nullifier = parsedLog.args[1] as string
        const outputCommitmentA = parsedLog.args[2] as string
        const outputCommitmentB = parsedLog.args[3] as string | null
        const amountA = String(parsedLog.args[4] || 0n)
        const amountB = String(parsedLog.args[5] || 0n)

        saveCommitment(userAddress, {
          commitment: outputCommitmentA,
          nullifier,
          contractType: 'amm',
          action: 'withdraw',
          amount: amountA,
          timestamp,
          poolId,
          metadata: { 
            event: 'LiquidityRemoved', 
            poolId, 
            amountA, 
            amountB,
            outputCommitmentB,
          },
        })

        if (outputCommitmentB) {
          saveCommitment(userAddress, {
            commitment: outputCommitmentB,
            nullifier,
            contractType: 'amm',
            action: 'withdraw',
            amount: amountB,
            timestamp,
            poolId,
            metadata: { event: 'LiquidityRemoved' },
          })
        }
        break
      }
    }
  } catch (error) {
    console.debug('Failed to parse AMM event:', error)
  }
}

/**
 * Parse DecentralizedInsurance events
 */
async function parseInsuranceEvents(
  log: Log | EventLog,
  userAddress: string,
  timestamp: number,
  provider: any
): Promise<void> {
  try {
    const insuranceContract = getInsuranceContract(provider)
    const parsedLog = insuranceContract.interface.parseLog({
      topics: log.topics as string[],
      data: typeof log.data === 'string' ? log.data : (log as any).data || '0x',
    })

    if (!parsedLog) return

    switch (parsedLog.name) {
      case 'PolicyCreated': {
        // Event PolicyCreated(uint256 indexed policyId, InsuranceType indexed insuranceType, bytes32 indexed protocolIdentifier, uint256 coverageAmount, uint256 premiumAmount)
        const policyId = Number(parsedLog.args[0] || 0n)
        const coverageAmount = String(parsedLog.args[3] || 0n)
        const premiumAmount = String(parsedLog.args[4] || 0n)

        saveCommitment(userAddress, {
          commitment: '0x0',
          contractType: 'insurance',
          action: 'claim',
          amount: premiumAmount,
          timestamp,
          policyId: String(policyId),
          metadata: { 
            event: 'PolicyCreated', 
            policyId, 
            coverageAmount,
            insuranceType: parsedLog.args[1],
            protocolIdentifier: parsedLog.args[2],
          },
        })
        break
      }

      case 'ClaimPaid': {
        // Event ClaimPaid(uint256 indexed claimId, uint256 indexed policyId, bytes32 indexed claimantCommitment, uint256 amount)
        const claimId = Number(parsedLog.args[0] || 0n)
        const policyId = String(parsedLog.args[1] || 0n)
        const claimantCommitment = parsedLog.args[2] as string
        const amount = String(parsedLog.args[3] || 0n)

        saveCommitment(userAddress, {
          commitment: claimantCommitment,
          contractType: 'insurance',
          action: 'claim',
          amount,
          timestamp,
          policyId,
          metadata: { event: 'ClaimPaid', claimId, policyId },
        })
        break
      }
    }
  } catch (error) {
    console.debug('Failed to parse insurance event:', error)
  }
}

