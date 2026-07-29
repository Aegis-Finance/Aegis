import { promises as fs } from 'fs'
import { configFile, ensureDir, dataDir } from './paths.js'

export interface NodeConfig {
  network: string
  version: string
  platform: string
  rpcPort: number
  wsPort: number
  p2pPort: number
}

export async function loadConfig(): Promise<NodeConfig | null> {
  try {
    const raw = await fs.readFile(configFile, 'utf-8')
    return JSON.parse(raw) as NodeConfig
  } catch (err: any) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

export async function saveConfig(config: NodeConfig) {
  await ensureDir(dataDir)
  await fs.writeFile(configFile, JSON.stringify(config, null, 2), 'utf-8')
}

