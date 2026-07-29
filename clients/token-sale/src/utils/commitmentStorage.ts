/**
 * Token distribution — auction commitment UX storage.
 *
 * **Default:** plaintext JSON under `aegis_auction_commitments_<addr>`.
 * **Optional vault:** same PBKDF2 + AES-GCM as main dApp (`aegis_vault_v1:`); flags/salt use `aegis_td_*` to avoid colliding with other apps on the same origin.
 */

import {
  b64urlToBytes,
  bytesToB64url,
  decryptUtf8,
  deriveAesKey,
  encryptUtf8,
  isVaultWrappedPayload,
  randomSalt,
} from './commitmentVaultCrypto'

export interface AuctionCommitmentRecord {
  commitment: string
  nullifier?: string
  contractType: 'auction' | 'claim'
  action: 'purchase' | 'claim'
  amount: string
  ethAmount?: string
  timestamp: number
  transactionHash?: string
  metadata?: Record<string, unknown>
}

const STORAGE_KEY = 'aegis_auction_commitments'
const VAULT_MODE_KEY = 'aegis_td_ux_vault_v1'
const VAULT_SALT_KEY = 'aegis_td_ux_vault_salt_v1'

export const AUCTION_COMMITMENT_STORAGE_PRIVACY_DOC =
  'Aegis-contracts/docs/ops/PRIVACY_UX_LOCAL_STORAGE_AND_DEVICE.md'

const sessionCryptoKeys = new Map<string, CryptoKey>()
const unlockCaches = new Map<string, AuctionCommitmentRecord[]>()
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>()

function waddr(walletAddress: string): string {
  return walletAddress.toLowerCase()
}

function bucketKey(wallet: string): string {
  return `${STORAGE_KEY}_${waddr(wallet)}`
}

function vaultModeLsKey(wallet: string): string {
  return `${VAULT_MODE_KEY}_${waddr(wallet)}`
}

