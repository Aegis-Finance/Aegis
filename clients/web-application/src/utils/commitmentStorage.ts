/**
 * Commitment Storage System
 *
 * **Default:** `localStorage` holds **plaintext JSON** keyed by wallet — UX helper only.
 *
 * **Optional device vault:** user-chosen passphrase → PBKDF2 + AES-GCM at rest (`aegis_vault_v1:` payloads).
 * Same-origin **XSS while the tab is open** can still read decrypted memory; the vault mainly protects
 * offline profile copies and casual device inspection. See `Aegis-contracts/docs/ops/PRIVACY_UX_LOCAL_STORAGE_AND_DEVICE.md`.
 */

import {
  decryptUtf8,
  deriveAesKey,
  encryptUtf8,
  isVaultWrappedPayload,
  randomSalt,
  bytesToB64url,
  b64urlToBytes,
} from '@/utils/commitmentVaultCrypto'

export const COMMITMENT_STORAGE_PRIVACY_DOC =
  'Aegis-contracts/docs/ops/PRIVACY_UX_LOCAL_STORAGE_AND_DEVICE.md'

const STORAGE_KEY = 'aegis_commitments'
const LOANS_KEY = 'aegis_loans'
const STAKING_KEY = 'aegis_staking'
const UNSTAKE_REQUESTS_KEY = 'aegis_unstake_requests'
const VAULT_MODE_KEY = 'aegis_ux_vault_v1'
const VAULT_SALT_KEY = 'aegis_ux_vault_salt_v1'

export interface CommitmentRecord {
  commitment: string // bytes32 hex string
  nullifier?: string // bytes32 hex string (for tracking)
  contractType: 'lending' | 'staking' | 'insurance' | 'yield' | 'amm' | 'supply' | 'loan' | 'policy' | 'claim'
  action: 'supply' | 'borrow' | 'stake' | 'unstake' | 'withdraw' | 'claim' | 'swap' | 'provide_liquidity'
  amount: string // BigInt as string
  timestamp: number
  loanId?: string // For lending contracts
  poolId?: string // For yield farming
  policyId?: string // For insurance
  positionId?: string // For staking/yield positions
  metadata?: Record<string, unknown> // Additional data
}

export interface LoanRecord extends CommitmentRecord {
  contractType: 'loan'
  loanId: string
  collateralCommitment: string
  loanCommitment: string
  principal: string
  collateralAmount: string
}

export interface StakingRecord extends CommitmentRecord {
  contractType: 'staking'
  positionId: string
  stakingCommitment: string
  epoch?: number
}

export interface UnstakeRequest {
  nullifier: string
  timestamp: number
  canComplete: boolean
}

type WalletVaultCache = {
  commitments: CommitmentRecord[]
  loans: LoanRecord[]
  staking: StakingRecord[]
  unstake: UnstakeRequest[]
}

const sessionCryptoKeys = new Map<string, CryptoKey>()
const unlockCaches = new Map<string, WalletVaultCache>()
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>()

function waddr(walletAddress: string): string {
  return walletAddress.toLowerCase()
}

function vaultModeLsKey(wallet: string): string {
  return `${VAULT_MODE_KEY}_${waddr(wallet)}`
}

function vaultSaltLsKey(wallet: string): string {
  return `${VAULT_SALT_KEY}_${waddr(wallet)}`
}

function kCommitments(wallet: string): string {
  return `${STORAGE_KEY}_${waddr(wallet)}`
}
function kLoans(wallet: string): string {
  return `${LOANS_KEY}_${waddr(wallet)}`
}
function kStaking(wallet: string): string {
  return `${STAKING_KEY}_${waddr(wallet)}`
}
function kUnstake(wallet: string): string {
  return `${UNSTAKE_REQUESTS_KEY}_${waddr(wallet)}`
}

function readRaw(lsKey: string): string | null {
  try {
    return localStorage.getItem(lsKey)
  } catch {
    return null
  }
}

function writeRaw(lsKey: string, value: string): void {
  try {
    localStorage.setItem(lsKey, value)
  } catch (e) {
    console.error('[commitmentStorage] writeRaw failed', e)
  }
}

