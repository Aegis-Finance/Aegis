import './styles.css'

const APP = 'https://app.aegisprotocol.org'
const TGE = 'https://tge.aegisprotocol.org'
const DOCS = 'https://doc.aegisprotocol.org'
const WHITEPAPER = 'https://github.com/Aegis-Finance/Aegis/tree/master/docs/whitepaper'
const SONIC_DOCS = 'https://docs.soniclabs.com/'
const EXPLORER = 'https://sonicscan.org'
const X_COMMUNITY = 'https://x.com/aegisecosystem'
const TELEGRAM = 'https://t.me/Aegisecosystem'
const AUCTION = '0x0a1C179317cB821AF838F4EF4bc3B4b7B81F43A4'

type ProductStatus = 'live' | 'ready' | 'progress' | 'soon'

type Product = {
  slug?: string
  doc?: string
  name: string
  headline: string
  body: string
  status: ProductStatus
  href?: string
}

type ProductGroup = {
  id: string
  label: string
  intro: string
  products: Product[]
}

const STATUS_LABEL: Record<ProductStatus, string> = {
  live: 'Live',
  ready: 'Needs a go',
  progress: 'Building',
  soon: 'Roadmap',
}

const STATUS_CLASS: Record<ProductStatus, string> = {
  live: 'badge-live',
  ready: 'badge-ready',
  progress: 'badge-progress',
  soon: 'badge-soon',
}

const SHIELDED = `${APP}/shielded-ecosystem`

