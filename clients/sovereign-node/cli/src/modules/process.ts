import { spawn, SpawnOptions } from 'child_process'
import { promises as fs } from 'fs'
import { createWriteStream } from 'fs'
import path from 'path'
import chalk from 'chalk'
import ora from 'ora'

import { pidFile, logsDir, sonicExecutablePath, networkDataDir, ensureDir } from './paths.js'

export async function isProcessRunning(): Promise<boolean> {
  try {
    const contents = await fs.readFile(pidFile, 'utf-8')
    const pid = Number(contents.trim())
    if (Number.isNaN(pid)) return false
    process.kill(pid, 0)
    return true
  } catch (err: any) {
    if (err.code === 'ENOENT' || err.code === 'ESRCH') return false
    if (err.code === 'EPERM') return true
    return false
  }
}

export async function writePidFile(pid: number) {
  await fs.writeFile(pidFile, String(pid), 'utf-8')
}

export async function removePidFile() {
  try {
    await fs.unlink(pidFile)
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err
  }
}

export async function startSonicProcess(params: {
  version: string
  platform: string
  network: string
  rpcPort: number
  wsPort: number
  p2pPort: number
  detach: boolean
}) {
  const { version, platform, network, rpcPort, wsPort, p2pPort, detach } = params
  const binaryPath = sonicExecutablePath(version, platform)

  await fs.access(binaryPath)

  await ensureDir(logsDir)
  const logFile = path.join(logsDir, `sonic-${Date.now()}.log`)
  const logStream = createWriteStream(logFile, { flags: 'a' })

  const dataDir = networkDataDir(network)
  await ensureDir(dataDir)

  const args = [
    `--datadir`,
    dataDir,
    '--http',
    '--http.addr',
    '127.0.0.1',
    '--http.port',
    String(rpcPort),
    '--http.api',
    'eth,net,web3',
    '--ws',
    '--ws.addr',
    '127.0.0.1',
    '--ws.port',
    String(wsPort),
    '--ws.api',
    'eth,net,web3',
    '--port',
    String(p2pPort),
  ]

  const spawnOpts: SpawnOptions = {
    detached: detach,
    stdio: ['ignore', 'pipe', 'pipe'],
  }

  const child = spawn(binaryPath, args, spawnOpts)
  child.stdout?.pipe(logStream, { end: false })
  child.stderr?.pipe(logStream, { end: false })
  child.on('exit', () => {
    logStream.write(`\n[process exited] code=${child.exitCode} signal=${child.killed ? 'killed' : 'none'}\n`)
    logStream.end()
  })
  await writePidFile(child.pid!)

  if (detach) {
    child.unref()
  }

  console.log(chalk.green(`Sonic node started (PID ${child.pid})`))
  console.log(chalk.gray(`Logs: ${logFile}`))
}

export async function stopSonicProcess() {
  try {
    const contents = await fs.readFile(pidFile, 'utf-8')
    const pid = Number(contents.trim())
    if (Number.isNaN(pid)) {
      console.warn('PID file corrupt; removing')
      await removePidFile()
      return
    }
    process.kill(pid, 'SIGTERM')
    const spinner = ora('Waiting for Sonic node to stop').start()
    let attempts = 0
    while (attempts < 50) {
      try {
        process.kill(pid, 0)
        await new Promise((resolve) => setTimeout(resolve, 200))
        attempts += 1
      } catch (_) {
        spinner.succeed('Sonic node stopped')
        await removePidFile()
        return
      }
    }
    spinner.warn('Process did not exit gracefully; sending SIGKILL')
    try {
      process.kill(pid, 'SIGKILL')
    } catch (err) {
      console.error('Failed to SIGKILL process', err)
    }
    await removePidFile()
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      console.log('No running node found')
      return
    }
    throw err
  }
}

