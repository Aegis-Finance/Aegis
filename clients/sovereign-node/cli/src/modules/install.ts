import chalk from 'chalk'
import ora from 'ora'

import { resolveLatestEntry } from './manifest.js'
import { downloadAndExtract } from './downloader.js'
import { getBinaryPath, ensureDir, sonicExecutablePath } from './paths.js'
import { promises as fs } from 'fs'
import { saveConfig } from './config.js'

interface InstallOptions {
  network: string
  force?: boolean
}

export async function installCommand({ network, force = false }: InstallOptions) {
  const spinner = ora('Resolving manifest entry').start()
  const entry = await resolveLatestEntry(network)
  spinner.succeed(`Found Sonic ${entry.version} (${entry.platform})`)

  const installPath = getBinaryPath(entry.version, entry.platform)
  await ensureDir(installPath)

  if (!force) {
    try {
      await fs.access(sonicExecutablePath(entry.version, entry.platform))
      console.log(chalk.green(`Sonic ${entry.version} already installed at ${installPath}`))
      await saveConfig({
        network,
        version: entry.version,
        platform: entry.platform,
        rpcPort: 8545,
        wsPort: 8546,
        p2pPort: 30303,
      })
      return
    } catch (_) {
      // fallthrough to download
    }
  }

  await downloadAndExtract({
    url: entry.url,
    sha256: entry.sha256,
    destination: installPath,
    version: entry.version,
    platform: entry.platform,
  })

  await saveConfig({
    network,
    version: entry.version,
    platform: entry.platform,
    rpcPort: 8545,
    wsPort: 8546,
    p2pPort: 30303,
  })

  console.log(chalk.green(`Sonic ${entry.version} ready for network ${network}`))
  if (entry.notes) {
    console.log(chalk.gray(entry.notes))
  }
}

