// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title TokenDistributionVerifierLib
 * @notice Decodes Groth16 public signals for `circuits/tokendistribution.circom` (must match `main { public [...] }` order).
 * @dev Order: `valid`, `commitment`, `nullifier`, `auctionPrice`, `maxPurchaseLimit`, `totalSupplyRemaining`, `merkleRoot`, `purchaseAmount`.
 */
library TokenDistributionVerifierLib {
    uint256 public constant PUBLIC_INPUT_COUNT = 8;

    struct PublicSignals {
        uint256 valid;
        bytes32 commitment;
        bytes32 nullifier;
        uint256 auctionPrice;
        uint256 maxPurchaseLimit;
        uint256 totalSupplyRemaining;
        bytes32 merkleRoot;
        uint256 purchaseAmount;
    }

    error TD_InvalidPublicInputLength();
    error TD_InvalidValidFlag();

    function requirePublicInputLength(uint256[] calldata publicInputs) internal pure {
        if (publicInputs.length != PUBLIC_INPUT_COUNT) revert TD_InvalidPublicInputLength();
    }

    function decode(uint256[] calldata publicInputs) internal pure returns (PublicSignals memory s) {
        requirePublicInputLength(publicInputs);
        s.valid = publicInputs[0];
        s.commitment = bytes32(publicInputs[1]);
        s.nullifier = bytes32(publicInputs[2]);
        s.auctionPrice = publicInputs[3];
        s.maxPurchaseLimit = publicInputs[4];
        s.totalSupplyRemaining = publicInputs[5];
        s.merkleRoot = bytes32(publicInputs[6]);
        s.purchaseAmount = publicInputs[7];
    }

    function requireValidProofFlag(PublicSignals memory s) internal pure {
        if (s.valid != 1) revert TD_InvalidValidFlag();
    }
}
