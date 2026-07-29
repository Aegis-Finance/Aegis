pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

template RecursiveAggregator(maxChildren) {
    signal input rootCommitment;
    signal input rootNullifier;
    signal input childCommitments[maxChildren];
    signal input childNullifiers[maxChildren];
    signal input childCount;

    signal output valid;

    component cHashers[maxChildren];
    component nHashers[maxChildren];
    component ltChild[maxChildren];

    signal cAgg[maxChildren + 1];
    signal nAgg[maxChildren + 1];
    signal useIdx[maxChildren];
    signal selCommitment[maxChildren];
    signal selNullifier[maxChildren];

    cAgg[0] <== 0;
    nAgg[0] <== 0;

    for (var i = 0; i < maxChildren; i++) {
        cHashers[i] = Poseidon(2);
        nHashers[i] = Poseidon(2);
        ltChild[i] = LessThan(6);

        ltChild[i].in[0] <== i;
        ltChild[i].in[1] <== childCount;
        useIdx[i] <== ltChild[i].out;

        selCommitment[i] <== useIdx[i] * childCommitments[i];
        selNullifier[i] <== useIdx[i] * childNullifiers[i];

        cHashers[i].inputs[0] <== cAgg[i];
        cHashers[i].inputs[1] <== selCommitment[i];
        cAgg[i + 1] <== cHashers[i].out;

        nHashers[i].inputs[0] <== nAgg[i];
        nHashers[i].inputs[1] <== selNullifier[i];
        nAgg[i + 1] <== nHashers[i].out;
    }

    rootCommitment === cAgg[maxChildren];
    rootNullifier === nAgg[maxChildren];
    valid <== 1;
}

component main {public [rootCommitment, rootNullifier]} = RecursiveAggregator(32);