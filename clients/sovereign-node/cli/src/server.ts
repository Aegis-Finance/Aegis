import express from 'express'
import morgan from 'morgan'
import { readFileSync, existsSync } from 'fs'
import { createHash } from 'crypto'
import { resolve, dirname, sep, relative } from 'path'
import serveStatic from 'serve-static'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/** Only standard read / broadcast JSON-RPC methods (no arbitrary proxy). */
const ALLOWED_RPC_METHODS = new Set([
  'eth_chainId',
  'eth_blockNumber',
  'eth_call',
  'eth_estimateGas',
  'eth_gasPrice',
  'eth_getBalance',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_getCode',
  'eth_getLogs',
  'eth_getStorageAt',
  'eth_getTransactionByHash',
  'eth_getTransactionCount',
  'eth_getTransactionReceipt',
  'eth_sendRawTransaction',
  'net_version',
  'web3_clientVersion',
])

const JSON_BODY_LIMIT = '900kb'
const MAX_BATCH = 32

type AppConfig = {
  rpc: { listen: string; port: number; upstreams: string[]; timeoutMs: number }
  circuits: {
    listen: string
    port: number
    root: string
    integrity: { enabled: boolean; sha256: Record<string, string> }
  }
  gateways: { arweave: string[]; ipfs: string[] }
}

function loadConfig(): AppConfig {
  const sharedDir = resolve(__dirname, '../../shared')
  const userCfg = resolve(sharedDir, 'config.json')
  const defaultCfg = resolve(sharedDir, 'config.example.json')
  const path = existsSync(userCfg) ? userCfg : defaultCfg
  return JSON.parse(readFileSync(path, 'utf8'))
}

function validateSingleRpc(
  r: unknown
): { ok: true } | { ok: false; status: number; message: string; id: unknown } {
  if (typeof r !== 'object' || r === null) {
    return { ok: false, status: 400, message: 'Invalid JSON-RPC body', id: null }
  }
  const o = r as Record<string, unknown>
  if (o.jsonrpc !== '2.0') {
    return { ok: false, status: 400, message: 'jsonrpc must be "2.0"', id: o.id ?? null }
  }
  if (typeof o.method !== 'string' || !ALLOWED_RPC_METHODS.has(o.method)) {
    return { ok: false, status: 403, message: `RPC method not allowed: ${String(o.method)}`, id: o.id ?? null }
  }
  return { ok: true }
}

function validateRpcEnvelope(
  body: unknown
): { ok: true } | { ok: false; status: number; message: string; id: unknown } {
  if (body === null || body === undefined) {
    return { ok: false, status: 400, message: 'Empty body', id: null }
  }
  if (Array.isArray(body)) {
    if (body.length === 0) {
      return { ok: false, status: 400, message: 'Empty batch', id: null }
    }
    if (body.length > MAX_BATCH) {
      return { ok: false, status: 400, message: `Batch exceeds ${MAX_BATCH}`, id: null }
    }
    for (const item of body) {
      const v = validateSingleRpc(item)
      if (!v.ok) return v
    }
    return { ok: true }
  }
  return validateSingleRpc(body)
}

function safeCircuitAbs(rootResolved: string, req: express.Request): string | null {
  const pathname = (req.originalUrl || req.url || '').split('?')[0]
  let tail = pathname
  if (tail.startsWith('/circuits/')) tail = tail.slice('/circuits/'.length)
  else if (tail.startsWith('/circuits')) tail = tail.slice('/circuits'.length).replace(/^\//, '')
  else if (tail.startsWith('/')) tail = tail.slice(1)
  const rel = decodeURIComponent(tail || '.').replace(/\\/g, '/')
  if (!rel || rel.includes('\0')) return null
  if (rel.split('/').some((s) => s === '..')) return null
  const abs = resolve(rootResolved, rel)
  const base = resolve(rootResolved)
  const guard = base.endsWith(sep) ? base : base + sep
  if (abs !== base && !abs.startsWith(guard)) return null
  return abs
}

function startRpcProxy(cfg: AppConfig['rpc']) {
  const app = express()
  app.disable('x-powered-by')
  app.use(morgan('tiny'))

  let idx = 0

  app.use((req, res, next) => {
    if (req.method !== 'POST') {
      res.status(405).setHeader('Allow', 'POST').send('Method Not Allowed')
      return
    }
    next()
  })

  app.post('/', express.json({ limit: JSON_BODY_LIMIT }), async (req, res) => {
    const v = validateRpcEnvelope(req.body)
    if (!v.ok) {
      res.status(v.status).json({
        jsonrpc: '2.0',
        id: v.id,
        error: { code: v.status === 403 ? 403 : -32600, message: v.message },
      })
      return
    }

    const target = cfg.upstreams[idx % cfg.upstreams.length]
    idx += 1

    try {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), cfg.timeoutMs)
      const upstream = await fetch(target, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(req.body),
        signal: ac.signal,
      })
      clearTimeout(timer)

      const text = await upstream.text()
      res.status(upstream.status)
      const ct = upstream.headers.get('content-type')
      if (ct && ct.includes('application/json')) {
        res.type('json').send(text)
      } else {
        res.type('json').send(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32603, message: 'Upstream returned non-JSON' },
          })
        )
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upstream error'
      res.status(502).json({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32603, message: msg },
      })
    }
  })

  app.listen(cfg.port, cfg.listen, () => {
    console.log(`RPC proxy (restricted JSON-RPC) on http://${cfg.listen}:${cfg.port}`)
  })
}

function startCircuitServer(cfg: AppConfig['circuits']) {
  const app = express()
  app.disable('x-powered-by')
  app.use(morgan('tiny'))
  const rootResolved = resolve(__dirname, '../../', cfg.root)

  app.use('/circuits', (req, res, next) => {
    const abs = safeCircuitAbs(rootResolved, req)
    if (!abs) {
      res.status(403).end()
      return
    }
    if (cfg.integrity.enabled && (req.method === 'GET' || req.method === 'HEAD')) {
      const relKey = relative(rootResolved, abs).split(sep).join('/')
      const expected = cfg.integrity.sha256[relKey]
      if (expected) {
        try {
          const buf = readFileSync(abs)
          if (createHash('sha256').update(buf).digest('hex') !== expected) {
            res.status(409).send('Integrity mismatch')
            return
          }
        } catch {
          // missing file: let static handler respond
        }
      }
    }
    next()
  })

  app.use(
    '/circuits',
    serveStatic(rootResolved, { fallthrough: false, index: false, dotfiles: 'deny' })
  )

  app.listen(cfg.port, cfg.listen, () => {
    console.log(`Circuits server at http://${cfg.listen}:${cfg.port}/circuits/`)
  })
}

function main() {
  const cfg = loadConfig()
  startRpcProxy(cfg.rpc)
  startCircuitServer(cfg.circuits)
}

main()