function vaultSaltLsKey(wallet: string): string {
  return `${VAULT_SALT_KEY}_${waddr(wallet)}`
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

function parseJsonArray(raw: string | null): AuctionCommitmentRecord[] {
  if (!raw || isVaultWrappedPayload(raw)) return []
  try {
    const j = JSON.parse(raw) as unknown
    return Array.isArray(j) ? (j as AuctionCommitmentRecord[]) : []
  } catch {
    return []
  }
}

function rawBucketHasSensitiveData(wallet: string): boolean {
  const raw = readRaw(bucketKey(wallet))
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

export function hasAuctionCommitmentLocalStorage(walletAddress: string): boolean {
  if (!walletAddress) return false
  return rawBucketHasSensitiveData(walletAddress)
}

function legacyRead(wallet: string): AuctionCommitmentRecord[] {
  return parseJsonArray(readRaw(bucketKey(wallet)))
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
  const rows = unlockCaches.get(w)
  if (!cryptoKey || !rows) return
  try {
    writeRaw(bucketKey(wallet), await encryptUtf8(cryptoKey, JSON.stringify(rows)))
  } catch (e) {
    console.error('[commitmentStorage] flushVaultToLocalStorage failed', e)
  }
}

export function getCommitments(walletAddress: string): AuctionCommitmentRecord[] {
  const w = waddr(walletAddress)
  if (!w) return []
  if (isCommitmentVaultEnabled(walletAddress)) {
    const c = unlockCaches.get(w)
    if (c) return [...c]
    return []
  }
  return legacyRead(walletAddress)
}

export function saveCommitment(walletAddress: string, record: AuctionCommitmentRecord): void {
  const w = waddr(walletAddress)
  if (!w) return
  try {
    if (isCommitmentVaultEnabled(walletAddress) && !isCommitmentVaultUnlocked(walletAddress)) {
      console.warn('[commitmentStorage] TGE vault locked — skipped saveCommitment.')
      return
    }
    const commitments = getCommitments(walletAddress)
    const existingIndex = commitments.findIndex(
      (c) => c.commitment.toLowerCase() === record.commitment.toLowerCase()
    )
    if (existingIndex >= 0) {
      commitments[existingIndex] = record
    } else {
      commitments.push(record)
    }
    if (isCommitmentVaultEnabled(walletAddress) && isCommitmentVaultUnlocked(walletAddress)) {
      unlockCaches.set(w, commitments)
      scheduleVaultPersist(walletAddress)
      return
    }
    writeRaw(bucketKey(walletAddress), JSON.stringify(commitments))
  } catch (error) {
    console.error('Failed to save commitment:', error)
  }
}

export function getPurchaseCommitments(walletAddress: string): AuctionCommitmentRecord[] {
  return getCommitments(walletAddress).filter((c) => c.contractType === 'auction' && c.action === 'purchase')
}

export function getClaimCommitments(walletAddress: string): AuctionCommitmentRecord[] {
  return getCommitments(walletAddress).filter((c) => c.contractType === 'claim' && c.action === 'claim')
}

export function removeCommitment(walletAddress: string, commitment: string): void {
  try {
    if (isCommitmentVaultEnabled(walletAddress) && !isCommitmentVaultUnlocked(walletAddress)) {
      console.warn('[commitmentStorage] TGE vault locked — skipped removeCommitment.')
      return
    }
    const filtered = getCommitments(walletAddress).filter(
      (c) => c.commitment.toLowerCase() !== commitment.toLowerCase()
    )
    if (isCommitmentVaultEnabled(walletAddress) && isCommitmentVaultUnlocked(walletAddress)) {
      unlockCaches.set(waddr(walletAddress), filtered)
      scheduleVaultPersist(walletAddress)
    } else {
      writeRaw(bucketKey(walletAddress), JSON.stringify(filtered))
    }
  } catch (error) {
    console.error('Failed to remove commitment:', error)
  }
}

export function removeCommitmentByNullifier(walletAddress: string, nullifier: string): void {
  try {
    if (isCommitmentVaultEnabled(walletAddress) && !isCommitmentVaultUnlocked(walletAddress)) {
      console.warn('[commitmentStorage] TGE vault locked — skipped removeCommitmentByNullifier.')
      return
    }
    const filtered = getCommitments(walletAddress).filter(
      (c) => !c.nullifier || c.nullifier.toLowerCase() !== nullifier.toLowerCase()
    )
    if (isCommitmentVaultEnabled(walletAddress) && isCommitmentVaultUnlocked(walletAddress)) {
      unlockCaches.set(waddr(walletAddress), filtered)
      scheduleVaultPersist(walletAddress)
    } else {
      writeRaw(bucketKey(walletAddress), JSON.stringify(filtered))
    }
  } catch (error) {
    console.error('Failed to remove commitment by nullifier:', error)
  }
}

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
  const rows = legacyRead(walletAddress)
  unlockCaches.set(w, rows)
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
  const raw = readRaw(bucketKey(walletAddress))
  if (!raw || !isVaultWrappedPayload(raw)) {
    throw new Error('Vault data missing or corrupt.')
  }
  try {
    const t = await decryptUtf8(cryptoKey, raw)
    const j = JSON.parse(t) as unknown
    const rows = Array.isArray(j) ? (j as AuctionCommitmentRecord[]) : []
    unlockCaches.set(w, rows)
    sessionCryptoKeys.set(w, cryptoKey)
  } catch (e) {
    console.error('[commitmentStorage] unlock decrypt', e)
    throw new Error('Wrong passphrase or damaged vault blob.')
  }
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

export async function disableEncryptedCommitmentCache(walletAddress: string, passphrase: string): Promise<void> {
  const w = waddr(walletAddress)
  if (!isCommitmentVaultEnabled(walletAddress)) {
    throw new Error('Encrypted cache is not enabled.')
  }
  await unlockCommitmentVault(walletAddress, passphrase)
  const rows = unlockCaches.get(w)
  if (!rows) throw new Error('Unlock failed')
  writeRaw(bucketKey(walletAddress), JSON.stringify(rows))
  removeRaw(vaultModeLsKey(walletAddress))
  removeRaw(vaultSaltLsKey(walletAddress))
  sessionCryptoKeys.delete(w)
  unlockCaches.delete(w)
}
