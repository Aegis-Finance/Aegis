pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

/**
 * @title transfer-commitment-action — `lockCollateral` / `unlockCollateral` on `PrivateTokenContract`
 * @notice Public I/O (4): `[commitment, amount, nullifier, domainTag]`.
 * @dev `domainTag` must be the small constants wired in Solidity (`LOCK_DOMAIN` / `UNLOCK_DOMAIN`), not raw keccak,
 *      so the value fits BN254 field semantics consistently in Circom + verifier IC.
 */
template TransferCommitmentAction() {
    signal input noteSecret;
    signal input nonce;

    signal input commitment;
    signal input amount;
    signal input nullifier;
    signal input domainTag;

    component comm = Poseidon(3);
    comm.inputs[0] <== noteSecret;
    comm.inputs[1] <== amount;
    comm.inputs[2] <== domainTag;
    comm.out === commitment;

    component nl = Poseidon(2);
    nl.inputs[0] <== noteSecret;
    nl.inputs[1] <== nonce;
    nl.out === nullifier;

    component amtPos = GreaterThan(252);
    amtPos.in[0] <== amount;
    amtPos.in[1] <== 0;
    amtPos.out === 1;
}

component main { public [ commitment, amount, nullifier, domainTag ] } = TransferCommitmentAction();
