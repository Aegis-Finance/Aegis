import os from 'os'
import path from 'path'
import { promises as fs } from 'fs'

export const APP_NAME = 'aegis-sonic-node'

export const dataDir = path.join(os.homedir(), '.aegis', 'sonic-node')
export const binariesDir = path.join(dataDir, 'binaries')
export const logsDir = path.join(dataDir, 'logs')
export const runDir = path.join(dataDir, 'run')
export const chainDataDir = path.join(dataDir, 'chains')

export const pidFile = path.join(runDir, 'sonic.pid')
export const configFile = path.join(dataDir, 'node-config.json')

export async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true })
}

export async function ensureDataDir() {
  await Promise.all([ensureDir(dataDir), ensureDir(binariesDir), ensureDir(logsDir), ensureDir(runDir), ensureDir(chainDataDir)])
}

export function networkDataDir(network: string) {
  return path.join(chainDataDir, network)
}

export function getBinaryPath(version: string, platform: string) {
  return path.join(binariesDir, version, platform)
}

export function sonicExecutableName() {
  if (process.platform === 'win32') {
    return 'sonicd.exe'
  }
  return 'sonicd'
}

export function sonicExecutablePath(version: string, platform: string) {
  return path.join(getBinaryPath(version, platform), sonicExecutableName())
}

