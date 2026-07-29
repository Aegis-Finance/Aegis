pragma circom 2.0.0;

/**
 * @title Simple Test Circuit
 * @author Sentinel - CTO & Smart Contract Architect
 * @notice Simple circuit for testing trusted setup ceremony
 * @dev This circuit proves knowledge of a secret that hashes to a public value
 */

include "../../node_modules/circomlib/circuits/poseidon.circom";

template SimpleProof() {
    // Private input (secret)
    signal input secret;
    
    // Public input (hash of secret)
    signal input publicHash;
    
    // Output signal
    signal output isValid;
    
    // Hash the secret
    component hasher = Poseidon(1);
    hasher.inputs[0] <== secret;
    
    // Verify the hash matches
    component eq = IsEqual();
    eq.in[0] <== hasher.out;
    eq.in[1] <== publicHash;
    
    // Output the result
    isValid <== eq.out;
    
    // Constraint to ensure the proof is valid
    isValid === 1;
}

template IsEqual() {
    signal input in[2];
    signal output out;
    
    component eq = IsZero();
    eq.in <== in[0] - in[1];
    out <== eq.out;
}

template IsZero() {
    signal input in;
    signal output out;
    
    signal inv;
    
    inv <-- in != 0 ? 1/in : 0;
    
    out <== -in*inv + 1;
    in*out === 0;
}

component main = SimpleProof();