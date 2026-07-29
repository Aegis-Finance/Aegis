// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ValidationLibrary} from "../libraries/ValidationLibrary.sol";
import {ICreatorReputationTracker} from "../interfaces/ICreatorReputationTracker.sol";

/// @dev Exposes `ValidationLibrary` entrypoints for Hardhat unit tests (libraries are not deployed alone).
contract ValidationLibraryHarness {
    function exValidateBondAmount(uint256 amount) external pure {
        ValidationLibrary.validateBondAmount(amount);
    }

    function exValidateAddress(address addr) external pure {
        ValidationLibrary.validateAddress(addr);
    }

    function exValidateNonEmptyArray(uint256 arrayLength) external pure {
        ValidationLibrary.validateNonEmptyArray(arrayLength);
    }

    function exValidateStringLength(string calldata str, uint256 minLength, uint256 maxLength) external pure {
        ValidationLibrary.validateStringLength(str, minLength, maxLength);
    }

    function exValidateRating(uint8 rating) external pure {
        ValidationLibrary.validateRating(rating);
    }

    function exValidateProfileInputs(string calldata profileName, string calldata profileDescription) external pure {
        ValidationLibrary.validateProfileInputs(profileName, profileDescription);
    }

    function exValidateFeedbackInputs(
        uint8 overallRating,
        uint8 communicationRating,
        uint8 deliveryRating,
        uint8 qualityRating,
        string calldata feedbackText
    ) external pure {
        ValidationLibrary.validateFeedbackInputs(
            overallRating,
            communicationRating,
            deliveryRating,
            qualityRating,
            feedbackText
        );
    }

    function exValidateSkillEndorsement(string calldata skillName, string calldata endorsementText) external pure {
        ValidationLibrary.validateSkillEndorsement(skillName, endorsementText);
    }

    function exValidateCampaignRegistration(uint256 campaignId, address creator) external pure {
        ValidationLibrary.validateCampaignRegistration(campaignId, creator);
    }

    function exValidateBondParameters(ICreatorReputationTracker.BondType bondType, uint256 amount, uint256 duration)
        external
        pure
    {
        ValidationLibrary.validateBondParameters(bondType, amount, duration);
    }

    function exValidateVerificationUpdate(string calldata verificationType, bool isVerified) external pure {
        ValidationLibrary.validateVerificationUpdate(verificationType, isVerified);
    }

    function exValidateProfileMetadata(ICreatorReputationTracker.ProfileMetadata calldata metadata) external pure {
        ValidationLibrary.validateProfileMetadata(metadata);
    }

    function exValidateFeedbackSubmission(
        uint256 campaignId,
        address creator,
        string calldata feedbackText,
        bool hasAlreadyProvided,
        bool isCreatorActive,
        address crowdShield
    ) external pure {
        ValidationLibrary.validateFeedbackSubmission(
            campaignId, creator, feedbackText, hasAlreadyProvided, isCreatorActive, crowdShield
        );
    }
}
