import { useQuery } from '@tanstack/react-query'
import { Contract, formatUnits } from 'ethers'
import type { Provider } from 'ethers'
import { ENV } from '../config'
import { formatToken } from '../utils/format'

const ZERO = '0x0000000000000000000000000000000000000000'

const ERC20_ABI = ['function balanceOf(address) view returns (uint256)']

type PackRow = { tokenSymbol: string; tokenAddress: string; enabled?: boolean }

type DutchMeta = {
  presaleOnly?: boolean
  referenceUsdPerUnit?: Record<string, number>
}

function decimalsForSymbol(sym: string): number {
  const u = sym.toUpperCase()
  if (u.includes('USDC') || u === 'USDT' || u === 'EURC') return 6
  return 18
}

function defaultRefUsd(): Record<string, number> {
  return { S: 0.02, wS: 0.02, USDC: 0.98, USDT: 0.98, EURC: 0.98, WETH: 1000 }
}

async function fetchPackRows(): Promise<{ rows: PackRow[]; refUsd: Record<string, number> }> {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/')
  const res = await fetch(`${base}config/sonic-chain-pack.json`, { cache: 'default' })
  if (!res.ok) return { rows: [], refUsd: defaultRefUsd() }
  const j = (await res.json()) as {
    meta?: { dutchAuctionDisplay?: DutchMeta }
    sonicMainnet?: { bridgeTokens?: PackRow[] }
    sonicTestnet?: { bridgeTokens?: PackRow[] }
  }
  const layer = ENV.chainId === 14601 ? j.sonicTestnet : j.sonicMainnet
  const ref = { ...defaultRefUsd(), ...j.meta?.dutchAuctionDisplay?.referenceUsdPerUnit }
  return { rows: layer?.bridgeTokens ?? [], refUsd: ref }
}

type Props = {
  provider: Provider
  address: string | null
}

/**
 * Lists Sonic pack tokens the wallet holds (balance &gt; 0), plus native S.
 * The auction accepts these tokens via the private ZK pay rails (fixed TGE pegs on-chain).
 */
export default function DutchTgeWalletBalances({ provider, address }: Props) {
  const q = useQuery({
    queryKey: ['td-ecosystem-balances', address, ENV.chainId],
    queryFn: async () => {
      const { rows, refUsd } = await fetchPackRows()
      const erc20Rows = rows.filter(
        (r) =>
          r.enabled !== false &&
          r.tokenSymbol !== 'AGS' &&
          r.tokenAddress &&
          r.tokenAddress.toLowerCase() !== ZERO
      )

      const nativeBal = address ? await provider.getBalance(address) : 0n

      const balances: Array<{
        symbol: string
        balance: bigint
        decimals: number
        usdApprox: number
        sApprox: number
      }> = []

      if (address && nativeBal > 0n) {
        const usd = Number(formatUnits(nativeBal, 18)) * (refUsd.S ?? 0.02)
        balances.push({
          symbol: 'S (native)',
          balance: nativeBal,
          decimals: 18,
          usdApprox: usd,
          sApprox: Number(formatUnits(nativeBal, 18)),
        })
      }

      for (const r of erc20Rows) {
        if (!address) continue
        const c = new Contract(r.tokenAddress, ERC20_ABI, provider)
        const bal = (await c.balanceOf(address)) as bigint
        if (bal === 0n) continue
        const dec = decimalsForSymbol(r.tokenSymbol)
        const units = Number(formatUnits(bal, dec))
        const key = r.tokenSymbol.replace(/\s*\(.*\)\s*/g, '').trim()
        const usdKey = key === 'wS' ? 'wS' : key.toUpperCase() === 'WS' ? 'wS' : key
        const px = refUsd[usdKey] ?? refUsd[key] ?? 0
        const usd = units * px
        const sPx = refUsd.S ?? 0.02
        balances.push({
          symbol: r.tokenSymbol,
          balance: bal,
          decimals: dec,
          usdApprox: usd,
          sApprox: sPx > 0 ? usd / sPx : 0,
        })
      }

      balances.sort((a, b) => a.symbol.localeCompare(b.symbol))
      return { balances, refUsd }
    },
    enabled: !!address && !!provider,
    refetchInterval: 12_000,
  })

  if (!address) {
    return (
      <p className="muted" style={{ marginTop: '8px' }}>
        Connect your wallet to see balances for Sonic pack tokens only.
      </p>
    )
  }

  if (q.isLoading) return <p className="muted">Loading wallet balances…</p>
  if (q.error) return <p className="muted">Could not load chain pack / balances.</p>

  const rows = q.data?.balances ?? []
  if (rows.length === 0) {
    return (
      <p className="muted" style={{ marginTop: '8px' }}>
        No bridged tokens detected yet. Use the <strong>Ethereum ⇌ Sonic bridge</strong> tab, then pay with USDC,
        USDT, EURC, WETH, or wS on <strong>Token sale</strong>.
      </p>
    )
  }

  return (
    <div style={{ marginTop: '12px' }}>
      <h4 style={{ margin: '0 0 8px', fontSize: '0.95rem' }}>Your Sonic pack balances</h4>
      <p className="muted" style={{ fontSize: '0.75rem', marginBottom: '8px' }}>
        Balances on Sonic. Select a token above to buy AGS — bridged USDC, USDT, EURC, and WETH use the same addresses as the bridge tab.
      </p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {rows.map((r) => (
          <li
            key={r.symbol}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '12px',
              fontSize: '0.85rem',
              borderBottom: '1px solid var(--color-border)',
              paddingBottom: '6px',
            }}
          >
            <span>{r.symbol}</span>
            <span style={{ textAlign: 'right' }}>
              <span style={{ fontFamily: 'monospace' }}>{formatToken(r.balance, r.decimals)}</span>
              <span className="muted" style={{ marginLeft: '8px', fontSize: '0.72rem' }}>
                ≈ {r.sApprox.toLocaleString(undefined, { maximumFractionDigits: 4 })} S (ref.)
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
