pragma circom 2.0.0;

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/gates.circom";
include "lib/DivFloor.circom";

/**
 * @title DutchAuction
 * @notice ZK proof that a bid price matches the on-chain Dutch auction schedule at `currentTime`.
 * @dev MUST stay aligned with:
 *      - `AuctionPriceLib.linearDutchPrice` (price decay = floor((start-reserve)*elapsed/duration))
 *      - `AuctionPriceLib.decayRatePerSecondWad` (WAD rate = floor((start-reserve)*WAD/duration))
 *      - `AutomatedDutchAuction.getAuctionVerifierPublicInputs` (exact public input order, 6 values)
 *
 *      Public inputs (indices 0..5):
 *        [0] startPrice
 *        [1] reservePrice
 *        [2] startTime
 *        [3] duration (seconds)
 *        [4] currentTime
 *        [5] priceDecayRatePerSecondWad  (must equal on-chain `decayRatePerSecondWad`)
 *
 *      Bit bounds (conservative for BN128 field): delta ≤ 190 bits, elapsed/duration ≤ 62 bits,
 *      WAD = 1e18. Then `delta * elapsed` and `delta * WAD` stay below the field modulus.
 */
template DutchAuction() {
    // Public inputs (order MUST match Solidity verifier wiring)
    signal input startPrice;
    signal input reservePrice;
    signal input startTime;
    signal input duration;
    signal input currentTime;
    signal input priceDecayRate;

    // Private inputs
    signal input bidAmount;
    signal input maxPrice;

    // Internal (private) — Groth16 public IO must stay exactly the six Solidity public inputs.
    signal calculatedPrice;
    signal timeRemaining;
    signal isValidBid;

    var WAD = 1000000000000000000;

    // --- Basic ordering / non-zero duration ---
    component startAboveReserve = GreaterEqThan(252);
    startAboveReserve.in[0] <== startPrice;
    startAboveReserve.in[1] <== reservePrice;
    startAboveReserve.out === 1;

    component durationNonZero = IsZero();
    durationNonZero.in <== duration;
    durationNonZero.out === 0;

    // delta = start - reserve (strictly positive when start > reserve)
    signal delta;
    delta <== startPrice - reservePrice;
    component deltaPos = GreaterThan(252);
    deltaPos.in[0] <== startPrice;
    deltaPos.in[1] <== reservePrice;
    deltaPos.out === 1;

    // Bit-range: keeps products inside the scalar field
    component deltaBits = Num2Bits(190);
    deltaBits.in <== delta;

    component elapsedNonNegative = GreaterEqThan(252);
    elapsedNonNegative.in[0] <== currentTime;
    elapsedNonNegative.in[1] <== startTime;
    elapsedNonNegative.out === 1;

    signal elapsedTime;
    elapsedTime <== currentTime - startTime;

    component elapsedBits = Num2Bits(62);
    elapsedBits.in <== elapsedTime;

    component durationBits = Num2Bits(62);
    durationBits.in <== duration;

    // currentTime < startTime + duration  (same window as on-chain `now < endTime` path)
    signal endTime;
    endTime <== startTime + duration;
    component strictLessThanEnd = LessThan(252);
    strictLessThanEnd.in[0] <== currentTime;
    strictLessThanEnd.in[1] <== endTime;
    strictLessThanEnd.out === 1;

    // elapsed < duration (follows from current < end and elapsed = current - start, for uint256)
    component elapsedLtDur = LessThan(252);
    elapsedLtDur.in[0] <== elapsedTime;
    elapsedLtDur.in[1] <== duration;
    elapsedLtDur.out === 1;

    // --- Price decay: floor(delta * elapsed / duration)  (matches AuctionPriceLib) ---
    signal decayDividend;
    decayDividend <== delta * elapsedTime;

    component decayDiv = DivFloor();
    decayDiv.dividend <== decayDividend;
    decayDiv.divisor <== duration;
    signal priceDecay;
    priceDecay <== decayDiv.quotient;

    calculatedPrice <== startPrice - priceDecay;

    // --- Bind public WAD rate to Solidity: floor(delta * WAD / duration) ---
    signal rateDividend;
    rateDividend <== delta * WAD;

    component rateDiv = DivFloor();
    rateDiv.dividend <== rateDividend;
    rateDiv.divisor <== duration;
    rateDiv.quotient === priceDecayRate;

    // --- Bid validity ---
    component priceMatch = IsEqual();
    priceMatch.in[0] <== bidAmount;
    priceMatch.in[1] <== calculatedPrice;
    priceMatch.out === 1;

    component maxPriceCheck = GreaterEqThan(252);
    maxPriceCheck.in[0] <== maxPrice;
    maxPriceCheck.in[1] <== bidAmount;
    maxPriceCheck.out === 1;

    component reserveCheck = GreaterEqThan(252);
    reserveCheck.in[0] <== calculatedPrice;
    reserveCheck.in[1] <== reservePrice;
    reserveCheck.out === 1;

    // timeRemaining = endTime - currentTime (safe under strictLessThanEnd)
    timeRemaining <== endTime - currentTime;

    // Every gate above is hard-constrained (=== 0/1); valid proofs only exist when all hold.
    isValidBid <== 1;
}

/**
 * @title AuctionPriceValidator
 * @notice Computes `validatedPrice` using the same floor-decay rule as `AuctionPriceLib`.
 */
template AuctionPriceValidator() {
    signal input startPrice;
    signal input reservePrice;
    signal input elapsedTime;
    signal input duration;
    signal output validatedPrice;

    signal delta;
    delta <== startPrice - reservePrice;

    component elapsedBits = Num2Bits(62);
    elapsedBits.in <== elapsedTime;

    component durationBits = Num2Bits(62);
    durationBits.in <== duration;

    component durationNonZero = IsZero();
    durationNonZero.in <== duration;
    durationNonZero.out === 0;

    component deltaBits = Num2Bits(190);
    deltaBits.in <== delta;

    signal decayDividend;
    decayDividend <== delta * elapsedTime;

    component decayDiv = DivFloor();
    decayDiv.dividend <== decayDividend;
    decayDiv.divisor <== duration;
    signal priceDecay;
    priceDecay <== decayDiv.quotient;

    validatedPrice <== startPrice - priceDecay;
}

component main {
    public [startPrice, reservePrice, startTime, duration, currentTime, priceDecayRate]
} = DutchAuction();
