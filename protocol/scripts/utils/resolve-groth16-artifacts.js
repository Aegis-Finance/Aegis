/**
 * Shared Groth16 artifact path resolution for `build/circuits/…` layouts.
 * Used by `generate-frontend-env.js` and `generate-verifier-artifact-manifest.js`
 * so wasm/zkey discovery stays consistent across tooling.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * @param {string} filePath
 * @returns {string} lowercase hex sha256, or empty string if file missing
 */
function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return '';
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Try several common circom/snarkjs output layouts under build/circuits/<dir>/…
 * `alternateDirs` covers renamed folders (e.g. bridge vs bridge_transfer).
 * @returns {{ wasmSrc: string, zkeySrc: string } | null}
 */
function resolveGroth16ArtifactPaths(contractsBuildDir, dir, wasmBase, alternateDirs = []) {
  const dirsToTry = [dir, ...alternateDirs];
  for (const d of dirsToTry) {
    const base = path.join(contractsBuildDir, d);
    const wasmCandidates = [
      path.join(base, `${wasmBase}_js`, `${wasmBase}.wasm`),
      path.join(base, `${d}_js`, `${wasmBase}.wasm`),
      path.join(base, `${d}_js`, `${d}.wasm`),
      path.join(base, `${wasmBase}.wasm`),
    ];
    const zkeyCandidates = [
      path.join(base, `${wasmBase}_final.zkey`),
      path.join(base, `${d}_final.zkey`),
    ];
    const wasmSrc = wasmCandidates.find((p) => fs.existsSync(p));
    const zkeySrc = zkeyCandidates.find((p) => fs.existsSync(p));
    if (wasmSrc && zkeySrc) return { wasmSrc, zkeySrc };
  }
  return null;
}

/**
 * VerifierFactory `circuitType` string → build folder + wasm basename.
 * Must stay aligned with `contracts/VerifierFactory.sol` supportedVerifierTypes,
 * `scripts/ceremony/factory-circuits.js`, and consumers that iterate the same order (e.g. `deploy-production-system.js`).
 */
const VERIFIER_FACTORY_CIRCUIT_BUILD_SPECS = [
  { circuitType: 'mint-optimized', dir: 'mint-optimized', wasmBase: 'mint-optimized', alternateDirs: [] },
  { circuitType: 'transfer-optimized', dir: 'transfer-optimized', wasmBase: 'transfer-optimized', alternateDirs: ['transfer'] },
  { circuitType: 'governance', dir: 'governance', wasmBase: 'governance', alternateDirs: [] },
  { circuitType: 'bridge', dir: 'bridge', wasmBase: 'bridge_transfer', alternateDirs: ['bridge_transfer'] },
  { circuitType: 'derivative', dir: 'derivative', wasmBase: 'derivative', alternateDirs: [] },
  { circuitType: 'privacy', dir: 'privacy', wasmBase: 'privacy', alternateDirs: [] },
  { circuitType: 'crowdfunding', dir: 'crowdfunding', wasmBase: 'crowdfunding', alternateDirs: [] },
  { circuitType: 'milestone', dir: 'milestone', wasmBase: 'milestone', alternateDirs: [] },
  { circuitType: 'refund', dir: 'refund', wasmBase: 'refund', alternateDirs: [] },
  { circuitType: 'tokendistribution', dir: 'tokendistribution', wasmBase: 'tokendistribution', alternateDirs: [] },
  { circuitType: 'auction', dir: 'auction', wasmBase: 'auction', alternateDirs: [] },
  { circuitType: 'auction-claim', dir: 'auction-claim', wasmBase: 'auction-claim', alternateDirs: [] },
  { circuitType: 'sybil-protection', dir: 'sybil-protection', wasmBase: 'sybil-protection', alternateDirs: [] },
  { circuitType: 'analytics', dir: 'analytics', wasmBase: 'analytics', alternateDirs: [] },
  { circuitType: 'reward', dir: 'reward', wasmBase: 'reward', alternateDirs: [] },
  { circuitType: 'leaderboard', dir: 'leaderboard', wasmBase: 'leaderboard', alternateDirs: [] },
  { circuitType: 'aggregator', dir: 'aggregator', wasmBase: 'aggregator', alternateDirs: [] },
  { circuitType: 'private-amm', dir: 'private-amm', wasmBase: 'private-amm', alternateDirs: [] },
  { circuitType: 'insurance', dir: 'insurance', wasmBase: 'insurance', alternateDirs: [] },
  { circuitType: 'staking', dir: 'staking', wasmBase: 'staking', alternateDirs: [] },
  { circuitType: 'lending-tenor', dir: 'lending-tenor', wasmBase: 'lending_tenor', alternateDirs: ['lending_tenor'] },
  {
    circuitType: 'lending-liquidity',
    dir: 'lending-liquidity',
    wasmBase: 'lending_liquidity',
    alternateDirs: ['lending_liquidity'],
  },
  { circuitType: 'lending-repay', dir: 'lending-repay', wasmBase: 'lending_repay', alternateDirs: ['lending_repay'] },
  {
    circuitType: 'lending-withdraw',
    dir: 'lending-withdraw',
    wasmBase: 'lending_withdraw',
    alternateDirs: ['lending_withdraw'],
  },
  {
    circuitType: 'lending-liquidate',
    dir: 'lending-liquidate',
    wasmBase: 'lending_liquidate',
    alternateDirs: ['lending_liquidate'],
  },
  { circuitType: 'farming', dir: 'farming', wasmBase: 'farming', alternateDirs: [] },
  {
    circuitType: 'bonding-curve-purchase',
    dir: 'bonding-curve-purchase',
    wasmBase: 'bonding-curve-purchase',
    alternateDirs: ['bonding_curve_purchase'],
  },
  {
    circuitType: 'bonding-curve-sell',
    dir: 'bonding-curve-sell',
    wasmBase: 'bonding-curve-sell',
    alternateDirs: ['bonding_curve_sell'],
  },
  { circuitType: 'batch', dir: 'batch', wasmBase: 'batch', alternateDirs: [] },
  { circuitType: 'recursive', dir: 'recursive', wasmBase: 'recursive', alternateDirs: [] },
  { circuitType: 'transfer-unshield', dir: 'transfer-unshield', wasmBase: 'transfer-unshield', alternateDirs: [] },
  { circuitType: 'shielded-transfer', dir: 'shielded-transfer', wasmBase: 'shielded-transfer', alternateDirs: [] },
  { circuitType: 'transfer-to-pool', dir: 'transfer-to-pool', wasmBase: 'transfer-to-pool', alternateDirs: [] },
  {
    circuitType: 'transfer-commitment-internal',
    dir: 'transfer-commitment-internal',
    wasmBase: 'transfer-commitment-internal',
    alternateDirs: [],
  },
  {
    circuitType: 'transfer-commitment-action',
    dir: 'transfer-commitment-action',
    wasmBase: 'transfer-commitment-action',
    alternateDirs: [],
  },
  { circuitType: 'stealth-address', dir: 'stealth-address', wasmBase: 'stealth-address', alternateDirs: [] },
  { circuitType: 'selective-disclosure', dir: 'selective-disclosure', wasmBase: 'selective-disclosure', alternateDirs: [] },
  { circuitType: 'payroll', dir: 'payroll', wasmBase: 'payroll', alternateDirs: [] },
  { circuitType: 'savings', dir: 'savings', wasmBase: 'savings', alternateDirs: [] },
  { circuitType: 'private-bond', dir: 'private-bond', wasmBase: 'private-bond', alternateDirs: [] },
  { circuitType: 'prediction-market', dir: 'prediction-market', wasmBase: 'prediction-market', alternateDirs: [] },
  { circuitType: 'private-stable', dir: 'private-stable', wasmBase: 'private-stable', alternateDirs: [] },
  { circuitType: 'credit-profile', dir: 'credit-profile', wasmBase: 'credit-profile', alternateDirs: [] },
  { circuitType: 'treasury-shield', dir: 'treasury-shield', wasmBase: 'treasury-shield', alternateDirs: [] },
];

