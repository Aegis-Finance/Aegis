pragma circom 2.0.0;

/**
 * @title Complex Test Circuit
 * @author Sentinel - CTO & Smart Contract Architect
 * @notice Complex circuit for testing trusted setup ceremony with multiple constraints
 * @dev This circuit proves knowledge of multiple secrets and their relationships
 */

include "../../node_modules/circomlib/circuits/poseidon.circom";
include "../../node_modules/circomlib/circuits/comparators.circom";

template ComplexProof() {
    // Private inputs
    signal input secret1;
    signal input secret2;
    signal input nonce;
    
    // Public inputs
    signal input publicHash1;
    signal input publicHash2;
    signal input combinedHash;
    signal input minValue;
    signal input maxValue;
    
    // Output signals
    signal output isValid;
    signal output proofHash;
    
    // Hash individual secrets
    component hasher1 = Poseidon(1);
    hasher1.inputs[0] <== secret1;
    
    component hasher2 = Poseidon(1);
    hasher2.inputs[0] <== secret2;
    
    // Verify individual hashes
    component eq1 = IsEqual();
    eq1.in[0] <== hasher1.out;
    eq1.in[1] <== publicHash1;
    
    component eq2 = IsEqual();
    eq2.in[0] <== hasher2.out;
    eq2.in[1] <== publicHash2;
    
    // Hash combination of secrets
    component combinedHasher = Poseidon(3);
    combinedHasher.inputs[0] <== secret1;
    combinedHasher.inputs[1] <== secret2;
    combinedHasher.inputs[2] <== nonce;
    
    // Verify combined hash
    component eq3 = IsEqual();
    eq3.in[0] <== combinedHasher.out;
    eq3.in[1] <== combinedHash;
    
    // Range check for secret1
    component gte = GreaterEqThan(64);
    gte.in[0] <== secret1;
    gte.in[1] <== minValue;
    
    component lte = LessEqThan(64);
    lte.in[0] <== secret1;
    lte.in[1] <== maxValue;
    
    // Ensure secret2 is non-zero
    component nonZero = IsZero();
    nonZero.in <== secret2;
    
    // All conditions must be satisfied
    signal allValid;
    allValid <== eq1.out * eq2.out * eq3.out * gte.out * lte.out * (1 - nonZero.out);
    
    // Output validation
    isValid <== allValid;
    isValid === 1;
    
    // Generate proof hash
    component proofHasher = Poseidon(4);
    proofHasher.inputs[0] <== publicHash1;
    proofHasher.inputs[1] <== publicHash2;
    proofHasher.inputs[2] <== combinedHash;
    proofHasher.inputs[3] <== nonce;
    
    proofHash <== proofHasher.out;
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

component main = ComplexProof();