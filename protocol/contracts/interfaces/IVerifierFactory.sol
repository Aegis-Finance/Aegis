// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./ICommonErrors.sol";

import {Groth16Verifier} from "../Groth16Verifier.sol";
import {CeremonyVerifier} from "../CeremonyVerifier.sol";

/**
 * @title IVerifierFactory
 * @dev Interface for VerifierFactory contract
 * @notice Interface for managing ZK proof verifiers across different circuit types
 * @author Aegis Protocol Team
 */
interface IVerifierFactory {
    /// @notice Events for verifier management
    
    /// @notice Emitted when a new verifier is deployed
    /// @param circuitType The type of circuit for the verifier
    /// @param verifier The address of the deployed verifier
    /// @param vkHash The hash of the verification key
    event VerifierDeployed(string indexed circuitType, address indexed verifier, bytes32 vkHash);
    
    /// @notice Emitted when an existing verifier is updated
    /// @param circuitType The type of circuit for the verifier
    /// @param oldVerifier The address of the old verifier
    /// @param newVerifier The address of the new verifier
    event VerifierUpdated(string indexed circuitType, address indexed oldVerifier, address indexed newVerifier);
    
    /// @notice Emitted when a verifier is removed
    /// @param circuitType The type of circuit for the verifier
    /// @param verifier The address of the removed verifier
    event VerifierRemoved(string indexed circuitType, address indexed verifier);
    
    /// @notice Emitted when a ceremony is validated for a verifier
    /// @param circuitType The type of circuit
    /// @param ceremonyId The ceremony ID
    /// @param verifier The verifier address
    event CeremonyValidated(string indexed circuitType, bytes32 indexed ceremonyId, address indexed verifier);
    
    /// @notice Custom errors

    /**
     * @notice Sets the governance contract address (one-time setup by owner)
     * @param _governance Address of the governance contract
     */
    function setGovernanceContract(address _governance) external;

    /**
     * @notice Deploys a new Groth16 verifier for a specific circuit type with ceremony validation
     * @param circuitType The type of circuit (e.g., "transfer", "mint", "burn")
     * @param verifyingKey The Groth16 verification key for the circuit
     * @param ceremonyMetadata The trusted setup ceremony metadata
     * @return verifier The address of the deployed verifier
     */
    function deployVerifier(
        string calldata circuitType,
        Groth16Verifier.VerifyingKey calldata verifyingKey,
        Groth16Verifier.CeremonyMetadata calldata ceremonyMetadata
    ) external returns (address verifier);

    /**
     * @notice Updates an existing verifier for a circuit type (restricted for production verifiers)
     * @param circuitType The type of circuit to update
     * @param verifyingKey The new verification key
     * @param ceremonyMetadata The trusted setup ceremony metadata
     */
    function updateVerifier(
        string calldata circuitType,
        Groth16Verifier.VerifyingKey calldata verifyingKey,
        Groth16Verifier.CeremonyMetadata calldata ceremonyMetadata
    ) external;

    /**
     * @notice Removes a verifier for a circuit type
     * @param circuitType The type of circuit to remove
     */
    function removeVerifier(string calldata circuitType) external;

    /**
     * @notice Gets the verifier address for a circuit type
     * @param circuitType The type of circuit
     * @return verifier The verifier address
     */
    function getVerifier(string calldata circuitType) external view returns (address verifier);

