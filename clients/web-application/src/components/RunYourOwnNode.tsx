/**
 * Banner: prefer local Sonic JSON-RPC (127.0.0.1:8545 / :8547) when available.
 */

import { useState, useEffect } from 'react'
import { detectLocalNode, type NodeDetectionResult } from '@/utils/nodeDetector'
import { useWalletStore } from '@/store/walletStore'
import toast from 'react-hot-toast'

export default function RunYourOwnNode() {
  const { rpcUrl, setRpcProfile } = useWalletStore()
  const [localNode, setLocalNode] = useState<NodeDetectionResult>({ isAvailable: false, url: null, type: null })
  const [isDetecting, setIsDetecting] = useState(true)

  useEffect(() => {
    // Initial detection
    detectLocalNode().then((result) => {
      setLocalNode(result)
      setIsDetecting(false)
    })

    // Periodic check every 10 seconds
    const interval = setInterval(() => {
      detectLocalNode().then(setLocalNode)
    }, 10000)

    return () => clearInterval(interval)
  }, [])

  const isUsingLocalNode = rpcUrl.startsWith('http://127.0.0.1') || rpcUrl.startsWith('http://localhost')
  const showBanner = !isUsingLocalNode && !isDetecting

  const handleConnectToLocalNode = () => {
    if (localNode.isAvailable && localNode.url) {
      const profileId = localNode.type === 'sovereign-cli' ? 'sovereign-cli' : 'sovereign-direct'
      setRpcProfile(profileId)
      toast.success('Switched read RPC to your local node')
    } else {
      toast.error('Local node not detected. Install the Aegis Node app first.')
    }
  }

  const handleDownloadNode = () => {
    window.open('https://github.com/Aegis-Finance/aegis-sovereign-node-app/releases/tag/v0.3.3', '_blank')
    toast.loading('Opening Aegis Node release...', { id: 'download' })
  }

  if (!showBanner) return null

  return (
    <div className="bg-terminal-accent/10 border border-terminal-accent/30 rounded-lg p-4 mb-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">🏠</span>
            <h3 className="text-lg font-semibold text-terminal-accent">
              Run Your Own Node
            </h3>
            {localNode.isAvailable && (
              <span className="text-xs uppercase font-semibold text-terminal-success bg-terminal-success/10 px-2 py-1 rounded">
                🟢 Available
              </span>
            )}
          </div>
          <p className="text-sm text-terminal-text-dim mb-3">
            Your wallet connects you to Sonic — it doesn&apos;t run a node for you. If you have Sonic running on your
            machine, switch to it here so reads stay on your setup instead of a public RPC you never picked.
          </p>
          <div className="flex flex-wrap gap-2">
            {localNode.isAvailable ? (
              <button
                onClick={handleConnectToLocalNode}
                className="btn-primary text-sm"
              >
                🚀 Connect to My Node ({localNode.latency}ms)
              </button>
            ) : (
              <button
                onClick={handleDownloadNode}
                className="btn-primary text-sm"
              >
                📥 Download Aegis Node App
              </button>
            )}
            <a
              href="https://github.com/Aegis-Finance"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary text-sm"
            >
              📖 Learn More
            </a>
          </div>
        </div>
        {localNode.isAvailable && (
          <div className="text-right">
            <div className="text-xs text-terminal-success font-mono">
              {localNode.url}
            </div>
            <div className="text-xs text-terminal-text-dim mt-1">
              Your personal Sonic node is running
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

