// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ICommonErrors} from "./../interfaces/ICommonErrors.sol";
import {ICreatorReputationTracker} from "../interfaces/ICreatorReputationTracker.sol";

/**
 * @title ValidationLibrary
 * @author Aegis Protocol Team
 * @notice Library containing input validation and verification logic
 * @dev This library contains validation functions to reduce contract size and improve reusability
 */
library ValidationLibrary {
    
    // Custom errors for validation

    // Constants for validation
    uint256 private constant MIN_PROFILE_NAME_LENGTH = 3;
    uint256 private constant MAX_PROFILE_NAME_LENGTH = 50;
    uint256 private constant MIN_PROFILE_DESCRIPTION_LENGTH = 10;
    uint256 private constant MAX_PROFILE_DESCRIPTION_LENGTH = 500;
    uint256 private constant MIN_SKILL_NAME_LENGTH = 2;
    uint256 private constant MAX_SKILL_NAME_LENGTH = 30;
    uint256 private constant MIN_ENDORSEMENT_LENGTH = 10;
    uint256 private constant MAX_ENDORSEMENT_LENGTH = 200;
    uint256 private constant MIN_RATING = 1;
    uint256 private constant MAX_RATING = 5;
    uint256 private constant MIN_BOND_AMOUNT = 0.1 ether;

    /**
     * @notice Validates profile input parameters
     * @param profileName Name of the profile
     * @param profileDescription Description of the profile
     */
    function validateProfileInputs(
        string calldata profileName,
        string calldata profileDescription
    ) public pure {
        // Validate profile name
        if (bytes(profileName).length < MIN_PROFILE_NAME_LENGTH || 
            bytes(profileName).length > MAX_PROFILE_NAME_LENGTH) {
            revert ICommonErrors.InvalidProfileDescription();
        }

        // Validate profile description
        if (bytes(profileDescription).length < MIN_PROFILE_DESCRIPTION_LENGTH || 
            bytes(profileDescription).length > MAX_PROFILE_DESCRIPTION_LENGTH) {
            revert ICommonErrors.InvalidProfileDescription();
        }

        // Check for empty strings
        if (bytes(profileName).length == 0 || bytes(profileDescription).length == 0) {
            revert ICommonErrors.StringTooShort();
        }
    }

    /**
     * @notice Validates feedback parameters
     * @param overallRating Overall rating (1-5)
     * @param communicationRating Communication rating (1-5)
     * @param deliveryRating Delivery rating (1-5)
     * @param qualityRating Quality rating (1-5)
     * @param feedbackText Feedback text
     */
    function validateFeedbackInputs(
        uint8 overallRating,
        uint8 communicationRating,
        uint8 deliveryRating,
        uint8 qualityRating,
        string calldata feedbackText
    ) public pure {
        // Validate ratings
        if (overallRating < MIN_RATING || overallRating > MAX_RATING ||
            communicationRating < MIN_RATING || communicationRating > MAX_RATING ||
            deliveryRating < MIN_RATING || deliveryRating > MAX_RATING ||
            qualityRating < MIN_RATING || qualityRating > MAX_RATING) {
            revert ICommonErrors.InvalidRating();
        }

        // Validate feedback text length
        if (bytes(feedbackText).length > MAX_ENDORSEMENT_LENGTH) {
            revert ICommonErrors.StringTooLong();
        }
    }

    /**
     * @notice Validates skill endorsement parameters
     * @param skillName Name of the skill
     * @param endorsementText Endorsement text
     */
    function validateSkillEndorsement(
        string calldata skillName,
        string calldata endorsementText
    ) public pure {
        // Validate skill name
        if (bytes(skillName).length < MIN_SKILL_NAME_LENGTH || 
            bytes(skillName).length > MAX_SKILL_NAME_LENGTH) {
            revert ICommonErrors.InvalidSkillName();
        }

        // Validate endorsement text
        if (bytes(endorsementText).length < MIN_ENDORSEMENT_LENGTH || 
            bytes(endorsementText).length > MAX_ENDORSEMENT_LENGTH) {
            revert ICommonErrors.InvalidEndorsementText();
        }
    }

    /**
     * @notice Validates bond amount
     * @param amount Bond amount to validate
     */
    function validateBondAmount(uint256 amount) public pure {
        if (amount < MIN_BOND_AMOUNT) {
            revert ICommonErrors.InsufficientBondAmount();
        }
    }

    /**
     * @notice Validates address is not zero
     * @param addr Address to validate
     */
    function validateAddress(address addr) public pure {
        if (addr == address(0)) {
            revert ICommonErrors.InvalidAddress();
        }
    }

    /**
     * @notice Validates array is not empty
     * @param arrayLength Length of the array to validate
     */
    function validateNonEmptyArray(uint256 arrayLength) public pure {
        if (arrayLength == 0) {
            revert ICommonErrors.EmptyArray();
        }
    }

    /**
     * @notice Validates string length within bounds
     * @param str String to validate
     * @param minLength Minimum allowed length
     * @param maxLength Maximum allowed length
     */
    function validateStringLength(
        string calldata str,
        uint256 minLength,
        uint256 maxLength
    ) public pure {
        uint256 length = bytes(str).length;
        if (length < minLength) {
            revert ICommonErrors.StringTooShort();
        }
        if (length > maxLength) {
            revert ICommonErrors.StringTooLong();
        }
    }

    /**
     * @notice Validates rating is within valid range
     * @param rating Rating to validate
     */
    function validateRating(uint8 rating) public pure {
        if (rating < MIN_RATING || rating > MAX_RATING) {
            revert ICommonErrors.InvalidRating();
        }
    }

    /**
     * @notice Validates profile metadata
     * @param metadata Profile metadata to validate
     */
    function validateProfileMetadata(
        ICreatorReputationTracker.ProfileMetadata calldata metadata
    ) public pure {
        // Validate skills array
        validateNonEmptyArray(metadata.skills.length);
        
        // Validate each skill name
        for (uint256 i = 0; i < metadata.skills.length; ++i) {
            validateStringLength(metadata.skills[i], MIN_SKILL_NAME_LENGTH, MAX_SKILL_NAME_LENGTH);
        }

        // Validate location if provided
        if (bytes(metadata.location).length > 0) {
            validateStringLength(metadata.location, 1, 100);
        }

        // Validate experience if provided
        if (bytes(metadata.experience).length > 0) {
            validateStringLength(metadata.experience, 1, 1000);
        }
    }

    /**
     * @notice Validates verification status update
     * @param verificationType Type of verification
     * @param isVerified New verification status
     */
    function validateVerificationUpdate(
        string calldata verificationType,
        bool isVerified
    ) public pure {
        // Validate verification type
        validateStringLength(verificationType, 1, 50);
        
        // Explicitly acknowledge parameter to suppress linting warning
        isVerified; // Parameter accepted for interface compatibility
        
        // Additional validation can be added here for specific verification types
        bytes32 typeHash = keccak256(bytes(verificationType));
        
        // Check for valid verification types
        if (typeHash != keccak256("identity") &&
            typeHash != keccak256("address") &&
            typeHash != keccak256("business") &&
            typeHash != keccak256("skill") &&
            typeHash != keccak256("social")) {
            revert ICommonErrors.InvalidSkillName(); // Reusing error for invalid type
        }
    }

    /**
     * @notice Validates bond parameters
     * @param bondType Type of bond
     * @param amount Bond amount
     * @param duration Bond duration
     */
    function validateBondParameters(
        ICreatorReputationTracker.BondType bondType,
        uint256 amount,
        uint256 duration
    ) public pure {
        // Validate bond amount
        validateBondAmount(amount);
        
        // Validate duration (minimum 1 day, maximum 1 year)
        if (duration < 1 days || duration > 365 days) {
            revert ICommonErrors.InsufficientBondAmount(); // Reusing error for invalid duration
        }
        
        // Validate bond type is within enum range
        if (uint8(bondType) > 2) { // Assuming 3 bond types (0, 1, 2)
            revert ICommonErrors.InsufficientBondAmount(); // Reusing error for invalid type
        }
    }

    /**
     * @notice Validates campaign registration parameters
     * @param campaignId Campaign ID to validate
     * @param creator Creator address
     */
    function validateCampaignRegistration(
        uint256 campaignId,
        address creator
    ) public pure {
        // Validate campaign ID is not zero
        if (campaignId == 0) {
            revert ICommonErrors.InsufficientBondAmount(); // Reusing error for invalid ID
        }
        
        // Validate creator address
        validateAddress(creator);
    }

    /**
     * @notice Validates feedback submission parameters
     * @param campaignId Campaign ID
     * @param creator Creator address
     * @param feedbackText Feedback text
     * @param hasAlreadyProvided Whether user has already provided feedback
     * @param isCreatorActive Whether creator is active
     * @param crowdShield CrowdShield contract reference
     */
    function validateFeedbackSubmission(
        uint256 campaignId,
        address creator,
        string calldata feedbackText,
        bool hasAlreadyProvided,
        bool isCreatorActive,
        address crowdShield
    ) public pure {
        // Validate campaign ID
        if (campaignId == 0) {
            revert ICommonErrors.InsufficientBondAmount(); // Reusing error for invalid ID
        }
        
        // Validate creator address
        validateAddress(creator);
        
        // Validate feedback text
        validateStringLength(feedbackText, 10, 1000);
        
        // Check if feedback already provided
        if (hasAlreadyProvided) {
            revert ICommonErrors.FeedbackAlreadyProvided(); // Using proper error for duplicate feedback
        }
        
        // Check if creator is active
        if (!isCreatorActive) {
            revert ICommonErrors.InvalidAddress(); // Reusing error for inactive creator
        }
        
        // Validate crowdShield address
        validateAddress(crowdShield);
    }
}
