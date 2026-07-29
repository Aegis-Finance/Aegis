import axios from 'axios'

export interface RpcStatus {
  syncing: boolean
  blockNumber: string | null
  peerCount: number | null
  chainId: string | null
}

export async function rpcHealth(rpcUrl: string): Promise<RpcStatus> {
  async function rpcCall(method: string, params: any[] = []) {
    const response = await axios.post(rpcUrl, {
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    })
    return response.data.result
  }

  const [syncing, blockNumberHex, peerCountHex, chainIdHex] = await Promise.all([
    rpcCall('eth_syncing'),
    rpcCall('eth_blockNumber'),
    rpcCall('net_peerCount'),
    rpcCall('eth_chainId'),
  ])

  return {
    syncing: syncing === false ? false : true,
    blockNumber: blockNumberHex ?? null,
    peerCount: peerCountHex ? parseInt(peerCountHex, 16) : null,
    chainId: chainIdHex ?? null,
  }
}