function removeRaw(lsKey: string): void {
  try {
    localStorage.removeItem(lsKey)
  } catch {
    /* ignore */
  }
}

function emptyCache(): WalletVaultCache {
  return { commitments: [], loans: [], staking: [], unstake: [] }
}

function parseJsonArray<T>(raw: string | null): T[] {
  if (!raw || isVaultWrappedPayload(raw)) return []
  try {
    const j = JSON.parse(raw) as unknown
    return Array.isArray(j) ? (j as T[]) : []
  } catch {
    return []
  }
}

function rawBucketHasSensitiveData(lsKey: string): boolean {
  const raw = readRaw(lsKey)
  if (!raw) return false
  if (isVaultWrappedPayload(raw)) return true
  try {
    const j = JSON.parse(raw) as unknown
    return Array.isArray(j) && j.length > 0
  } catch {
    return false
  }
}

export function isCommitmentVaultEnabled(walletAddress: string): boolean {
  return readRaw(vaultModeLsKey(walletAddress)) === '1'
}

export function isCommitmentVaultUnlocked(walletAddress: string): boolean {
  return sessionCryptoKeys.has(waddr(walletAddress))
}

/**
 * True if any non-empty commitment-related bucket exists for this wallet in localStorage
 * (plaintext or vault-wrapped).
 */
export function hasCommitmentRelatedLocalStorage(walletAddress: string): boolean {
  const w = waddr(walletAddress)
  if (!w) return false
  return (
    rawBucketHasSensitiveData(kCommitments(walletAddress)) ||
    rawBucketHasSensitiveData(kLoans(walletAddress)) ||
    rawBucketHasSensitiveData(kStaking(walletAddress)) ||
    rawBucketHasSensitiveData(kUnstake(walletAddress))
  )
}

function getCache(wallet: string): WalletVaultCache | undefined {
  return unlockCaches.get(waddr(wallet))
}

function ensureCache(wallet: string): WalletVaultCache {
  const w = waddr(wallet)
  let c = unlockCaches.get(w)
  if (!c) {
    c = emptyCache()
    unlockCaches.set(w, c)
  }
  return c
}

function scheduleVaultPersist(wallet: string): void {
  const w = waddr(wallet)
  const prev = persistTimers.get(w)
  if (prev !== undefined) clearTimeout(prev)
  persistTimers.set(
    w,
    setTimeout(() => {
      persistTimers.delete(w)
      void flushVaultToLocalStorage(wallet)
    }, 400)
  )
}

async function flushVaultToLocalStorage(wallet: string): Promise<void> {
  const w = waddr(wallet)
  const cryptoKey = sessionCryptoKeys.get(w)
  const c = unlockCaches.get(w)
  if (!cryptoKey || !c) return
  try {
    writeRaw(kCommitments(wallet), await encryptUtf8(cryptoKey, JSON.stringify(c.commitments)))
    writeRaw(kLoans(wallet), await encryptUtf8(cryptoKey, JSON.stringify(c.loans)))
    writeRaw(kStaking(wallet), await encryptUtf8(cryptoKey, JSON.stringify(c.staking)))
    writeRaw(kUnstake(wallet), await encryptUtf8(cryptoKey, JSON.stringify(c.unstake)))
  } catch (e) {
    console.error('[commitmentStorage] flushVaultToLocalStorage failed', e)
  }
}

function legacyReadCommitments(wallet: string): CommitmentRecord[] {
  return parseJsonArray<CommitmentRecord>(readRaw(kCommitments(wallet)))
}
function legacyReadLoans(wallet: string): LoanRecord[] {
  return parseJsonArray<LoanRecord>(readRaw(kLoans(wallet)))
}
function legacyReadStaking(wallet: string): StakingRecord[] {
  return parseJsonArray<StakingRecord>(readRaw(kStaking(wallet)))
}
function legacyReadUnstake(wallet: string): UnstakeRequest[] {
  return parseJsonArray<UnstakeRequest>(readRaw(kUnstake(wallet)))
}

