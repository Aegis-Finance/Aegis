pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

/**
 * @title Bridge Circuit
 * @dev ZK circuit for cross-chain bridge operations
 * @notice Proves valid cross-chain transfers without revealing amounts or addresses
 */
template Bridge() {
    // Public inputs
    signal input nullifierHash;
    signal input merkleRoot;
    signal input destinationChain;
    signal input transferCommitment;
    signal input feeCommitment;
    
    // Private inputs
    signal input amount;
    signal input blinding;
    signal input nullifier;
    signal input pathElements[20];
    signal input pathIndices[20];
    signal input destinationAddress;
    signal input fee;
    signal input transferBlinding;
    signal input feeBlinding;
    signal input nonce;
    
    // Output
    signal output valid;
    
    // Components
    component poseidon1 = Poseidon(3);
    component poseidon2 = Poseidon(2);
    component poseidon3 = Poseidon(5);
    component poseidon4 = Poseidon(3);
    
    component merkleProof[20];
    component selector[20];
    
    component amountCheck = GreaterThan(252);  // Support up to 2^252-1 for large token amounts (max circomlib supports)
    component feeCheck = GreaterThan(252);  // Support up to 2^252-1 for large token amounts (max circomlib supports)
    component chainCheck = GreaterThan(32);  // Chain ID fits in 32 bits
    component balanceCheck = GreaterEqThan(252);  // Support up to 2^252-1 for large token amounts (max circomlib supports)
    
    // Verify input commitment
    poseidon1.inputs[0] <== amount;
    poseidon1.inputs[1] <== blinding;
    poseidon1.inputs[2] <== nullifier;
    
    // Verify nullifier hash
    poseidon2.inputs[0] <== nullifier;
    poseidon2.inputs[1] <== destinationChain; // Bind to destination chain
    poseidon2.out === nullifierHash;
    
    // Verify transfer commitment
    poseidon3.inputs[0] <== amount - fee; // Net amount after fee
    poseidon3.inputs[1] <== destinationAddress;
    poseidon3.inputs[2] <== destinationChain;
    poseidon3.inputs[3] <== nonce;
    poseidon3.inputs[4] <== transferBlinding;
    poseidon3.out === transferCommitment;
    
    // Verify fee commitment
    poseidon4.inputs[0] <== fee;
    poseidon4.inputs[1] <== destinationChain;
    poseidon4.inputs[2] <== feeBlinding;
    poseidon4.out === feeCommitment;
    
    // Merkle tree verification
    var currentHash = poseidon1.out;
    for (var i = 0; i < 20; i++) {
        merkleProof[i] = Poseidon(2);
        selector[i] = Selector();
        
        selector[i].in[0] <== currentHash;
        selector[i].in[1] <== pathElements[i];
        selector[i].sel <== pathIndices[i];
        
        merkleProof[i].inputs[0] <== selector[i].out[0];
        merkleProof[i].inputs[1] <== selector[i].out[1];
        currentHash = merkleProof[i].out;
    }
    currentHash === merkleRoot;
    
    // Verify amount is positive
    amountCheck.in[0] <== amount;
    amountCheck.in[1] <== 0;
    amountCheck.out === 1;
    
    // Verify fee is positive
    feeCheck.in[0] <== fee;
    feeCheck.in[1] <== 0;
    feeCheck.out === 1;
    
    // Verify destination chain is valid
    chainCheck.in[0] <== destinationChain;
    chainCheck.in[1] <== 0;
    chainCheck.out === 1;
    
    // Verify sufficient balance (amount >= fee)
    balanceCheck.in[0] <== amount;
    balanceCheck.in[1] <== fee;
    balanceCheck.out === 1;
    
    valid <== 1;
}

template Selector() {
    signal input in[2];
    signal input sel;
    signal output out[2];
    
    signal temp1;
    signal temp2;
    signal temp3;
    signal temp4;
    
    temp1 <== (1 - sel) * in[0];
    temp2 <== sel * in[1];
    out[0] <== temp1 + temp2;
    
    temp3 <== (1 - sel) * in[1];
    temp4 <== sel * in[0];
    out[1] <== temp3 + temp4;
}

component main {public [nullifierHash, merkleRoot, destinationChain, transferCommitment, feeCommitment]} = Bridge();