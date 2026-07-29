import SonicGatewayBridgePanel from '@/components/SonicGatewayBridgePanel'
import '@/styles/sonicGatewayBridge.css'

export default function Bridge() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-terminal-accent">Sonic Gateway</h1>
        <p className="text-sm text-terminal-text-dim max-w-2xl">
          Move supported tokens from Ethereum to Sonic through the official Gateway. Private bridge will be up soon.
        </p>
      </div>
      <SonicGatewayBridgePanel />
    </div>
  )
}
