/**
 * Browser prover witness field names — align with Circom templates / sovereign-node-app.
 * Used by Governance and Shielded ecosystem pages for local dev proving.
 */
export const CIRCUIT_WITNESS_SCHEMAS = {
  governance: {
    vote: ['proposalId', 'voterCommitment', 'votingPower', 'voteTimestamp', 'nullifier', 'voteType'],
    delegate: ['delegatorCommitment', 'delegateCommitment', 'delegatedPower', 'nullifier', 'action'],
  },
  'stealth-address': ['paymentTag', 'viewTag', 'commitmentHash', 'nullifierHash', 'spendingKeyHash'],
  'selective-disclosure': ['nullifierHash', 'kind', 'subjectCommitment', 'threshold', 'merkleRoot'],
  payroll: ['employerHash', 'periodId', 'nullifierHash', 'employeeCommitment', 'amount'],
  savings: ['depositId', 'nullifierHash', 'newCommitmentHash', 'merkleRoot'],
  'private-bond': ['nullifierHash', 'noteCommitment', 'faceValue', 'merkleRoot'],
  'prediction-market': ['marketId', 'outcome', 'nullifierHash', 'commitmentHash'],
  'private-stable': ['nullifierHash', 'collateralCommitment', 'stableCommitment', 'amount'],
  'credit-profile': ['nullifierHash', 'profileCommitment', 'newScore', 'merkleRoot'],
  'treasury-shield': ['moveId', 'nullifierHash', 'recipientCommitment', 'merkleRoot'],
  farming: ['poolId', 'nullifierHash', 'stakeCommitment', 'amount'],
  crowdfunding: ['campaignId', 'amount', 'contributorCommitment'],
} as const

export type CircuitWitnessSlug = keyof typeof CIRCUIT_WITNESS_SCHEMAS
