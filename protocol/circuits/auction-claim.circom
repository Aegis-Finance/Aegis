pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";

template AuctionClaim() {
    signal input commitment;
    signal input recipient;
    signal input secret;
    signal input nonce;
    signal output valid;

    component hasher = Poseidon(3);
    hasher.inputs[0] <== secret;
    hasher.inputs[1] <== recipient;
    hasher.inputs[2] <== nonce;
    hasher.out === commitment;

    valid <== 1;
}

component main {public [commitment, recipient]} = AuctionClaim();