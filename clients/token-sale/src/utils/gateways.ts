export function parseList(env?: string): string[] {
  if (!env) return []
  return env
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function buildGatewayUrls(txid: string, gateways: string[], pathSuffix = ''): string[] {
  if (txid.startsWith('http://') || txid.startsWith('https://')) {
    return [txid]
  }
  return gateways.map((g) => `${g.replace(/\/+$/,'')}/${txid}${pathSuffix}`)
}

export async function pickFirstReachable(urls: string[], timeoutMs = 7000): Promise<string> {
  for (const url of urls) {
    try {
      const controller = new AbortController()
      const t = setTimeout(() => controller.abort(), timeoutMs)
      const res = await fetch(url, { method: 'HEAD', signal: controller.signal })
      clearTimeout(t)
      if (res.ok) return url
    } catch {}
  }
  // Fallback to first even if HEAD failed
  return urls[0]
}


