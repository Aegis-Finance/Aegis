pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/gates.circom";

/**
 * @title Refund Circuit
 * @dev ZK circuit for private refund requests implementing Austrian Economics principles:
 *      - Individual Sovereignty: Private refund amounts and contributor identities
 *      - Voluntary Association: Opt-in refund eligibility verification
 *      - Sound Money: Cryptographic proof of contribution and refund validity
 *      - Market-Driven Justice: Reputation-based refund approval
 *      - Methodological Individualism: Individual refund decisions and assessments
 */
template Refund() {
    // Public inputs (visible on-chain)
    signal input campaignId;              // Campaign identifier
    signal input refundCommitment;        // Commitment to refund request
    signal input nullifierHash;          // Prevents double refund requests
    signal input contributionMerkleRoot;  // Root of contributors tree
    signal input refundReason;            // Reason code for refund (1-10)
    signal input campaignStatus;          // Current campaign status
    signal input refundDeadline;         // Deadline for refund requests
    signal input currentTimestamp;       // Current block timestamp
    signal input totalRefundPool;        // Total available for refunds
    signal input currentRefundClaimed;   // Already claimed refunds
    
    // Private inputs (secrets)
    signal input originalContribution;   // Original contribution amount
    signal input contributorSecret;     // Contributor's secret key
    signal input nullifierSecret;       // Secret for nullifier generation
    signal input refundBlinding;         // Blinding factor for commitment
    signal input contributionProof[20];  // Merkle proof of original contribution
    signal input contributionIndices[20]; // Merkle proof indices
    signal input contributorNonce;       // Unique nonce for contributor
    signal input refundJustification;    // Private justification hash
    signal input contributorReputation;  // Contributor's reputation score
    
    // Output
    signal output valid;
    signal output refundAmount;          // Calculated refund amount
    signal output newRefundClaimed;      // New total claimed refunds
    signal output refundEligible;        // Whether refund is eligible
    
    // Components
    component commitmentHasher = Poseidon(6);
    component nullifierHasher = Poseidon(4);
    component contributorHasher = Poseidon(2);
    component merkleVerifier = MerkleTreeVerifier(20);
    
    // Validation checks
    component reasonCheck = LessEqThan(8);
    component deadlineCheck = LessEqThan(64);  // Timestamp fits in 64 bits
    component contributionCheck = GreaterEqThan(252);  // Support up to 2^252-1 for large token amounts (max circomlib supports)
    component contributionIsZero = IsZero();
    component poolCheck = GreaterEqThan(252);  // Support up to 2^252-1 for large token amounts (max circomlib supports)
    component statusCheck = RefundStatusValidator();
    component reputationCheck = GreaterEqThan(32);
    
    // Refund calculation
    component refundCalculator = RefundCalculator();
    
    // Verify refund commitment
    // commitment = hash(originalContribution, contributorSecret, refundBlinding, refundReason, refundJustification, campaignId)
    commitmentHasher.inputs[0] <== originalContribution;
    commitmentHasher.inputs[1] <== contributorSecret;
    commitmentHasher.inputs[2] <== refundBlinding;
    commitmentHasher.inputs[3] <== refundReason;
    commitmentHasher.inputs[4] <== refundJustification;
    commitmentHasher.inputs[5] <== campaignId;
    commitmentHasher.out === refundCommitment;
    
    // Generate nullifier hash to prevent double refund requests
    // nullifier = hash(contributorSecret, nullifierSecret, campaignId, refundReason)
    nullifierHasher.inputs[0] <== contributorSecret;
    nullifierHasher.inputs[1] <== nullifierSecret;
    nullifierHasher.inputs[2] <== campaignId;
    nullifierHasher.inputs[3] <== refundReason;
    nullifierHasher.out === nullifierHash;
    
    // Generate contributor commitment for merkle tree verification
    contributorHasher.inputs[0] <== contributorSecret;
    contributorHasher.inputs[1] <== contributorNonce;
    
    // Verify contributor made original contribution
    merkleVerifier.leaf <== contributorHasher.out;
    merkleVerifier.root <== contributionMerkleRoot;
    for (var i = 0; i < 20; i++) {
        merkleVerifier.pathElements[i] <== contributionProof[i];
        merkleVerifier.pathIndices[i] <== contributionIndices[i];
    }
    
    // Verify refund reason is valid (1-10)
    reasonCheck.in[0] <== refundReason;
    reasonCheck.in[1] <== 10;
    reasonCheck.out === 1;
    
    // Verify refund request is within deadline
    deadlineCheck.in[0] <== currentTimestamp;
    deadlineCheck.in[1] <== refundDeadline;
    deadlineCheck.out === 1;
    
    // Verify original contribution is positive
    contributionCheck.in[0] <== originalContribution;
    contributionCheck.in[1] <== 0;
    contributionIsZero.in <== originalContribution;
    contributionIsZero.out === 0;
    
    // Verify contributor has sufficient reputation for refund
    reputationCheck.in[0] <== contributorReputation;
    reputationCheck.in[1] <== 50; // Minimum reputation threshold
    reputationCheck.out === 1;
    
    // Verify campaign status allows refunds
    statusCheck.campaignStatus <== campaignStatus;
    statusCheck.refundReason <== refundReason;
    
    // Calculate refund amount based on reason and campaign status
    refundCalculator.originalContribution <== originalContribution;
    refundCalculator.refundReason <== refundReason;
    refundCalculator.campaignStatus <== campaignStatus;
    refundCalculator.contributorReputation <== contributorReputation;
    refundAmount <== refundCalculator.refundAmount;
    
    // Verify refund pool has sufficient funds
    newRefundClaimed <== currentRefundClaimed + refundAmount;
    poolCheck.in[0] <== totalRefundPool;
    poolCheck.in[1] <== newRefundClaimed;
    poolCheck.out === 1;
    
    // Determine overall refund eligibility
    component eligibleAnd1 = AND();
    eligibleAnd1.a <== statusCheck.eligible;
    eligibleAnd1.b <== poolCheck.out;
    
    component eligibleAnd2 = AND();
    eligibleAnd2.a <== eligibleAnd1.out;
    eligibleAnd2.b <== reputationCheck.out;
    
    refundEligible <== eligibleAnd2.out;
    
    component validAnd1 = AND();
    component validAnd2 = AND();
    component validAnd3 = AND();
    component validAnd4 = AND();
    
    validAnd1.a <== reasonCheck.out;
    validAnd1.b <== deadlineCheck.out;
    
    validAnd2.a <== validAnd1.out;
    validAnd2.b <== contributionCheck.out;
    
    validAnd3.a <== validAnd2.out;
    validAnd3.b <== eligibleAnd2.out;
    
    validAnd4.a <== validAnd3.out;
    validAnd4.b <== statusCheck.eligible;
    
    valid <== validAnd4.out;
}

