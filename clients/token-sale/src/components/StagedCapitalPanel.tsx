import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Contract, ethers, getAddress, ZeroAddress } from 'ethers'
import toast from 'react-hot-toast'

import { ENV } from '../config'
import { useWalletStore } from '../store/walletStore'
import { formatAddress } from '../utils/format'
import { getPublicProvider, getStagedCapitalVaultAt } from '../utils/contracts'
import { isValidAddress } from '../utils/security'
import { stagedCapitalInvestorLeaf } from '../utils/stagedCapitalMerkle'
import { stagedCapitalTypedDomain, STAGED_CAPITAL_EIP712_TYPES } from '../utils/stagedCapitalEip712'
import { waitAndParseTransaction } from '../utils/transactionHelper'

const ROUND_STATUS = ['Funding', 'Failed', 'Active', 'Completed'] as const

const ERC20_MIN = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
] as const

type RoundView = {
  founder: string
  token: string
  hardCap: bigint
  minRaise: bigint
  startTime: bigint
  endTime: bigint
  totalRaised: bigint
  status: number
  milestoneCount: number
  committeeThreshold: number
  nextMilestone: number
  releaseBps: readonly bigint[]
  investorMerkleRoot: string
}

function parseRound(raw: unknown): RoundView {
  const r = raw as Record<string, unknown>
  const bpsRaw = r.releaseBps
  const releaseBps = Array.isArray(bpsRaw)
    ? (bpsRaw as unknown[]).map((x) => BigInt(String(x)))
    : []
  return {
    founder: String(r.founder),
    token: String(r.token),
    hardCap: BigInt(String(r.hardCap)),
    minRaise: BigInt(String(r.minRaise)),
    startTime: BigInt(String(r.startTime)),
    endTime: BigInt(String(r.endTime)),
    totalRaised: BigInt(String(r.totalRaised)),
    status: Number(r.status),
    milestoneCount: Number(r.milestoneCount),
    committeeThreshold: Number(r.committeeThreshold),
    nextMilestone: Number(r.nextMilestone),
    releaseBps,
    investorMerkleRoot: String(r.investorMerkleRoot ?? ethers.ZeroHash),
  }
}

