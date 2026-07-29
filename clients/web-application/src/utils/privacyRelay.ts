import { resolvePrivacyEntryRouterAddress } from '@/utils/deploymentManifest'



export { resolvePrivacyEntryRouterAddress }



const DEFAULT_RELAY_URL = 'http://127.0.0.1:8787'



/** Comma-separated relay bases for fleet round-robin (G6.5). */

export function privacyRelayHttpUrls(): string[] {

  const multi = (import.meta.env.VITE_PRIVACY_RELAY_HTTP_URLS as string | undefined)?.trim()

  if (multi) {

    const list = multi.split(',').map((s) => s.trim()).filter(Boolean)

    if (list.length) return list

  }

  const single = privacyRelayHttpUrl()

  return single ? [single] : []

}



let relayRoundRobin = 0



/** HTTP relayer base URL (`privacy-entry-relayer-http.mjs`). */

export function privacyRelayHttpUrl(): string | undefined {

  const u = (import.meta.env.VITE_PRIVACY_RELAY_HTTP_URL as string | undefined)?.trim()

  if (u) return u

  if (resolvePrivacyEntryRouterAddress()) return DEFAULT_RELAY_URL

  return undefined

}



export function privacyRelayApiKey(): string | undefined {

  const k = (import.meta.env.VITE_PRIVACY_RELAY_API_KEY as string | undefined)?.trim()

  return k || undefined

}



export function privacyRelaySubmitJitterMaxMs(): number {

  const raw = (import.meta.env.VITE_PRIVACY_SUBMIT_JITTER_MAX_MS as string | undefined)?.trim()

  const n = raw ? parseInt(raw, 10) : 0

  if (!Number.isFinite(n) || n <= 0) return 0

  return Math.min(n, 30_000)

}



export async function sleepPrivacyRelaySubmitJitter(): Promise<void> {

  const max = privacyRelaySubmitJitterMaxMs()

  if (max <= 0) return

  const ms = 1 + Math.floor(Math.random() * max)

  await new Promise((r) => setTimeout(r, ms))

}



/**

 * Gasless relay when `PrivacyEntryRouter` is deployed and relay is not explicitly disabled.

 */

export function preferGaslessPrivacyRelay(): boolean {

  const off =

    import.meta.env.VITE_DEFAULT_GASLESS_RELAY === '0' ||

    import.meta.env.VITE_DEFAULT_GASLESS_RELAY === 'false'

  if (off) return false

  return privacyRelayHttpUrls().length > 0 && Boolean(resolvePrivacyEntryRouterAddress())

}



export function resolveExecutionRelayAddress(): string | undefined {

  const a = (import.meta.env.VITE_EXECUTION_RELAY_ADDRESS as string | undefined)?.trim()

  if (a && a !== '0x0000000000000000000000000000000000000000') return a

  return undefined

}



export function preferGaslessExecutionRelay(): boolean {

  const off =

    import.meta.env.VITE_DEFAULT_GASLESS_RELAY === '0' ||

    import.meta.env.VITE_DEFAULT_GASLESS_RELAY === 'false'

  if (off) return false

  return Boolean(resolveExecutionRelayAddress() && privacyRelayHttpUrls().length > 0)

}



export type PrivacyRelayPath =

  | '/v1/relay-shield'

  | '/v1/relay-unshield'

  | '/v1/relay-transparent-exit'

  | '/v1/relay-shielded-transfer'

  | '/v1/relay-execution'



export type RelayShieldPayload = {

  proof?: string[]

  publicInputs?: string[]

  deadline: string

  nonce: string

  signature: string

  authorizedSigner?: string

  user?: string

  target?: string

  data?: string

  value?: string

}



function pickRelayBase(): string {

  const urls = privacyRelayHttpUrls()

  if (!urls.length) throw new Error('Privacy relayer URL not configured')

  const idx = relayRoundRobin % urls.length

  relayRoundRobin += 1

  return urls[idx].replace(/\/+$/, '')

}



export async function postPrivacyRelay(

  path: PrivacyRelayPath,

  body: RelayShieldPayload

): Promise<{ txHash: string }> {

  await sleepPrivacyRelaySubmitJitter()

  const base = pickRelayBase()

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  const apiKey = privacyRelayApiKey()

  if (apiKey) headers['X-Relayer-Api-Key'] = apiKey



  const res = await fetch(`${base}${path}`, {

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


