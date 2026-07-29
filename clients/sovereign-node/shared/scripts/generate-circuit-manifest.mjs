#!/usr/bin/env node
/**
 * Pin SHA-256 hashes for bundled circuit artifacts (operational profile).
 * Updates shared/config.json or prints JSON for manual merge.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')
const circuitsDir = path.join(repoRoot, 'circuits')
const configPath = path.join(repoRoot, 'shared', 'config.json')
const examplePath = path.join(repoRoot, 'shared', 'config.example.json')

const ARTIFACTS = ['.wasm', '.zkey']

function walk(dir, base = dir) {
  const out = {}
  if (!fs.existsSync(dir)) return out
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, name.name)
    if (name.isDirectory()) Object.assign(out, walk(abs, base))
    else if (ARTIFACTS.some((ext) => name.name.endsWith(ext))) {
      const rel = path.relative(base, abs).split(path.sep).join('/')
      const buf = fs.readFileSync(abs)
      out[rel] = crypto.createHash('sha256').update(buf).digest('hex')
    }
  }
  return out
}

const sha256 = walk(circuitsDir)
const count = Object.keys(sha256).length
if (count === 0) {
  console.error('No circuit artifacts in', circuitsDir)
  console.error('Run: cd sovereign-node-app/desktop && npm run bundle')
  process.exit(1)
}

const target = fs.existsSync(configPath) ? configPath : examplePath
const cfg = JSON.parse(fs.readFileSync(target, 'utf8'))
cfg.circuits ??= {}
cfg.circuits.integrity = { enabled: true, sha256 }
fs.writeFileSync(target, `${JSON.stringify(cfg, null, 2)}\n`)
console.log(`Pinned ${count} circuit hashes → ${target}`)
