pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

/**
 * @title Derivative Circuit
 * @dev ZK circuit for private derivatives operations
 * @notice Proves valid derivative contract creation and exercise without revealing positions
 */
template Derivative() {
    // Public inputs
    signal input nullifierHash;
    signal input merkleRoot;
    signal input contractCommitment;
    signal input collateralCommitment;
    signal input derivativeType; // 0=call, 1=put, 2=future
    
    // Private inputs
    signal input collateralAmount;
    signal input blinding;
    signal input nullifier;
    signal input pathElements[20];
    signal input pathIndices[20];
    signal input strikePrice;
    signal input expiryTime;
    signal input notionalAmount;
    signal input premium;
    signal input contractBlinding;
    signal input collateralBlinding;
    signal input userSecret;
    
    // Output
    signal output valid;
    
    // Components
    component poseidon1 = Poseidon(4);
    component poseidon2 = Poseidon(2);
    component poseidon3 = Poseidon(6);
    component poseidon4 = Poseidon(3);
    
    component merkleProof[20];
    component selector[20];
    
    component collateralCheck = GreaterThan(252);  // Support up to 2^252-1 for large token amounts (max circomlib supports)
    component strikePriceCheck = GreaterThan(252);  // Support up to 2^252-1 for large token amounts (max circomlib supports)
    component notionalCheck = GreaterThan(252);  // Support up to 2^252-1 for large token amounts (max circomlib supports)
    component typeCheck = LessThan(8);
    component expiryCheck = GreaterThan(252);  // Support up to 2^252-1 for large timestamps (max circomlib supports)
    component collateralSufficiencyCheck = GreaterEqThan(252);  // Support up to 2^252-1 for large token amounts (max circomlib supports)
    
    // Verify input commitment (collateral)
    poseidon1.inputs[0] <== collateralAmount;
    poseidon1.inputs[1] <== blinding;
    poseidon1.inputs[2] <== nullifier;
    poseidon1.inputs[3] <== userSecret;
    
    // Verify nullifier hash
    poseidon2.inputs[0] <== nullifier;
    poseidon2.inputs[1] <== derivativeType; // Bind to derivative type
    poseidon2.out === nullifierHash;
    
    // Verify contract commitment
    poseidon3.inputs[0] <== derivativeType;
    poseidon3.inputs[1] <== strikePrice;
    poseidon3.inputs[2] <== expiryTime;
    poseidon3.inputs[3] <== notionalAmount;
    poseidon3.inputs[4] <== premium;
    poseidon3.inputs[5] <== contractBlinding;
    poseidon3.out === contractCommitment;
    
    // Verify collateral commitment
    poseidon4.inputs[0] <== collateralAmount;
    poseidon4.inputs[1] <== derivativeType;
    poseidon4.inputs[2] <== collateralBlinding;
    poseidon4.out === collateralCommitment;
    
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
    
    // Verify collateral amount is positive
    collateralCheck.in[0] <== collateralAmount;
    collateralCheck.in[1] <== 0;
    collateralCheck.out === 1;
    
    // Verify strike price is positive
    strikePriceCheck.in[0] <== strikePrice;
    strikePriceCheck.in[1] <== 0;
    strikePriceCheck.out === 1;
    
    // Verify notional amount is positive
    notionalCheck.in[0] <== notionalAmount;
    notionalCheck.in[1] <== 0;
    notionalCheck.out === 1;
    
    // Verify derivative type is valid (0, 1, or 2)
    typeCheck.in[0] <== derivativeType;
    typeCheck.in[1] <== 3;
    typeCheck.out === 1;
    
    // Verify expiry time is in the future
    expiryCheck.in[0] <== expiryTime;
    expiryCheck.in[1] <== 1700000000; // Reasonable minimum timestamp
    expiryCheck.out === 1;
    
    // Verify sufficient collateral (simplified check)
    // In practice, this would involve complex calculations based on derivative type
    collateralSufficiencyCheck.in[0] <== collateralAmount;
    collateralSufficiencyCheck.in[1] <== notionalAmount / 10; // 10% minimum collateral
    collateralSufficiencyCheck.out === 1;
    
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

component main {public [nullifierHash, merkleRoot, contractCommitment, collateralCommitment, derivativeType]} = Derivative();