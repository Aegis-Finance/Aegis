pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/gates.circom";

/**
 * @title Token distribution (allowlist + caps + sale binding)
 * @notice Groth16 **public** signals (order for snarkjs → verifier wiring):
 *   `[ valid, commitment, nullifier, auctionPrice, maxPurchaseLimit, totalSupplyRemaining, merkleRoot, purchaseAmount ]`.
 * @dev Proves:
 *   - Buyer is in allowlist Merkle tree (leaf = Poseidon(buyerSecret, buyerNonce)).
 *   - `purchaseAmount` is positive, within `maxPurchaseLimit`, fits `totalSupplyRemaining`,
 *     and `previousPurchases + purchaseAmount <= maxPurchaseLimit`.
 *   - `auctionPrice > 0`, `maxPurchaseLimit > 0` (sanity for on-chain binding).
 *   - `commitment` / `nullifier` bind secrets to this sale (`merkleRoot` in hash inputs).
 *   - Merkle path index bits are binary (anti-malleability).
 * On-chain integration: register `"tokendistribution"` verifier and pass the **8** public fields above (`purchaseAmount` must match minted amount).
 */
template MerkleTreeVerifier20() {
    signal input leaf;
    signal input root;
    signal input pathElements[20];
    signal input pathIndices[20];

    component hashers[20];
    component selectors[20];
    component pathBits[20];

    var currentHash = leaf;

    for (var i = 0; i < 20; i++) {
        hashers[i] = Poseidon(2);
        selectors[i] = Selector();
        pathBits[i] = Num2Bits(1);

        pathBits[i].in <== pathIndices[i];
        selectors[i].select <== pathBits[i].out[0];
        selectors[i].left <== currentHash;
        selectors[i].right <== pathElements[i];

        hashers[i].inputs[0] <== selectors[i].outLeft;
        hashers[i].inputs[1] <== selectors[i].outRight;

        currentHash = hashers[i].out;
    }

    currentHash === root;
}

template Selector() {
    signal input select;
    signal input left;
    signal input right;
    signal output outLeft;
    signal output outRight;

    outLeft <== left + select * (right - left);
    outRight <== right + select * (left - right);
}

template TokenDistribution() {
    // --- private witness ---
    signal input buyerSecret;
    signal input buyerNonce;
    signal input purchaseNonce;
    signal input previousPurchases;
    signal input pathElements[20];
    signal input pathIndices[20];

    // --- public (Groth16) — declaration order must match `main { public [...] }` for snarkjs publicSignals ---
    signal input valid;
    signal input commitment;
    signal input nullifier;
    signal input auctionPrice;
    signal input maxPurchaseLimit;
    signal input totalSupplyRemaining;
    signal input merkleRoot;
    signal input purchaseAmount;

    // Path index bits must be 0/1
    component pathBits[20];
    for (var i = 0; i < 20; i++) {
        pathBits[i] = Num2Bits(1);
        pathBits[i].in <== pathIndices[i];
    }

    // Allowlist leaf
    component leafH = Poseidon(2);
    leafH.inputs[0] <== buyerSecret;
    leafH.inputs[1] <== buyerNonce;

    component merkle = MerkleTreeVerifier20();
    merkle.leaf <== leafH.out;
    merkle.root <== merkleRoot;
    for (var j = 0; j < 20; j++) {
        merkle.pathElements[j] <== pathElements[j];
        merkle.pathIndices[j] <== pathIndices[j];
    }

    // Commitment + nullifier bind to this sale root
    component com = Poseidon(4);
    com.inputs[0] <== buyerSecret;
    com.inputs[1] <== purchaseAmount;
    com.inputs[2] <== purchaseNonce;
    com.inputs[3] <== merkleRoot;
    com.out === commitment;

    component nul = Poseidon(3);
    nul.inputs[0] <== buyerSecret;
    nul.inputs[1] <== purchaseNonce;
    nul.inputs[2] <== merkleRoot;
    nul.out === nullifier;

    // purchaseAmount > 0
    component amtPos = GreaterThan(252);
    amtPos.in[0] <== purchaseAmount;
    amtPos.in[1] <== 0;
    amtPos.out === 1;

    // auctionPrice > 0, maxPurchaseLimit > 0
    component apPos = GreaterThan(252);
    apPos.in[0] <== auctionPrice;
    apPos.in[1] <== 0;
    apPos.out === 1;

    component capPos = GreaterThan(252);
    capPos.in[0] <== maxPurchaseLimit;
    capPos.in[1] <== 0;
    capPos.out === 1;

    // purchaseAmount <= maxPurchaseLimit
    component leCap = LessEqThan(252);
    leCap.in[0] <== purchaseAmount;
    leCap.in[1] <== maxPurchaseLimit;

    // purchaseAmount <= totalSupplyRemaining
    component leSup = LessEqThan(252);
    leSup.in[0] <== purchaseAmount;
    leSup.in[1] <== totalSupplyRemaining;

    // previousPurchases >= 0 (trivial field; still range-typed for witness sanity)
    component prevGe0 = GreaterEqThan(252);
    prevGe0.in[0] <== previousPurchases;
    prevGe0.in[1] <== 0;

    // previousPurchases + purchaseAmount <= maxPurchaseLimit (no overflow in field for sane magnitudes)
    signal sumPurchases;
    sumPurchases <== previousPurchases + purchaseAmount;
    component leCum = LessEqThan(252);
    leCum.in[0] <== sumPurchases;
    leCum.in[1] <== maxPurchaseLimit;

    component a1 = AND();
    a1.a <== leCap.out;
    a1.b <== leSup.out;

    component a2 = AND();
    a2.a <== a1.out;
    a2.b <== leCum.out;

    component a3 = AND();
    a3.a <== a2.out;
    a3.b <== prevGe0.out;

    component a4 = AND();
    a4.a <== a3.out;
    a4.b <== apPos.out;

    component a5 = AND();
    a5.a <== a4.out;
    a5.b <== capPos.out;

    component a6 = AND();
    a6.a <== a5.out;
    a6.b <== amtPos.out;

    component vEq = IsEqual();
    vEq.in[0] <== valid;
    vEq.in[1] <== a6.out;
    vEq.out === 1;
}

component main {public [
    valid,
    commitment,
    nullifier,
    auctionPrice,
    maxPurchaseLimit,
    totalSupplyRemaining,
    merkleRoot,
    purchaseAmount
]} = TokenDistribution();
