/**
 * Local-first privacy flow metrics (Wallet). No network I/O unless user opts in and
 * `VITE_PRIVACY_TELEMETRY_ENDPOINT` is set — see `docs/ops/PRIVACY_METRICS_PRODUCT_AND_LEGAL.md`.
 */
const STORAGE_KEY = 'aegis_privacy_local_metrics_v1'
const TELEMETRY_OPT_IN_KEY = 'aegis_privacy_telemetry_opt_in_v1'
const SESSION_BEACON_KEY = 'aegis_privacy_telemetry_beacon_sent_v1'

export type LocalPrivacyMetricsV1 = {
  version: 1
  shieldStarted: number
  shieldSucceeded: number
  unshieldStarted: number
  unshieldSucceeded: number
}

function defaultMetrics(): LocalPrivacyMetricsV1 {
  return { version: 1, shieldStarted: 0, shieldSucceeded: 0, unshieldStarted: 0, unshieldSucceeded: 0 }
}

function readMetrics(): LocalPrivacyMetricsV1 {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultMetrics()
    const j = JSON.parse(raw) as Partial<LocalPrivacyMetricsV1>
    if (j?.version !== 1) return defaultMetrics()
    return {
      version: 1,
      shieldStarted: Math.max(0, Number(j.shieldStarted) || 0),
      shieldSucceeded: Math.max(0, Number(j.shieldSucceeded) || 0),
      unshieldStarted: Math.max(0, Number(j.unshieldStarted) || 0),
      unshieldSucceeded: Math.max(0, Number(j.unshieldSucceeded) || 0),
    }
  } catch {
    return defaultMetrics()
  }
}

function writeMetrics(m: LocalPrivacyMetricsV1): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(m))
  } catch {
    /* quota / private mode */
  }
}

export function getLocalPrivacyMetrics(): LocalPrivacyMetricsV1 {
  if (typeof localStorage === 'undefined') return defaultMetrics()
  return readMetrics()
}

export function resetLocalPrivacyMetrics(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export function recordShieldStarted(): void {
  if (typeof localStorage === 'undefined') return
  const m = readMetrics()
  m.shieldStarted += 1
  writeMetrics(m)
}

export function recordShieldSucceeded(): void {
  if (typeof localStorage === 'undefined') return
  const m = readMetrics()
  m.shieldSucceeded += 1
  writeMetrics(m)
}

export function recordUnshieldStarted(): void {
  if (typeof localStorage === 'undefined') return
  const m = readMetrics()
  m.unshieldStarted += 1
  writeMetrics(m)
}

export function recordUnshieldSucceeded(): void {
  if (typeof localStorage === 'undefined') return
  const m = readMetrics()
  m.unshieldSucceeded += 1
  writeMetrics(m)
}

/** Percent 0–100, or null if no attempts. */
export function formatLocalPrivacySummaryLine(s: LocalPrivacyMetricsV1): string {
  const sp = s.shieldStarted > 0 ? Math.round((100 * s.shieldSucceeded) / s.shieldStarted) : null
  const up = s.unshieldStarted > 0 ? Math.round((100 * s.unshieldSucceeded) / s.unshieldStarted) : null
  return `Shields: ${s.shieldSucceeded} succeeded / ${s.shieldStarted} started${sp !== null ? ` (${sp}%)` : ''}. Transparent exits: ${s.unshieldSucceeded} / ${s.unshieldStarted}${up !== null ? ` (${up}%)` : ''}.`
}

export function isTelemetryOptIn(): boolean {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem(TELEMETRY_OPT_IN_KEY) === '1'
}

export function setTelemetryOptIn(optIn: boolean): void {
  try {
    if (optIn) localStorage.setItem(TELEMETRY_OPT_IN_KEY, '1')
    else localStorage.removeItem(TELEMETRY_OPT_IN_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * Sends **anonymous aggregate counters** (no wallet address, no chain id in payload by default).
 * At most **once per browser tab** per pageload session flag to limit noise.
 */
export function maybeSendPrivacyTelemetryBeacon(): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return
  const endpoint = (import.meta.env.VITE_PRIVACY_TELEMETRY_ENDPOINT as string | undefined)?.trim()
  if (!endpoint || !isTelemetryOptIn()) return
  try {
    if (sessionStorage.getItem(SESSION_BEACON_KEY) === '1') return
    const m = getLocalPrivacyMetrics()
    const body = JSON.stringify({
      schema: 'aegis.privacy.v1',
      shieldStarted: m.shieldStarted,
      shieldSucceeded: m.shieldSucceeded,
      unshieldStarted: m.unshieldStarted,
      unshieldSucceeded: m.unshieldSucceeded,
      t: Date.now(),
    })
    const blob = new Blob([body], { type: 'application/json' })
    const ok =
      typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function'
        ? navigator.sendBeacon(endpoint, blob)
        : false
    if (!ok) {
      void fetch(endpoint, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        mode: 'cors',
      }).catch(() => {})
    }
    sessionStorage.setItem(SESSION_BEACON_KEY, '1')
  } catch {
    /* ignore */
  }
}
