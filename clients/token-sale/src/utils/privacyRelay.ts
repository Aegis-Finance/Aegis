import { ENV } from '../config'

export function privacyRelayHttpUrl(): string | undefined {
  const u = (import.meta.env.VITE_PRIVACY_RELAY_HTTP_URL as string | undefined)?.trim()
  return u || undefined
}

export function privacyRelayApiKey(): string | undefined {
  const k = (import.meta.env.VITE_PRIVACY_RELAY_API_KEY as string | undefined)?.trim()
  return k || undefined
}

export function preferGaslessPrivacyRelay(): boolean {
  const off =
    import.meta.env.VITE_DEFAULT_GASLESS_RELAY === '0' ||
    import.meta.env.VITE_DEFAULT_GASLESS_RELAY === 'false'
  if (off) return false
  return Boolean(privacyRelayHttpUrl() && ENV.privacyEntryRouterAddress)
}

export type RelayShieldPayload = {
  proof: string[]
  publicInputs: string[]
  deadline: string
  nonce: string
  signature: string
}

export async function postPrivacyRelay(
  path: '/v1/relay-shield' | '/v1/relay-unshield' | '/v1/relay-transparent-exit',
  body: RelayShieldPayload
): Promise<{ txHash: string }> {
  const base = privacyRelayHttpUrl()
  if (!base) throw new Error('VITE_PRIVACY_RELAY_HTTP_URL not configured')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const apiKey = privacyRelayApiKey()
  if (apiKey) headers['X-Relayer-Api-Key'] = apiKey

  const res = await fetch(`${base.replace(/\/+$/, '')}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; txHash?: string; error?: string }
  if (!res.ok || !data.ok || !data.txHash) {
    throw new Error(data.error || `Relayer error (${res.status})`)
  }
  return { txHash: data.txHash }
}
