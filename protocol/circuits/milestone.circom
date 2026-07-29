pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/gates.circom";

/**
 * @title Milestone Circuit
 * @dev ZK circuit for private milestone verification implementing Austrian Economics principles:
 *      - Individual Sovereignty: Private reviewer identities and scores
 *      - Voluntary Association: Opt-in milestone review participation
 *      - Market-Driven Evaluation: Reputation-weighted milestone assessment
 *      - Spontaneous Order: Emergent consensus on milestone completion
 *      - Methodological Individualism: Individual reviewer assessments
 */
template Milestone() {
    // Public inputs (visible on-chain)
    signal input campaignId;              // Campaign identifier
    signal input milestoneId;             // Milestone identifier
    signal input reviewCommitment;        // Commitment to review score
    signal input nullifierHash;          // Prevents double reviews
    signal input merkleRoot;             // Root of eligible reviewers tree
    signal input minimumScore;           // Minimum passing score
    signal input requiredReviewers;      // Required number of reviewers
    signal input currentReviewCount;     // Current number of reviews
    signal input weightedScoreSum;       // Current weighted score sum
    signal input totalWeight;            // Total reviewer weight
    
    // Private inputs (secrets)
    signal input reviewScore;            // Actual review score (0-100)
    signal input reviewerSecret;         // Reviewer's secret key
    signal input nullifierSecret;       // Secret for nullifier generation
    signal input reviewBlinding;         // Blinding factor for commitment
    signal input reviewerWeight;         // Reviewer's reputation weight
    signal input pathElements[20];       // Merkle proof elements
    signal input pathIndices[20];        // Merkle proof indices
    signal input reviewerNonce;          // Unique nonce for reviewer
    signal input evidenceHash;           // Hash of milestone evidence
    signal input reviewTimestamp;        // Timestamp of review
    
    // Output
    signal output valid;
    signal output newWeightedSum;        // New weighted score sum
    signal output newTotalWeight;        // New total weight
    signal output newReviewCount;        // New review count
    signal output milestoneStatus;       // 0=pending, 1=approved, 2=rejected
    
    // Components
    component commitmentHasher = Poseidon(6);
    component nullifierHasher = Poseidon(4);
    component reviewerHasher = Poseidon(2);
    component merkleVerifier = MerkleTreeVerifier(20);
    
    // Range and validity checks
    component scoreCheck = LessEqThan(8);
    component weightNonNegative = GreaterEqThan(252);  // Support up to 2^252-1 for large token amounts (max circomlib supports)
    component weightIsZero = IsZero();
    component timestampIsZero = IsZero();
    component evidenceIsZero = IsZero();
    
    // Milestone completion calculation
    component thresholdCheck = GreaterEqThan(128);
    component reviewCountCheck = GreaterEqThan(32);
    
    // Verify review commitment
    // commitment = hash(score, reviewerSecret, reviewBlinding, milestoneId, evidenceHash, timestamp)
    commitmentHasher.inputs[0] <== reviewScore;
    commitmentHasher.inputs[1] <== reviewerSecret;
    commitmentHasher.inputs[2] <== reviewBlinding;
    commitmentHasher.inputs[3] <== milestoneId;
    commitmentHasher.inputs[4] <== evidenceHash;
    commitmentHasher.inputs[5] <== reviewTimestamp;
    commitmentHasher.out === reviewCommitment;
    
    // Generate nullifier hash to prevent double reviews
    // nullifier = hash(reviewerSecret, nullifierSecret, milestoneId, campaignId)
    nullifierHasher.inputs[0] <== reviewerSecret;
    nullifierHasher.inputs[1] <== nullifierSecret;
    nullifierHasher.inputs[2] <== milestoneId;
    nullifierHasher.inputs[3] <== campaignId;
    nullifierHasher.out === nullifierHash;
    
    // Generate reviewer commitment for merkle tree
    reviewerHasher.inputs[0] <== reviewerSecret;
    reviewerHasher.inputs[1] <== reviewerNonce;
    
    // Verify reviewer is in eligible reviewers set
    merkleVerifier.leaf <== reviewerHasher.out;
    merkleVerifier.root <== merkleRoot;
    for (var i = 0; i < 20; i++) {
        merkleVerifier.pathElements[i] <== pathElements[i];
        merkleVerifier.pathIndices[i] <== pathIndices[i];
    }
    
    // Verify review score is valid (0-100)
    scoreCheck.in[0] <== reviewScore;
    scoreCheck.in[1] <== 100;
    scoreCheck.out === 1;
    
    // Verify reviewer has positive weight (reputation)
    weightNonNegative.in[0] <== reviewerWeight;
    weightNonNegative.in[1] <== 0;
    weightIsZero.in <== reviewerWeight;
    weightIsZero.out === 0;
    
    // Verify timestamp is valid (non-zero)
    timestampIsZero.in <== reviewTimestamp;
    timestampIsZero.out === 0;
    
    // Verify evidence hash is provided
    evidenceIsZero.in <== evidenceHash;
    evidenceIsZero.out === 0;
    
    // Calculate new weighted sum and total weight
    newWeightedSum <== weightedScoreSum + (reviewScore * reviewerWeight);
    newTotalWeight <== totalWeight + reviewerWeight;
    newReviewCount <== currentReviewCount + 1;
    
    // Calculate milestone status based on weighted average
    signal minimumWeightedScore;
    minimumWeightedScore <== minimumScore * newTotalWeight;
    
    // Check if minimum review count is met
    reviewCountCheck.in[0] <== newReviewCount;
    reviewCountCheck.in[1] <== requiredReviewers;
    
    // Check if weighted average meets minimum score
    thresholdCheck.in[0] <== newWeightedSum;
    thresholdCheck.in[1] <== minimumWeightedScore;
    
    // Determine milestone status
    // Status = 0 (pending) if not enough reviews
    // Status = 1 (approved) if enough reviews and score >= minimum
    // Status = 2 (rejected) if enough reviews and score < minimum
    signal approved;
    approved <== reviewCountCheck.out * thresholdCheck.out;
    
    signal rejected;
    rejected <== reviewCountCheck.out * (1 - thresholdCheck.out);
    
    milestoneStatus <== approved + rejected * 2;
    
    component validAnd1 = AND();
    component validAnd2 = AND();
    
    validAnd1.a <== scoreCheck.out;
    validAnd1.b <== weightNonNegative.out;
    
    validAnd2.a <== validAnd1.out;
    validAnd2.b <== reviewCountCheck.out;
    
    valid <== validAnd2.out;
}

