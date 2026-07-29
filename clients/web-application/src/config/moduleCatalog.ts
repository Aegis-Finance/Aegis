import { isContractConfigured } from '@/utils/productReadiness'
import { isCircuitProvingReady } from '@/config/circuitReadiness'
import { CONTRACT_ADDRESSES, type ContractKey } from '@/config/contracts'

export type NavGroup = 'essentials' | 'trade' | 'defi' | 'raise' | 'protocol'

export type ModuleStatus = 'live' | 'zk-setup' | 'not-deployed'

export type AppModule = {
  path: string
  label: string
  icon: string
  group: NavGroup
  /** Primary contract — nav hidden when optional + unset. */
  contractKey?: ContractKey
  optional?: boolean
  /** ZK circuit slug when private actions need proving. */
  circuitSlug?: string
  tagline: string
}

export const NAV_GROUPS: { id: NavGroup; label: string }[] = [
  { id: 'essentials', label: 'Essentials' },
  { id: 'trade', label: 'Trade' },
  { id: 'defi', label: 'DeFi' },
  { id: 'raise', label: 'Raise' },
  { id: 'protocol', label: 'Protocol' },
]

export const APP_MODULES: AppModule[] = [
  { path: '/', label: 'Home', icon: '⌂', group: 'essentials', tagline: 'Status hub & quick links' },
  { path: '/wallet', label: 'Wallet', icon: '💼', group: 'essentials', circuitSlug: 'mint-optimized', tagline: 'Shield, unshield, commitments' },
  { path: '/swap', label: 'Swap', icon: '💱', group: 'trade', contractKey: 'PRIVATE_AMM', circuitSlug: 'private-amm', tagline: 'Private AMM swaps' },
  { path: '/liquidity', label: 'Liquidity', icon: '💧', group: 'trade', contractKey: 'PRIVATE_AMM', tagline: 'Add or remove pool liquidity' },
  { path: '/bridge', label: 'Sonic Gateway', icon: '🌉', group: 'trade', tagline: 'Ethereum → Sonic via official Gateway' },
  { path: '/lending', label: 'Lending', icon: '💰', group: 'defi', contractKey: 'LENDING', circuitSlug: 'lending-tenor', tagline: 'Borrow & lend privately' },
  { path: '/staking', label: 'Staking', icon: '🔒', group: 'defi', contractKey: 'STAKING', circuitSlug: 'staking', tagline: 'Stake AGS with ZK' },
  { path: '/yield-farming', label: 'Yield', icon: '🌾', group: 'defi', contractKey: 'YIELD_FARMING', circuitSlug: 'farming', tagline: 'Farm shielded rewards' },
  { path: '/insurance', label: 'Insurance', icon: '🏥', group: 'defi', contractKey: 'INSURANCE', circuitSlug: 'insurance', tagline: 'Coverage pools & claims' },
  { path: '/derivatives', label: 'Options', icon: '📊', group: 'defi', contractKey: 'DERIVATIVES', optional: true, circuitSlug: 'derivative', tagline: 'Private options & forwards' },
  { path: '/crowdfunding', label: 'Crowdfunding', icon: '🚀', group: 'raise', contractKey: 'CROWDFUNDING', circuitSlug: 'crowdfunding', tagline: 'Campaigns & milestones' },
  { path: '/staged-capital', label: 'Staged capital', icon: '📈', group: 'raise', contractKey: 'STAGED_CAPITAL_VAULT', optional: true, tagline: 'VC milestone vaults' },
  { path: '/governance', label: 'Governance', icon: '⚡', group: 'protocol', contractKey: 'GOVERNANCE', circuitSlug: 'governance', tagline: 'Proposals & shielded votes' },
  { path: '/treasury-incentives', label: 'Treasury & LP', icon: '🏛️', group: 'protocol', contractKey: 'GOVERNANCE_TREASURY', tagline: 'Bonds & liquidity mining' },
  {
    path: '/shielded-ecosystem',
    label: 'Shielded+',
    icon: '🛡️',
    group: 'protocol',
    contractKey: 'SHIELDED_ECOSYSTEM_ROUTER',
    optional: true,
    tagline: 'Stealth, payroll, bonds & more',
  },
]

export function isModuleVisible(mod: AppModule): boolean {
  if (mod.path === '/' || mod.path === '/wallet') return true
  if (!mod.contractKey) return true
  if (!mod.optional) return true
  return isContractConfigured(CONTRACT_ADDRESSES[mod.contractKey])
}

export function getModuleStatus(mod: AppModule): ModuleStatus {
  if (mod.contractKey && !isContractConfigured(CONTRACT_ADDRESSES[mod.contractKey])) {
    return 'not-deployed'
  }
  if (mod.circuitSlug && !isCircuitProvingReady(mod.circuitSlug)) {
    return 'zk-setup'
  }
  return 'live'
}

export function getVisibleModules(): AppModule[] {
  return APP_MODULES.filter(isModuleVisible)
}

export function getModulesByGroup(): { group: (typeof NAV_GROUPS)[number]; modules: AppModule[] }[] {
  const visible = new Set(getVisibleModules().map((m) => m.path))
  return NAV_GROUPS.map((group) => ({
    group,
    modules: APP_MODULES.filter((m) => m.group === group.id && visible.has(m.path)),
  })).filter((g) => g.modules.length > 0)
}

export function findModuleByPath(pathname: string): AppModule | undefined {
  return APP_MODULES.find((m) => m.path === pathname)
}

export const MODULE_STATUS_LABEL: Record<ModuleStatus, string> = {
  live: 'Live',
  'zk-setup': 'ZK setup',
  'not-deployed': 'Not wired',
}

export const MODULE_STATUS_CLASS: Record<ModuleStatus, string> = {
  live: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  'zk-setup': 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  'not-deployed': 'bg-terminal-border/40 text-terminal-text-dim border-terminal-border/60',
}
