import { useQuery } from '@tanstack/react-query'
import { useWalletStore } from '@/store/walletStore'
import { Contract } from 'ethers'
import { formatBalance } from '@/utils/format'
import { CONTRACT_ADDRESSES, ZERO_ADDRESS } from '@/config/contracts'
import { Link } from 'react-router-dom'
const LEADERBOARD_ADDRESS = CONTRACT_ADDRESSES.LEADERBOARD
const TREASURY_ALLOCATOR_ADDRESS = CONTRACT_ADDRESSES.TREASURY_LIQUIDITY_ALLOCATOR
const PRIVATE_AMM_ADDRESS = CONTRACT_ADDRESSES.PRIVATE_AMM

export default function Home() {
  const { provider, isConnected, address } = useWalletStore()

  // Fetch leaderboard data
  const { data: leaderboardData } = useQuery({
    queryKey: ['leaderboard', LEADERBOARD_ADDRESS],
    queryFn: async () => {
      if (!provider || LEADERBOARD_ADDRESS === '0x0000000000000000000000000000000000000000') return null
      try {
        const leaderboardABI = [
          'function getCurrentLibertyCycleInfo() view returns (uint256, uint256, uint256)',
          'function getFreeMarketLeaderboard(uint256) view returns (uint256, uint256, uint256, uint256, uint256, uint8, bytes32, uint256)',
          'function getSovereigntyRankings(uint256) view returns (bytes32[])',
          'function getSovereignIndividual(bytes32) view returns (bytes32, string, uint256, uint256, uint256, uint256, uint256, uint256, uint8, bool, bytes32, uint256)',
        ]
        const contract = new Contract(LEADERBOARD_ADDRESS, leaderboardABI, provider)
        
        const cycleInfo = await contract.getCurrentLibertyCycleInfo()

        const currentCycle = Number(cycleInfo[0])
        const leaderboard = await contract.getFreeMarketLeaderboard(currentCycle)
        const rankings = await contract.getSovereigntyRankings(currentCycle)

        // Fetch top 10 sovereigns
        const topSovereigns = await Promise.all(
          rankings.slice(0, 10).map(async (commitment: string) => {
            try {
              const sovereign = await contract.getSovereignIndividual(commitment)
              return {
                commitment,
                alias: sovereign[1],
                score: BigInt(sovereign[2]),
                exchanges: BigInt(sovereign[3]),
                wealth: BigInt(sovereign[4]),
                tier: Number(sovereign[8]),
              }
            } catch {
              return null
            }
          })
        )

        return {
          totalSovereigns: Number(leaderboard[1]),
          prizePool: BigInt(leaderboard[2]),
          peakScore: BigInt(leaderboard[7]),
          topSovereigns: topSovereigns.filter((s): s is NonNullable<typeof s> => s !== null),
        }
      } catch (error) {
        console.error('Error fetching leaderboard:', error)
        return null
      }
    },
    enabled: !!provider,
    refetchInterval: 30000,
  })

  const tierNames = ['Liberty Seeker', 'Market Participant', 'Sound Money Advocate', 'Austrian Scholar', 'Praxeological Master', 'Misesian Sovereign']

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div className="space-y-6 text-center">
        <h1 className="text-4xl md:text-5xl font-bold text-terminal-text leading-tight">
          Privacy rails you can audit,<br />
          <span className="text-terminal-accent">governance without a back door</span>
        </h1>

        {/* Pillars */}
        <div className="grid gap-4 md:grid-cols-3 text-left mt-8">
          <div className="card bg-terminal-surface/70 border-terminal-border/60">
            <h3 className="text-base font-semibold text-terminal-text mb-2">Verifiable</h3>
            <p className="text-sm text-terminal-text-dim leading-relaxed">
              Trades, votes, and shielded transfers settle on-chain. Zero-knowledge proofs let you prove what you need
              without broadcasting your balances to the world.
            </p>
          </div>
          <div className="card bg-terminal-surface/70 border-terminal-border/60">
            <h3 className="text-base font-semibold text-terminal-text mb-2">Governance on-chain</h3>
            <p className="text-sm text-terminal-text-dim leading-relaxed">
              Protocol changes run through community votes and timelocks. Holders set the rules—there is no secret
              admin switch in this app.
            </p>
          </div>
          <div className="card bg-terminal-surface/70 border-terminal-border/60">
            <h3 className="text-base font-semibold text-terminal-text mb-2">Sonic &amp; Ethereum</h3>
            <p className="text-sm text-terminal-text-dim leading-relaxed">
              Day-to-day activity runs on <strong className="text-terminal-text">Sonic</strong> for fast, low-cost
              settlement. Use the bridge when you want to move assets between Sonic and{' '}
              <strong className="text-terminal-text">Ethereum</strong>.
            </p>
          </div>
        </div>

        {/* Quick start — only modules wired in this build */}
        <div className="flex flex-wrap justify-center gap-3 mt-8">
          <Link to="/wallet" className="btn-primary px-8 py-3 text-base">
            Wallet
          </Link>
          <Link to="/swap" className="btn-secondary px-6 py-3 text-base">
            Trade
          </Link>
          <Link to="/governance" className="btn-secondary px-6 py-3 text-base">
            Governance
          </Link>
          <Link to="/staking" className="btn-secondary px-6 py-3 text-base">
            Staking
          </Link>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {[{
          title: 'Max Supply',
          value: '21M',
          subtitle: 'AGS tokens',
        }, {
          title: 'Execution',
          value: '100%',
          subtitle: 'On-chain',
        }, {
          title: 'Privacy',
          value: 'ZK',
          subtitle: 'Per deployed flow',
        }].map((stat) => (
          <div key={stat.title} className="card text-center bg-terminal-surface/60 border-terminal-border/60">
            <p className="text-xs uppercase tracking-[0.2em] text-terminal-text-dim mb-2 font-medium">{stat.title}</p>
            <div className="text-2xl font-bold text-terminal-accent mb-1">{stat.value}</div>
            <div className="text-sm text-terminal-text-dim">{stat.subtitle}</div>
          </div>
        ))}
      </div>

      {/* Liquidity Section */}
      <div className="card border-terminal-border/60 bg-terminal-surface/60">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="space-y-3">
            <h2 className="text-2xl font-bold text-terminal-accent">Liquidity Pools</h2>
            <p className="text-terminal-text-dim max-w-2xl leading-relaxed">
              Public pools and treasury plumbing are on-chain like everything else. Inspect pool and allocator contracts
              before depositing size.
            </p>
          </div>
          <div className="bg-terminal-surface border border-terminal-border/40 rounded-lg px-5 py-4 font-mono text-xs text-terminal-text-dim space-y-2 min-w-[280px]">
            <div>
              <div className="text-terminal-text mb-1 font-semibold">Allocator</div>
              <div className="text-sm">
                {TREASURY_ALLOCATOR_ADDRESS !== ZERO_ADDRESS
                  ? `${TREASURY_ALLOCATOR_ADDRESS.slice(0, 10)}...${TREASURY_ALLOCATOR_ADDRESS.slice(-8)}`
                  : 'Not deployed'}
              </div>
            </div>
            <div>
              <div className="text-terminal-text mb-1 font-semibold">Private AMM</div>
              <div className="text-sm">
                {PRIVATE_AMM_ADDRESS !== ZERO_ADDRESS
                  ? `${PRIVATE_AMM_ADDRESS.slice(0, 10)}...${PRIVATE_AMM_ADDRESS.slice(-8)}`
                  : 'Not deployed'}
              </div>
            </div>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/liquidity" className="btn-secondary">
            Add / remove liquidity
          </Link>
          <Link to="/treasury-incentives" className="btn-secondary">
            Treasury bonds &amp; LP gauge
          </Link>
          <Link to="/swap" className="btn-secondary">
            View Pools
          </Link>
        </div>
      </div>

      {/* Privacy Leaderboard Section */}
      {LEADERBOARD_ADDRESS !== ZERO_ADDRESS && (
        <div className="card">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold text-terminal-accent mb-2">
                Privacy Leaderboard
              </h2>
              <p className="text-terminal-text-dim">
                On-chain rankings from the leaderboard contract (commitment-based aliases).
              </p>
            </div>
          </div>

          {leaderboardData ? (
            <div className="space-y-4">
              {/* Stats */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="card bg-terminal-surface">
                  <div className="text-sm text-terminal-text-dim mb-1">Total</div>
                  <div className="text-xl font-bold text-terminal-accent">
                    {leaderboardData.totalSovereigns}
                  </div>
                </div>
                <div className="card bg-terminal-surface">
                  <div className="text-sm text-terminal-text-dim mb-1">Prize Pool</div>
                  <div className="text-xl font-bold text-terminal-accent">
                    {formatBalance(leaderboardData.prizePool)} AGS
                  </div>
                </div>
                <div className="card bg-terminal-surface">
                  <div className="text-sm text-terminal-text-dim mb-1">Top Score</div>
                  <div className="text-xl font-bold text-terminal-accent">
                    {formatBalance(leaderboardData.peakScore)}
                  </div>
                </div>
              </div>

              {/* Top Rankings */}
              {leaderboardData.topSovereigns.length > 0 ? (
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold text-terminal-text mb-4">Top Participants</h3>
                  <div className="space-y-2">
                    {leaderboardData.topSovereigns.map((sovereign, index) => (
                      <div
                        key={sovereign.commitment}
                        className="flex items-center justify-between p-4 rounded-lg border border-terminal-border/30 hover:border-terminal-accent/50 transition-colors bg-terminal-surface/50"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-full bg-terminal-accent/20 flex items-center justify-center font-bold text-terminal-accent text-sm">
                            {index + 1}
                          </div>
                          <div>
                            <div className="font-semibold text-terminal-text">
                              {sovereign.alias || `${sovereign.commitment.slice(0, 8)}...`}
                            </div>
                            <div className="text-sm text-terminal-text-dim">
                              {tierNames[sovereign.tier] || 'Participant'}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold text-terminal-accent">
                            {formatBalance(sovereign.score)} pts
                          </div>
                          <div className="text-sm text-terminal-text-dim">
                            {formatBalance(sovereign.exchanges)} exchanges
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-terminal-text-dim">
                  No participants yet. Be the first!
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-terminal-text-dim">
              Loading leaderboard data...
            </div>
          )}
        </div>
      )}

      {/* Connection Status */}
      {!isConnected && (
        <div className="card bg-terminal-surface/80 border-terminal-border/60 text-center">
          <p className="text-terminal-text-dim leading-relaxed">
            Connect a Sonic-compatible wallet to sign transactions. That does <strong className="text-terminal-text">not</strong> by itself
            run a blockchain node—it only gives the dApp an address and uses the wallet&apos;s chosen RPC for writes.
          </p>
        </div>
      )}

      {isConnected && address && (
        <div className="card bg-terminal-accent/10 border-terminal-accent/30 text-center">
          <p className="text-terminal-accent font-medium">
            Connected: {address.slice(0, 6)}...{address.slice(-4)}
          </p>
          <p className="text-xs text-terminal-text-dim mt-2">
            Wallet ready. For reads, pick RPC in the header; for sovereignty, run local Sonic JSON-RPC.
          </p>
        </div>
      )}
    </div>
  )
}