/**
 * @title Merkle Tree Verifier
 * @dev Verifies membership in a merkle tree for reviewer eligibility
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
 * @title Milestone Status Calculator
 * @dev Calculates milestone status based on review conditions
 */
template AustrianMilestoneValidator() {
    signal input reviewScore;
    signal input reviewerReputation;
    signal input marketConsensus;
    signal input voluntaryReview;
    signal input individualAssessment;
    
    signal output austrianValid;
    
    component voluntaryCheck = IsEqual();
    component individualCheck = IsEqual();
    component reputationCheck = GreaterEqThan(32);
    component consensusCheck = GreaterEqThan(8);
    component validityAnd1 = AND();
    component validityAnd2 = AND();
    
    voluntaryCheck.in[0] <== voluntaryReview;
    voluntaryCheck.in[1] <== 1;
    
    individualCheck.in[0] <== individualAssessment;
    individualCheck.in[1] <== 1;
    
    reputationCheck.in[0] <== reviewerReputation;
    reputationCheck.in[1] <== 0;
    
    consensusCheck.in[0] <== reviewScore;
    consensusCheck.in[1] <== marketConsensus;
    
    validityAnd1.a <== voluntaryCheck.out;
    validityAnd1.b <== individualCheck.out;
    
    validityAnd2.a <== validityAnd1.out;
    validityAnd2.b <== reputationCheck.out;
    
    component validityAnd3 = AND();
    validityAnd3.a <== validityAnd2.out;
    validityAnd3.b <== consensusCheck.out;
    
    austrianValid <== validityAnd3.out;
}

// Main component with public signals
component main {public [
    campaignId,
    milestoneId,
    reviewCommitment,
    nullifierHash,
    merkleRoot,
    minimumScore,
    requiredReviewers,
    currentReviewCount,
    weightedScoreSum,
    totalWeight
]} = Milestone();