const productGroups: ProductGroup[] = [
  {
    id: 'privacy-core',
    label: 'Essentials',
    intro: 'Start here: shield funds, enter the privacy set, and move value without broadcasting every hop to the world.',
    products: [
      {
        slug: 'wallet',
        name: 'Shielded wallet',
        headline: 'Hold and send AGS without a public scoreboard.',
        body: 'Shield into Groth16 commitments, transfer privately, unshield when you need transparent rails. Optional encrypted vault for local UX — keys never leave your browser.',
        status: 'live',
        href: `${APP}/wallet`,
      },
      {
        slug: 'wallet',
        name: 'Privacy entry',
        headline: 'Join the shielded set without advertising your funding trail.',
        body: 'Governed routers and relayers submit EIP-712 intents so your public wallet is not permanently linked to every private action you take later.',
        status: 'live',
        href: SHIELDED,
      },
    ],
  },
  {
    id: 'trade',
    label: 'Trade & liquidity',
    intro: 'Move assets on Sonic — public depth where markets need it, proof-gated execution where policy requires it. Every mode is labeled.',
    products: [
      {
        slug: 'swap',
        name: 'Swap',
        headline: 'Exchange tokens across canonical Sonic pools.',
        body: 'Public AMM for visible depth. Governed router for best execution. PrivateAMM when verifiers are live — proofs gate policy, not fantasy hidden reserves.',
        status: 'live',
        href: `${APP}/swap`,
      },
      {
        slug: 'liquidity',
        name: 'Liquidity',
        headline: 'Earn fees by supplying pool depth.',
        body: 'Add and remove liquidity on public pairs. Positions and fees verify on SonicScan — the trade-off is composability and depth for counterparties who need it.',
        status: 'live',
        href: `${APP}/liquidity`,
      },
      {
        slug: 'swap',
        name: 'Limits & RFQ',
        headline: 'Set a price or take a quote — no dark CLOB theater.',
        body: 'On-chain limit escrows, EIP-712 signed orders, and atomic RFQ settlement for size. Solver competition and hybrid matchers are on the roadmap.',
        status: 'live',
        href: `${APP}/swap`,
      },
      {
        slug: 'bridge',
        name: 'Sonic Gateway',
        headline: 'Bring Ethereum assets onto Sonic in one flow.',
        body: 'Official bridge into chainId 146 — then shield, swap, lend, and govern without treating L1 and L2 as separate products.',
        status: 'live',
        href: `${APP}/bridge`,
      },
    ],
  },
  {
    id: 'defi',
    label: 'DeFi & risk',
    intro: 'Borrow, stake, farm, insure, and hedge with the same privacy grammar — rules on-chain, viewing keys with you.',
    products: [
      {
        slug: 'lending',
        name: 'Lending',
        headline: 'Borrow against collateral without publishing your whole balance sheet.',
        body: 'ZK-backed borrow and lend with automatic liquidations per published parameters — no credit committee in a Telegram group.',
        status: 'live',
        href: `${APP}/lending`,
      },
      {
        slug: 'staking',
        name: 'Staking',
        headline: 'Stake AGS to help secure the protocol.',
        body: 'Lock AGS for network security and governance weight. Stake and unstake through commitment-aware contracts when circuits are green.',
        status: 'live',
        href: `${APP}/staking`,
      },
      {
        slug: 'staking',
        name: 'Yield farming',
        headline: 'Farm shielded rewards on your positions.',
        body: 'Earn protocol incentives on LP or staking positions without advertising farm size and harvest timing to every block explorer.',
        status: 'live',
        href: `${APP}/yield-farming`,
      },
      {
        slug: 'insurance',
        name: 'Insurance',
        headline: 'Buy coverage when smart-contract risk is real.',
        body: 'Premiums, pools, and claims paths enforced by contracts. ZK claims prove eligibility without dumping personal data on Sonic.',
        status: 'live',
        href: `${APP}/insurance`,
      },
      {
        slug: 'derivatives',
        name: 'Private options',
        headline: 'Hedge direction without tipping size and side on-chain.',
        body: 'Call and put options on Sonic — open, exercise, and settle with ZK proofs. Settlement uses the on-chain AGS/SONIC mark in the app.',
        status: 'live',
        href: `${APP}/derivatives`,
      },
    ],
  },
  {
    id: 'raise',
    label: 'Raise capital',
    intro: 'Primary issuance, milestone vaults, and community raises — timelocks and proofs instead of handshake unlocks.',
    products: [
      {
        doc: '/token/dutch-auction',
        name: 'Dutch auction',
        headline: 'Fair primary AGS issuance on a falling price schedule.',
        body: 'Contract is deployed on Sonic — the sale opens when we announce and start the window on official channels, then the schedule runs automatically. Pay with S, wS, or bridged stables.',
        status: 'ready',
        href: TGE,
      },
      {
        slug: 'crowdfunding',
        name: 'Crowdfunding',
        headline: 'Run a raise with milestone gates contributors can verify.',
        body: 'Campaigns unlock capital on-chain when milestones hit — contributors see the rules, founders get enforceable releases.',
        status: 'live',
        href: `${APP}/crowdfunding`,
      },
      {
        slug: 'staged-capital',
        name: 'Staged capital',
        headline: 'VC-style tranches without PDF side letters.',
        body: 'Capital unlocks when milestones verify — LPs and founders share one source of truth instead of email threads.',
        status: 'live',
        href: `${APP}/staged-capital`,
      },
    ],
  },
  {
    id: 'protocol',
    label: 'Governance & treasury',
    intro: 'Upgrades, fees, and treasury flow through votes and delays — no secret admin panel.',
    products: [
      {
        doc: '/protocol/governance',
        name: 'Governance',
        headline: 'Vote on how the protocol evolves.',
        body: 'Token holders set router allowlists, verifier promotions, fee tiers, and privacy policy — timelocked execution included. Shielded tally where enabled.',
        status: 'live',
        href: `${APP}/governance`,
      },
      {
        slug: 'treasury',
        name: 'Treasury & LP',
        headline: 'Align long-term liquidity with protocol revenue.',
        body: 'Treasury bonds, liquidity mining epochs, and allocator policy — emissions and depth scheduled in contracts, not in a spreadsheet.',
        status: 'live',
        href: `${APP}/treasury-incentives`,
      },
    ],
  },
  {
    id: 'shielded-plus',
    label: 'Shielded+',
    intro: 'Advanced privacy-native modules in one app surface — payroll, savings, markets, credit, bonds, disclosure, and relayers.',
    products: [
      {
        slug: 'shielded-plus',
        name: 'Stealth receive',
        headline: 'Get paid without reusing one public deposit address.',
        body: 'Invoice-style pay links for payroll, donations, and checkout — each receive path is fresh so watchers cannot map your income graph.',
        status: 'live',
        href: SHIELDED,
      },
      {
        slug: 'shielded-plus',
        name: 'Selective disclosure',
        headline: 'Prove facts to auditors without opening your wallet.',
        body: 'Share only what regulators or counterparties require — balances and full history stay private by default.',
        status: 'live',
        href: SHIELDED,
      },
      {
        slug: 'shielded-plus',
        name: 'Relayer marketplace',
        headline: 'Pick who pays gas for your private transactions.',
        body: 'Competing relayers on fees and uptime — not a single hosted gatekeeper for every shielded action.',
        status: 'live',
        href: SHIELDED,
      },
      {
        slug: 'shielded-plus',
        name: 'Anonymous payroll',
        headline: 'Pay teams without salary ledgers on SonicScan.',
        body: 'Batch shielded payouts — HR sees policy, the chain sees proofs, employees receive without a public wage trail.',
        status: 'live',
        href: SHIELDED,
      },
      {
        slug: 'shielded-plus',
        name: 'Privacy savings',
        headline: 'Save inside the shielded set.',
        body: 'Park AGS in a savings vault under commitments — grow balances without a public number everyone can watch.',
        status: 'live',
        href: SHIELDED,
      },
      {
        slug: 'shielded-plus',
        name: 'Shielded yield vault',
        headline: 'Earn yield on shielded principal.',
        body: 'Compound returns inside commitments — vault rates and rules are on-chain, your position size stays confidential.',
        status: 'live',
        href: SHIELDED,
      },
      {
        slug: 'shielded-plus',
        name: 'Shielded incentives',
        headline: 'Claim protocol rewards privately.',
        body: 'Collect emissions and LP incentives without linking every claim transaction to your public address.',
        status: 'live',
        href: SHIELDED,
      },
      {
        slug: 'shielded-plus',
        name: 'Prediction markets',
        headline: 'Trade event outcomes without tipping your hand.',
        body: 'Bet on results with proof-gated settlement — position size and conviction stay confidential where circuits allow.',
        status: 'progress',
        href: SHIELDED,
      },
      {
        slug: 'shielded-plus',
        name: 'Stable vault',
        headline: 'Hold stables in the shielded layer.',
        body: 'Park USDC-class assets privately before you swap, lend, or pay out — stable denomination without a public stable balance.',
        status: 'live',
        href: SHIELDED,
      },
      {
        slug: 'shielded-plus',
        name: 'Credit profile',
        headline: 'Prove borrow credibility without doxxing your wallet.',
        body: 'Show repayment history and limits to lenders with ZK — not a full on-chain credit report anyone can scrape.',
        status: 'progress',
        href: SHIELDED,
      },
      {
        slug: 'shielded-plus',
        name: 'Private bonds',
        headline: 'Issue and buy debt without public order books.',
        body: 'Fixed-income raises and secondary flow with selective disclosure for size and holders — treasuries and funds stay discreet.',
        status: 'progress',
        href: SHIELDED,
      },
    ],
  },
  {
    id: 'commerce',
    label: 'Commerce',
    intro: 'Merchant checkout on Sonic — invoice API, pay links, webhooks, ZK settlement.',
    products: [
      {
        slug: 'merchant-paygate',
        name: 'ZK merchant paygate',
        headline: 'Create an invoice, share a link, get a webhook on settle.',
        body: 'Non-custodial checkout for S, wS, and stables — shielded pay by default, transparent fallback for accounting. On the public roadmap.',
        status: 'soon',
        href: `${DOCS}/products/merchant-paygate`,
      },
    ],
  },
]

