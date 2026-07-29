import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

function isOperationalBuild(env: Record<string, string>): boolean {
  const p = (env.VITE_SECURITY_PROFILE || '').trim().toLowerCase()
  if (p === 'operational') return true
  const f = (env.VITE_OPERATIONAL_PROFILE || '').trim().toLowerCase()
  return f === '1' || f === 'true' || f === 'yes'
}

const CSP_CONNECT_OPERATIONAL_STATIC =
  "'self' blob: data: http://127.0.0.1:8545 http://127.0.0.1:8547 http://127.0.0.1:8080 ws://127.0.0.1:8545 ws://127.0.0.1:8547"

/**
 * Static `connect-src` tokens: Sonic RPCs, explorers, Arweave gateways (see `src/utils/arweaveGateway.ts`),
 * local anvil, blob/data for wasm. Google is omitted — added only when `VITE_ENABLE_THIRD_PARTY_TRANSLATE=1`.
 * User RPC / gateway hosts from `.env` are merged at build via `buildProductionConnectSrc`.
 */
const CSP_CONNECT_STATIC =
  "'self' https://rpc.testnet.soniclabs.com https://rpc.blaze.soniclabs.com https://rpc.soniclabs.com https://rpc.soniclabs.com/mainnet https://testnet.sonicscan.org https://sonicscan.org https://api.odos.xyz https://enterprise-api.odos.xyz https://arweave.net https://ar-io.net https://arweave.live https://gateway.arweave.net https://arweave.dev https://gateway.irys.xyz https://arweave-search.goldsky.com https://arweave.news https://ar-io.dev https://arweave.cache.holaplex.com blob: data: http://127.0.0.1:8545 http://127.0.0.1:8547 ws://127.0.0.1:8545 ws://127.0.0.1:8547"

function splitCommaEnv(value: string | undefined): string[] {
  if (!value || typeof value !== 'string') return []
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Normalize to `https://host:port` or `http://127.0.0.1:port` for CSP `connect-src`. */
function originTokenForCsp(raw: string | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null
  const t = raw.trim()
  if (!t) return null
  let href = t
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(t)) {
    href = `https://${t}`
  }
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
  add(env.VITE_CUSTOM_RPC_URL)
  add(env.VITE_PROVER_URL)
  add(env.VITE_PRIVACY_RELAY_HTTP_URL)
  for (const raw of splitCommaEnv(env.VITE_PRIVACY_RELAY_HTTP_URLS)) add(raw)

  for (const raw of splitCommaEnv(env.VITE_TRUSTED_RPC_HOSTS)) add(raw)
  for (const raw of splitCommaEnv(env.VITE_ARWEAVE_GATEWAYS)) add(raw)
  for (const raw of splitCommaEnv(env.VITE_IPFS_GATEWAYS)) add(raw)
  for (const raw of splitCommaEnv(env.VITE_CSP_EXTRA_CONNECT)) add(raw)

  for (const [key, val] of Object.entries(env)) {
    if (/^VITE_SOVEREIGN_NODE_\d+$/.test(key) && val) add(val)
  }

  return [...origins]
}

function buildProductionConnectSrc(env: Record<string, string>): string {
  const parts = new Set<string>()
  const staticList = isOperationalBuild(env) ? CSP_CONNECT_OPERATIONAL_STATIC : CSP_CONNECT_STATIC
  for (const token of staticList.trim().split(/\s+/)) {
    if (token) parts.add(token)
  }
  for (const o of collectConnectOriginsFromEnv(env)) {
    parts.add(o)
  }
  return [...parts].join(' ')
}

function cspMetaProduction(allowGoogleTranslate: boolean, env: Record<string, string>): string {
  const operational = isOperationalBuild(env)
  const connectSrc = buildProductionConnectSrc(env)
  if (allowGoogleTranslate && !operational) {
    return [
      "default-src 'self'",
      "script-src 'self' https://translate.google.com https://translate.googleapis.com",
      "style-src 'self' 'unsafe-inline' https://translate.googleapis.com https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: https:",
      `connect-src ${connectSrc} https://translate.google.com https://translate.googleapis.com`,
      "frame-src https://translate.google.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      'upgrade-insecure-requests',
    ].join('; ')
  }
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

/** Vite dev server: HMR, eval, arbitrary RPC during local testing. */
function cspMetaDevelopment(): string {
  return [
    "default-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: https: blob:",
    "connect-src 'self' ws: wss: http: https: data: blob:",
    "frame-src 'self' https://translate.google.com",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ')
}

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const allowGoogleTranslate = env.VITE_ENABLE_THIRD_PARTY_TRANSLATE === '1'
  const operational = isOperationalBuild(env)
  const isDevServer = command === 'serve'

  return {
    plugins: [
      react(),
      {
        name: 'aegis-csp-meta',
        enforce: 'pre',
        transformIndexHtml(html) {
          if (!html.includes('__AEGIS_CSP__')) return html
          const csp = isDevServer ? cspMetaDevelopment() : cspMetaProduction(allowGoogleTranslate, env)
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
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      minify: 'esbuild',
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            'ethers-vendor': ['ethers'],
            'ddos-protection': ['./src/utils/ddosProtection'],
            'contracts-core': [
              './src/abis/Token.json',
              './src/abis/Governance.json',
              './src/abis/Staking.json',
              './src/abis/Lending.json',
            ],
            'contracts-defi': [
              './src/abis/AMM.json',
              './src/abis/PublicLiquidityPool.json',
              './src/abis/AegisPublicPoolRouter.json',
              './src/abis/TransparentEscrowOrders.json',
              './src/abis/YieldFarming.json',
              './src/abis/Insurance.json',
            ],
            'contracts-infra': [
              './src/abis/VerifierFactory.json',
              './src/abis/SonicGatewayWrapper.json',
              './src/abis/CrossChainPrivacyBridge.json',
              './src/abis/GovernanceTreasury.json',
            ],
          },
        },
      },
    },
    server: {
      port: 3000,
      open: true,
    },
    publicDir: 'public',
  }
})