/**
 * @title Merkle Tree Verifier
 * @dev Verifies membership in a merkle tree for contribution proof
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
 * @title Refund Status Validator
 * @dev Validates if campaign status allows refunds for given reason
 */
template RefundStatusValidator() {
    signal input campaignStatus;  // 0=active, 1=successful, 2=failed, 3=cancelled
    signal input refundReason;    // 1-10 different refund reasons
    signal output eligible;
    
    // Refund eligibility matrix based on Austrian Economics principles
    component statusChecks[4];
    component reasonChecks[10];
    
    // Campaign status checks
    statusChecks[0] = IsEqual(); // Active campaigns
    statusChecks[0].in[0] <== campaignStatus;
    statusChecks[0].in[1] <== 0;
    
    statusChecks[1] = IsEqual(); // Successful campaigns
    statusChecks[1].in[0] <== campaignStatus;
    statusChecks[1].in[1] <== 1;
    
    statusChecks[2] = IsEqual(); // Failed campaigns
    statusChecks[2].in[0] <== campaignStatus;
    statusChecks[2].in[1] <== 2;
    
    statusChecks[3] = IsEqual(); // Cancelled campaigns
    statusChecks[3].in[0] <== campaignStatus;
    statusChecks[3].in[1] <== 3;
    
    // Refund reason eligibility
    // Reason 1-3: Always eligible for failed/cancelled campaigns
    // Reason 4-6: Eligible for active campaigns with justification
    // Reason 7-10: Special circumstances, case-by-case
    
    component eligibilityCalculator = RefundEligibilityCalculator();
    eligibilityCalculator.campaignStatus <== campaignStatus;
    eligibilityCalculator.refundReason <== refundReason;
    
    eligible <== eligibilityCalculator.eligible;
}

