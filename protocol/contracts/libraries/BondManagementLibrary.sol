// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ICreatorReputationTracker} from "../interfaces/ICreatorReputationTracker.sol";
import {ErrorLibrary} from "./ErrorLibrary.sol";
import {AegisCrowdShield} from "../crowdfunding/AegisCrowdShield.sol";
import {ValidationLibrary} from "./ValidationLibrary.sol";

/**
 * @title BondManagementLibrary
 * @author Aegis Protocol Team
 * @notice Library for managing reputation bonds
 * @dev Extracted from CreatorReputationTracker to reduce contract size
 */
library BondManagementLibrary {
    /// @notice Lock period for reputation bonds (90 days)
    uint256 public constant BOND_LOCK_PERIOD = 90 days;

    // Events
    event BondPosted(
        address indexed creator, 
        uint256 amount, 
        uint256 indexed campaignId, 
        ICreatorReputationTracker.BondType bondType
    );
    event BondSlashed(
        address indexed creator, 
        uint256 bondIndex, 
        uint256 slashAmount, 
        string reason, 
        address indexed slasher, 
        uint256 disputeId
    );
    event BondReleased(address indexed creator, uint256 amount, uint256 indexed campaignId);

    // Custom errors

    /**
     * @dev Create a reputation bond with optimized struct initialization
     * @param creator Creator address
     * @param bondAmount Amount of the bond
     * @param campaignId Campaign ID
     * @param bondType Type of bond
     * @return ReputationBond struct
     */
    function createBond(
        address creator,
        uint256 bondAmount,
        uint256 campaignId,
        ICreatorReputationTracker.BondType bondType
    ) public view returns (ICreatorReputationTracker.ReputationBond memory) {
        uint256 unlockTime = block.timestamp + BOND_LOCK_PERIOD;
        
        return ICreatorReputationTracker.ReputationBond({
            creator: creator,
            bondAmount: bondAmount,
            campaignId: campaignId,
            bondType: bondType,
            lockPeriod: uint64(BOND_LOCK_PERIOD),
            unlockTime: unlockTime,
            isActive: true,
            isSlashed: false,
            slashAmount: 0,
            slashReason: ""
        });
    }

    /**
     * @dev Validate bond posting requirements with consolidated validation
     * @param crowdShield Reference to AegisCrowdShield contract
     * @param campaignId Campaign ID
     * @param creator Creator address
     * @param bondAmount Bond amount
     */
    function validateBondPosting(
        AegisCrowdShield crowdShield,
        uint256 campaignId,
        address creator,
        uint256 bondAmount
    ) public view {
        // Validate bond amount
        ValidationLibrary.validateBondAmount(bondAmount);

        // Verify campaign exists and caller is creator in one call
        AegisCrowdShield.CampaignSovereignty memory campaign = crowdShield.getCampaign(campaignId);
        
        // Consolidated validation: address validity and creator match
        if (campaign.creator == address(0) || campaign.creator != creator) {
            revert ErrorLibrary.NotCampaignCreator();
        }
    }

    /**
     * @dev Slash a bond with consolidated validation
     * @param bond Storage reference to the bond
     * @param slashAmount Amount to slash
     * @param reason Reason for slashing
     */
    function slashBond(
        ICreatorReputationTracker.ReputationBond storage bond,
        uint256 slashAmount,
        string calldata reason
    ) public {
        // Consolidated validation checks
        if (!bond.isActive || bond.isSlashed) {
            revert ErrorLibrary.BondNotActiveOrAlreadySlashed();
        }
        if (slashAmount > bond.bondAmount) {
            revert ErrorLibrary.SlashAmountExceedsBond();
        }

        // Update bond state
        bond.isSlashed = true;
        bond.slashAmount = slashAmount;
        bond.slashReason = reason;
    }

    /**
     * @dev Validate bond release requirements with optimized checks
     * @param bond Bond to validate
     * @param creator Creator address
     */
    function validateBondRelease(
        ICreatorReputationTracker.ReputationBond storage bond,
        address creator
    ) public view returns (uint256 releaseAmount) {
        // Consolidated validation checks
        if (!bond.isActive) {
            revert ErrorLibrary.BondNotActiveOrAlreadySlashed();
        }
        if (block.timestamp < bond.unlockTime) {
            revert ErrorLibrary.BondStillLocked();
        }
        if (bond.creator != creator) {
            revert ErrorLibrary.NotCampaignCreator();
        }

        // Calculate release amount once
        releaseAmount = bond.bondAmount - bond.slashAmount;
    }

    /**
     * @dev Release a bond with optimized validation and transfer
     * @param bond Storage reference to the bond
     * @param creator Creator address
     * @return releaseAmount Amount released
     */
    function releaseBond(
        ICreatorReputationTracker.ReputationBond storage bond,
        address creator
    ) public returns (uint256 releaseAmount) {
        // CRITICAL SECURITY: Validate creator address before any operations
        if (creator == address(0)) revert ErrorLibrary.InvalidAddress();
        
        releaseAmount = validateBondRelease(bond, creator);
        
        // CHECKS-EFFECTS-INTERACTIONS pattern: Update state BEFORE external call
        // Update bond state before transfer (CEI pattern)
        bond.isActive = false;
        
        // INTERACTIONS: External call AFTER state update (CEI pattern)
        // CRITICAL: Creator address validated above, releaseAmount validated by validateBondRelease
        // This is intentional - we're releasing a bond to the validated creator
        // Slither warning is expected - bond release intentionally sends ETH to validated creator
        // slither-disable-next-line arbitrary-send-eth
        (bool success, ) = payable(creator).call{value: releaseAmount}("");
        if (!success) {
            // Revert will automatically undo bond.isActive = false above
            revert ErrorLibrary.BondReleaseFailed();
        }
    }
}
