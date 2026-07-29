import chalk from 'chalk'

import { isProcessRunning, stopSonicProcess } from './process.js'

export async function stopCommand() {
  const running = await isProcessRunning()
  if (!running) {
    console.log(chalk.yellow('No running Sonic node detected'))
    return
  }
  await stopSonicProcess()
}