const roadmapPhases = [
  {
    when: 'Now',
    title: 'Protocol on Sonic',
    items: [
      'Core contracts on chainId 146 — wallet, swap, lend, stake, yield, insure, govern, Shielded+.',
      'Public AMM + limit/RFQ starters; PrivateAMM with honest messaging.',
      'Signed open-source releases on GitHub.',
    ],
  },
  {
    when: 'TGE',
    title: 'Primary issuance',
    items: [
      'Dutch auction window — verified contract only, announced on X & Telegram.',
      'Post-sale liquidity seed and canonical routing in the app.',
      'Ignore copycat AGS — not live until we say so.',
    ],
  },
  {
    when: 'Next',
    title: 'Execution depth',
    items: [
      'Production PrivateAMM path, TWAP guardrails, split routing.',
      'ZK-wrapped advanced execution per audited circuit.',
      'Fleet / insurance oracle pilots (B2B track).',
    ],
  },
  {
    when: 'Ecosystem',
    title: 'Partners & commerce',
    items: [
      'ZK merchant paygate beta — invoices, webhooks, bot integrations.',
      'Relayer marketplace maturation and partner registry.',
      'Selective disclosure packs for institutions.',
    ],
  },
]

function docUrl(p: Product) {
  if (p.doc) return `${DOCS}${p.doc}`
  return p.slug ? `${DOCS}/products/${p.slug}` : `${DOCS}/products/`
}

