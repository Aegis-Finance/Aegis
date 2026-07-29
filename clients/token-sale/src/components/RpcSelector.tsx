/**
 * RPC selector — options include the first URL from `public/config/sonic-chain-pack.json`
 * for the configured chain (same source as Aegis-contracts `sync:chain-pack`).
 */

import { useMemo, useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { detectLocalNode, watchLocalNode, type NodeDetectionResult } from '../utils/nodeDetector'
import { ENV, setRpcUrl } from '../config'
import { isTrustedRpcUrl } from '../utils/rpcTrust'
import { updateRpcUrl } from '../utils/contracts'
import { fetchChainPackPrimaryRpc } from '../utils/chainPackRpc'
import toast from 'react-hot-toast'

const DAO_RPC = (import.meta.env.VITE_DAO_RPC_URL as string | undefined)?.trim() ?? ''

export default function RpcSelector() {
  const [isOpen, setIsOpen] = useState(false)
  const [localNode, setLocalNode] = useState<NodeDetectionResult>({ isAvailable: false, url: null, type: null })
  const [currentRpc, setCurrentRpc] = useState(ENV.rpcUrl)
  const [customUrl, setCustomUrl] = useState('')

  const { data: packRpc } = useQuery({
    queryKey: ['chain-pack-primary-rpc', ENV.chainId],
    queryFn: () => fetchChainPackPrimaryRpc(ENV.chainId),
    staleTime: 24 * 60 * 60 * 1000,
  })

  const rpcOptions = useMemo(() => {
    const opts: Array<{ id: string; label: string; url: string | null }> = []
    if (DAO_RPC && isTrustedRpcUrl(DAO_RPC)) {
      opts.push({ id: 'dao', label: 'DAO / self-hosted', url: DAO_RPC })
    }
    const fallback =
      ENV.chainId === 14601 ? 'https://rpc.testnet.soniclabs.com' : 'https://rpc.soniclabs.com'
    const official = packRpc && isTrustedRpcUrl(packRpc) ? packRpc : fallback
    opts.push({
      id: 'sonic-official',
      label: ENV.chainId === 14601 ? 'Sonic testnet (official)' : 'Sonic mainnet (official)',
      url: official,
    })
    opts.push(
      { id: 'local-8547', label: 'Local 8547', url: 'http://127.0.0.1:8547' },
      { id: 'local-8545', label: 'Local 8545', url: 'http://127.0.0.1:8545' },
      { id: 'custom', label: 'Custom', url: null }
    )
    return opts
  }, [packRpc])

  useEffect(() => {
    const cleanup = watchLocalNode((result) => {
      setLocalNode(result)
    }, 10000)
    return cleanup
  }, [currentRpc])

  const handleRpcSelect = (id: string, url?: string | null) => {
    if (id === 'custom' && !customUrl.trim()) {
      toast.error('Enter a custom RPC URL')
      return
    }
    const selectedUrl = id === 'custom' ? customUrl.trim() : url
    if (!selectedUrl) {
      toast.error('Invalid RPC URL')
      return
    }
    if (!isTrustedRpcUrl(selectedUrl)) {
      toast.error(
        'RPC must be HTTPS on Sonic Labs, your configured DAO node, localhost, or another trusted host'
      )
      return
    }
    try {
      setRpcUrl(selectedUrl)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Invalid RPC URL')
      return
    }
    updateRpcUrl(selectedUrl)
    setCurrentRpc(selectedUrl)
    setIsOpen(false)
    toast.success('RPC updated', { duration: 2000 })
  }

  const isLocalNodeAvailable = (url: string) => localNode.isAvailable && localNode.url === url

  return (
    <div className="relative" style={{ position: 'relative' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="btn-secondary"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 16px',
          fontSize: '14px',
        }}
      >
        <span>RPC</span>
        {currentRpc.startsWith('http://127.0.0.1') && <span style={{ fontSize: '10px' }}>local</span>}
      </button>

      {isOpen && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 40 }}
            onClick={() => setIsOpen(false)}
            aria-hidden
          />
          <div
            style={{
              position: 'absolute',
              right: 0,
              top: 'calc(100% + 8px)',
              width: '320px',
              backgroundColor: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '16px',
              zIndex: 50,
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            }}
          >
            <div style={{ marginBottom: '12px', fontWeight: 600, fontSize: '14px' }}>RPC</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {rpcOptions
                .filter((opt) => opt.id !== 'custom')
                .map((option) => {
                  const isLocal = option.id.startsWith('local-')
                  const isAvailable = isLocal && option.url ? isLocalNodeAvailable(option.url) : true
                  const isSelected = currentRpc === option.url
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => isAvailable && handleRpcSelect(option.id, option.url)}
                      disabled={isLocal && !isAvailable}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '12px',
                        borderRadius: '6px',
                        fontSize: '13px',
                        border: isSelected ? '1px solid var(--color-accent)' : '1px solid transparent',
                        backgroundColor: isSelected ? 'var(--color-accent)/10' : 'transparent',
                        color: isLocal && !isAvailable ? 'var(--color-text-dim)' : 'var(--color-text)',
                        opacity: isLocal && !isAvailable ? 0.6 : 1,
                        cursor: isLocal && !isAvailable ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginBottom: '4px',
                        }}
                      >
                        <span style={{ fontWeight: 500 }}>{option.label}</span>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--color-text-dim)', fontFamily: 'monospace' }}>
                        {option.url}
                      </div>
                    </button>
                  )
                })}
            </div>
            <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--color-border)' }}>
              <div style={{ fontSize: '12px', color: 'var(--color-text-dim)', marginBottom: '8px' }}>Custom</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                  placeholder="https://..."
                  style={{
                    flex: 1,
                    padding: '8px',
                    fontSize: '12px',
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '4px',
                    color: 'var(--color-text)',
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRpcSelect('custom')
                  }}
                />
                <button
                  type="button"
                  onClick={() => handleRpcSelect('custom')}
                  className="btn-primary"
                  style={{ padding: '8px 16px', fontSize: '12px' }}
                >
                  Save
                </button>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--color-text-dim)', marginTop: '8px' }}>
                Trusted custom HTTPS URLs are also suggested when your wallet adds Sonic (same list as the main app RPC
                selector).
              </div>
            </div>
            <div
              style={{
                marginTop: '12px',
                paddingTop: '12px',
                borderTop: '1px solid var(--color-border)',
                fontSize: '11px',
                color: 'var(--color-text-dim)',
              }}
            >
              Active: <span style={{ fontFamily: 'monospace' }}>{currentRpc}</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