export function getCommitments(walletAddress: string): CommitmentRecord[] {
  const w = waddr(walletAddress)
  if (!w) return []
  if (isCommitmentVaultEnabled(walletAddress)) {
    const c = getCache(walletAddress)
    if (c) return [...c.commitments]
    return []
  }
  return legacyReadCommitments(walletAddress)
}

export function saveCommitment(walletAddress: string, record: CommitmentRecord): void {
  const w = waddr(walletAddress)
  if (!w) return
  try {
    if (isCommitmentVaultEnabled(walletAddress) && !isCommitmentVaultUnlocked(walletAddress)) {
      console.warn('[commitmentStorage] Vault locked — skipped saveCommitment (unlock Wallet vault first).')
      return
    }
    if (isCommitmentVaultEnabled(walletAddress) && isCommitmentVaultUnlocked(walletAddress)) {
      const c = ensureCache(walletAddress)
      c.commitments.push(record)
      scheduleVaultPersist(walletAddress)
      return
    }
    const commitments = getCommitments(walletAddress)
    commitments.push(record)
    writeRaw(kCommitments(walletAddress), JSON.stringify(commitments))
  } catch (error) {
    console.error('Failed to save commitment:', error)
  }
}

export function getLoans(walletAddress: string): LoanRecord[] {
  const w = waddr(walletAddress)
  if (!w) return []
  if (isCommitmentVaultEnabled(walletAddress)) {
    const c = getCache(walletAddress)
    if (c) return [...c.loans]
    return []
  }
  return legacyReadLoans(walletAddress)
}

export function saveLoan(walletAddress: string, loan: LoanRecord): void {
  try {
    if (isCommitmentVaultEnabled(walletAddress) && !isCommitmentVaultUnlocked(walletAddress)) {
      console.warn('[commitmentStorage] Vault locked — skipped saveLoan.')
      return
    }
    const loans = getLoans(walletAddress)
    const index = loans.findIndex((l) => l.loanId === loan.loanId)
    if (index >= 0) {
      loans[index] = loan
    } else {
      loans.push(loan)
    }
    if (isCommitmentVaultEnabled(walletAddress) && isCommitmentVaultUnlocked(walletAddress)) {
      const c = ensureCache(walletAddress)
      c.loans = loans
      scheduleVaultPersist(walletAddress)
    } else {
      writeRaw(kLoans(walletAddress), JSON.stringify(loans))
    }
    saveCommitment(walletAddress, loan)
  } catch (error) {
    console.error('Failed to save loan:', error)
  }
}

export function removeLoan(walletAddress: string, loanId: string): void {
  try {
    if (isCommitmentVaultEnabled(walletAddress) && !isCommitmentVaultUnlocked(walletAddress)) {
      console.warn('[commitmentStorage] Vault locked — skipped removeLoan.')
      return
    }
    const loans = getLoans(walletAddress).filter((l) => l.loanId !== loanId)
    if (isCommitmentVaultEnabled(walletAddress) && isCommitmentVaultUnlocked(walletAddress)) {
      const c = ensureCache(walletAddress)
      c.loans = loans
      scheduleVaultPersist(walletAddress)
    } else {
      writeRaw(kLoans(walletAddress), JSON.stringify(loans))
    }
  } catch (error) {
    console.error('Failed to remove loan:', error)
  }
}

export function getStakingPositions(walletAddress: string): StakingRecord[] {
  const w = waddr(walletAddress)
  if (!w) return []
  if (isCommitmentVaultEnabled(walletAddress)) {
    const c = getCache(walletAddress)
    if (c) return [...c.staking]
    return []
  }
  return legacyReadStaking(walletAddress)
}

