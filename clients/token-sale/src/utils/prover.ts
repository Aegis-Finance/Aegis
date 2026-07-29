import { groth16 } from 'snarkjs'
import { parseList, buildGatewayUrls, pickFirstReachable } from './gateways'
import { isOperationalProfile, OPERATIONAL_CIRCUITS_ORIGIN } from './operationalProfile'

async function resolveFromManifest(pathsKey: string, arweaveGateways: string[], ipfsGateways: string[]): Promise<string | null> {
  try {
    const res = await fetch('dist-manifest.json', { method: 'GET' })
    if (!res.ok) return null
    const manifest = await res.json()
    const txid = manifest?.paths?.[pathsKey]?.id
    if (typeof txid === 'string' && txid.length > 0) {
      const candidates = [
        ...buildGatewayUrls(txid, arweaveGateways, ''),
        ...buildGatewayUrls(txid, ipfsGateways, ''),
      ]
      return pickFirstReachable(candidates)
    }
  } catch {}
  return null
}

async function resolveCircuitUrl(primary: string | undefined, fallbackTxId: string | undefined, pathSuffix = ''): Promise<string> {
  const local = primary || ''
  if (local.startsWith('http')) return local

  const localMirror = (import.meta.env.VITE_LOCAL_MIRROR as string | undefined) || ''
  const candidates: string[] = []

  if (isOperationalProfile()) {
    if (localMirror) {
      candidates.push(`${localMirror.replace(/\/+$/, '')}${pathSuffix}`)
    }
    if (primary && !primary.startsWith('http')) {
      candidates.unshift(primary)
      candidates.push(`${OPERATIONAL_CIRCUITS_ORIGIN}/circuits/${primary.replace(/^\/+/, '')}`)
    }
    const reachable = await pickFirstReachable(candidates)
    if (reachable) return reachable
    throw new Error('Operational build: circuit artifact not available on local mirror (run Aegis app)')
  }

  const arweaveGateways = parseList(import.meta.env.VITE_ARWEAVE_GATEWAYS as string | undefined) || [
    'https://arweave.net',
    'https://arweave.dev',
    'https://gateway.irys.xyz',
  ]
  const ipfsGateways = parseList(import.meta.env.VITE_IPFS_GATEWAYS as string | undefined) || [
    'https://ipfs.io/ipfs',
    'https://cloudflare-ipfs.com/ipfs',
  ]

  if (localMirror) {
    candidates.push(`${localMirror.replace(/\/+$/,'')}${pathSuffix}`)
  }

  if (fallbackTxId) {
    candidates.push(...buildGatewayUrls(fallbackTxId, arweaveGateways, pathSuffix))
    candidates.push(...buildGatewayUrls(fallbackTxId, ipfsGateways, pathSuffix))
  }

  if (primary && !primary.startsWith('http')) {
    // Treat as relative path under /public
    candidates.unshift(primary)
  } else if (primary) {
    candidates.unshift(primary)
  }

  // Final fallback: look for local relative circuits folder
  if (candidates.length === 0 && pathSuffix) {
    const relative = `circuits${pathSuffix}`
    candidates.push(relative)
  }

  // Try dist-manifest.json mapping (granular deploy captures txids)
  if (candidates.length === 0 && pathSuffix) {
    const key = `circuits${pathSuffix}`
    const viaManifest = await resolveFromManifest(key.replace(/^\//,''), arweaveGateways, ipfsGateways)
    if (viaManifest) candidates.push(viaManifest)
  }

  return pickFirstReachable(candidates)
}

function hexToBigIntArray(hex: string): bigint[] {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (clean.length !== 64 * 8) {
    throw new Error('Invalid proof length')
  }
  const arr: bigint[] = []
  for (let i = 0; i < 8; i++) {
    const chunk = '0x' + clean.slice(i * 64, (i + 1) * 64)
    arr.push(BigInt(chunk))
  }
  return arr
}

export async function proveAuction(input: any): Promise<{ proof: bigint[]; publicSignals: string[] }> {
  // Use multi-gateway fallback for circuit artifacts
  const wasm = await resolveCircuitUrl(
    import.meta.env.VITE_AUCTION_CIRCUIT_WASM as string | undefined,
    import.meta.env.VITE_AUCTION_CIRCUIT_WASM_TXID as string | undefined,
    '/auction/auction.wasm'
  )
  const zkey = await resolveCircuitUrl(
    import.meta.env.VITE_AUCTION_CIRCUIT_ZKEY as string | undefined,
    import.meta.env.VITE_AUCTION_CIRCUIT_ZKEY_TXID as string | undefined,
    '/auction/auction_final.zkey'
  )

  const { proof, publicSignals } = await groth16.fullProve(input, wasm, zkey)
  const solidityCalldata: string = await groth16.exportSolidityCallData(proof, publicSignals)
  const parts = solidityCalldata.replace(/\s+/g, '').split('],[')
  const proofHex = parts[0].replace('[', '').replace(']', '').replace(/"/g, '')
  const arr = hexToBigIntArray(proofHex)
  return { proof: arr, publicSignals }
}

export async function proveAuctionClaim(input: any): Promise<{ proof: bigint[]; publicInputs: bigint[] }> {
  // Use multi-gateway fallback for circuit artifacts
  const wasm = await resolveCircuitUrl(
    import.meta.env.VITE_AUCTION_CLAIM_WASM as string | undefined,
    import.meta.env.VITE_AUCTION_CLAIM_WASM_TXID as string | undefined,
    '/auction-claim/claim.wasm'
  )
  const zkey = await resolveCircuitUrl(
    import.meta.env.VITE_AUCTION_CLAIM_ZKEY as string | undefined,
    import.meta.env.VITE_AUCTION_CLAIM_ZKEY_TXID as string | undefined,
    '/auction-claim/claim_final.zkey'
  )

  const { proof, publicSignals } = await groth16.fullProve(input, wasm, zkey)
  const solidityCalldata: string = await groth16.exportSolidityCallData(proof, publicSignals)
  const parts = solidityCalldata.replace(/\s+/g, '').split('],[')
  const proofHex = parts[0].replace('[', '').replace(']', '').replace(/"/g, '')
  const inputsHex = parts[1].replace(']', '').replace('[', '').replace(/"/g, '')
  const proofArr = hexToBigIntArray(proofHex)
  const inputsArr = inputsHex.split(',').filter(Boolean).map((x) => BigInt(x))
  return { proof: proofArr, publicInputs: inputsArr }
}


