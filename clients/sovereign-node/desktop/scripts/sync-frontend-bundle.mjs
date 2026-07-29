#!/usr/bin/env node
/**
 * Copy built main dApp (frontend/dist) into the desktop bundle.
 * Run from repo root after: cd frontend && npm run build
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(desktopRoot, '..')

function resolveFrontendDist() {
  if (process.env.AEGIS_FRONTEND_DIST) {
    return path.resolve(process.env.AEGIS_FRONTEND_DIST)
  }
  const candidates = [
    path.join(repoRoot, 'web-application', 'dist'),
    path.join(repoRoot, 'frontend', 'dist'),
    path.join(repoRoot, '..', 'frontend', 'dist'),
    path.join(repoRoot, '..', 'aegis-web-application', 'dist'),
    path.join(repoRoot, '..', 'web-application', 'dist'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return candidates[0]
}

const frontendDist = resolveFrontendDist()
const bundleApp = path.join(desktopRoot, 'bundle', 'app')
const circuitsDest = path.join(desktopRoot, '..', 'circuits')

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) {
    console.error('Missing:', src)
    process.exit(1)
  }
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) copyRecursive(from, to)
    else fs.copyFileSync(from, to)
  }
}

if (!fs.existsSync(frontendDist)) {
  console.error(
    'frontend dist not found. Build the dApp first, or set AEGIS_FRONTEND_DIST:\n' +
      '  cd frontend && npm run build\n' +
      '  AEGIS_FRONTEND_DIST=/path/to/dist npm run bundle'
  )
  process.exit(1)
}

console.log('Syncing', frontendDist, '→', bundleApp)
if (fs.existsSync(bundleApp)) fs.rmSync(bundleApp, { recursive: true, force: true })
copyRecursive(frontendDist, bundleApp)

const circuitsSrc = path.join(frontendDist, 'circuits')
if (fs.existsSync(circuitsSrc)) {
  console.log('Syncing circuits →', circuitsDest)
  if (fs.existsSync(circuitsDest)) fs.rmSync(circuitsDest, { recursive: true, force: true })
  copyRecursive(circuitsSrc, circuitsDest)
}

console.log('Bundle ready for Aegis desktop app.')
