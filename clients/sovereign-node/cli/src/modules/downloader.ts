import { createWriteStream } from 'fs'
import { promises as fs } from 'fs'
import path from 'path'
import crypto from 'crypto'
import axios from 'axios'
import tar from 'tar'
import ora from 'ora'
import chalk from 'chalk'

import { ensureDir, sonicExecutablePath } from './paths.js'

export interface DownloadOptions {
  url: string
  sha256: string
  destination: string
  version: string
  platform: string
}

async function ensureChecksum(filePath: string, expected: string) {
  const hash = crypto.createHash('sha256')
  const fileBuffer = await fs.readFile(filePath)
  hash.update(fileBuffer)
  const digest = hash.digest('hex')
  if (digest !== expected) {
    throw new Error(`Checksum mismatch: expected ${expected}, got ${digest}`)
  }
}

export async function downloadAndExtract({ url, sha256, destination, version, platform }: DownloadOptions) {
  await ensureDir(destination)
  // remove existing files in destination
  const existing = await fs.readdir(destination)
  await Promise.all(existing.map((file) => fs.rm(path.join(destination, file), { recursive: true, force: true })))
  const spinner = ora(`Downloading Sonic binary from ${url}`).start()

  const tmpFile = path.join(destination, 'download.tmp')
  const response = await axios.get(url, { responseType: 'stream' })
  const writer = createWriteStream(tmpFile)

  const total = Number(response.headers['content-length']) || 0
  let downloaded = 0

  response.data.on('data', (chunk: Buffer) => {
    downloaded += chunk.length
    if (total) {
      const pct = ((downloaded / total) * 100).toFixed(2)
      spinner.text = `Downloading Sonic binary... ${pct}%`
    }
  })

  await new Promise<void>((resolve, reject) => {
    writer.on('finish', resolve)
    writer.on('error', reject)
    response.data.pipe(writer)
  })

  spinner.text = 'Verifying checksum'
  await ensureChecksum(tmpFile, sha256)

  spinner.text = 'Extracting archive'
  await tar.x({ file: tmpFile, cwd: destination, strip: 1 })

  await fs.unlink(tmpFile)
  try {
    const execPath = sonicExecutablePath(version, platform)
    await fs.access(execPath)
    await fs.chmod(execPath, 0o755)
  } catch (_) {
    // ignore if binary not present (e.g., Windows handles permissions differently)
  }

  spinner.succeed(chalk.green('Sonic binary ready'))
}

