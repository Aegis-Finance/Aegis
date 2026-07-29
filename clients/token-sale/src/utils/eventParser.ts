/**
 * Event Parser for Auction Commitment Tracking
 * Parses transaction receipts to extract commitments and nullifiers from auction events
 * Ensures complete tracking of user's privacy-preserving auction purchases and claims
 */

import { Contract, TransactionReceipt, EventLog, Log } from 'ethers'
import { getAuctionContract } from './contracts'
import { ENV } from '../config'
import {
  saveCommitment,
  removeCommitment,
  removeCommitmentByNullifier,
  type AuctionCommitmentRecord,
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

  const auctionAddress = ENV.auctionAddress
  if (!auctionAddress) return

  const timestamp = Math.floor(Date.now() / 1000)

  for (const log of receipt.logs) {
    try {
      const logAddress = log.address.toLowerCase()

      // Parse AutomatedDutchAuction events
      if (logAddress === auctionAddress?.toLowerCase()) {
        await parseAuctionEvents(log, userAddress, timestamp, provider, receipt.hash)
      }
    } catch (error) {
      // Silently skip events we can't parse (may be from other contracts)
      console.debug('Failed to parse event log:', error)
    }
  }
}

/**
 * Parse AutomatedDutchAuction events
 */
async function parseAuctionEvents(
  log: Log | EventLog,
  userAddress: string,
  timestamp: number,
  provider: any,
  transactionHash?: string
): Promise<void> {
  try {
    const auctionContract = getAuctionContract(provider)
    const parsedLog = auctionContract.interface.parseLog({
      topics: log.topics as string[],
      data: typeof log.data === 'string' ? log.data : (log as any).data || '0x',
    })

    if (!parsedLog) return

    switch (parsedLog.name) {
      case 'TokensPurchased': {
        // Event TokensPurchased(address indexed buyer, uint256 amount, uint256 price, uint256 totalCost)
        // This is for legacy/public purchases - no commitment tracking needed
        break
      }

      case 'PrivatePurchase': {
        // Event PrivatePurchase(bytes32 indexed commitment, uint256 amount, uint256 price)
        const commitment = parsedLog.args[0] as string
        const amount = parsedLog.args[1] ? String(parsedLog.args[1]) : '0'
        const price = parsedLog.args[2] ? String(parsedLog.args[2]) : '0'
        
        if (commitment && commitment !== '0' && commitment !== '0x0') {
          const commitmentHex = commitment.startsWith('0x') 
            ? commitment 
            : '0x' + BigInt(commitment).toString(16).padStart(64, '0')
          
          // Calculate ETH amount from tokens and price
          const ethAmount = amount && price && price !== '0' 
            ? String((BigInt(amount) * BigInt(price)) / BigInt(1e18))
            : '0'
          
          const record: AuctionCommitmentRecord = {
            commitment: commitmentHex,
            contractType: 'auction',
            action: 'purchase',
            amount,
            ethAmount,
            timestamp,
            transactionHash,
            metadata: { event: 'PrivatePurchase', price },
          }

          saveCommitment(userAddress, record)
        }
        break
      }

      case 'PrivateClaim': {
        // Event PrivateClaim(bytes32 indexed commitment, uint256 amount)
        const commitment = parsedLog.args[0] as string
        const amount = parsedLog.args[1] ? String(parsedLog.args[1]) : '0'
        
        if (commitment && commitment !== '0' && commitment !== '0x0') {
          const commitmentHex = commitment.startsWith('0x') 
            ? commitment 
            : '0x' + BigInt(commitment).toString(16).padStart(64, '0')
          
          const record: AuctionCommitmentRecord = {
            commitment: commitmentHex,
            contractType: 'claim',
            action: 'claim',
            amount,
            timestamp,
            transactionHash,
            metadata: { event: 'PrivateClaim' },
          }

          saveCommitment(userAddress, record)
        }
        break
      }
    }
  } catch (error) {
    console.debug('Failed to parse auction event:', error)
  }
}