/**
 * @title Refund Eligibility Calculator
 * @dev Calculates refund eligibility based on Austrian Economics principles
 */
template RefundEligibilityCalculator() {
    signal input campaignStatus;
    signal input refundReason;
    signal output eligible;
    
    // Austrian Economics refund principles:
    // 1. Individual sovereignty: Contributors can exit voluntary associations
    // 2. Contract enforcement: Refunds based on agreed terms
    // 3. Market justice: Reputation-based refund approval
    
    component reasonRange1 = InRange(8); // Reasons 1-3: Project failure
    reasonRange1.in <== refundReason;
    reasonRange1.lower <== 1;
    reasonRange1.upper <== 3;
    
    component reasonRange2 = InRange(8); // Reasons 4-6: Creator misconduct
    reasonRange2.in <== refundReason;
    reasonRange2.lower <== 4;
    reasonRange2.upper <== 6;
    
    component reasonRange3 = InRange(8); // Reasons 7-10: Special circumstances
    reasonRange3.in <== refundReason;
    reasonRange3.lower <== 7;
    reasonRange3.upper <== 10;
    
    component statusFailed = IsEqual();
    statusFailed.in[0] <== campaignStatus;
    statusFailed.in[1] <== 2; // Failed
    
    component statusCancelled = IsEqual();
    statusCancelled.in[0] <== campaignStatus;
    statusCancelled.in[1] <== 3; // Cancelled
    
    component statusActive = IsEqual();
    statusActive.in[0] <== campaignStatus;
    statusActive.in[1] <== 0; // Active
    
    // Eligibility logic
    // Always eligible for failed/cancelled campaigns
    signal failedOrCancelled;
    failedOrCancelled <== statusFailed.out + statusCancelled.out;
    
    signal activeWithMisconduct;
    activeWithMisconduct <== statusActive.out * reasonRange2.out;
    
    signal specialCircumstances;
    specialCircumstances <== reasonRange3.out;
    
    signal activeOrSpecial;
    activeOrSpecial <== activeWithMisconduct + specialCircumstances - activeWithMisconduct * specialCircumstances;
    
    eligible <== failedOrCancelled + (1 - failedOrCancelled) * activeOrSpecial;
}

/**
 * @title Refund Calculator
 * @dev Calculates refund amount based on Austrian Economics principles
 */
template RefundCalculator() {
    signal input originalContribution;
    signal input refundReason;
    signal input campaignStatus;
    signal input contributorReputation;
    signal output refundAmount;
    
    // Refund percentage based on reason and status
    component percentageCalculator = RefundPercentageCalculator();
    percentageCalculator.refundReason <== refundReason;
    percentageCalculator.campaignStatus <== campaignStatus;
    percentageCalculator.contributorReputation <== contributorReputation;
    
    // Calculate refund amount ensuring integer division by 100
    signal percentageProduct;
    percentageProduct <== originalContribution * percentageCalculator.percentage;
    
    var INV100 = 10287474149764459354455810700270919291617731268195536141538155967690629992940;
    refundAmount <== percentageProduct * INV100;
}

/**
 * @title Refund Percentage Calculator
 * @dev Calculates refund percentage based on Austrian Economics market principles
 */
