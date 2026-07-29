pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

template BatchAggregator(maxItems) {
    signal input batchCommitment;
    signal input batchNullifier;
    signal input itemCommitments[maxItems];
    signal input itemNullifiers[maxItems];
    signal input itemCount;

    signal output valid;

    component cHashers[maxItems];
    component nHashers[maxItems];
    component ltItem[maxItems];

    signal cAgg[maxItems + 1];
    signal nAgg[maxItems + 1];
    signal useIdx[maxItems];
    signal selCommitment[maxItems];
    signal selNullifier[maxItems];

    cAgg[0] <== 0;
    nAgg[0] <== 0;

    for (var i = 0; i < maxItems; i++) {
        cHashers[i] = Poseidon(2);
        nHashers[i] = Poseidon(2);
        ltItem[i] = LessThan(6);

        ltItem[i].in[0] <== i;
        ltItem[i].in[1] <== itemCount;
        useIdx[i] <== ltItem[i].out;

        selCommitment[i] <== useIdx[i] * itemCommitments[i];
        selNullifier[i] <== useIdx[i] * itemNullifiers[i];

        cHashers[i].inputs[0] <== cAgg[i];
        cHashers[i].inputs[1] <== selCommitment[i];
        cAgg[i + 1] <== cHashers[i].out;

        nHashers[i].inputs[0] <== nAgg[i];
        nHashers[i].inputs[1] <== selNullifier[i];
        nAgg[i + 1] <== nHashers[i].out;
    }

    batchCommitment === cAgg[maxItems];
    batchNullifier === nAgg[maxItems];
    valid <== 1;
}

component main {public [batchCommitment, batchNullifier]} = BatchAggregator(32);