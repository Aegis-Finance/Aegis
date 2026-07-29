pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

/**
 * @title Governance Circuit
 * @dev ZK circuit for private governance voting
 * @notice Proves voting eligibility and power without revealing voter identity
 */
template Governance() {
    // Public inputs
    signal input nullifierHash;
    signal input merkleRoot;
    signal input proposalId;
    signal input voteCommitment;
    signal input votingPowerCommitment;
    
    // Private inputs
    signal input votingPower;
    signal input blinding;
    signal input nullifier;
    signal input pathElements[20];
    signal input pathIndices[20];
    signal input voteChoice; // 0=against, 1=for, 2=abstain
    signal input voteBlinding;
    signal input powerBlinding;
    signal input voterSecret;
    
    // Output
    signal output valid;
    
    // Components
    component poseidon1 = Poseidon(4);
    component poseidon2 = Poseidon(2);
    component poseidon3 = Poseidon(4);
    component poseidon4 = Poseidon(3);
    
    component merkleProof[20];
    component selector[20];
    
    component powerCheck = GreaterThan(252);  // Support up to 2^252-1 for large token amounts (max circomlib supports)
    component voteCheck = LessThan(8);
    component proposalCheck = GreaterThan(32);  // proposalId fits in 32 bits
    
    // Verify voter commitment (proves ownership of voting tokens)
    poseidon1.inputs[0] <== votingPower;
    poseidon1.inputs[1] <== blinding;
    poseidon1.inputs[2] <== nullifier;
    poseidon1.inputs[3] <== voterSecret;
    
    // Verify nullifier hash (prevents double voting)
    poseidon2.inputs[0] <== nullifier;
    poseidon2.inputs[1] <== proposalId; // Bind nullifier to specific proposal
    poseidon2.out === nullifierHash;
    
    // Verify vote commitment
    poseidon3.inputs[0] <== voteChoice;
    poseidon3.inputs[1] <== votingPower;
    poseidon3.inputs[2] <== proposalId;
    poseidon3.inputs[3] <== voteBlinding;
    poseidon3.out === voteCommitment;
    
    // Verify voting power commitment
    poseidon4.inputs[0] <== votingPower;
    poseidon4.inputs[1] <== proposalId;
    poseidon4.inputs[2] <== powerBlinding;
    poseidon4.out === votingPowerCommitment;
    
    // Merkle tree verification (proves voter is in eligible voter set)
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
    
    // Verify voting power is positive
    powerCheck.in[0] <== votingPower;
    powerCheck.in[1] <== 0;
    powerCheck.out === 1;
    
    // Verify vote choice is valid (0, 1, or 2)
    voteCheck.in[0] <== voteChoice;
    voteCheck.in[1] <== 3;
    voteCheck.out === 1;
    
    // Verify proposal ID is valid
    proposalCheck.in[0] <== proposalId;
    proposalCheck.in[1] <== 0;
    proposalCheck.out === 1;
    
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

component main {public [nullifierHash, merkleRoot, proposalId, voteCommitment, votingPowerCommitment]} = Governance();