template RefundPercentageCalculator() {
    signal input refundReason;
    signal input campaignStatus;
    signal input contributorReputation;
    signal output percentage;
    
    // Categorize refund reasons
    component reasonTier1 = InRange(8); // Reasons 1-3
    reasonTier1.in <== refundReason;
    reasonTier1.lower <== 1;
    reasonTier1.upper <== 3;
    
    component reasonTier2 = InRange(8); // Reasons 4-6
    reasonTier2.in <== refundReason;
    reasonTier2.lower <== 4;
    reasonTier2.upper <== 6;
    
    component reasonTier3 = InRange(8); // Reasons 7-10
    reasonTier3.in <== refundReason;
    reasonTier3.lower <== 7;
    reasonTier3.upper <== 10;
    
    signal basePercentage;
    basePercentage <== reasonTier1.out * 100 + reasonTier2.out * 80 + reasonTier3.out * 60;
    
    component reputationBonus = ReputationBonus();
    reputationBonus.reputation <== contributorReputation;
    reputationBonus.basePercentage <== basePercentage;
    
    percentage <== reputationBonus.adjustedPercentage;
}

/**
 * @title Reputation Bonus
 * @dev Adjusts refund percentage based on contributor reputation
 */
template ReputationBonus() {
    signal input reputation;
    signal input basePercentage;
    signal output adjustedPercentage;
    
    // Higher reputation contributors get up to 10% bonus
    component reputationCheck = GreaterEqThan(32);
    reputationCheck.in[0] <== reputation;
    reputationCheck.in[1] <== 81; // High reputation threshold (>80)
    
    signal bonus;
    bonus <== reputationCheck.out * 10; // 10% bonus for high reputation
    
    adjustedPercentage <== basePercentage + bonus;
}

/**
 * @title In Range
 * @dev Checks if a value is within a specified range
 */
template InRange(n) {
    signal input in;
    signal input lower;
    signal input upper;
    signal output out;
    
    component lowerCheck = GreaterEqThan(n);
    component upperCheck = LessEqThan(n);
    
    lowerCheck.in[0] <== in;
    lowerCheck.in[1] <== lower;
    
    upperCheck.in[0] <== in;
    upperCheck.in[1] <== upper;
    
    out <== lowerCheck.out * upperCheck.out;
}

/**
 * @title Austrian Economics Refund Validator
 * @dev Additional validation for Austrian Economics principles in refunds
 */
template AustrianRefundValidator() {
    signal input originalContribution;
    signal input refundReason;
    signal input voluntaryExit;
    signal input contractualBasis;
    signal input marketJustification;
    
    signal output austrianValid;
    
    component voluntaryCheck = IsEqual();
    component contractCheck = IsEqual();
    component marketCheck = GreaterEqThan(32);  // Market ID fits in 32 bits
    component contributionCheck = GreaterEqThan(252);  // Support up to 2^252-1 for large token amounts (max circomlib supports)
    component contributionIsZeroCheck = IsZero();
    component austrianAnd1 = AND();
    component austrianAnd2 = AND();
    component austrianAnd3 = AND();
    
    // Verify exit is voluntary (individual sovereignty)
    voluntaryCheck.in[0] <== voluntaryExit;
    voluntaryCheck.in[1] <== 1;
    
    // Verify contractual basis exists
    contractCheck.in[0] <== contractualBasis;
    contractCheck.in[1] <== 1;
    
    // Verify market justification
    marketCheck.in[0] <== marketJustification;
    marketCheck.in[1] <== 50; // Minimum market justification score
    
    // Verify contribution is valid
    contributionCheck.in[0] <== originalContribution;
    contributionCheck.in[1] <== 0;
    contributionIsZeroCheck.in <== originalContribution;
    contributionIsZeroCheck.out === 0;
    
    austrianAnd1.a <== voluntaryCheck.out;
    austrianAnd1.b <== contractCheck.out;
    
    austrianAnd2.a <== austrianAnd1.out;
    austrianAnd2.b <== marketCheck.out;
    
    austrianAnd3.a <== austrianAnd2.out;
    austrianAnd3.b <== contributionCheck.out;
    
    austrianValid <== austrianAnd3.out;
}

// Main component with public signals
component main {public [
    campaignId,
    refundCommitment,
    nullifierHash,
    contributionMerkleRoot,
    refundReason,
    campaignStatus,
    refundDeadline,
    currentTimestamp,
    totalRefundPool,
    currentRefundClaimed
]} = Refund();