pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

/**
 * @title transfer-to-pool — `PrivateTokenContract.transferToPool`
 * @notice Public I/O (4): `[commitment, poolAddress, amount, nullifier]` matching Solidity encoding
 *         (`poolAddress` as field element, constrained to 160 bits).
 * @dev Note opening: `commitment = Poseidon(noteSecret, amount, poolAddress)`; `nullifier = Poseidon(noteSecret, nonce)`.
 */
template TransferToPool() {
    signal input noteSecret;
    signal input nonce;

    signal input commitment;
    signal input poolAddress;
    signal input amount;
    signal input nullifier;

    component comm = Poseidon(3);
    comm.inputs[0] <== noteSecret;
    comm.inputs[1] <== amount;
    comm.inputs[2] <== poolAddress;
    comm.out === commitment;

    component nl = Poseidon(2);
    nl.inputs[0] <== noteSecret;
    nl.inputs[1] <== nonce;
    nl.out === nullifier;

    component amtPos = GreaterThan(252);
    amtPos.in[0] <== amount;
    amtPos.in[1] <== 0;
    amtPos.out === 1;

    component poolBits = Num2Bits(160);
    poolBits.in <== poolAddress;
}

component main { public [ commitment, poolAddress, amount, nullifier ] } = TransferToPool();
