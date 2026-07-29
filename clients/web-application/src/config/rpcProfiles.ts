/**
 * Public Sonic RPC URLs mirror the canonical list in `public/config/sonic-chain-pack.json`
 * (synced from `Aegis-contracts`). After changing RPC order in the pack, re-sync the JSON
 * and keep these defaults aligned where they represent the same endpoints.
 */
import {
  allowPublicSonicRpcInUi,
  isOperationalProfile,
  operationalDefaultRpcUrl,
} from '@/utils/operationalProfile'
export type RpcProfile = {
  id: string
  label: string
  url: string | null
  description?: string
  trusted?: boolean
  requiresConfig?: boolean
}

const daoRpcUrl = import.meta.env.VITE_DAO_RPC_URL
  ? String(import.meta.env.VITE_DAO_RPC_URL).trim()
  : null

function daoRpcHostname(): string | null {
  if (!daoRpcUrl) return null
  try {
    return new URL(daoRpcUrl).hostname.toLowerCase()
  } catch {
    return null
  }
}

export const RPC_PROFILES: RpcProfile[] = [
  {
    id: 'sovereign-cli',
    label: 'My Own Node (127.0.0.1:8547) 🏠',
    url: 'http://127.0.0.1:8547',
    trusted: true,
    description: 'Sovereign Node CLI - Your personal Sonic node',
  },
  {
    id: 'sovereign-direct',
    label: 'My Own Node (127.0.0.1:8545) 🏠',
    url: 'http://127.0.0.1:8545',
    trusted: true,
    description: 'Direct local Sonic node connection',
  },
  {
    id: 'dao',
    label: 'DAO Node (recommended)',
    url: daoRpcUrl && daoRpcUrl.length > 0 ? daoRpcUrl : null,
    trusted: true,
    description: 'Managed by Aegis DAO operations',
    requiresConfig: !daoRpcUrl || daoRpcUrl.length === 0,
  },
  {
    id: 'sonic-official-pack',
    label: 'Sonic official (chain pack)',
    url: null,
    description: 'Primary RPC from public/config/sonic-chain-pack.json (synced from Aegis-contracts)',
  },
  {
    id: 'sonic-public-mainnet',
    label: 'Sonic Public RPC (mainnet)',
    url: 'https://rpc.soniclabs.com',
    description: 'Chain ID 146 — https://docs.soniclabs.com/sonic/build-on-sonic/getting-started',
  },
  {
    id: 'custom',
    label: 'Custom RPC URL…',
    url: null,
    description: 'Specify any HTTPS endpoint',
  },
]

export function getRpcProfile(id: string): RpcProfile | undefined {
  return getVisibleRpcProfiles().find((profile) => profile.id === id) ?? RPC_PROFILES.find((p) => p.id === id)
}

/** Hide public Sonic endpoints in operational builds. */
export function getVisibleRpcProfiles(): RpcProfile[] {
  if (allowPublicSonicRpcInUi()) return RPC_PROFILES
  return RPC_PROFILES.filter((p) => !isHostedSonicPublicRpcProfile(p.id))
}

/**
 * Default read-only RPC when the wallet is disconnected.
 * Operational: local sovereign proxy first. Convenience: DAO → public Sonic → local.
 */
export function getFirstAvailableRpcProfile(): RpcProfile {
  const byId = (id: string) => RPC_PROFILES.find((p) => p.id === id)
  if (isOperationalProfile()) {
    const local = byId('sovereign-cli')
    if (local?.url) return local
    const dao = byId('dao')
    if (dao?.url && dao.url.length > 0) return dao
    const direct = byId('sovereign-direct')
    if (direct?.url) return direct
    return {
      id: 'sovereign-cli',
      label: 'My Own Node (127.0.0.1:8547)',
      url: operationalDefaultRpcUrl(),
      trusted: true,
    }
  }
  const dao = byId('dao')
  if (dao?.url && dao.url.length > 0) return dao
  const sonic = byId('sonic-public-mainnet')
  if (sonic?.url) return sonic
  const s8547 = byId('sovereign-cli')
  if (s8547?.url) return s8547
  const s8545 = byId('sovereign-direct')
  if (s8545?.url) return s8545
  return {
    id: 'custom',
    label: 'Custom RPC URL…',
    url: null,
  }
}

export function isHttpsUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:') {
      return true
    }
    // Allow localhost for sovereign nodes
    if (parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')) {
      return true
    }
    return false
  } catch (error) {
    return false
  }
}

/**
 * Custom RPC must be HTTPS to a known-good host, or match VITE_DAO_RPC_URL / VITE_TRUSTED_RPC_HOSTS.
 * Prevents a malicious site from persisting an arbitrary JSON-RPC URL via shared machines.
 */
export function isTrustedRpcUrl(url: string): boolean {
  if (!isHttpsUrl(url)) return false
  try {
    const u = new URL(url)
    if (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')) {
      return true
    }
    if (u.protocol !== 'https:') return false
    const h = u.hostname.toLowerCase()
    const daoHost = daoRpcHostname()
    if (daoHost && h === daoHost) return true
    if (isOperationalProfile()) {
      const extra = import.meta.env.VITE_TRUSTED_RPC_HOSTS as string | undefined
      if (extra) {
        const allow = new Set(
          extra
            .split(',')
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean)
        )
        return allow.has(h)
      }
      return false
    }
    if (h.endsWith('.soniclabs.com')) return true
    const extra = import.meta.env.VITE_TRUSTED_RPC_HOSTS as string | undefined
    if (extra) {
      const allow = new Set(
        extra
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      )
      if (allow.has(h)) return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * Check if URL points to a local sovereign node
 */
export function isLocalSovereignNode(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === 'http:' &&
      (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') &&
      (parsed.port === '8545' || parsed.port === '8547' || parsed.port === '')
    )
  } catch {
    return false
  }
}

/** Hosted Sonic Labs JSON-RPC profiles (not DAO / not local). */
const HOSTED_SONIC_PUBLIC_PROFILE_IDS = new Set([
  'sonic-official-pack',
  'sonic-public-mainnet',
])

export function isHostedSonicPublicRpcProfile(profileId: string): boolean {
  return HOSTED_SONIC_PUBLIC_PROFILE_IDS.has(profileId)
}


