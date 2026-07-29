/**
 * Sovereign Node Client
 * Handles communication with Aegis sovereign nodes for critical operations
 */

import { checkRateLimit } from './rateLimiter'

export interface SovereignNodeConfig {
  url: string
  name: string
  priority: number
  enabled: boolean
  timeout: number
}

/**
 * Sovereign node endpoints
 * These should be configured via environment variables
 */
export const SOVEREIGN_NODES: SovereignNodeConfig[] = [
  // Primary nodes (configure via env)
  ...(import.meta.env.VITE_SOVEREIGN_NODE_1
    ? [
        {
          url: import.meta.env.VITE_SOVEREIGN_NODE_1,
          name: 'Sovereign Node 1',
          priority: 1,
          enabled: true,
          timeout: 15000,
        },
      ]
    : []),
  ...(import.meta.env.VITE_SOVEREIGN_NODE_2
    ? [
        {
          url: import.meta.env.VITE_SOVEREIGN_NODE_2,
          name: 'Sovereign Node 2',
          priority: 2,
          enabled: true,
          timeout: 15000,
        },
      ]
    : []),
  ...(import.meta.env.VITE_SOVEREIGN_NODE_3
    ? [
        {
          url: import.meta.env.VITE_SOVEREIGN_NODE_3,
          name: 'Sovereign Node 3',
          priority: 3,
          enabled: true,
          timeout: 15000,
        },
      ]
    : []),
  // Local node (if running)
  {
    url: 'http://127.0.0.1:8545',
    name: 'Local Sovereign Node',
    priority: 0, // Highest priority if available
    enabled: true,
    timeout: 5000,
  },
]

interface NodeHealth {
  url: string
  lastSuccess: number
  lastFailure: number
  consecutiveFailures: number
  isHealthy: boolean
}

class SovereignNodeManager {
  private health: Map<string, NodeHealth> = new Map()
  private readonly MAX_CONSECUTIVE_FAILURES = 2
  private readonly HEALTH_CHECK_INTERVAL = 30000 // 30 seconds

  constructor() {
    SOVEREIGN_NODES.forEach((node) => {
      this.health.set(node.url, {
        url: node.url,
        lastSuccess: Date.now(),
        lastFailure: 0,
        consecutiveFailures: 0,
        isHealthy: true,
      })
    })

    // Periodic health check
    setInterval(() => this.healthCheck(), this.HEALTH_CHECK_INTERVAL)
  }

  /**
   * Get healthy nodes sorted by priority
   */
  getHealthyNodes(): SovereignNodeConfig[] {
    return SOVEREIGN_NODES.filter((node) => {
      const health = this.health.get(node.url)
      return (
        node.enabled &&
        health &&
        health.isHealthy &&
        health.consecutiveFailures < this.MAX_CONSECUTIVE_FAILURES
      )
    }).sort((a, b) => a.priority - b.priority)
  }

  /**
   * Record successful request
   */
  recordSuccess(url: string): void {
    const health = this.health.get(url)
    if (health) {
      health.lastSuccess = Date.now()
      health.consecutiveFailures = 0
      health.isHealthy = true
    }
  }

  /**
   * Record failed request
   */
  recordFailure(url: string): void {
    const health = this.health.get(url)
    if (health) {
      health.lastFailure = Date.now()
      health.consecutiveFailures++
      if (health.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
        health.isHealthy = false
      }
    }
  }

  /**
   * Health check
   */
  private async healthCheck(): Promise<void> {
    const healthyNodes = this.getHealthyNodes()
    if (healthyNodes.length === 0) {
      // Reset failures if all are down (might be temporary)
      this.health.forEach((health) => {
        health.consecutiveFailures = Math.max(0, health.consecutiveFailures - 1)
        if (health.consecutiveFailures < this.MAX_CONSECUTIVE_FAILURES) {
          health.isHealthy = true
        }
      })
      return
    }

    // Check first healthy node
    const testNode = healthyNodes[0]
    try {
      const response = await fetch(`${testNode.url}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      })
      if (response.ok) {
        this.recordSuccess(testNode.url)
      } else {
        this.recordFailure(testNode.url)
      }
    } catch {
      this.recordFailure(testNode.url)
    }
  }
}

const nodeManager = new SovereignNodeManager()

/**
 * Execute RPC call through sovereign node with fallback
 */
export async function callSovereignNode(
  method: string,
  params: unknown[] = []
): Promise<unknown> {
  // Check rate limit for critical operations
  checkRateLimit('critical')

  const healthyNodes = nodeManager.getHealthyNodes()

  if (healthyNodes.length === 0) {
    throw new Error('No healthy sovereign nodes available')
  }

  const errors: Error[] = []

  // Try each node in priority order
  for (const node of healthyNodes) {
    let timeoutId: NodeJS.Timeout | null = null
    try {
      const controller = new AbortController()
      timeoutId = setTimeout(() => controller.abort(), node.timeout)

      const response = await fetch(node.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method,
          params,
        }),
        signal: controller.signal,
      })

      if (timeoutId) clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`Node ${node.name} returned ${response.status}`)
      }

      const data = await response.json()

      if (data.error) {
        throw new Error(data.error.message || 'RPC error')
      }

      nodeManager.recordSuccess(node.url)
      return data.result
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId)
      nodeManager.recordFailure(node.url)
      errors.push(
        error instanceof Error
          ? error
          : new Error(`Node ${node.name} failed: ${String(error)}`)
      )
      continue
    }
  }

  throw new Error(
    `All sovereign nodes failed. Last error: ${errors[errors.length - 1]?.message}`
  )
}

/**
 * Check if sovereign nodes are available
 */
export function hasSovereignNodes(): boolean {
  return nodeManager.getHealthyNodes().length > 0
}

/**
 * Get status of all sovereign nodes
 */
export function getSovereignNodeStatus(): Array<{
  url: string
  name: string
  isHealthy: boolean
  priority: number
}> {
  return SOVEREIGN_NODES.map((node) => {
    const health = nodeManager['health'].get(node.url)
    return {
      url: node.url,
      name: node.name,
      isHealthy: health?.isHealthy ?? false,
      priority: node.priority,
    }
  })
}

