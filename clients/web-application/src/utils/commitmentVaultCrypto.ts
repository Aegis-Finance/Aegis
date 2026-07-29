/**
 * Browser-only UX vault: AES-256-GCM + PBKDF2-SHA-256.
 * Does not defeat XSS in the same tab; raises the bar for offline disk / backup reads of localStorage.
 */

const PREFIX = 'aegis_vault_v1:'

/** Stable ArrayBuffer copy for Web Crypto `BufferSource` typing. */
function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(u.byteLength)
  new Uint8Array(out).set(u)
  return out
}

export function bytesToB64url(bytes: Uint8Array): string {
  let bin = ''
  bytes.forEach((b) => {
    bin += String.fromCharCode(b)
  })
  const b64 = btoa(bin)
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function isVaultWrappedPayload(raw: string | null | undefined): boolean {
  return Boolean(raw && raw.startsWith(PREFIX))
}

export function stripVaultPrefix(raw: string): string {
  return raw.slice(PREFIX.length)
}

export function wrapVaultPayload(innerJson: string): string {
  return PREFIX + innerJson
}

export async function randomSalt(): Promise<Uint8Array> {
  return crypto.getRandomValues(new Uint8Array(16))
}

export async function deriveAesKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder().encode(passphrase)
  const material = await crypto.subtle.importKey('raw', enc, 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: toArrayBuffer(salt), iterations: 250_000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function encryptUtf8(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const pt = new TextEncoder().encode(plaintext)
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, key, pt)
  )
  const envelope = {
    iv: bytesToB64url(iv),
    ct: bytesToB64url(ct),
  }
  return wrapVaultPayload(JSON.stringify(envelope))
}

export async function decryptUtf8(key: CryptoKey, wrapped: string): Promise<string> {
  const inner = isVaultWrappedPayload(wrapped) ? stripVaultPrefix(wrapped) : wrapped
  const { iv, ct } = JSON.parse(inner) as { iv: string; ct: string }
  const ivBytes = b64urlToBytes(iv)
  const ctBytes = b64urlToBytes(ct)
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(ivBytes) },
    key,
    toArrayBuffer(ctBytes)
  )
  return new TextDecoder().decode(pt)
}
