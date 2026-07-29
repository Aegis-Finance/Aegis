import { Link } from 'react-router-dom'
import { DEFAULT_NETWORK } from '@/config/contracts'
import { SONIC_GATEWAY_DOCS } from '@/config/sonicInfra'
import { setBridgeSwapIntent } from '@/utils/bridgeSwapIntent'
const btn =
  'inline-flex items-center rounded-md border border-terminal-border bg-terminal-bg-secondary px-3 py-1.5 text-xs font-medium text-terminal-text transition-colors hover:border-terminal-accent'

/**
 * One-line flow: official Gateway → (mainnet) public swap → shield step (form below).
 */
export default function GetAgsFlowRail() {
  const isMainnet = DEFAULT_NETWORK.chainId === 146

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-terminal-border/50 pb-4">
      <a href={SONIC_GATEWAY_DOCS.gatewayApp} target="_blank" rel="noopener noreferrer" className={btn}>
        Gateway
      </a>
      <span className="text-terminal-text-muted">→</span>
      {isMainnet ? (
        <Link
          to="/swap?direction=QUOTE_TO_AGS"
          onClick={() => setBridgeSwapIntent({ direction: 'QUOTE_TO_AGS' })}
          className={btn}
        >
          Swap
        </Link>
      ) : (        <span className={`${btn} cursor-default opacity-60`}>Swap</span>
      )}
      <span className="text-terminal-text-muted">→</span>
      <span className="text-xs font-medium text-terminal-accent">Shield</span>
    </div>
  )
}
