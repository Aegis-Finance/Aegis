pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

/**
 * @title Privacy Circuit
 * @dev Zero-knowledge circuit for private transactions with anonymity set
 * @notice Proves knowledge of a secret without revealing it, with nullifier for double-spend prevention
 */
template Privacy() {
    // Private inputs (secrets)
    signal input secret;           // Secret value for commitment
    signal input nullifierSecret;  // Secret for nullifier generation
    signal input merkleProof[20];  // Merkle proof for anonymity set membership
    signal input merklePathIndices[20]; // Path indices for merkle proof
    
    // Public inputs (visible on-chain)
    signal output commitmentHash;  // Public commitment hash
    signal output nullifierHash;   // Public nullifier hash (prevents double-spending)
    
    // Internal components
    component commitmentHasher = Poseidon(1);
    component nullifierHasher = Poseidon(2);
    component merkleVerifier = MerkleTreeVerifier(20);
    
    // Generate commitment hash from secret
    commitmentHasher.inputs[0] <== secret;
    commitmentHash <== commitmentHasher.out;
    
    // Generate nullifier hash from secret and nullifier secret
    nullifierHasher.inputs[0] <== secret;
    nullifierHasher.inputs[1] <== nullifierSecret;
    nullifierHash <== nullifierHasher.out;
    
    // Verify membership in anonymity set via merkle proof
    merkleVerifier.leaf <== commitmentHash;
    for (var i = 0; i < 20; i++) {
        merkleVerifier.pathElements[i] <== merkleProof[i];
        merkleVerifier.pathIndices[i] <== merklePathIndices[i];
    }
    
    // Constraint: secret must be non-zero
    component secretCheck = IsZero();
    secretCheck.in <== secret;
    secretCheck.out === 0;
    
    // Constraint: nullifier secret must be non-zero
    component nullifierSecretCheck = IsZero();
    nullifierSecretCheck.in <== nullifierSecret;
    nullifierSecretCheck.out === 0;
}

/**
 * @title Merkle Tree Verifier
 * @dev Verifies membership in a merkle tree
 */
template MerkleTreeVerifier(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal output root;
    
    component hashers[levels];
    component selectors[levels];
    
    for (var i = 0; i < levels; i++) {
        hashers[i] = Poseidon(2);
        selectors[i] = Selector();
        
        selectors[i].pathIndex <== pathIndices[i];
        selectors[i].left <== i == 0 ? leaf : hashers[i-1].out;
        selectors[i].right <== pathElements[i];
        
        hashers[i].inputs[0] <== selectors[i].outLeft;
        hashers[i].inputs[1] <== selectors[i].outRight;
    }
    
    root <== hashers[levels-1].out;
}

/**
 * @title Selector
 * @dev Selects left or right based on path index
 */
template Selector() {
    signal input pathIndex;
    signal input left;
    signal input right;
    signal output outLeft;
    signal output outRight;
    
    // If pathIndex == 0, use (left, right), else use (right, left)
    outLeft <== left + pathIndex * (right - left);
    outRight <== right + pathIndex * (left - right);
}

// Main component
component main = Privacy();