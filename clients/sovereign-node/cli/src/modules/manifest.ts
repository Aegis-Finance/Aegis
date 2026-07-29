import { promises as fs } from 'fs'
import semver from 'semver'
import { fileURLToPath } from 'url'
import path from 'path'

export interface ManifestEntry {
  version: string
  platform: string
  network: 'sonic-mainnet' | 'sonic-testnet'
  url: string
  sha256: string
  signature: string
  released_at: string
  notes?: string
}

export interface ManifestData {
  entries: ManifestEntry[]
}

function platformKey(): string {
  const arch = process.arch
  const platform = process.platform

  if (platform === 'darwin') {
    return 'macos-universal'
  }
  if (platform === 'win32') {
    return 'windows-x86_64'
  }
  if (arch === 'arm64') {
    return `${platform}-arm64`
  }
  return `${platform}-x86_64`
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export async function loadManifest(): Promise<ManifestEntry[]> {
  const manifestPath = path.resolve(__dirname, '../../../shared/binaries.json')
  const raw = await fs.readFile(manifestPath, 'utf-8')
  const parsed = JSON.parse(raw) as ManifestEntry[]
  return parsed
}

export async function resolveLatestEntry(network: string) {
  const entries = await loadManifest()
  const targetPlatform = platformKey()
  const filtered = entries.filter((entry) => entry.network === network && entry.platform === targetPlatform)
  if (filtered.length === 0) {
    throw new Error(`No binaries found in manifest for network ${network} and platform ${targetPlatform}`)
  }

  const sorted = filtered.sort((a, b) => semver.rcompare(semver.coerce(a.version) ?? '0.0.0', semver.coerce(b.version) ?? '0.0.0'))
  return sorted[0]
}

