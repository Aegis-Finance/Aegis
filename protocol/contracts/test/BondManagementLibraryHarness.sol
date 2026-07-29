// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BondManagementLibrary} from "../libraries/BondManagementLibrary.sol";
import {AegisCrowdShield} from "../crowdfunding/AegisCrowdShield.sol";
import {ICreatorReputationTracker} from "../interfaces/ICreatorReputationTracker.sol";

/// @dev Thin harness for `BondManagementLibrary` view/pure helpers used in crowdfunding reputation flows.
contract BondManagementLibraryHarness {
    function exCreateBond(
        address creator,
        uint256 bondAmount,
        uint256 campaignId,
        ICreatorReputationTracker.BondType bondType
    )
        external
        view
        returns (
            address outCreator,
            uint256 outAmount,
            uint256 outCampaignId,
            uint256 unlockTime,
            bool isActive,
            bool isSlashed
        )
    {
        ICreatorReputationTracker.ReputationBond memory b =
            BondManagementLibrary.createBond(creator, bondAmount, campaignId, bondType);
        return (b.creator, b.bondAmount, b.campaignId, b.unlockTime, b.isActive, b.isSlashed);
    }

    function exValidateBondPosting(address crowdShield, uint256 campaignId, address creator, uint256 bondAmount)
        external
        view
    {
        BondManagementLibrary.validateBondPosting(AegisCrowdShield(crowdShield), campaignId, creator, bondAmount);
    }
}