export function saveStakingPosition(walletAddress: string, position: StakingRecord): void {
  try {
    if (isCommitmentVaultEnabled(walletAddress) && !isCommitmentVaultUnlocked(walletAddress)) {
      console.warn('[commitmentStorage] Vault locked — skipped saveStakingPosition.')
      return
    }
    const positions = getStakingPositions(walletAddress)
    const index = positions.findIndex((p) => p.positionId === position.positionId)
    if (index >= 0) {
      positions[index] = position
    } else {
      positions.push(position)
    }
    if (isCommitmentVaultEnabled(walletAddress) && isCommitmentVaultUnlocked(walletAddress)) {
      const c = ensureCache(walletAddress)
      c.staking = positions
      scheduleVaultPersist(walletAddress)
    } else {
      writeRaw(kStaking(walletAddress), JSON.stringify(positions))
    }
    saveCommitment(walletAddress, position)
  } catch (error) {
    console.error('Failed to save staking position:', error)
  }
}

export function getUnstakeRequests(walletAddress: string): UnstakeRequest[] {
  const w = waddr(walletAddress)
  if (!w) return []
  if (isCommitmentVaultEnabled(walletAddress)) {
    const c = getCache(walletAddress)
    if (c) return [...c.unstake]
    return []
  }
  return legacyReadUnstake(walletAddress)
}

export function saveUnstakeRequest(walletAddress: string, request: UnstakeRequest): void {
  try {
    if (isCommitmentVaultEnabled(walletAddress) && !isCommitmentVaultUnlocked(walletAddress)) {
      console.warn('[commitmentStorage] Vault locked — skipped saveUnstakeRequest.')
      return
    }
    const requests = getUnstakeRequests(walletAddress)
    const index = requests.findIndex((r) => r.nullifier === request.nullifier)
    if (index >= 0) {
      requests[index] = request
    } else {
      requests.push(request)
    }
    if (isCommitmentVaultEnabled(walletAddress) && isCommitmentVaultUnlocked(walletAddress)) {
      const c = ensureCache(walletAddress)
      c.unstake = requests
      scheduleVaultPersist(walletAddress)
    } else {
      writeRaw(kUnstake(walletAddress), JSON.stringify(requests))
    }
  } catch (error) {
    console.error('Failed to save unstake request:', error)
  }
}

export function removeUnstakeRequest(walletAddress: string, nullifier: string): void {
  try {
    if (isCommitmentVaultEnabled(walletAddress) && !isCommitmentVaultUnlocked(walletAddress)) {
      console.warn('[commitmentStorage] Vault locked — skipped removeUnstakeRequest.')
      return
    }
    const requests = getUnstakeRequests(walletAddress).filter((r) => r.nullifier !== nullifier)
    if (isCommitmentVaultEnabled(walletAddress) && isCommitmentVaultUnlocked(walletAddress)) {
      const c = ensureCache(walletAddress)
      c.unstake = requests
      scheduleVaultPersist(walletAddress)
    } else {
      writeRaw(kUnstake(walletAddress), JSON.stringify(requests))
    }
  } catch (error) {
    console.error('Failed to remove unstake request:', error)
  }
}

export function getSupplyCommitments(walletAddress: string): CommitmentRecord[] {
  const commitments = getCommitments(walletAddress)
  return commitments.filter((c) => c.contractType === 'lending' && c.action === 'supply')
}

export function generateLoanId(collateralCommitment: string, loanCommitment: string): string {
  const combined = `${collateralCommitment}_${loanCommitment}`
  let hash = 0
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }
  return `0x${Math.abs(hash).toString(16).padStart(64, '0')}`
}

export function generatePositionId(commitment: string, contractType: string): string {
  const combined = `${contractType}_${commitment}`
  let hash = 0
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }
  return `0x${Math.abs(hash).toString(16).padStart(64, '0')}`
}

