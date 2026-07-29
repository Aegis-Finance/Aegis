// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IVerifierFactory} from "./interfaces/IVerifierFactory.sol";
import {IVerifier} from "./interfaces/IVerifier.sol";
import {ICommonErrors} from "./interfaces/ICommonErrors.sol";
import {IPrivateGovernance} from "./interfaces/IPrivateGovernance.sol";
import {Groth16Verifier} from "./Groth16Verifier.sol";
import {CeremonyVerifier} from "./CeremonyVerifier.sol";
import {GovernanceAccessLib} from "./libraries/GovernanceAccessLib.sol";

/**
 * @title VerifierFactory
 * @author Aegis Protocol Team
 * @dev Factory contract for deploying and managing ZK proof verifiers
 * @notice Manages deployment, updates, and verification of Groth16 verifiers with DAO governance
 */
contract VerifierFactory is IVerifierFactory, ICommonErrors {
    
    /// @notice Mapping from circuit type to verifier address
    mapping(string => address) public override verifiers;

    /// @notice Array of all deployed verifier addresses
    address[] public override allVerifiers;

    /// @notice Mapping to check if an address is a registered verifier
    mapping(address => bool) public override isVerifier;

    /// @notice Array of supported verifier types
    string[] public override supportedVerifierTypes;

    /// @notice Mapping to track ceremony IDs for each circuit type
    mapping(string => bytes32) public override circuitCeremonyIds;

    /// @notice Mapping to track if a verifier is production-ready
    mapping(address => bool) public override isProductionVerifier;

    /// @notice The governance contract that controls this factory
    IPrivateGovernance public governance;

    /// @notice Optional OpenZeppelin timelock (`AegisTimelockController`); when set, its `execute` path may call admin functions here.
    address public timelockController;
    
    /// @notice The ceremony verifier for validating trusted setup
    CeremonyVerifier private immutable _CEREMONY_VERIFIER;
    
    /// @notice Event emitted when governance is updated
    event GovernanceUpdated(address indexed oldGovernance, address indexed newGovernance);

    /// @notice Emitted when the timelock authorized for delayed admin execution is updated
    event TimelockControllerUpdated(address indexed previousTimelock, address indexed newTimelock);
    
    /// @notice Initializes the VerifierFactory with supported verifier types
    /// @param _ceremonyVerifier Address of the ceremony verifier contract
    /// @param _governance Address of the governance contract
    constructor(address _ceremonyVerifier, address _governance) {
        if (_ceremonyVerifier == address(0)) revert InvalidVerifier();
        if (_governance == address(0)) revert InvalidGovernanceAddress();
        
        _CEREMONY_VERIFIER = CeremonyVerifier(_ceremonyVerifier);
        governance = IPrivateGovernance(_governance);
        
        // Initialize supported verifier types array.
        // Order and strings MUST match `scripts/ceremony/factory-circuits.js` (FACTORY_CIRCUIT_TYPES)
        // and `scripts/utils/resolve-groth16-artifacts.js` (VERIFIER_FACTORY_CIRCUIT_BUILD_SPECS).
        // Run `npm run circuits:validate` from `Aegis-contracts/` after edits here or in those maps.
        supportedVerifierTypes.push("mint-optimized");
        supportedVerifierTypes.push("transfer-optimized");
        supportedVerifierTypes.push("governance");
        supportedVerifierTypes.push("bridge");
        supportedVerifierTypes.push("derivative");
        supportedVerifierTypes.push("privacy");
        supportedVerifierTypes.push("crowdfunding");
        supportedVerifierTypes.push("milestone");
        supportedVerifierTypes.push("refund");
        supportedVerifierTypes.push("tokendistribution");
        supportedVerifierTypes.push("auction");
        supportedVerifierTypes.push("auction-claim");
        supportedVerifierTypes.push("sybil-protection");
        supportedVerifierTypes.push("analytics");
        supportedVerifierTypes.push("reward");
        supportedVerifierTypes.push("leaderboard");
        supportedVerifierTypes.push("aggregator");
        supportedVerifierTypes.push("private-amm");
        supportedVerifierTypes.push("insurance");
        supportedVerifierTypes.push("staking");
        supportedVerifierTypes.push("lending-tenor");
        supportedVerifierTypes.push("lending-liquidity");
        supportedVerifierTypes.push("lending-repay");
        supportedVerifierTypes.push("lending-withdraw");
        supportedVerifierTypes.push("lending-liquidate");
        supportedVerifierTypes.push("farming");
        supportedVerifierTypes.push("bonding-curve-purchase");
        supportedVerifierTypes.push("bonding-curve-sell");
        // `batch` / `recursive`: aggregation circuits; ceremony + manifest slots (see docs).
        supportedVerifierTypes.push("batch");
        supportedVerifierTypes.push("recursive");
        supportedVerifierTypes.push("transfer-unshield");
        supportedVerifierTypes.push("shielded-transfer");
        supportedVerifierTypes.push("transfer-to-pool");
        supportedVerifierTypes.push("transfer-commitment-internal");
        supportedVerifierTypes.push("transfer-commitment-action");
        // Ecosystem extension (selective-privacy financial stack) — keep synced with factory-circuits.js
        supportedVerifierTypes.push("stealth-address");
        supportedVerifierTypes.push("selective-disclosure");
        supportedVerifierTypes.push("payroll");
        supportedVerifierTypes.push("savings");
        supportedVerifierTypes.push("private-bond");
        supportedVerifierTypes.push("prediction-market");
        supportedVerifierTypes.push("private-stable");
        supportedVerifierTypes.push("credit-profile");
        supportedVerifierTypes.push("treasury-shield");
    }
    
    /// @notice Modifier to restrict access to governance contract only
    /// @dev Always enforced (including local Hardhat). See `CeremonyVerifier.onlyGovernance`.
    modifier onlyGovernance() {
        if (!GovernanceAccessLib.isGovernanceTimelockOrCore(address(governance), timelockController, msg.sender)) {
            revert UnauthorizedAccess();
        }
        _;
    }

    /// @notice Register the protocol timelock so `execute` may perform verifier admin operations after delay.
    function setTimelockController(address newTimelock) external onlyGovernance {
        emit TimelockControllerUpdated(timelockController, newTimelock);
        timelockController = newTimelock;
    }
    
    /// @notice Sets the governance contract address
    /// @param _governance Address of the governance contract
    function setGovernanceContract(address _governance) external override onlyGovernance {
        if (_governance == address(0)) revert InvalidGovernanceAddress();
        address oldGovernance = address(governance);
        governance = IPrivateGovernance(_governance);
        emit GovernanceUpdated(oldGovernance, _governance);
    }
    
    /// @notice Deploys a new verifier for a circuit type
    /// @param circuitType The type of circuit
    /// @param verifyingKey The verification key
    /// @param ceremonyMetadata The trusted setup ceremony metadata
    /// @return verifier The address of the deployed verifier
    function deployVerifier(
        string calldata circuitType,
        Groth16Verifier.VerifyingKey calldata verifyingKey,
        Groth16Verifier.CeremonyMetadata calldata ceremonyMetadata
    ) external override onlyGovernance returns (address verifier) {
        if (bytes(circuitType).length == 0) revert EmptyCircuitType();
        if (verifiers[circuitType] != address(0)) revert VerifierAlreadyExists();
        
        return _deployAndRegisterVerifier(circuitType, verifyingKey, ceremonyMetadata);
    }
    
    /// @notice Updates an existing verifier for a circuit type
    /// @param circuitType The type of circuit to update
    /// @param verifyingKey The new verification key
    /// @param ceremonyMetadata The trusted setup ceremony metadata
    function updateVerifier(
        string calldata circuitType,
        Groth16Verifier.VerifyingKey calldata verifyingKey,
        Groth16Verifier.CeremonyMetadata calldata ceremonyMetadata
    ) external override onlyGovernance {
        address oldVerifier = verifiers[circuitType];
        if (oldVerifier == address(0)) revert VerifierNotFound();
        
        // For production verifiers, require additional validation
        if (isProductionVerifier[oldVerifier]) {
            if (!ceremonyMetadata.isProduction) revert ImmutableVerifierViolation();
        }
        
        // Validate ceremony metadata and transcript
        if (!CeremonyVerifier(_CEREMONY_VERIFIER).isCeremonyFinalized(ceremonyMetadata.ceremonyId)) {
            revert InvalidCeremonyMetadata();
        }
        
        // Deploy new verifier
        address newVerifier = _deployAndRegisterVerifier(circuitType, verifyingKey, ceremonyMetadata);
        
        // Update mappings
        isVerifier[oldVerifier] = false;
        verifiers[circuitType] = newVerifier;
        
        emit VerifierUpdated(circuitType, oldVerifier, newVerifier);
    }
    
    /// @notice Removes a verifier for a circuit type
    /// @param circuitType The type of circuit to remove
    function removeVerifier(string calldata circuitType) external override onlyGovernance {
        address verifier = verifiers[circuitType];
        if (verifier == address(0)) revert VerifierNotFound();
        
        delete verifiers[circuitType];
        isVerifier[verifier] = false;
        
        emit VerifierRemoved(circuitType, verifier);
    }
    
    /// @notice Gets the verifier address for a circuit type
    /// @param circuitType The type of circuit
    /// @return verifier The verifier address
    function getVerifier(string calldata circuitType) external view override returns (address verifier) {
        verifier = verifiers[circuitType];
        if (verifier == address(0)) revert VerifierNotFound();
        return verifier;
    }
    
    /// @notice Verifies a proof using the appropriate verifier
    /// @param circuitType The type of circuit
    /// @param proof The ZK proof
    /// @param publicInputs The public inputs
    /// @return bool True if the proof is valid
    function verifyProof(
        string calldata circuitType,
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external view override returns (bool) {
        address verifier = verifiers[circuitType];
        if (verifier == address(0)) revert VerifierNotFound();
        
        return IVerifier(verifier).verifyProof(proof, publicInputs);
    }
    
    /// @notice Gets all deployed verifier addresses
    /// @return address[] Array of all verifier addresses
    function getAllVerifiers() external view override returns (address[] memory) {
        return allVerifiers;
    }
    
    /// @notice Gets the number of deployed verifiers
    /// @return uint256 The number of verifiers
    function getVerifierCount() external view override returns (uint256) {
        return allVerifiers.length;
    }
    
    /// @notice Checks if a circuit type has a verifier
    /// @param circuitType The type of circuit
    /// @return bool True if verifier exists
    function hasVerifier(string calldata circuitType) external view override returns (bool) {
        return verifiers[circuitType] != address(0);
    }
    
    /// @notice Gets the verification key hash for a circuit type
    /// @param circuitType The type of circuit
    /// @return bytes32 The verification key hash
    function getVerificationKeyHash(string calldata circuitType) external view override returns (bytes32) {
        address verifier = verifiers[circuitType];
        if (verifier == address(0)) revert VerifierNotFound();
        
        return Groth16Verifier(verifier).VERIFICATION_KEY_HASH();
    }
    
    /// @notice Gets all supported verifier types
    /// @return string[] Array of supported verifier type names
    function getSupportedVerifierTypes() external view override returns (string[] memory) {
        return supportedVerifierTypes;
    }
    
    /// @notice Legacy `transfer-optimized` verifier (factory slot; not the EOA `unshield` layout).
    /// @dev `PrivateTokenContract` resolves `unshield` / `shieldedTransfer` / pool / commitment proofs via `getVerifier(string)`; this accessor remains for tooling and older integrations.
    /// @return address The transfer-optimized verifier address
    function transferOptimizedVerifier() external view override returns (address) {
        return verifiers["transfer-optimized"];
    }
    
    /// @notice Gets the mint-optimized verifier address
    /// @return address The mint-optimized verifier address
    function mintOptimizedVerifier() external view override returns (address) {
        return verifiers["mint-optimized"];
    }
    
    /// @notice Gets the privacy verifier address
    /// @return address The privacy verifier address
    function privacyVerifier() external view override returns (address) {
        return verifiers["privacy"];
    }

    /// @notice Gets the governance verifier address
    /// @return address The governance verifier address
    function governanceVerifier() external view override returns (address) {
        return verifiers["governance"];
    }
    
    /// @notice Gets the bridge verifier address
    /// @return address The bridge verifier address
    function bridgeVerifier() external view override returns (address) {
        return verifiers["bridge"];
    }
    
    /// @notice Gets the derivative verifier address
    /// @return address The derivative verifier address
    function derivativeVerifier() external view override returns (address) {
        return verifiers["derivative"];
    }
    
    /// @notice Gets the ceremony verifier contract
    /// @return CeremonyVerifier The ceremony verifier contract
    function CEREMONY_VERIFIER() external view override returns (CeremonyVerifier) {
        return _CEREMONY_VERIFIER;
    }
    
    /// @notice Gets the ceremony ID for a circuit type
    /// @param circuitType The circuit type
    /// @return bytes32 The ceremony ID
    function getCeremonyId(string calldata circuitType) external view override returns (bytes32) {
        return circuitCeremonyIds[circuitType];
    }
    
    /// @notice Checks if a verifier is production-ready
    /// @param verifier The verifier address
    /// @return bool True if production-ready
    function isProduction(address verifier) external view override returns (bool) {
        return isProductionVerifier[verifier];
    }
    
    /// @notice Gets the governance contract address
    /// @return address The governance contract address
    function governanceContract() external view override returns (address) {
        return address(governance);
    }
    
    /// @notice Internal function to deploy and register a verifier
    /// @param circuitType The type of circuit
    /// @param verifyingKey The verification key
    /// @param ceremonyMetadata The trusted setup ceremony metadata
    /// @return verifier The address of the deployed verifier
    /// @dev On **local / listed dev chain IDs** (Hardhat `31337`, Sonic devnets `14601` / `57054`),
    ///      `CeremonyVerifier.isCeremonyFinalized` is **not** enforced so teams can iterate without
    ///      on-chain ceremony state. On all other chains, `ceremonyId` must be finalized on
    ///      `CeremonyVerifier` before deploy.
    function _deployAndRegisterVerifier(
        string calldata circuitType,
        Groth16Verifier.VerifyingKey calldata verifyingKey,
        Groth16Verifier.CeremonyMetadata calldata ceremonyMetadata
    ) internal returns (address verifier) {
        if (block.chainid != 31337 && block.chainid != 14601 && block.chainid != 57054) {
            if (!CeremonyVerifier(_CEREMONY_VERIFIER).isCeremonyFinalized(ceremonyMetadata.ceremonyId)) {
                revert InvalidCeremonyMetadata();
            }
        }
        
        // Deploy new Groth16 verifier
        verifier = address(new Groth16Verifier(verifyingKey, ceremonyMetadata));
        
        // Register the verifier
        verifiers[circuitType] = verifier;
        allVerifiers.push(verifier);
        isVerifier[verifier] = true;
        circuitCeremonyIds[circuitType] = ceremonyMetadata.ceremonyId;
        isProductionVerifier[verifier] = ceremonyMetadata.isProduction;
        
        emit VerifierDeployed(circuitType, verifier, ceremonyMetadata.ceremonyId);
        
        return verifier;
    }
}