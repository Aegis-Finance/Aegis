/**
 * Transaction Helper for Token Distribution
 * Wrapper for transactions that automatically parses events and saves commitments
 * Ensures all privacy-preserving actions are properly tracked
 */

import { ContractTransactionResponse, TransactionReceipt } from 'ethers'
import { parseTransactionEvents } from './eventParser'
import { useWalletStore } from '../store/walletStore'

/**
 * Wait for transaction and parse events
 * Automatically tracks all commitments from transaction receipt
 */
export async function waitAndParseTransaction(
  tx: ContractTransactionResponse,
  userAddress: string,
  provider: any
): Promise<TransactionReceipt> {
  const receipt = await tx.wait()
  
  if (receipt && receipt.status === 1) {
    // Parse and save commitments from transaction events
    await parseTransactionEvents(receipt, userAddress, provider)
  }
  
  // Return receipt or throw if null (tx.wait() can return null in some cases but usually not)
  if (!receipt) throw new Error('Transaction failed')
  return receipt
}

/**
 * Execute transaction with automatic event parsing
 * Use this wrapper for all privacy-preserving transactions
 */
export async function executeTransactionWithTracking<T>(
  txPromise: Promise<ContractTransactionResponse>,
  userAddress: string,
  provider: any
): Promise<TransactionReceipt> {
  const tx = await txPromise
  return await waitAndParseTransaction(tx, userAddress, provider)
}

