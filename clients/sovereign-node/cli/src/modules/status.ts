import chalk from 'chalk'

import { loadConfig } from './config.js'
import { isProcessRunning } from './process.js'
import { rpcHealth } from './rpc.js'

interface StatusOptions {
  network: string
  json?: boolean
}

export async function statusCommand({ network, json = false }: StatusOptions) {
  const config = await loadConfig()
  const running = await isProcessRunning()
  let rpcStatus = null
  if (config) {
    try {
      rpcStatus = await rpcHealth(`http://127.0.0.1:${config.rpcPort}`)
    } catch (err) {
      rpcStatus = null
    }
  }

  if (json) {
    console.log(
      JSON.stringify(
        {
          running,
          config,
          rpcStatus,
          network,
        },
        null,
        2,
      ),
    )
    return
  }

  if (!config) {
    console.log(chalk.yellow('Sonic node not installed yet. Run `aegis-node install`.'))
    return
  }

  console.log(chalk.cyan(`Network: ${config.network}`))
  console.log(chalk.cyan(`Version: ${config.version} (${config.platform})`))
  console.log(chalk.cyan(`RPC: http://127.0.0.1:${config.rpcPort}`))
  console.log(chalk.cyan(`P2P Port: ${config.p2pPort}`))

  if (running) {
    console.log(chalk.green('Process: running'))
  } else {
    console.log(chalk.yellow('Process: not running'))
  }

  if (rpcStatus) {
    console.log(
      chalk.gray(
        `RPC status → chainId: ${rpcStatus.chainId}, block: ${rpcStatus.blockNumber}, peers: ${rpcStatus.peerCount}, syncing: ${rpcStatus.syncing}`,
      ),
    )
  } else {
    console.log(chalk.gray('RPC status unavailable (node offline or RPC not yet responsive)'))
  }
}

