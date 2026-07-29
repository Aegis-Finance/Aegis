pragma circom 2.0.0;

/**
 * @title transfer-optimized (legacy Merkle transfer experiment)
 * @notice **Not** aligned with `PrivateTokenContract.unshield` (4 public slots, no Merkle root).
 *         EOA **unshield** must use the `transfer-unshield` factory circuit + verifier wired via
 *         `transferUnshieldVerifier` (see `PrivateTokenContract` + `transfer-unshield.circom`).
 * @dev On-chain, `PrivateTokenContract` does **not** substitute this VK for 4- or 11-public rails — dedicated
 *      slots must be factory-registered or calls revert `InvalidVerifier`. Use **`MockZKVerifier`** only in tests
 *      when you intentionally bypass layout checks; production / Sonic deploys must wire `transfer-unshield`,
 *      `transfer-to-pool`, etc.
 */

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

template OptimizedTransfer() {
    // Public inputs
    signal input nullifierHash;
    signal input commitmentHash;
    signal input merkleRoot;
    signal input recipient;
    signal input amount;
    
    // Private inputs
    signal input secret;
    signal input nullifier;
    signal input pathElements[20];
    signal input pathIndices[20];
    
    // Outputs
    signal output valid;
    
    // Components
    component nullifierHasher = Poseidon(2);
    component commitmentHasher = Poseidon(3);
    component merkleProof = MerkleTreeInclusionProof(20);
    component amountCheck = GreaterThan(252);  // Support up to 2^252-1 for large token amounts (max circomlib supports)
    
    // Nullifier hash verification
    nullifierHasher.inputs[0] <== secret;
    nullifierHasher.inputs[1] <== nullifier;
    nullifierHasher.out === nullifierHash;
    
    // Commitment hash verification
    commitmentHasher.inputs[0] <== secret;
    commitmentHasher.inputs[1] <== amount;
    commitmentHasher.inputs[2] <== recipient;
    commitmentHasher.out === commitmentHash;
    
    // Merkle proof verification
    merkleProof.leaf <== commitmentHash;
    merkleProof.root <== merkleRoot;
    for (var i = 0; i < 20; i++) {
        merkleProof.pathElements[i] <== pathElements[i];
        merkleProof.pathIndices[i] <== pathIndices[i];
    }
    
    // Amount range check (ensure amount is positive)
    amountCheck.in[0] <== amount;
    amountCheck.in[1] <== 0;
    amountCheck.out === 1;
    
    // Output validation
    valid <== merkleProof.root;
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
    
    // Use intermediate signals to ensure quadratic constraints
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

component main {public [nullifierHash, commitmentHash, merkleRoot, recipient, amount]} = OptimizedTransfer();