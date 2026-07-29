#!/usr/bin/env node

import { Command } from 'commander'
import chalk from 'chalk'
import { installCommand } from './modules/install.js'
import { startCommand } from './modules/start.js'
import { stopCommand } from './modules/stop.js'
import { statusCommand } from './modules/status.js'
import { updateCommand } from './modules/update.js'
import { ensureDataDir } from './modules/paths.js'

const program = new Command()

program
  .name('aegis-node')
  .description('Aegis sovereign Sonic node manager')
  .version('0.1.0')
  .option('-n, --network <network>', 'target network (sonic-mainnet|sonic-testnet)', 'sonic-testnet')

program
  .command('install')
  .description('Download and verify the Sonic node binary for this platform')
  .option('--force', 'force re-download even if already installed', false)
  .action(async (opts, cmd) => {
    const network = cmd.parent?.getOptionValue('network') as string
    await ensureDataDir()
    await installCommand({ network, force: opts.force })
  })

program
  .command('start')
  .description('Start the Sonic node with recommended flags')
  .option('--no-detach', 'run in foreground (do not detach)')
  .action(async (opts, cmd) => {
    const network = cmd.parent?.getOptionValue('network') as string
    await ensureDataDir()
    await startCommand({ network, detach: opts.detach !== false })
  })

program
  .command('stop')
  .description('Stop the running Sonic node')
  .action(async () => {
    await stopCommand()
  })

program
  .command('status')
  .description('Show node process and RPC health')
  .option('--json', 'output machine-readable JSON', false)
  .action(async (opts, cmd) => {
    const network = cmd.parent?.getOptionValue('network') as string
    await statusCommand({ network, json: opts.json })
  })

program
  .command('update')
  .description('Check manifest and install newer Sonic binary if available')
  .action(async (cmd) => {
    const network = cmd.parent?.getOptionValue('network') as string
    await updateCommand({ network })
  })

program
  .hook('preAction', () => {
    console.log(chalk.cyan.bold('Aegis Sovereign Node Suite'))
  })

program.parseAsync().catch((err) => {
  console.error(chalk.red(err instanceof Error ? err.message : String(err)))
  process.exitCode = 1
})