    /**
     * @notice Verifies a proof using the appropriate verifier
     * @param circuitType The type of circuit
     * @param proof The ZK proof
     * @param publicInputs The public inputs
     * @return bool True if the proof is valid
     */
    function verifyProof(
        string calldata circuitType,
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external view returns (bool);

    /**
     * @notice Gets all deployed verifier addresses
     * @return address[] Array of all verifier addresses
     */
    function getAllVerifiers() external view returns (address[] memory);

    /**
     * @notice Gets the number of deployed verifiers
     * @return uint256 The number of verifiers
     */
    function getVerifierCount() external view returns (uint256);

    /**
     * @notice Checks if a circuit type has a verifier
     * @param circuitType The type of circuit
     * @return bool True if verifier exists
     */
    function hasVerifier(string calldata circuitType) external view returns (bool);

    /**
     * @notice Gets verification key hash for a circuit type
     * @param circuitType The type of circuit
     * @return bytes32 The verification key hash
     */
    function getVerificationKeyHash(string calldata circuitType) external view returns (bytes32);

    /**
     * @notice Gets all supported verifier types
     * @return string[] Array of supported verifier type names
     */
    function getSupportedVerifierTypes() external view returns (string[] memory);

    /**
     * @notice Gets the legacy `transfer-optimized` verifier address (factory slot; not the EOA `unshield` layout).
     * @dev `PrivateTokenContract` uses dedicated slots (`transfer-unshield`, `shielded-transfer`, pool/commitment splits) via `getVerifier(string)`; `verifiers.transfer` still resolves this type for dev fallback.
     * @return address The transfer-optimized verifier address
     */
    function transferOptimizedVerifier() external view returns (address);

    /**
     * @notice Gets the mint-optimized verifier address
     * @return address The mint-optimized verifier address
     */
    function mintOptimizedVerifier() external view returns (address);

    /**
     * @notice Gets the privacy verifier address
     * @return address The privacy verifier address
     */
    function privacyVerifier() external view returns (address);

    /**
     * @notice Gets the governance verifier address
     * @return address The governance verifier address
     */
    function governanceVerifier() external view returns (address);

    /**
     * @notice Gets the bridge verifier address
     * @return address The bridge verifier address
     */
    function bridgeVerifier() external view returns (address);

    /**
     * @notice Gets the derivative verifier address
     * @return address The derivative verifier address
     */
    function derivativeVerifier() external view returns (address);

    /**
     * @notice Gets the ceremony ID for a circuit type
     * @param circuitType The circuit type
     * @return ceremonyId The ceremony ID
     */
    function getCeremonyId(string calldata circuitType) external view returns (bytes32 ceremonyId);

    /**
     * @notice Checks if a verifier is production-ready
     * @param verifier The verifier address
     * @return isProduction True if the verifier is production-ready
     */
    function isProduction(address verifier) external view returns (bool);

    /**
     * @notice Gets the governance contract address
     * @return address The governance contract address
     */
    function governanceContract() external view returns (address);

    /**
     * @notice Gets the ceremony verifier contract
     * @return CeremonyVerifier The ceremony verifier contract
     */
    function CEREMONY_VERIFIER() external view returns (CeremonyVerifier);

    /**
     * @notice Gets verifier address for a circuit type (public mapping accessor)
     * @param circuitType The circuit type
     * @return address The verifier address
     */
    function verifiers(string calldata circuitType) external view returns (address);

    /**
     * @notice Gets verifier address by index (public array accessor)
     * @param index The index in the allVerifiers array
     * @return address The verifier address
     */
    function allVerifiers(uint256 index) external view returns (address);

    /**
     * @notice Checks if an address is a valid verifier (public mapping accessor)
     * @param verifier The address to check
     * @return bool True if the address is a valid verifier
     */
    function isVerifier(address verifier) external view returns (bool);

    /**
     * @notice Gets supported verifier type by index (public array accessor)
     * @param index The index in the supportedVerifierTypes array
     * @return string The verifier type name
     */
    function supportedVerifierTypes(uint256 index) external view returns (string memory);

    /**
     * @notice Gets ceremony ID for a circuit type (public mapping accessor)
     * @param circuitType The circuit type
     * @return bytes32 The ceremony ID
     */
    function circuitCeremonyIds(string calldata circuitType) external view returns (bytes32);

    /**
     * @notice Checks if a verifier is production-ready (public mapping accessor)
     * @param verifier The verifier address
     * @return bool True if the verifier is production-ready
     */
    function isProductionVerifier(address verifier) external view returns (bool);
}