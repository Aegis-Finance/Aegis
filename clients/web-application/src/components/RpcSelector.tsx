import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWalletStore } from '@/store/walletStore'
import { getVisibleRpcProfiles, isHostedSonicPublicRpcProfile, isTrustedRpcUrl } from '@/config/rpcProfiles'
import { isOperationalProfile } from '@/utils/operationalProfile'
import { watchLocalNode, type NodeDetectionResult } from '@/utils/nodeDetector'
import { fetchSonicChainPackPrimaryRpcs } from '@/config/sonicChainPack'
import { DEFAULT_NETWORK } from '@/config/contracts'

export default function RpcSelector() {
  const {
    rpcUrl,
    rpcProfileId,
    customRpcUrl,
    setRpcProfile,
  } = useWalletStore()
  const [isOpen, setIsOpen] = useState(false)
  const [customUrl, setCustomUrl] = useState(customRpcUrl || '')
  const [localNode, setLocalNode] = useState<NodeDetectionResult>({ isAvailable: false, url: null, type: null })

  const { data: packRpcUrls } = useQuery({
    queryKey: ['sonic-chain-pack-rpc-urls', DEFAULT_NETWORK.chainId],
    queryFn: fetchSonicChainPackPrimaryRpcs,
    staleTime: 24 * 60 * 60 * 1000,
  })

  const officialPackDisplayUrl = useMemo(() => {
    const trusted = packRpcUrls?.find((u) => typeof u === 'string' && isTrustedRpcUrl(u))
    return trusted ?? 'https://rpc.soniclabs.com'
  }, [packRpcUrls])

  // Auto-detect local node on mount and watch for changes
  useEffect(() => {
    const cleanup = watchLocalNode((result) => {
      setLocalNode(result)
      // Auto-connect to detected local node if not connected yet
      if (result.isAvailable && result.url && (!isOperationalProfile() || isHostedSonicPublicRpcProfile(rpcProfileId))) {
        const profileId = result.type === 'sovereign-cli' ? 'sovereign-cli' : 'sovereign-direct'
        if (isHostedSonicPublicRpcProfile(rpcProfileId) || (isOperationalProfile() && !rpcUrl.startsWith('http://127.0.0.1'))) {
          setRpcProfile(profileId)
        }
      }
    }, 10000) // Check every 10 seconds

    return cleanup
  }, [rpcUrl, rpcProfileId, setRpcProfile])

  const visibleProfiles = getVisibleRpcProfiles()
  const standardProfiles = visibleProfiles.filter((profile) => profile.id !== 'custom')
  const customProfile = visibleProfiles.find((profile) => profile.id === 'custom')

  const handleProfileClick = (profileId: string) => {
    setRpcProfile(profileId)
    setIsOpen(false)
  }

  const handleCustomRpc = () => {
    if (!customProfile) {
      return
    }
    if (customUrl.trim()) {
      setRpcProfile(customProfile.id, customUrl.trim())
      setIsOpen(false)
    }
  }

  const renderBadge = (profileId: string) => {
    if (profileId === 'sovereign-cli' || profileId === 'sovereign-direct') {
      const isAvailable = localNode.isAvailable && localNode.type === profileId
      return (
        <span className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded ${
          isAvailable 
            ? 'text-terminal-success bg-terminal-success/10' 
            : 'text-terminal-text-dim bg-terminal-muted/30'
        }`}>
          {isAvailable ? '🟢 Active' : '⚪ Offline'}
        </span>
      )
    }
    if (profileId === 'dao') {
      return (
        <span className="text-[10px] uppercase font-semibold text-terminal-accent bg-terminal-accent/10 px-2 py-0.5 rounded">
          Sovereign
        </span>
      )
    }
    return null
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="btn-secondary text-sm flex items-center gap-2"
      >
        <span className="text-xs">🌐</span>
        <span className="hidden sm:inline">RPC</span>
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 top-full z-50 mt-2 flex w-80 max-h-[min(32rem,calc(100vh-5rem))] flex-col overflow-hidden rounded-lg border border-terminal-border bg-terminal-surface shadow-lg">
            <div className="shrink-0 border-b border-terminal-border px-4 py-3">
              <div className="text-sm font-medium text-terminal-text">Select RPC Node</div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pt-3">
            <div className="space-y-3">
              <div className="space-y-1">
                {standardProfiles.map((profile) => {
                  const isSelected = rpcProfileId === profile.id
                  const isSovereignNode = profile.id === 'sovereign-cli' || profile.id === 'sovereign-direct'
                  const isLocalAvailable = isSovereignNode && localNode.isAvailable && localNode.type === profile.id
                  const effectiveUrl =
                    profile.id === 'sonic-official-pack'
                      ? officialPackDisplayUrl
                      : profile.url
                  const disabled = !effectiveUrl || (isSovereignNode && !isLocalAvailable)
                  
                  return (
                    <button
                      key={profile.id}
                      onClick={() => !disabled && handleProfileClick(profile.id)}
                      disabled={disabled}
                      className={`
                        w-full text-left px-3 py-2 rounded text-sm transition-colors border
                        ${isSelected
                          ? 'bg-terminal-accent/20 text-terminal-accent border-terminal-accent'
                          : 'border-transparent text-terminal-text-dim hover:text-terminal-text hover:bg-terminal-muted/30'}
                        ${disabled ? 'opacity-60 cursor-not-allowed' : ''}
                        ${isSovereignNode && isLocalAvailable ? 'border-terminal-success/30' : ''}
                      `}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium flex items-center gap-2">
                          {profile.label}
                          {renderBadge(profile.id)}
                        </div>
                        {profile.requiresConfig && (
                          <span className="text-[10px] uppercase font-semibold text-terminal-warning">
                            Not available
                          </span>
                        )}
                        {isSovereignNode && !isLocalAvailable && (
                          <span className="text-[10px] uppercase font-semibold text-terminal-warning">
                            Install Node
                          </span>
                        )}
                      </div>
                      {profile.description && (
                        <div className="text-[11px] text-terminal-text-dim mt-1">
                          {profile.description}
                        </div>
                      )}
                      {effectiveUrl && (
                        <div className="text-xs font-mono text-terminal-text-dim truncate mt-1">
                          {effectiveUrl}
                          {isSovereignNode && isLocalAvailable && localNode.latency && (
                            <span className="ml-2 text-terminal-success">
                              ({localNode.latency}ms)
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>

              {customProfile && (
                <div className="pt-3 border-terminal-border border-t">
                  <div className="text-xs text-terminal-text-dim mb-2">
                    Custom RPC URL
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={customUrl}
                      onChange={(e) => setCustomUrl(e.target.value)}
                      placeholder="https://..."
                      className="input-field flex-1 text-sm"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleCustomRpc()
                        }
                      }}
                    />
                    <button
                      onClick={handleCustomRpc}
                      className="btn-primary text-sm px-3"
                    >
                      Save
                    </button>
                  </div>
                  <div className="text-[11px] text-terminal-text-dim mt-2">
                    HTTPS endpoints only (except 127.0.0.1 for local testing). If you add Sonic in your wallet, this
                    URL is included in the suggested RPC list when it matches our trust rules.
                  </div>
                </div>
              )}

            </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

