pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/gates.circom";

/**
 * @title Crowdfunding Circuit
 * @dev ZK circuit for private crowdfunding contributions implementing Austrian Economics principles:
 *      - Individual Sovereignty: Private contribution amounts and identities
 *      - Voluntary Association: Opt-in contribution verification
 *      - Sound Money: Cryptographic proof of contribution validity
 *      - Spontaneous Order: Market-driven contribution patterns
 *      - Methodological Individualism: Individual contribution decisions
 */
template Crowdfunding() {
    // Public inputs (visible on-chain)
    signal input campaignId;              // Campaign identifier
    signal input contributionCommitment;  // Commitment to contribution amount
    signal input nullifierHash;          // Prevents double contributions
    signal input merkleRoot;             // Root of eligible contributors tree
    signal input minimumContribution;    // Minimum contribution amount
    signal input maximumContribution;    // Maximum contribution amount
    signal input campaignTarget;         // Campaign funding target
    signal input currentTotal;           // Current total raised
    
    // Private inputs (secrets)
    signal input contributionAmount;     // Actual contribution amount
    signal input contributorSecret;     // Contributor's secret key
    signal input nullifierSecret;       // Secret for nullifier generation
    signal input contributionBlinding;  // Blinding factor for commitment
    signal input pathElements[20];      // Merkle proof elements
    signal input pathIndices[20];       // Merkle proof indices
    signal input contributorNonce;      // Unique nonce for contributor
    
    // Output
    signal output valid;
    signal output newTotal;             // New total after contribution
    
    // Components
    component commitmentHasher = Poseidon(4);
    component nullifierHasher = Poseidon(3);
    component contributorHasher = Poseidon(2);
    component merkleVerifier = MerkleTreeVerifier(20);
    
    // Range checks
    component minCheck = GreaterEqThan(252);  // Support up to 2^252-1 for large token amounts (max circomlib supports)
    component maxCheck = LessEqThan(252);  // Support up to 2^252-1 for large token amounts (max circomlib supports)
    component targetCheck = LessEqThan(252);  // Support up to 2^252-1 for large token amounts (max circomlib supports)
    component amountCheck = GreaterThan(252);  // Support up to 2^252-1 for large token amounts (max circomlib supports)
    
    // Verify contribution commitment
    // commitment = hash(amount, contributorSecret, contributionBlinding, campaignId)
    commitmentHasher.inputs[0] <== contributionAmount;
    commitmentHasher.inputs[1] <== contributorSecret;
    commitmentHasher.inputs[2] <== contributionBlinding;
    commitmentHasher.inputs[3] <== campaignId;
    commitmentHasher.out === contributionCommitment;
    
    // Generate nullifier hash to prevent double contributions
    // nullifier = hash(contributorSecret, nullifierSecret, campaignId)
    nullifierHasher.inputs[0] <== contributorSecret;
    nullifierHasher.inputs[1] <== nullifierSecret;
    nullifierHasher.inputs[2] <== campaignId;
    nullifierHasher.out === nullifierHash;
    
    // Generate contributor commitment for merkle tree
    contributorHasher.inputs[0] <== contributorSecret;
    contributorHasher.inputs[1] <== contributorNonce;
    
    // Verify contributor is in eligible contributors set
    merkleVerifier.leaf <== contributorHasher.out;
    merkleVerifier.root <== merkleRoot;
    for (var i = 0; i < 20; i++) {
        merkleVerifier.pathElements[i] <== pathElements[i];
        merkleVerifier.pathIndices[i] <== pathIndices[i];
    }
    
    // Verify contribution amount is positive
    amountCheck.in[0] <== contributionAmount;
    amountCheck.in[1] <== 0;
    amountCheck.out === 1;
    
    // Verify contribution meets minimum requirement
    minCheck.in[0] <== contributionAmount;
    minCheck.in[1] <== minimumContribution;
    minCheck.out === 1;
    
    // Verify contribution doesn't exceed maximum
    maxCheck.in[0] <== contributionAmount;
    maxCheck.in[1] <== maximumContribution;
    maxCheck.out === 1;
    
    // Calculate new total and verify it doesn't exceed target
    newTotal <== currentTotal + contributionAmount;
    targetCheck.in[0] <== newTotal;
    targetCheck.in[1] <== campaignTarget;
    targetCheck.out === 1;
    
    // Aggregate validation flag
    component validAnd1 = AND();
    component validAnd2 = AND();
    component validAnd3 = AND();
    
    validAnd1.a <== amountCheck.out;
    validAnd1.b <== minCheck.out;
    
    validAnd2.a <== validAnd1.out;
    validAnd2.b <== maxCheck.out;
    
    validAnd3.a <== validAnd2.out;
    validAnd3.b <== targetCheck.out;
    
    valid <== validAnd3.out;
}

/**
 * @title Merkle Tree Verifier
 * @dev Verifies membership in a merkle tree for contributor eligibility
 */
template MerkleTreeVerifier(levels) {
    signal input leaf;
    signal input root;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    
    component hashers[levels];
    component selectors[levels];
    component pathBits[levels];
    
    var currentHash = leaf;
    
    for (var i = 0; i < levels; i++) {
        hashers[i] = Poseidon(2);
        selectors[i] = Selector();
        pathBits[i] = Num2Bits(1);
        
        pathBits[i].in <== pathIndices[i];
        selectors[i].select <== pathBits[i].out[0];
        selectors[i].left <== currentHash;
        selectors[i].right <== pathElements[i];
        
        hashers[i].inputs[0] <== selectors[i].outLeft;
        hashers[i].inputs[1] <== selectors[i].outRight;
        
        currentHash = hashers[i].out;
    }
    
    currentHash === root;
}

/**
 * @title Selector
 * @dev Selects left or right based on path index for merkle proof
 */
template Selector() {
    signal input select;
    signal input left;
    signal input right;
    signal output outLeft;
    signal output outRight;
    
    outLeft <== left + select * (right - left);
    outRight <== right + select * (left - right);
}

/**
 * @title Austrian Economics Contribution Validator
 * @dev Additional validation for Austrian Economics principles
 */
template AustrianContributionValidator() {
    signal input contributionAmount;
    signal input contributorReputation;
    signal input marketPrice;
    signal input voluntaryFlag;
    
    signal output austrianValid;
    
    component voluntaryCheck = IsEqual();
    component reputationCheck = GreaterThan(32);
    component marketCheck = GreaterThan(252);  // Support up to 2^252-1 for large token amounts (max circomlib supports)
    
    // Verify contribution is voluntary (flag must be 1)
    voluntaryCheck.in[0] <== voluntaryFlag;
    voluntaryCheck.in[1] <== 1;
    
    // Verify contributor has positive reputation
    reputationCheck.in[0] <== contributorReputation;
    reputationCheck.in[1] <== 0;
    
    // Verify contribution reflects market pricing
    marketCheck.in[0] <== contributionAmount;
    marketCheck.in[1] <== marketPrice;
    
    // All Austrian Economics principles satisfied
    austrianValid <== voluntaryCheck.out * reputationCheck.out * marketCheck.out;
}

// Main component with public signals
component main {public [
    campaignId,
    contributionCommitment,
    nullifierHash,
    merkleRoot,
    minimumContribution,
    maximumContribution,
    campaignTarget,
    currentTotal
]} = Crowdfunding();