function badge(status: ProductStatus) {
  return `<span class="${STATUS_CLASS[status]}">${STATUS_LABEL[status]}</span>`
}

function nav() {
  return `
    <header class="sticky top-0 z-50 border-b border-terminal-border/80 bg-terminal-bg/85 backdrop-blur-lg">
      <div class="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5">
        <a href="/" class="font-display text-base font-bold uppercase tracking-[0.32em] text-terminal-text">AEGIS</a>
        <nav class="flex flex-wrap items-center gap-0.5 sm:gap-1 text-sm">
          <a href="${WHITEPAPER}" class="btn-ghost hidden sm:inline-flex" rel="noopener noreferrer">Whitepaper</a>
          <a href="${DOCS}" class="btn-ghost">Docs</a>
          <a href="${TGE}" class="btn-ghost hidden sm:inline-flex">Sale</a>
          <a href="${APP}" class="btn-primary !py-2 !px-5 !text-xs sm:!text-sm">Launch app</a>
        </nav>
      </div>
    </header>`
}

function scamBanner() {
  return `
    <div class="alert-banner">
      <div class="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <p class="text-sm leading-snug">
          <strong class="text-terminal-text">AGS is not live for public trading yet.</strong>
          <span class="text-terminal-text-dim"> Official contract &amp; TGE news only on </span>
          <a href="${X_COMMUNITY}" class="font-medium text-terminal-accent hover:underline" rel="noopener noreferrer">X</a>
          <span class="text-terminal-text-dim"> and </span>
          <a href="${TELEGRAM}" class="font-medium text-terminal-accent hover:underline" rel="noopener noreferrer">Telegram</a>.
        </p>
        <div class="flex shrink-0 gap-2">
          <a href="${X_COMMUNITY}" class="btn-secondary !rounded-full !px-4 !py-1.5 !text-xs" rel="noopener noreferrer">Follow</a>
        </div>
      </div>
    </div>`
}

