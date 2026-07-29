import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

function isOperationalBuild(env: Record<string, string>): boolean {
  const p = (env.VITE_SECURITY_PROFILE || '').trim().toLowerCase()
  if (p === 'operational') return true
  const f = (env.VITE_OPERATIONAL_PROFILE || '').trim().toLowerCase()
  return f === '1' || f === 'true' || f === 'yes'
}

const CSP_CONNECT_CONVENIENCE =
  "'self' https://api.etherscan.io https://rpc.testnet.soniclabs.com https://rpc.soniclabs.com https://rpc.blaze.soniclabs.com https://testnet.sonicscan.org https://sonicscan.org https://arweave.net https://ar-io.net https://arweave.live https://gateway.arweave.net https://arweave.dev https://gateway.irys.xyz blob: data: http://127.0.0.1:8545 http://127.0.0.1:8547 http://127.0.0.1:8080 ws://127.0.0.1:8545 ws://127.0.0.1:8547"

const CSP_CONNECT_OPERATIONAL =
  "'self' blob: data: http://127.0.0.1:8545 http://127.0.0.1:8547 http://127.0.0.1:8080 ws://127.0.0.1:8545 ws://127.0.0.1:8547"

function splitCommaEnv(value: string | undefined): string[] {
  if (!value || typeof value !== 'string') return []
  return value.split(',').map((s) => s.trim()).filter(Boolean)
}

function originTokenForCsp(raw: string | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null
  const t = raw.trim()
  if (!t) return null
  let href = t
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(t)) href = `https://${t}`
  try {
    const u = new URL(href)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    if (u.protocol === 'http:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') return null
    return `${u.protocol}//${u.host}`
  } catch {
    return null
  }
}

function collectConnectOriginsFromEnv(env: Record<string, string>): string[] {
  const origins = new Set<string>()
  const add = (raw: string | undefined) => {
    const o = originTokenForCsp(raw)
    if (o) origins.add(o)
  }
  add(env.VITE_DAO_RPC_URL)
  add(env.VITE_RPC_URL)
  add(env.VITE_PROVER_URL)
  add(env.VITE_LOCAL_MIRROR)
  for (const raw of splitCommaEnv(env.VITE_TRUSTED_RPC_HOSTS)) add(raw)
  if (!isOperationalBuild(env)) {
    for (const raw of splitCommaEnv(env.VITE_ARWEAVE_GATEWAYS)) add(raw)
    for (const raw of splitCommaEnv(env.VITE_IPFS_GATEWAYS)) add(raw)
    for (const raw of splitCommaEnv(env.VITE_CSP_EXTRA_CONNECT)) add(raw)
  }
  return [...origins]
}

function buildConnectSrc(env: Record<string, string>): string {
  const base = isOperationalBuild(env) ? CSP_CONNECT_OPERATIONAL : CSP_CONNECT_CONVENIENCE
  const parts = new Set(base.trim().split(/\s+/))
  for (const o of collectConnectOriginsFromEnv(env)) parts.add(o)
  return [...parts].join(' ')
}

function cspMetaProduction(env: Record<string, string>): string {
  const operational = isOperationalBuild(env)
  const connectSrc = buildConnectSrc(env)
  return [
    "default-src 'self'",
    "script-src 'self'",
    operational
      ? "style-src 'self' 'unsafe-inline'"
      : "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    operational ? "font-src 'self' data:" : "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    `connect-src ${connectSrc}`,
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ')
}

function cspMetaDevelopment(): string {
  return [
    "default-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: https: blob:",
    "connect-src 'self' ws: wss: http: https: data: blob:",
    "frame-src 'none'",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ')
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const operational = isOperationalBuild(env)
  const isDevServer = command === 'serve'

  return {
    base: './',
    plugins: [
      react(),
      {
        name: 'aegis-csp-meta',
        enforce: 'pre',
        transformIndexHtml(html: string) {
          if (!html.includes('__AEGIS_CSP__')) return html
          const csp = isDevServer ? cspMetaDevelopment() : cspMetaProduction(env)
          let out = html.replaceAll('__AEGIS_CSP__', csp)
          if (operational && !isDevServer) {
            out = out
              .replace(/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com"[^>]*>\s*/g, '')
              .replace(/<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com"[^>]*>\s*/g, '')
              .replace(/<link[^>]*fonts\.googleapis\.com[^>]*>\s*/g, '')
          }
          return out
        },
      },
    ],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom'],
            'ethers-vendor': ['ethers'],
            'ddos-protection': ['./src/utils/ddosProtection'],
          },
        },
      },
    },
    server: {
      port: 4175,
      host: true,
    },
    publicDir: 'public',
  }
})