/** First-time: migrate plaintext buckets to encrypted-at-rest (passphrase never stored). */
export async function enableEncryptedCommitmentCache(walletAddress: string, passphrase: string): Promise<void> {
  const w = waddr(walletAddress)
  if (!w) throw new Error('No wallet address')
  if (isCommitmentVaultEnabled(walletAddress)) {
    throw new Error('Encrypted cache already enabled — use Unlock.')
  }
  if (!passphrase || passphrase.length < 10) {
    throw new Error('Use a passphrase of at least 10 characters.')
  }
  const salt = await randomSalt()
  const saltB64 = bytesToB64url(salt)
  const cryptoKey = await deriveAesKey(passphrase, salt)
  const commitments = legacyReadCommitments(walletAddress)
  const loans = legacyReadLoans(walletAddress)
  const staking = legacyReadStaking(walletAddress)
  const unstake = legacyReadUnstake(walletAddress)

  unlockCaches.set(w, { commitments, loans, staking, unstake })
  sessionCryptoKeys.set(w, cryptoKey)

  writeRaw(vaultSaltLsKey(walletAddress), saltB64)
  await flushVaultToLocalStorage(walletAddress)
  writeRaw(vaultModeLsKey(walletAddress), '1')
}

export async function unlockCommitmentVault(walletAddress: string, passphrase: string): Promise<void> {
  const w = waddr(walletAddress)
  if (!w) throw new Error('No wallet address')
  if (!isCommitmentVaultEnabled(walletAddress)) {
    throw new Error('Encrypted cache is not enabled for this wallet.')
  }
  const saltB64 = readRaw(vaultSaltLsKey(walletAddress))
  if (!saltB64) throw new Error('Missing vault salt — cannot unlock.')
  const salt = b64urlToBytes(saltB64)
  const cryptoKey = await deriveAesKey(passphrase, salt)

  const rawC = readRaw(kCommitments(walletAddress))
  const rawL = readRaw(kLoans(walletAddress))
  const rawS = readRaw(kStaking(walletAddress))
  const rawU = readRaw(kUnstake(walletAddress))
  if (!rawC || !isVaultWrappedPayload(rawC)) {
    throw new Error('Vault data missing or corrupt.')
  }

  const decryptArr = async <T>(raw: string | null, label: string): Promise<T[]> => {
    if (!raw?.trim()) return []
    if (!isVaultWrappedPayload(raw)) {
      return parseJsonArray<T>(raw)
    }
    try {
      const t = await decryptUtf8(cryptoKey, raw)
      const j = JSON.parse(t) as unknown
      return Array.isArray(j) ? (j as T[]) : []
    } catch (e) {
      console.error(`[commitmentStorage] decrypt ${label}`, e)
      throw new Error('Wrong passphrase or damaged vault blobs.')
    }
  }

  const commitments = await decryptArr<CommitmentRecord>(rawC, 'commitments')
  const loans = await decryptArr<LoanRecord>(rawL, 'loans')
  const staking = await decryptArr<StakingRecord>(rawS, 'staking')
  const unstake = await decryptArr<UnstakeRequest>(rawU, 'unstake')
  unlockCaches.set(w, { commitments, loans, staking, unstake })
  sessionCryptoKeys.set(w, cryptoKey)
}

export function lockCommitmentVault(walletAddress: string): void {
  const w = waddr(walletAddress)
  const t = persistTimers.get(w)
  if (t !== undefined) clearTimeout(t)
  persistTimers.delete(w)
  void flushVaultToLocalStorage(walletAddress).finally(() => {
    sessionCryptoKeys.delete(w)
    unlockCaches.delete(w)
  })
}

/** Remove encryption; restores plaintext JSON (requires passphrase). */
export async function disableEncryptedCommitmentCache(walletAddress: string, passphrase: string): Promise<void> {
  const w = waddr(walletAddress)
  if (!isCommitmentVaultEnabled(walletAddress)) {
    throw new Error('Encrypted cache is not enabled.')
  }
  await unlockCommitmentVault(walletAddress, passphrase)
  const c = unlockCaches.get(w)
  if (!c) throw new Error('Unlock failed')
  writeRaw(kCommitments(walletAddress), JSON.stringify(c.commitments))
  writeRaw(kLoans(walletAddress), JSON.stringify(c.loans))
  writeRaw(kStaking(walletAddress), JSON.stringify(c.staking))
  writeRaw(kUnstake(walletAddress), JSON.stringify(c.unstake))
  removeRaw(vaultModeLsKey(walletAddress))
  removeRaw(vaultSaltLsKey(walletAddress))
  sessionCryptoKeys.delete(w)
  unlockCaches.delete(w)
}
