import chalk from 'chalk'

import { resolveLatestEntry } from './manifest.js'
import { loadConfig } from './config.js'
import { installCommand } from './install.js'

interface UpdateOptions {
  network: string
}

export async function updateCommand({ network }: UpdateOptions) {
  const manifestEntry = await resolveLatestEntry(network)
  const config = await loadConfig()

  if (config && config.version === manifestEntry.version) {
    console.log(chalk.green(`Latest version ${manifestEntry.version} already installed.`))
    return
  }

  console.log(chalk.cyan(`Updating to Sonic ${manifestEntry.version} for ${network}`))
  await installCommand({ network, force: true })
  console.log(chalk.green('Update complete. Restart node to apply new version.'))
}

