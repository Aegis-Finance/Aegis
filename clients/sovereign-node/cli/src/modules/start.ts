import chalk from 'chalk'

import { loadConfig, saveConfig } from './config.js'
import { resolveLatestEntry } from './manifest.js'
import { installCommand } from './install.js'
import { startSonicProcess, isProcessRunning } from './process.js'

interface StartOptions {
  network: string
  detach: boolean
}

export async function startCommand({ network, detach }: StartOptions) {
  const running = await isProcessRunning()
  if (running) {
    console.log(chalk.yellow('Sonic node is already running'))
    return
  }

  let config = await loadConfig()
  if (!config || config.network !== network) {
    console.log(chalk.gray('No compatible installation found; installing latest binary'))
    await installCommand({ network, force: false })
    config = await loadConfig()
    if (!config) {
      throw new Error('Failed to load config after installation')
    }
  }

  // Ensure manifest still valid; if newer version same network, use config version
  const manifestEntry = await resolveLatestEntry(network)
  if (manifestEntry.version !== config.version) {
    console.log(chalk.gray(`Manifest version ${manifestEntry.version} differs from installed ${config.version}. Run aegis-node update to upgrade.`))
  }

  await startSonicProcess({
    version: config.version,
    platform: config.platform,
    network: config.network,
    rpcPort: config.rpcPort,
    wsPort: config.wsPort,
    p2pPort: config.p2pPort,
    detach,
  })

  if (!detach) {
    console.log(chalk.gray('Running in foreground; press Ctrl+C to stop.'))
  }
}