function productCard(p: Product) {
  const title = p.href
    ? `<a href="${p.href}" class="text-lg font-semibold text-terminal-text hover:text-terminal-accent">${p.name}</a>`
    : `<span class="text-lg font-semibold text-terminal-text">${p.name}</span>`
  const learn = p.slug || p.doc
    ? `<a href="${docUrl(p)}" class="btn-link mt-auto pt-3 inline-block">Read docs →</a>`
    : ''
  return `
    <article class="card flex h-full flex-col">
      <div class="flex flex-wrap items-center justify-between gap-2">
        ${title}
        ${badge(p.status)}
      </div>
      <p class="mt-3 font-medium leading-snug text-terminal-text">${p.headline}</p>
      <p class="mt-2 flex-1 text-sm leading-relaxed text-terminal-text-dim">${p.body}</p>
      ${learn}
    </article>`
}

function footer() {
  return `
    <footer class="border-t border-terminal-border bg-terminal-surface/50 py-14 text-sm text-terminal-text-dim">
      <div class="mx-auto max-w-6xl px-4">
        <div class="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div class="lg:col-span-1">
            <p class="font-display text-xs font-bold uppercase tracking-widest text-terminal-text">Aegis</p>
            <p class="mt-3 leading-relaxed">Private finance on Sonic. Wallets talk to chain — we do not hold your keys.</p>
            <a href="${SONIC_DOCS}" class="mt-4 inline-flex items-center gap-1 text-xs font-medium text-terminal-accent hover:underline" rel="noopener noreferrer">Built on Sonic ↗</a>
          </div>
          <div>
            <p class="text-xs font-bold uppercase tracking-wide text-terminal-text">Product</p>
            <div class="mt-3 flex flex-col gap-2">
              <a href="${APP}" class="hover:text-terminal-accent">App</a>
              <a href="${TGE}" class="hover:text-terminal-accent">Token sale</a>
              <a href="${DOCS}/products/" class="hover:text-terminal-accent">All modules</a>
              <a href="${WHITEPAPER}" class="hover:text-terminal-accent" rel="noopener noreferrer">Whitepaper</a>
            </div>
          </div>
          <div>
            <p class="text-xs font-bold uppercase tracking-wide text-terminal-text">Learn</p>
            <div class="mt-3 flex flex-col gap-2">
              <a href="${DOCS}" class="hover:text-terminal-accent">Documentation</a>
              <a href="${DOCS}/roadmap/" class="hover:text-terminal-accent">Roadmap</a>
              <a href="${DOCS}/protocol/privacy-model" class="hover:text-terminal-accent">Privacy model</a>
              <a href="${DOCS}/build/security" class="hover:text-terminal-accent">Security</a>
            </div>
          </div>
          <div>
            <p class="text-xs font-bold uppercase tracking-wide text-terminal-text">Community</p>
            <div class="mt-3 flex flex-col gap-2">
              <a href="${X_COMMUNITY}" class="hover:text-terminal-accent" rel="noopener noreferrer">X @aegisecosystem</a>
              <a href="${TELEGRAM}" class="hover:text-terminal-accent" rel="noopener noreferrer">Telegram</a>
              <a href="https://github.com/Aegis-Finance/Aegis" class="hover:text-terminal-accent" rel="noopener noreferrer">GitHub</a>
            </div>
          </div>
        </div>
      </div>
    </footer>`
}

