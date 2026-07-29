pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/gates.circom";

/**
 * @title Bonding Curve Sell Circuit
 * @dev Privacy-preserving bonding curve sell with ZK proof
 * @notice Proves valid token sale without revealing seller identity
 */
template BondingCurveSell() {
    // Public inputs
    signal input merkleRoot;         // Merkle root of valid commitments (public)
    signal input nullifierHash;      // Nullifier hash (public, prevents double-spending)
    signal input commitmentHash;    // Commitment hash (public, privacy-preserving)
    signal input tokenAmount;        // Amount of tokens being sold (public)
    signal input recipient;          // Recipient address for SONIC (public, as uint256)
    
    // Private inputs
    signal input secret;              // Seller's secret key (private)
    signal input nullifier;         // Unique nullifier (private)
    signal input originalAmount;     // Original token amount in commitment (private)
    signal input pathElements[20];  // Merkle proof path elements
    signal input pathIndices[20];   // Merkle proof path indices
    
    // Output
    signal output valid;
    
    // Components
    component nullifierHasher = Poseidon(2);
    component commitmentHasher = Poseidon(3);
    component merkleProof = MerkleTreeInclusionProof(20);
    component amountCheck = GreaterThan(252);  // Support up to 2^252-1 for large token amounts (max circomlib supports)
    
    // 1. Verify nullifier hash
    nullifierHasher.inputs[0] <== secret;
    nullifierHasher.inputs[1] <== nullifier;
    nullifierHasher.out === nullifierHash;
    
    // 2. Verify commitment hash (includes: secret, originalAmount, nullifier)
    commitmentHasher.inputs[0] <== secret;
    commitmentHasher.inputs[1] <== originalAmount;
    commitmentHasher.inputs[2] <== nullifier;
    commitmentHasher.out === commitmentHash;
    
    // 3. Verify merkle proof (proves commitment is in valid set)
    merkleProof.leaf <== commitmentHash;
    merkleProof.root <== merkleRoot;
    for (var i = 0; i < 20; i++) {
        merkleProof.pathElements[i] <== pathElements[i];
        merkleProof.pathIndices[i] <== pathIndices[i];
    }
    
    // 4. Verify token amount matches commitment (or is less for partial sells)
    component amountLessEq = LessEqThan(252);  // Support up to 2^252-1 for large token amounts (max circomlib supports)
    amountLessEq.in[0] <== tokenAmount;
    amountLessEq.in[1] <== originalAmount;
    amountLessEq.out === 1; // tokenAmount <= originalAmount
    
    // 5. Range checks
    amountCheck.in[0] <== tokenAmount;
    amountCheck.in[1] <== 0;
    amountCheck.out === 1; // tokenAmount > 0
    
    valid <== 1;
}

template MerkleTreeInclusionProof(levels) {
    signal input leaf;
    signal input root;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    
    signal output out;
    
    component hashers[levels];
    component selectors[levels];
    
    signal currentHash[levels + 1];
    currentHash[0] <== leaf;
    
    for (var i = 0; i < levels; i++) {
        selectors[i] = Selector();
        selectors[i].in[0] <== currentHash[i];
        selectors[i].in[1] <== pathElements[i];
        selectors[i].sel <== pathIndices[i];
        
        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== selectors[i].out[0];
        hashers[i].inputs[1] <== selectors[i].out[1];
        
        currentHash[i + 1] <== hashers[i].out;
    }
    
    out <== currentHash[levels];
    root === out;
}

template Selector() {
    signal input in[2];
    signal input sel;
    signal output out[2];
    
    signal sel_complement;
    signal temp1, temp2, temp3, temp4;
    
    sel_complement <== 1 - sel;
    temp1 <== sel_complement * in[0];
    temp2 <== sel * in[1];
    out[0] <== temp1 + temp2;
    
    temp3 <== sel * in[0];
    temp4 <== sel_complement * in[1];
    out[1] <== temp3 + temp4;
}

// Public inputs order matches contract: root, nullifierHash, commitmentHash, amount, recipient
component main {public [merkleRoot, nullifierHash, commitmentHash, tokenAmount, recipient]} = BondingCurveSell();

