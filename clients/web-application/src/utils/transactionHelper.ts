/**
 * Transaction Helper
 * Wrapper for transactions that automatically parses events and saves commitments
 * Ensures all privacy-preserving actions are properly tracked
 */

import { ContractTransactionResponse, TransactionReceipt } from 'ethers'
import { parseTransactionEvents } from './eventParser'

/**
 * Wait for transaction and parse events
 * Automatically tracks all commitments from transaction receipt
 */
export async function waitAndParseTransaction(
  tx: ContractTransactionResponse,
  userAddress: string,
  provider: any
): Promise<TransactionReceipt | null> {
  const receipt = await tx.wait()
  
  if (receipt && receipt.status === 1) {
    // Parse and save commitments from transaction events
    await parseTransactionEvents(receipt, userAddress, provider)
  }
  
  return receipt
}

/**
 * Execute transaction with automatic event parsing
 * Use this wrapper for all privacy-preserving transactions
 */
export async function executeTransactionWithTracking(
  txPromise: Promise<ContractTransactionResponse>,
  userAddress: string,
  provider: any
): Promise<TransactionReceipt | null> {
  const tx = await txPromise
  return await waitAndParseTransaction(tx, userAddress, provider)
}