document.querySelector('#app')!.innerHTML = `
${nav()}
${scamBanner()}
<main>
  <section class="hero-glow grid-dots border-b border-terminal-border">
    <div class="mx-auto max-w-6xl px-4 pb-16 pt-14 sm:pb-20 sm:pt-20">
      <h1 class="max-w-3xl font-display text-[2.25rem] font-bold leading-[1.12] tracking-tight sm:text-5xl lg:text-[3.5rem]">
        Private DeFi on Sonic.
      </h1>
      <p class="mt-5 max-w-2xl text-lg leading-relaxed text-terminal-text sm:text-xl">
        <strong class="font-semibold text-terminal-text">Aegis is a finance app</strong> where you can trade, borrow, save, and govern
        <strong class="font-semibold text-terminal-text"> without everyone seeing your wallet history.</strong>
      </p>
      <p class="mt-3 max-w-xl text-base text-terminal-text-dim">
        Connect your wallet. Use one app for wallet, trade, DeFi, raises, governance, and Shielded+ — you keep your keys, we never hold your funds.
      </p>
      <div class="mt-8 flex flex-wrap gap-3">
        <a href="${APP}" class="btn-primary">Launch app</a>
        <a href="${DOCS}" class="btn-secondary">Documentation</a>
      </div>
      <ul class="mt-12 grid gap-4 sm:grid-cols-3">
        <li class="card-flat">
          <p class="font-semibold text-terminal-text">Stay private</p>
          <p class="mt-1.5 text-sm leading-relaxed text-terminal-text-dim">Send and hold money without a public ledger showing who paid whom.</p>
        </li>
        <li class="card-flat">
          <p class="font-semibold text-terminal-text">One place for DeFi</p>
          <p class="mt-1.5 text-sm leading-relaxed text-terminal-text-dim">Swap, lend, stake, farm, insure, raise, and vote — not a dozen disconnected sites.</p>
        </li>
        <li class="card-flat">
          <p class="font-semibold text-terminal-text">Rules you can verify</p>
          <p class="mt-1.5 text-sm leading-relaxed text-terminal-text-dim">Open contracts on Sonic. No hidden admin switch in the app.</p>
        </li>
      </ul>
    </div>
  </section>

  <section class="border-b border-terminal-border bg-terminal-surface/40 py-12 sm:py-14">
    <div class="mx-auto max-w-6xl px-4">
      <h2 class="text-lg font-semibold text-terminal-text">Everything in the app</h2>
      <p class="mt-2 max-w-2xl text-sm text-terminal-text-dim">Same modules as the live app navigation — each link opens the product you use.</p>
      <div class="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 sm:gap-4">
        <a href="${APP}/wallet" class="card-flat !p-4 transition hover:border-terminal-accent/40">
          <p class="text-sm font-semibold text-terminal-text">Wallet</p>
          <p class="mt-1 text-xs text-terminal-text-dim">Shield &amp; send privately</p>
        </a>
        <a href="${APP}/swap" class="card-flat !p-4 transition hover:border-terminal-accent/40">
          <p class="text-sm font-semibold text-terminal-text">Swap</p>
          <p class="mt-1 text-xs text-terminal-text-dim">Trade tokens</p>
        </a>
        <a href="${APP}/liquidity" class="card-flat !p-4 transition hover:border-terminal-accent/40">
          <p class="text-sm font-semibold text-terminal-text">Liquidity</p>
          <p class="mt-1 text-xs text-terminal-text-dim">Supply pool depth</p>
        </a>
        <a href="${APP}/bridge" class="card-flat !p-4 transition hover:border-terminal-accent/40">
          <p class="text-sm font-semibold text-terminal-text">Sonic Gateway</p>
          <p class="mt-1 text-xs text-terminal-text-dim">Bridge from Ethereum</p>
        </a>
        <a href="${APP}/lending" class="card-flat !p-4 transition hover:border-terminal-accent/40">
          <p class="text-sm font-semibold text-terminal-text">Lending</p>
          <p class="mt-1 text-xs text-terminal-text-dim">Borrow &amp; lend</p>
        </a>
        <a href="${APP}/staking" class="card-flat !p-4 transition hover:border-terminal-accent/40">
          <p class="text-sm font-semibold text-terminal-text">Staking</p>
          <p class="mt-1 text-xs text-terminal-text-dim">Stake AGS</p>
        </a>
        <a href="${APP}/yield-farming" class="card-flat !p-4 transition hover:border-terminal-accent/40">
          <p class="text-sm font-semibold text-terminal-text">Yield</p>
          <p class="mt-1 text-xs text-terminal-text-dim">Farm rewards</p>
        </a>
        <a href="${APP}/insurance" class="card-flat !p-4 transition hover:border-terminal-accent/40">
          <p class="text-sm font-semibold text-terminal-text">Insurance</p>
          <p class="mt-1 text-xs text-terminal-text-dim">Buy coverage</p>
        </a>
        <a href="${APP}/derivatives" class="card-flat !p-4 transition hover:border-terminal-accent/40">
          <p class="text-sm font-semibold text-terminal-text">Options</p>
          <p class="mt-1 text-xs text-terminal-text-dim">Hedge privately</p>
        </a>
        <a href="${APP}/crowdfunding" class="card-flat !p-4 transition hover:border-terminal-accent/40">
          <p class="text-sm font-semibold text-terminal-text">Crowdfunding</p>
          <p class="mt-1 text-xs text-terminal-text-dim">Milestone raises</p>
        </a>
        <a href="${APP}/staged-capital" class="card-flat !p-4 transition hover:border-terminal-accent/40">
          <p class="text-sm font-semibold text-terminal-text">Staged capital</p>
          <p class="mt-1 text-xs text-terminal-text-dim">VC tranches</p>
        </a>
        <a href="${APP}/governance" class="card-flat !p-4 transition hover:border-terminal-accent/40">
          <p class="text-sm font-semibold text-terminal-text">Governance</p>
          <p class="mt-1 text-xs text-terminal-text-dim">Vote on rules</p>
        </a>
        <a href="${APP}/treasury-incentives" class="card-flat !p-4 transition hover:border-terminal-accent/40">
          <p class="text-sm font-semibold text-terminal-text">Treasury &amp; LP</p>
          <p class="mt-1 text-xs text-terminal-text-dim">Bonds &amp; mining</p>
        </a>
        <a href="${SHIELDED}" class="card-flat !p-4 transition hover:border-terminal-accent/40">
          <p class="text-sm font-semibold text-terminal-text">Shielded+</p>
          <p class="mt-1 text-xs text-terminal-text-dim">Payroll, savings &amp; more</p>
        </a>
        <a href="${TGE}" class="card-flat !p-4 transition hover:border-terminal-accent/40">
          <p class="text-sm font-semibold text-terminal-text">Token sale</p>
          <p class="mt-1 text-xs text-terminal-text-dim">Dutch auction (TGE)</p>
        </a>
      </div>
    </div>
  </section>

  <section class="border-b border-terminal-border py-10 sm:py-12">
    <div class="mx-auto max-w-6xl px-4 text-center sm:text-left">
      <p class="section-label">Full product map</p>
      <h2 class="section-title mt-2 text-2xl sm:text-3xl">What each module does for you</h2>
      <p class="mt-3 mx-auto sm:mx-0 max-w-2xl text-terminal-text-dim leading-relaxed">
        Every card below matches a module in the app or token sale — headline is the user benefit, body is when you reach for it.
      </p>
    </div>
  </section>

  ${productGroups
    .map(
      (group, i) => `
  <section class="py-16 sm:py-20 ${i % 2 === 1 ? 'bg-terminal-surface/30 border-y border-terminal-border' : ''} ${group.id === 'commerce' ? '!bg-terminal-accent/[0.04]' : ''}" id="${group.id}">
    <div class="mx-auto max-w-6xl px-4">
      <p class="section-label">${group.label}</p>
      <h2 class="section-title mt-2 text-2xl sm:text-3xl">${group.label}</h2>
      <p class="mt-3 max-w-2xl text-terminal-text-dim leading-relaxed">${group.intro}</p>
      <div class="mt-8 grid gap-4 sm:grid-cols-2 ${group.products.length >= 6 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'} ${group.products.length === 1 ? 'max-w-xl' : ''}">
        ${group.products.map(productCard).join('')}
      </div>
    </div>
  </section>`
    )
    .join('')}

  <section class="border-y border-terminal-border bg-terminal-bg py-16 sm:py-20">
    <div class="mx-auto max-w-6xl px-4 lg:flex lg:items-start lg:gap-16">
      <div class="lg:w-1/2">
        <p class="section-label">Primary issuance</p>
        <h2 class="section-title mt-2 text-2xl sm:text-3xl">Dutch auction when we open the window</h2>
        <p class="mt-4 leading-relaxed text-terminal-text-dim">
          Price falls on a published schedule until inventory clears or time ends.
          We announce the live contract on <a href="${X_COMMUNITY}" class="text-terminal-accent hover:underline" rel="noopener noreferrer">X</a> and
          <a href="${TELEGRAM}" class="text-terminal-accent hover:underline" rel="noopener noreferrer">Telegram</a> — everything else is a scam until then.
        </p>
        <div class="mt-6 flex flex-wrap gap-3">
          <a href="${TGE}" class="btn-primary">Token sale app</a>
          <a href="${DOCS}/token/dutch-auction" class="btn-secondary">How it works</a>
        </div>
      </div>
      <div class="mt-8 lg:mt-0 lg:w-1/2">
        <div class="card-flat font-mono text-xs">
          <p class="text-terminal-text-dim">Verified auction contract (verify before sending)</p>
          <a href="${EXPLORER}/address/${AUCTION}" class="mt-2 block break-all text-sm text-terminal-accent hover:underline" rel="noopener noreferrer">${AUCTION}</a>
        </div>
      </div>
    </div>
  </section>

  <section class="py-16 sm:py-20">
    <div class="mx-auto max-w-6xl px-4">
      <p class="section-label">Roadmap</p>
      <h2 class="section-title mt-2 text-2xl sm:text-3xl">Shipped honestly</h2>
      <p class="mt-3 max-w-2xl text-terminal-text-dim">If it is not in the app or signed release, we label it roadmap — including merchant paygate and private CLOB research.</p>
      <div class="mt-10 grid gap-4 sm:grid-cols-2">
        ${roadmapPhases
          .map(
            (p) => `
        <div class="card-flat">
          <p class="text-xs font-bold uppercase tracking-wider text-terminal-accent">${p.when}</p>
          <h3 class="mt-1 font-semibold text-terminal-text">${p.title}</h3>
          <ul class="mt-4 space-y-2 text-sm text-terminal-text-dim">
            ${p.items.map((item) => `<li class="flex gap-2"><span class="text-terminal-accent">·</span><span>${item}</span></li>`).join('')}
          </ul>
        </div>`
          )
          .join('')}
      </div>
      <p class="mt-8 flex flex-wrap gap-4 text-sm">
        <a href="${DOCS}/roadmap/" class="btn-link">Full roadmap →</a>
        <a href="${DOCS}/roadmap/phases" class="btn-link">2026–2030 phases →</a>
        <a href="${DOCS}/roadmap/trading" class="btn-link">Trading milestones →</a>
      </p>
    </div>
  </section>

  <section class="border-t border-terminal-border bg-gradient-to-b from-terminal-accent/8 to-transparent py-16 sm:py-20">
    <div class="mx-auto max-w-6xl px-4 text-center">
      <p class="section-label">Official channels</p>
      <h2 class="section-title mt-2 text-2xl sm:text-3xl">We announce. You verify.</h2>
      <p class="mx-auto mt-4 max-w-xl text-terminal-text-dim leading-relaxed">
        TGE timing, paygate beta, contract drops, and security notices — never in your DMs first.
      </p>
      <div class="mt-8 flex flex-wrap justify-center gap-3">
        <a href="${X_COMMUNITY}" class="btn-primary" rel="noopener noreferrer">X @aegisecosystem</a>
        <a href="${TELEGRAM}" class="btn-secondary" rel="noopener noreferrer">Telegram</a>
        <a href="${DOCS}/resources/community" class="btn-secondary">Scam checklist</a>
      </div>
    </div>
  </section>
</main>
${footer()}
`
