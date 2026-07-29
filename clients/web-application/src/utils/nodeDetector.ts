/**
 * Automatic Local Node Detection
 * Checks if user is running a local Sonic node and provides one-click connection
 */

export interface NodeDetectionResult {
  isAvailable: boolean
  url: string | null
  type: 'sovereign-cli' | 'sovereign-direct' | null
  latency?: number
}

const NODE_ENDPOINTS = [
  { url: 'http://127.0.0.1:8547', type: 'sovereign-cli' as const },
  { url: 'http://127.0.0.1:8545', type: 'sovereign-direct' as const },
]

/**
 * Check if a local node is available by making a quick eth_blockNumber call
 */
async function checkNodeAvailability(
  url: string,
  timeoutMs: number = 2000
): Promise<{ available: boolean; latency?: number }> {
  try {
    const startTime = Date.now()
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_blockNumber',
        params: [],
      }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)
    const latency = Date.now() - startTime

    if (!response.ok) {
      return { available: false }
    }

    const data = await response.json()
    // Valid response should have a result
    if (data.result) {
      return { available: true, latency }
    }

    return { available: false }
  } catch (error) {
    // Silently fail - node is not available
    return { available: false }
  }
}

/**
 * Detect available local nodes
 * Returns the first available node with lowest latency
 */
export async function detectLocalNode(): Promise<NodeDetectionResult> {
  const results = await Promise.all(
    NODE_ENDPOINTS.map(async (endpoint) => {
      const check = await checkNodeAvailability(endpoint.url)
      return {
        ...endpoint,
        ...check,
      }
    })
  )

  const available = results.filter((r) => r.available)
  if (available.length === 0) {
    return {
      isAvailable: false,
      url: null,
      type: null,
    }
  }

  // Return the fastest available node
  const fastest = available.sort((a, b) => (a.latency || 0) - (b.latency || 0))[0]

  return {
    isAvailable: true,
    url: fastest.url,
    type: fastest.type,
    latency: fastest.latency,
  }
}

/**
 * Periodically check for local node availability
 */
export function watchLocalNode(
  callback: (result: NodeDetectionResult) => void,
  intervalMs: number = 10000
): () => void {
  let intervalId: number | null = null
  let isRunning = true

  const check = async () => {
    if (!isRunning) return
    const result = await detectLocalNode()
    callback(result)
  }

  // Initial check
  check()

  // Set up interval
  if (typeof window !== 'undefined') {
    intervalId = window.setInterval(check, intervalMs)
  }

  // Return cleanup function
  return () => {
    isRunning = false
    if (intervalId !== null && typeof window !== 'undefined') {
      window.clearInterval(intervalId)
    }
  }
}