/** Read `?vault=` from the URL; updates on navigation (e.g. back/forward). */
function useVaultQueryParam(): string {
  const [search, setSearch] = useState(() =>
    typeof window !== 'undefined' ? window.location.search : ''
  )
  useEffect(() => {
    const onPop = () => setSearch(window.location.search)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  return useMemo(() => new URLSearchParams(search).get('vault')?.trim() ?? '', [search])
}

export default function StagedCapitalPanel() {
  const { provider, signer, address, chainId, isConnected } = useWalletStore()
  const [roundIdStr, setRoundIdStr] = useState('1')
  const [depositAmount, setDepositAmount] = useState('')
  const [stealthTagHex, setStealthTagHex] = useState('')
  const [evidenceHex, setEvidenceHex] = useState('')
  const [committeeSigs, setCommitteeSigs] = useState<{ signer: string; signature: string }[]>([])
  const [merkleProofJson, setMerkleProofJson] = useState('[]')

  const vaultParam = useVaultQueryParam()
  const vaultQueryInvalid = Boolean(vaultParam && !isValidAddress(vaultParam))

  const readProvider = provider ?? getPublicProvider()

  const effectiveVaultAddr = useMemo(() => {
    if (vaultParam) {
      if (!isValidAddress(vaultParam)) return null
      return getAddress(vaultParam)
    }
    const d = ENV.stagedCapitalVaultAddress
    if (!d || d === ZeroAddress || !isValidAddress(d)) return null
    return getAddress(d)
  }, [vaultParam])

  const vaultRead = useMemo(
    () => (effectiveVaultAddr ? getStagedCapitalVaultAt(effectiveVaultAddr, readProvider) : null),
    [effectiveVaultAddr, readProvider]
  )

  const effectiveChainId = chainId ?? ENV.chainId

  const roundId = useMemo(() => {
    try {
      return BigInt(roundIdStr.trim() || '0')
    } catch {
      return 0n
    }
  }, [roundIdStr])

  const { data: roundData, refetch: refetchRound } = useQuery({
    queryKey: ['staged-capital-round', effectiveVaultAddr, roundIdStr, address, ENV.rpcUrl],
    enabled: Boolean(vaultRead && roundId > 0n),
    queryFn: async () => {
      if (!vaultRead || roundId === 0n) return null
      const raw = await vaultRead.getRound(roundId)
      const committee: string[] = await vaultRead.getCommittee(roundId)
      const payouts: bigint[] = []
      const rv = parseRound(raw)
      for (let i = 0; i < rv.milestoneCount; i++) {
        const p: bigint = await vaultRead.milestonePayout(roundId, i)
        payouts.push(p)
      }
      const dep =
        address && roundId > 0n ? ((await vaultRead.deposits(roundId, address)) as bigint) : 0n
      let tokenSymbol = 'TOKEN'
      let tokenDecimals = 18
      try {
        const t = new Contract(rv.token, ERC20_MIN, readProvider)
        tokenSymbol = await t.symbol()
        const d = Number(await t.decimals())
        if (Number.isFinite(d) && d >= 0 && d <= 36) tokenDecimals = d
      } catch {
        /* ignore */
      }
      let investorLeafPreview: string | null = null
      if (address) {
        investorLeafPreview = stagedCapitalInvestorLeaf(address)
        try {
          const onChain = (await vaultRead.computeInvestorLeaf(address)) as string
          if (onChain.toLowerCase() !== investorLeafPreview.toLowerCase()) {
            console.warn('stagedCapital leaf mismatch JS vs chain', { investorLeafPreview, onChain })
          }
        } catch {
          /* ignore */
        }
      }
      return { round: rv, committee, payouts, myDeposit: dep, tokenSymbol, tokenDecimals, investorLeafPreview }
    },
  })

  const signAttestation = async () => {
    if (!effectiveVaultAddr || !vaultRead || !signer || roundId === 0n) {
      toast.error('Connect a committee wallet and set a valid round id.')
      return
    }
    if (roundData?.round.status !== 2) {
      toast.error('Round must be Active (finalize after min raise) before committee attestations.')
      return
    }
    const addr = await signer.getAddress()
    const committee = roundData?.committee ?? []
    if (!committee.some((c) => c.toLowerCase() === addr.toLowerCase())) {
      toast.error('Connected wallet is not on this round’s committee.')
      return
    }
    let evidence: string
    try {
      evidence = ethers.isHexString(evidenceHex.trim(), 32)
        ? evidenceHex.trim()
        : ethers.keccak256(ethers.toUtf8Bytes(evidenceHex.trim() || 'milestone'))
    } catch {
      toast.error('Evidence must be 32-byte hex or text (hashed).')
      return
    }
    if (committeeSigs.some((s) => s.signer.toLowerCase() === addr.toLowerCase())) {
      toast.error('You already added a signature for this wallet.')
      return
    }
    try {
      const domain = stagedCapitalTypedDomain(effectiveVaultAddr, effectiveChainId)
      const sig = await signer.signTypedData(domain, STAGED_CAPITAL_EIP712_TYPES, {
        roundId,
        milestoneIndex: BigInt(roundData?.round.nextMilestone ?? 0),
        evidenceHash: evidence,
      })
      setCommitteeSigs((prev) => [...prev, { signer: addr, signature: sig }])
      toast.success('Attestation signature recorded locally — submit when you have enough committee sigs.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Signing failed')
    }
  }

  const submitAttestation = async () => {
    if (!vaultRead || !signer || roundId === 0n) return
    if (roundData?.round.status !== 2) {
      toast.error('Round must be Active.')
      return
    }
    const v = effectiveVaultAddr ? getStagedCapitalVaultAt(effectiveVaultAddr, signer) : null
    if (!v) return
    const thr = roundData?.round.committeeThreshold ?? 0
    if (committeeSigs.length < thr) {
      toast.error(`Need at least ${thr} committee signatures (have ${committeeSigs.length}).`)
      return
    }
    let evidence: string
    try {
      evidence = ethers.isHexString(evidenceHex.trim(), 32)
        ? evidenceHex.trim()
        : ethers.keccak256(ethers.toUtf8Bytes(evidenceHex.trim() || 'milestone'))
    } catch {
      toast.error('Invalid evidence hash.')
      return
    }
    const idx = roundData?.round.nextMilestone ?? 0
    const signers = committeeSigs.map((s) => s.signer)
    const signatures = committeeSigs.map((s) => s.signature)
    try {
      const tx = await v.attestMilestone(roundId, idx, evidence, signers, signatures)
      const user = await signer.getAddress()
      await waitAndParseTransaction(tx, user, provider ?? readProvider)
      toast.success('Milestone attested on-chain.')
      setCommitteeSigs([])
      await refetchRound()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Attestation failed')
    }
  }

  const deposit = async () => {
    if (!signer || !roundData || roundId === 0n) return
    const v = effectiveVaultAddr ? getStagedCapitalVaultAt(effectiveVaultAddr, signer) : null
    if (!v) return
    let amount: bigint
    try {
      amount = ethers.parseUnits(depositAmount.trim() || '0', roundData.tokenDecimals)
    } catch {
      toast.error(`Invalid amount (token uses ${roundData.tokenDecimals} decimals).`)
      return
    }
    if (amount <= 0n) {
      toast.error('Amount must be positive.')
      return
    }
    const token = new Contract(roundData.round.token, ERC20_MIN, signer)
    const user = await signer.getAddress()
    try {
      const allowance: bigint = await token.allowance(user, effectiveVaultAddr!)
      if (allowance < amount) {
        const txA = await token.approve(effectiveVaultAddr!, ethers.MaxUint256)
        await waitAndParseTransaction(txA, user, provider ?? readProvider)
      }
      let tag = ethers.ZeroHash
      if (stealthTagHex.trim()) {
        tag = ethers.isHexString(stealthTagHex.trim(), 32)
          ? stealthTagHex.trim()
          : ethers.keccak256(ethers.toUtf8Bytes(stealthTagHex.trim()))
      }
      const root = roundData.round.investorMerkleRoot
      const hasAllowlist =
        root &&
        root !== ethers.ZeroHash &&
        root.toLowerCase() !== '0x0000000000000000000000000000000000000000000000000000000000000000'
      let merkleProof: string[] = []
      if (hasAllowlist) {
        try {
          const parsed = JSON.parse(merkleProofJson.trim() || '[]') as unknown
          if (!Array.isArray(parsed)) throw new Error('Proof must be a JSON array')
          merkleProof = parsed.map((x) => {
            const s = String(x).trim()
            if (!ethers.isHexString(s, 32)) throw new Error(`Invalid proof element: ${s}`)
            return s
          })
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Invalid Merkle proof JSON')
          return
        }
      }
      const tx = await v.commitCapital(roundId, amount, tag, merkleProof)
      await waitAndParseTransaction(tx, user, provider ?? readProvider)
      toast.success('Capital committed.')
      setDepositAmount('')
      await refetchRound()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Deposit failed')
    }
  }

  const finalize = async () => {
    if (!signer) {
      toast.error('Connect a wallet to send finalizeRound.')
      return
    }
    const v = effectiveVaultAddr ? getStagedCapitalVaultAt(effectiveVaultAddr, signer) : null
    if (!v || roundId === 0n) return
    try {
      const user = await signer.getAddress()
      const tx = await v.finalizeRound(roundId)
      await waitAndParseTransaction(tx, user, provider ?? readProvider)
      toast.success('Round finalized.')
      await refetchRound()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Finalize failed')
    }
  }

  const refund = async () => {
    if (!signer) return
    const v = effectiveVaultAddr ? getStagedCapitalVaultAt(effectiveVaultAddr, signer) : null
    if (!v || roundId === 0n) return
    try {
      const user = await signer.getAddress()
      const tx = await v.refund(roundId)
      await waitAndParseTransaction(tx, user, provider ?? readProvider)
      toast.success('Refund claimed.')
      await refetchRound()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Refund failed')
    }
  }

  const claim = async () => {
    if (!signer) return
    const v = effectiveVaultAddr ? getStagedCapitalVaultAt(effectiveVaultAddr, signer) : null
    if (!v || roundId === 0n) return
    try {
      const user = await signer.getAddress()
      const tx = await v.claimMilestone(roundId)
      await waitAndParseTransaction(tx, user, provider ?? readProvider)
      toast.success('Milestone claimed to founder.')
      await refetchRound()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Claim failed')
    }
  }

  if (vaultQueryInvalid) {
    return (
      <section className="panel">
        <h2>Staged capital</h2>
        <p style={{ color: 'var(--color-warning, #f59e0b)', fontSize: '0.9rem' }}>
          Invalid vault address in the URL: <code style={{ wordBreak: 'break-all' }}>{vaultParam}</code>. Use a valid
          0x address or remove <code>?vault=</code> from the URL.
        </p>
        <p className="muted">
          <a href={typeof window !== 'undefined' ? window.location.pathname : '.'}>Clear query and retry</a>
        </p>
      </section>
    )
  }

  if (!vaultRead) {
    return (
      <section className="panel">
        <h2>Staged capital</h2>
        <p className="muted">Staged capital is not available on this deployment yet.</p>
      </section>
    )
  }

  const nowSec = Math.floor(Date.now() / 1000)
  const r = roundData?.round
  const canFinalize = r?.status === 0 && nowSec > Number(r.endTime)
  const isFounder = address && r?.founder.toLowerCase() === address.toLowerCase()
  const rpcPreview = ENV.rpcUrl.length > 52 ? `${ENV.rpcUrl.slice(0, 52)}…` : ENV.rpcUrl

  return (
    <section className="panel">
      <h2>Staged capital</h2>
      <p className="muted" style={{ maxWidth: '48rem', lineHeight: 1.55 }}>
        VC-style tranches: investors commit ERC20 during a window; committee attests milestones (EIP-712); founder
        claims each tranche in order. Optional commitment tag on deposit for off-chain coordination.
      </p>
      <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
        Vault: <code style={{ wordBreak: 'break-all' }}>{effectiveVaultAddr}</code> · read RPC: {rpcPreview}
      </p>
      <div
        style={{
          marginTop: 16,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'flex-end',
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          padding: 16,
        }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.875rem' }}>
          Round id
          <input
            value={roundIdStr}
            onChange={(e) => setRoundIdStr(e.target.value)}
            style={{
              width: 120,
              padding: '6px 8px',
              borderRadius: 6,
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              color: 'var(--color-text)',
            }}
          />
        </label>
        <button type="button" className="primary" onClick={() => void refetchRound()}>
          Refresh
        </button>
      </div>

      {roundData && r && (
        <div style={{ marginTop: 20, border: '1px solid var(--color-border)', borderRadius: 8, padding: 16 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 12,
              fontSize: '0.875rem',
            }}
          >
            <div>
              <div className="muted">Status</div>
              <div style={{ fontWeight: 600 }}>{ROUND_STATUS[r.status] ?? r.status}</div>
            </div>
            <div>
              <div className="muted">Payment token</div>
              <div>
                {roundData.tokenSymbol} · {formatAddress(r.token)}
              </div>
            </div>
            <div>
              <div className="muted">Founder</div>
              <div>{formatAddress(r.founder)}</div>
            </div>
            <div>
              <div className="muted">Committee</div>
              <div style={{ fontSize: '0.75rem' }}>
                {roundData.committee.map((c) => (
                  <div key={c}>{formatAddress(c)}</div>
                ))}
                <div className="muted" style={{ marginTop: 4 }}>
                  Threshold: {r.committeeThreshold} of {roundData.committee.length}
                </div>
              </div>
            </div>
            <div>
              <div className="muted">Raised / caps</div>
              <div>
                {ethers.formatUnits(r.totalRaised, roundData.tokenDecimals)} /{' '}
                {ethers.formatUnits(r.hardCap, roundData.tokenDecimals)} (min{' '}
                {ethers.formatUnits(r.minRaise, roundData.tokenDecimals)})
              </div>
            </div>
            <div>
              <div className="muted">Window (unix)</div>
              <div>
                {r.startTime.toString()} → {r.endTime.toString()}
              </div>
            </div>
            <div>
              <div className="muted">Next milestone</div>
              <div>{r.nextMilestone}</div>
            </div>
            <div>
              <div className="muted">Your deposit</div>
              <div>{ethers.formatUnits(roundData.myDeposit, roundData.tokenDecimals)}</div>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <div className="muted">Investor allowlist root</div>
              <div style={{ fontFamily: 'monospace', fontSize: '0.75rem', wordBreak: 'break-all' }}>
                {r.investorMerkleRoot === ethers.ZeroHash ? (
                  <span className="muted">Open round (no Merkle proof)</span>
                ) : (
                  r.investorMerkleRoot
                )}
              </div>
              {roundData.investorLeafPreview ? (
                <p className="muted" style={{ fontSize: '0.75rem', marginTop: 6, wordBreak: 'break-all' }}>
                  Your leaf: <span style={{ fontFamily: 'monospace' }}>{roundData.investorLeafPreview}</span>
                </p>
              ) : null}
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div className="muted" style={{ marginBottom: 6 }}>
              Milestones (bps / payout)
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.8rem' }}>
              {r.releaseBps.map((bps, i) => (
                <li key={i}>
                  #{i}: {bps.toString()} bps → {ethers.formatUnits(roundData.payouts[i] ?? 0n, roundData.tokenDecimals)}{' '}
                  {roundData.tokenSymbol}
                </li>
              ))}
            </ul>
          </div>

          {r.status === 0 && (
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Investor · commit</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}>
                  Amount ({roundData.tokenDecimals} decimals)
                  <input
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    placeholder="0.0"
                    style={{
                      width: 140,
                      padding: '6px 8px',
                      borderRadius: 6,
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-surface)',
                    }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 200px', fontSize: '0.8rem' }}>
                  Stealth tag (optional)
                  <input
                    value={stealthTagHex}
                    onChange={(e) => setStealthTagHex(e.target.value)}
                    placeholder="0x… or label"
                    style={{
                      padding: '6px 8px',
                      borderRadius: 6,
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-surface)',
                    }}
                  />
                </label>
                {r.investorMerkleRoot &&
                  r.investorMerkleRoot !== ethers.ZeroHash &&
                  r.investorMerkleRoot.toLowerCase() !==
                    '0x0000000000000000000000000000000000000000000000000000000000000000' && (
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%', fontSize: '0.8rem' }}>
                      Merkle proof JSON
                      <textarea
                        value={merkleProofJson}
                        onChange={(e) => setMerkleProofJson(e.target.value)}
                        placeholder='["0x…","0x…"]'
                        rows={3}
                        style={{
                          width: '100%',
                          fontFamily: 'monospace',
                          fontSize: '0.75rem',
                          padding: 8,
                          borderRadius: 6,
                          border: '1px solid var(--color-border)',
                          background: 'var(--color-surface)',
                        }}
                      />
                    </label>
                  )}
                <button type="button" className="primary" disabled={!isConnected} onClick={() => void deposit()}>
                  Commit capital
                </button>
              </div>
            </div>
          )}

          {r.status === 0 && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Anyone · finalize</div>
              <p className="muted" style={{ fontSize: '0.8rem' }}>
                After funding ends: if raised &lt; min → Failed (refunds). Else → Active.
              </p>
              <button type="button" className="ghost" disabled={!isConnected || !canFinalize} onClick={() => void finalize()}>
                finalizeRound
              </button>
              {!canFinalize && (
                <span className="muted" style={{ fontSize: '0.75rem', marginLeft: 8 }}>
                  Unlocks after end time ({r.endTime.toString()}, now {nowSec}).
                </span>
              )}
            </div>
          )}

          {r.status === 1 && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
              <button
                type="button"
                className="ghost"
                disabled={!isConnected || roundData.myDeposit === 0n}
                onClick={() => void refund()}
                style={{ borderColor: 'rgba(239, 68, 68, 0.5)', color: '#fecaca' }}
              >
                Refund my deposit
              </button>
            </div>
          )}

          {r.status === 2 && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Committee · EIP-712</div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 480, fontSize: '0.8rem' }}>
                Evidence
                <input
                  value={evidenceHex}
                  onChange={(e) => setEvidenceHex(e.target.value)}
                  placeholder="0x… or text"
                  style={{
                    padding: '6px 8px',
                    borderRadius: 6,
                    border: '1px solid var(--color-border)',
                    fontFamily: 'monospace',
                    fontSize: '0.75rem',
                    background: 'var(--color-surface)',
                  }}
                />
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                <button type="button" className="ghost" disabled={!isConnected} onClick={() => void signAttestation()}>
                  Sign milestone
                </button>
                <button type="button" className="primary" disabled={!isConnected} onClick={() => void submitAttestation()}>
                  Submit ({committeeSigs.length} sigs)
                </button>
                {committeeSigs.length > 0 ? (
                  <button type="button" className="ghost" onClick={() => setCommitteeSigs([])}>
                    Clear sigs
                  </button>
                ) : null}
              </div>
              {committeeSigs.length > 0 && (
                <ul style={{ fontSize: '0.75rem', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {committeeSigs.map((s) => (
                    <li key={s.signer}>
                      {formatAddress(s.signer)}: {s.signature.slice(0, 20)}…
                    </li>
                  ))}
                </ul>
              )}

              <div style={{ fontWeight: 600, marginTop: 16, marginBottom: 8 }}>Founder · claim</div>
              <button type="button" className="primary" disabled={!isConnected || !isFounder} onClick={() => void claim()}>
                claimMilestone
              </button>
              {!isFounder && (
                <span className="muted" style={{ fontSize: '0.75rem', marginLeft: 8 }}>
                  Connect founder wallet to claim.
                </span>
              )}
            </div>
          )}

          {r.status === 3 && (
            <p className="muted" style={{ marginTop: 16 }}>
              Round completed.
            </p>
          )}
        </div>
      )}

      {!roundData && roundId > 0n && <p className="muted">Loading round or round does not exist.</p>}
    </section>
  )
}