const CIRCUIT_SOURCE_FILES = {
  'mint-optimized': 'mint-optimized.circom',
  'transfer-optimized': 'transfer-optimized.circom',
  governance: 'governance.circom',
  bridge: 'bridge.circom',
  derivative: 'derivative.circom',
  privacy: 'privacy.circom',
  crowdfunding: 'crowdfunding.circom',
  milestone: 'milestone.circom',
  refund: 'refund.circom',
  tokendistribution: 'tokendistribution.circom',
  auction: 'auction.circom',
  'auction-claim': 'auction-claim.circom',
  'sybil-protection': 'sybil-protection.circom',
  analytics: 'analytics.circom',
  reward: 'reward.circom',
  leaderboard: 'leaderboard.circom',
  aggregator: 'aggregator.circom',
  'private-amm': 'private-amm.circom',
  insurance: 'insurance.circom',
  staking: 'staking.circom',
  'lending-tenor': 'lending_tenor.circom',
  'lending-liquidity': 'lending_liquidity.circom',
  'lending-repay': 'lending_repay.circom',
  'lending-withdraw': 'lending_withdraw.circom',
  'lending-liquidate': 'lending_liquidate.circom',
  farming: 'farming.circom',
  'bonding-curve-purchase': 'bonding-curve-purchase.circom',
  'bonding-curve-sell': 'bonding-curve-sell.circom',
  batch: 'batch.circom',
  recursive: 'recursive.circom',
  'transfer-unshield': 'transfer-unshield.circom',
  'shielded-transfer': 'shielded-transfer.circom',
  'transfer-to-pool': 'transfer-to-pool.circom',
  'transfer-commitment-internal': 'transfer-commitment-internal.circom',
  'transfer-commitment-action': 'transfer-commitment-action.circom',
  'stealth-address': 'stealth-address.circom',
  'selective-disclosure': 'selective-disclosure.circom',
  payroll: 'payroll.circom',
  savings: 'savings.circom',
  'private-bond': 'private-bond.circom',
  'prediction-market': 'prediction-market.circom',
  'private-stable': 'private-stable.circom',
  'credit-profile': 'credit-profile.circom',
  'treasury-shield': 'treasury-shield.circom',
};

module.exports = {
  resolveGroth16ArtifactPaths,
  sha256File,
  VERIFIER_FACTORY_CIRCUIT_BUILD_SPECS,
  CIRCUIT_SOURCE_FILES,
};
