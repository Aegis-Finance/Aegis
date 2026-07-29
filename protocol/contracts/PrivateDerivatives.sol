// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CommitmentLib} from "./libraries/CommitmentLib.sol";
import {GovernanceAccessLib} from "./libraries/GovernanceAccessLib.sol";
import {ProofUtils} from "./utils/ProofUtils.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PrivateTokenContract} from "./PrivateTokenContract.sol";
import {VerifierFactory} from "./VerifierFactory.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import {ICommonErrors} from "./interfaces/ICommonErrors.sol";
import {MultiOracleAggregator} from "./oracles/MultiOracleAggregator.sol";

// Custom errors for gas optimization

/**
 * @title PrivateDerivatives
 * @author Aegis Protocol Team
 * @dev Anonymous derivatives trading with ZK-proof privacy
 * @notice Supports private options and futures with automated settlement
 */
contract PrivateDerivatives is ReentrancyGuard, ICommonErrors {
    using CommitmentLib for bytes32;
    
    /// @notice Address of the governance contract for administrative operations
    address public governanceContract;

    /// @notice Optional `AegisTimelockController` for delayed governance execution.
    address public timelockController;

    event TimelockControllerUpdated(address indexed previousTimelock, address indexed newTimelock);

    /// @notice Core private token contract for settlement operations
    PrivateTokenContract public immutable PRIVATE_TOKEN;
    
    /// @notice Verifier factory for ZK proof validation
    VerifierFactory public immutable VERIFIER_FACTORY;
    
    /// @notice Circuit type identifier for derivative operations
    string public constant DERIVATIVE_CIRCUIT = "derivative";
    
    // Derivative types
    enum DerivativeType { CALL_OPTION, PUT_OPTION, FUTURE }
    enum OptionStyle { EUROPEAN, AMERICAN }
    enum SettlementStatus { ACTIVE, EXERCISED, EXPIRED, SETTLED }
    
    /// @notice Minimum time until contract expiry (1 hour)
    uint256 public constant MIN_EXPIRY = 1 hours;
    
    /// @notice Maximum time until contract expiry (365 days)
    uint256 public constant MAX_EXPIRY = 365 days;
    
    /// @notice Settlement fee in basis points (0.3%)
    uint256 public constant SETTLEMENT_FEE_BPS = 30;
    
    /// @notice Liquidation threshold in basis points (80%)
    uint256 public constant LIQUIDATION_THRESHOLD = 8000;
    
    // Timestamp security constants
    uint256 private constant TIMESTAMP_TOLERANCE = 900; // 15 minutes tolerance for timestamp comparisons
    uint256 private constant MAX_FUTURE_TOLERANCE = 300; // 5 minutes tolerance for future timestamps
    uint256 private constant MAX_PAST_TOLERANCE = 3600; // 1 hour max past tolerance
    
    /// @notice Next available contract ID for new derivative contracts
    uint256 public nextContractId;
    
    /// @notice Total value locked in all active derivative contracts
    uint256 public totalValueLocked;
    
    /// @notice Accumulated protocol fees from settlements
    uint256 public protocolFees;
    
    /// @notice Mapping of contract ID to derivative contract details
    mapping(uint256 => DerivativeContract) public contracts;
    
    /// @notice Mapping to track used nullifiers for double-spend prevention
    mapping(bytes32 => bool) public nullifierUsed;
    
    /// @notice Mapping of commitment hash to contract ID
    mapping(bytes32 => uint256) public commitmentToContract;
    
    /// @notice Mapping of user address to their contract IDs
    mapping(address => uint256[]) public userContracts;
    
    /// @notice Mapping of asset identifier to current price
    mapping(bytes32 => uint256) public assetPrices;
    
    /// @notice Mapping of asset identifier to price timestamp
    mapping(bytes32 => uint256) public priceTimestamps;
    
    // Oracle configuration struct (legacy - for direct Chainlink oracle addresses)
    struct OracleConfig {
        address[] oracles; // Multiple Chainlink oracle addresses (legacy)
        uint256 count; // Number of oracles
        uint256 requiredConfirmations; // Required oracle confirmations
    }
    
    /// @notice Mapping of asset identifier to oracle configuration (legacy)
    mapping(bytes32 => OracleConfig) public oracleConfigs;
    
    /// @notice Mapping of asset identifier to MultiOracleAggregator address (new)
    mapping(bytes32 => address) public multiOracleAggregators;
    
    /// @notice Mapping of asset identifier to whether to use multi-oracle aggregator
    mapping(bytes32 => bool) public useMultiOracle;
    
    /// @notice Maximum allowed price staleness (1 hour)
    uint256 public constant PRICE_STALENESS_THRESHOLD = 3600;
    
    /// @notice Maximum allowed price deviation between oracles (5%)
    uint256 public constant MAX_PRICE_DEVIATION = 500;
    
    /// @notice Minimum required oracle confirmations for price updates
    uint256 public constant MIN_ORACLE_CONFIRMATIONS = 2;
    
    /// @notice Mapping of authorized keeper addresses for price updates
    mapping(address => bool) public authorizedKeepers;
    
    /// @notice Mapping of asset identifier to minimum update interval
    mapping(bytes32 => uint256) public updateIntervals;
    
    /// @notice Default minimum interval between price updates (5 minutes)
    uint256 public constant DEFAULT_UPDATE_INTERVAL = 300;
    
    /// @notice Maximum allowed interval between price updates (1 hour)
    uint256 public constant MAX_UPDATE_INTERVAL = 3600;
    
    /// @notice Mapping of asset identifier to total liquidity pool amount
    mapping(bytes32 => uint256) public liquidityPools;
    
    /// @notice Mapping of asset identifier to total pool shares issued
    mapping(bytes32 => uint256) public poolShares;
    
    struct DerivativeContract {
        uint256 id;
        DerivativeType derivativeType;
        OptionStyle optionStyle;
        SettlementStatus status;
        
        bytes32 underlyingAsset;
        uint256 strikePrice;
        uint256 premium;
        uint256 notionalAmount;
        uint256 collateral;
        
        uint256 creationTime;
        uint256 expiryTime;
        uint256 exerciseTime;
        
        bytes32 buyerCommitment;
        bytes32 sellerCommitment;
        bytes32 settlementCommitment;
        
        bool isPrivate;
        bytes32 privacyNullifier;
    }
    
    struct CreateContractParams {
        DerivativeType derivativeType;
        OptionStyle optionStyle;
        bytes32 underlyingAsset;
        uint256 strikePrice;
        uint256 premium;
        uint256 notionalAmount;
        uint256 expiryTime;
        uint256 requestTimestamp;
        bytes32 buyerCommitment;
        bytes32 sellerCommitment;
        bytes zkProof;
    }
    
    struct ExerciseParams {
        uint256 contractId;
        bytes32 exerciseCommitment;
        bytes32 nullifier;
        bytes zkProof;
    }
    
    // Events
    
    /**
     * @notice Emitted when a new derivative contract is created
     * @param contractId Unique identifier for the contract
     * @param derivativeType Type of derivative (call, put, future)
     * @param underlyingAsset Asset identifier for the underlying
     * @param strikePrice Strike price for the derivative
     * @param premium Premium paid for the contract
     */
    event ContractCreated(
        uint256 indexed contractId,
        DerivativeType derivativeType,
        bytes32 indexed underlyingAsset,
        uint256 strikePrice,
        uint256 premium
    );
    
    /**
     * @notice Emitted when a derivative contract is exercised
     * @param contractId Unique identifier for the contract
     * @param nullifier Privacy nullifier for the exercise
     * @param payoff Amount paid out upon exercise
     * @param timestamp Time of exercise
     */
    event ContractExercised(
        uint256 indexed contractId,
        bytes32 indexed nullifier,
        uint256 indexed payoff,
        uint256 timestamp
    );
    
    /**
     * @notice Emitted when a derivative contract is settled
     * @param contractId Unique identifier for the contract
     * @param status Final settlement status
     * @param finalPrice Final price used for settlement
     * @param payoff Final payoff amount
     */
    event ContractSettled(
        uint256 indexed contractId,
        SettlementStatus status,
        uint256 finalPrice,
        uint256 payoff
    );
    
    /**
     * @notice Emitted when liquidity is added to an asset pool
     * @param asset Asset identifier
     * @param commitment Privacy commitment for the liquidity
     * @param amount Amount of liquidity added
     * @param shares Pool shares issued
     */
    event LiquidityAdded(
        bytes32 indexed asset,
        bytes32 indexed commitment,
        uint256 indexed amount,
        uint256 shares
    );
    
    /**
     * @notice Emitted when liquidity is removed from an asset pool
     * @param asset Asset identifier
     * @param commitment Privacy commitment for the liquidity
     * @param amount Amount of liquidity removed
     * @param shares Pool shares burned
     */
    event LiquidityRemoved(
        bytes32 indexed asset,
        bytes32 indexed commitment,
        uint256 indexed amount,
        uint256 shares
    );
    
    /**
     * @notice Emitted when an asset price is updated
     * @param asset Asset identifier
     * @param price New price value
     * @param timestamp Time of price update
     */
    event PriceUpdated(bytes32 indexed asset, uint256 indexed price, uint256 indexed timestamp);
    
    /**
     * @notice Emitted when an emergency price override is applied
     * @param asset Asset identifier
     * @param price Override price value
     * @param reason Reason for the emergency override
     * @param timestamp Time of override
     */
    event EmergencyPriceOverride(
        bytes32 indexed asset, 
        uint256 indexed price, 
        string reason, 
        uint256 indexed timestamp
    );
    
    /**
     * @notice Emitted when governance contract is updated
     * @param oldGovernance Previous governance contract address
     * @param newGovernance New governance contract address
     */
    event GovernanceUpdated(address indexed oldGovernance, address indexed newGovernance);
    
    modifier validContract(uint256 contractId) {
        if (contractId > nextContractId - 1) revert InvalidContractId();
        // Use range-based logic to avoid incorrect-equality warnings
        uint8 currentStatusValue = uint8(contracts[contractId].status);
        if (currentStatusValue > 0) revert ContractNotActive(); // ACTIVE = 0
        _;
    }
    
    /// @dev `derivative.circom` public layout: nullifierHash, merkleRoot, contractCommitment,
    ///      collateralCommitment, derivativeType, valid (output).
    uint256 private constant DERIVATIVE_PUBLIC_INPUTS = 6;

    /// @dev Groth16 proof (8 × 32) + 6 public inputs (6 × 32).
    uint256 private constant DERIVATIVE_PROOF_BYTES = 256 + (DERIVATIVE_PUBLIC_INPUTS * 32);

    /// @notice Optional AGS/quote pool used by keepers for `syncPriceFromPool`.
    mapping(bytes32 => address) public priceSourcePools;

    event PriceSourcePoolSet(bytes32 indexed asset, address indexed pool);

    error InvalidDerivativePublicInputs();
    error PoolReservesEmpty();
    error PriceSourcePoolNotSet();

    /**
     * @notice Verify a derivative Groth16 proof packed as 8 proof limbs + 6 public inputs.
     * @dev Matches ceremonied `derivative` verifier (`nPublic = 6`). Does not bind commitments —
     *      callers must check public inputs against calldata.
     */
    function _verifyDerivativeProof(bytes memory proof)
        internal
        view
        returns (uint256[8] memory convertedProof, uint256[] memory publicInputs)
    {
        (convertedProof, publicInputs) = _convertProofData(proof);
        if (publicInputs.length != DERIVATIVE_PUBLIC_INPUTS || publicInputs[5] != 1) {
            revert InvalidDerivativePublicInputs();
        }
        if (!VERIFIER_FACTORY.verifyProof(DERIVATIVE_CIRCUIT, convertedProof, publicInputs)) {
            revert InvalidZKProof();
        }
    }
    
    /**
     * @notice Initializes the PrivateDerivatives contract
     * @param _privateToken Address of the private token contract for settlements
     * @param _verifierFactory Address of the verifier factory for ZK proof validation
     * @param _governance Address of the governance contract for DAO control
     */
    constructor(
        address _privateToken,
        address _verifierFactory,
        address _governance
    ) {
        if (_privateToken == address(0)) revert InvalidTokenAddress();
        if (_verifierFactory == address(0)) revert InvalidVerifierAddress();
        if (_governance == address(0)) revert InvalidOracleAddress();
        
        PRIVATE_TOKEN = PrivateTokenContract(_privateToken);
        VERIFIER_FACTORY = VerifierFactory(_verifierFactory);
        governanceContract = _governance;
        nextContractId = 1;
        
        emit GovernanceUpdated(address(0), _governance);
    }

    // Governance modifiers
    /**
     * @notice Modifier to allow only governance contract to call functions
     * @dev Ensures fully autonomous operation through governance
     */
    modifier onlyGovernance() {
        if (!GovernanceAccessLib.isGovernanceTimelockOrCore(governanceContract, timelockController, msg.sender)) {
            revert UnauthorizedAccess();
        }
        _;
    }

    function setTimelockController(address newTimelock) external onlyGovernance {
        emit TimelockControllerUpdated(timelockController, newTimelock);
        timelockController = newTimelock;
    }
    
    /**
     * @notice Updates the governance contract address (governance only - DAO controlled)
     * @param _governance Address of the new governance contract
     * @dev Allows DAO to update governance contract through consensus
     */
    function setGovernance(address _governance) external onlyGovernance {
        if (_governance == address(0)) revert InvalidOracleAddress();
        
        address oldGovernance = governanceContract;
        governanceContract = _governance;
        emit GovernanceUpdated(oldGovernance, _governance);
    }

    /**
     * @notice Creates a new derivative contract with ZK proof validation
     * @dev Validates all parameters and creates a new derivative contract
     * @param params Contract creation parameters including ZK proof
     * @return contractId The unique identifier of the created contract
     */
    function createContract(
        CreateContractParams calldata params
    ) external returns (uint256 contractId) {
        (, uint256[] memory pubs) = _verifyDerivativeProof(params.zkProof);
        if (pubs[4] != uint256(uint8(params.derivativeType))) revert InvalidDerivativePublicInputs();
        if (bytes32(pubs[2]) != params.buyerCommitment) revert InvalidDerivativePublicInputs();

        uint256 currentTime = block.timestamp;
        
        // Validate all contract parameters
        _validateContractParams(params, currentTime);
        
        contractId = nextContractId;
        ++nextContractId;
        
        // Calculate required collateral
        uint256 requiredCollateral = _calculateCollateral(
            params.derivativeType,
            params.notionalAmount,
            params.strikePrice,
            params.underlyingAsset
        );
        
        // Check for duplicate buyer commitment
        if (commitmentToContract[params.buyerCommitment] != 0) {
            revert CommitmentAlreadyExists();
        }
        
        // Create and store the contract
        _createAndStoreContract(params, contractId, requiredCollateral, currentTime);
        
        // Handle premium transfer
        _handlePremiumTransfer(params);
        
        // Lock seller's collateral
        PRIVATE_TOKEN.lockCollateralInternal(params.sellerCommitment, requiredCollateral);
    }

    /**
     * @notice Validates contract creation parameters
     * @dev Internal function to validate timestamps, prices, and amounts
     * @param params Contract creation parameters
     * @param currentTime Current block timestamp
     */
    function _validateContractParams(
        CreateContractParams calldata params,
        uint256 currentTime
    ) internal pure {
        // Validate request timestamp to prevent replay attacks
        if (params.requestTimestamp > currentTime + MAX_FUTURE_TOLERANCE) revert RequestTimestampTooFarInFuture();
        // Safe subtraction to prevent underflow
        if (currentTime >= MAX_PAST_TOLERANCE) {
            if (params.requestTimestamp < currentTime - MAX_PAST_TOLERANCE) revert RequestTimestampTooOld();
        } else {
            // If currentTime < MAX_PAST_TOLERANCE, allow any non-zero timestamp
            if (params.requestTimestamp == 0) revert RequestTimestampTooOld();
        }
        
        if (params.expiryTime < currentTime + MIN_EXPIRY - TIMESTAMP_TOLERANCE + 1) revert ExpiryTooSoon();
        if (params.expiryTime > currentTime + MAX_EXPIRY + TIMESTAMP_TOLERANCE - 1) revert ExpiryTooFar();
        if (params.strikePrice == 0) revert InvalidStrikePrice();
        if (params.notionalAmount == 0) revert InvalidNotionalAmount();
        // Futures can have 0 premium, but options must have premium > 0
        if (params.derivativeType != DerivativeType.FUTURE) {
            if (params.premium == 0) revert InvalidPremium();
        }
    }

    /**
     * @notice Creates and stores the derivative contract
     * @dev Internal function to create contract struct and update state
     * @param params Contract creation parameters
     * @param contractId The contract identifier
     * @param requiredCollateral Calculated collateral amount
     * @param currentTime Current block timestamp
     */
    function _createAndStoreContract(
        CreateContractParams calldata params,
        uint256 contractId,
        uint256 requiredCollateral,
        uint256 currentTime
    ) internal {
        // Create contract
        contracts[contractId] = DerivativeContract({
            id: contractId,
            derivativeType: params.derivativeType,
            optionStyle: params.optionStyle,
            status: SettlementStatus.ACTIVE,
            underlyingAsset: params.underlyingAsset,
            strikePrice: params.strikePrice,
            premium: params.premium,
            notionalAmount: params.notionalAmount,
            collateral: requiredCollateral,
            creationTime: currentTime,
            expiryTime: params.expiryTime,
            exerciseTime: 0,
            buyerCommitment: params.buyerCommitment,
            sellerCommitment: params.sellerCommitment,
            settlementCommitment: bytes32(0),
            isPrivate: true,
            privacyNullifier: keccak256(abi.encodePacked(params.buyerCommitment, contractId))
        });
        
        // Lock collateral and premium
        totalValueLocked += requiredCollateral + params.premium;
        
        // Update state before external calls (checks-effects-interactions pattern)
        commitmentToContract[params.buyerCommitment] = contractId;
        
        // Emit event before external calls
        emit ContractCreated(
            contractId,
            params.derivativeType,
            params.underlyingAsset,
            params.strikePrice,
            params.premium
        );
    }

    /**
     * @notice Handles premium transfer between commitments
     * @dev Internal function to transfer premium or ensure seller commitment exists
     * @param params Contract creation parameters
     */
    function _handlePremiumTransfer(CreateContractParams calldata params) internal {
        // Transfer premium from buyer to seller (through commitments) - only if premium > 0
        if (params.premium > 0) {
            PRIVATE_TOKEN.transferBetweenCommitmentsInternal(
                params.buyerCommitment,
                params.sellerCommitment,
                params.premium
            );
        } else {
            // For futures contracts (premium = 0), ensure seller commitment exists
            // Check if commitment exists first to avoid revert
            if (!PRIVATE_TOKEN.commitmentExists(params.sellerCommitment)) {
                PRIVATE_TOKEN.createCommitment(params.sellerCommitment);
            }
        }
    }
    
    /**
     * @notice Exercises an option contract with ZK proof validation
     * @dev Validates exercise conditions and executes option settlement
     * @param params Exercise parameters including ZK proof and nullifier
     */
    function exerciseOption(
        ExerciseParams calldata params
    ) external validContract(params.contractId) {
        (, uint256[] memory pubs) = _verifyDerivativeProof(params.zkProof);
        if (bytes32(pubs[2]) != params.exerciseCommitment) revert InvalidDerivativePublicInputs();
        if (bytes32(pubs[0]) != params.nullifier) revert InvalidDerivativePublicInputs();

        if (nullifierUsed[params.nullifier]) revert NullifierAlreadyUsed();
        
        DerivativeContract storage contractData = contracts[params.contractId];
        uint256 currentTime = block.timestamp;
        
        // Validate exercise conditions
        _validateExerciseConditions(contractData, currentTime);
        
        nullifierUsed[params.nullifier] = true;
        
        // Get and validate current price
        uint256 currentPrice = _getCurrentValidPrice(contractData.underlyingAsset, currentTime);
        
        // Calculate payoff
        uint256 payoff = _calculatePayoff(contractData, currentPrice);
        
        if (payoff > 0) {
            _executeSettlement(params, contractData, payoff, currentPrice, currentTime);
        } else {
            emit ContractSettled(params.contractId, contractData.status, currentPrice, payoff);
        }
    }

    /**
     * @notice Validates conditions for option exercise
     * @dev Internal function to check contract type, expiry, and exercise timing
     * @param contractData The derivative contract data
     * @param currentTime Current block timestamp
     */
    function _validateExerciseConditions(
        DerivativeContract storage contractData,
        uint256 currentTime
    ) internal view {
        if (contractData.derivativeType == DerivativeType.FUTURE) revert CannotExerciseFutures();
        if (currentTime > contractData.expiryTime + TIMESTAMP_TOLERANCE) revert ContractExpired();
        
        // For European options, only allow exercise at expiry
        // Use range-based logic to avoid incorrect-equality warnings
        uint8 styleValue = uint8(contractData.optionStyle);
        if (styleValue < 1) { // EUROPEAN is 0
            if (currentTime < contractData.expiryTime - 1 hours) revert EuropeanOptionExerciseRestriction();
        }
    }

    /**
     * @notice Gets and validates current asset price
     * @dev Internal function to retrieve price and check staleness
     * @param asset The underlying asset identifier
     * @param currentTime Current block timestamp
     * @return currentPrice The validated current price
     */
    function _getCurrentValidPrice(
        bytes32 asset,
        uint256 currentTime
    ) internal view returns (uint256 currentPrice) {
        currentPrice = assetPrices[asset];
        if (currentPrice == 0) revert PriceNotAvailable();
        // Add tolerance to price staleness check to reduce timestamp manipulation
        if (currentTime - priceTimestamps[asset] > 1 hours + MAX_FUTURE_TOLERANCE) {
            revert PriceTooStale();
        }
    }

    /**
     * @notice Executes settlement for profitable option exercise
     * @dev Internal function to handle settlement, fees, and transfers
     * @param params Exercise parameters
     * @param contractData The derivative contract data
     * @param payoff Calculated payoff amount
     * @param currentPrice Current asset price
     * @param currentTime Current block timestamp
     */
    function _executeSettlement(
        ExerciseParams calldata params,
        DerivativeContract storage contractData,
        uint256 payoff,
        uint256 currentPrice,
        uint256 currentTime
    ) internal {
        // Update contract status
        contractData.status = SettlementStatus.EXERCISED;
        contractData.exerciseTime = currentTime;
        contractData.settlementCommitment = params.exerciseCommitment;
        
        // Calculate settlement fee
        uint256 settlementFee = (payoff * SETTLEMENT_FEE_BPS) / 10000;
        // CRITICAL FIX: Prevent underflow if settlementFee exceeds payoff
        if (settlementFee > payoff) {
            settlementFee = payoff; // Cap fee to payoff amount
        }
        uint256 netPayoff = payoff - settlementFee;
        
        protocolFees += settlementFee;
        // Ensure we don't underflow totalValueLocked
        if (payoff < totalValueLocked + 1) {
            totalValueLocked -= payoff;
        } else {
            totalValueLocked = 0;
        }
        
        // Emit events before external calls
        emit ContractExercised(params.contractId, params.nullifier, netPayoff, currentTime);
        emit ContractSettled(params.contractId, contractData.status, currentPrice, payoff);
        
        // Convert proof and transfer payoff
        (uint256[8] memory proof, ) = _convertProofData(params.zkProof);
        PRIVATE_TOKEN.transferFromCollateral(
            contractData.sellerCommitment,
            params.exerciseCommitment,
            netPayoff,
            params.nullifier,
            proof
        );
        
        // Release remaining collateral to seller
        // CRITICAL FIX: Prevent underflow in collateral calculation
        if (contractData.collateral > payoff) {
            unchecked {
                uint256 remainingCollateral = contractData.collateral - payoff;
                PRIVATE_TOKEN.unlockCollateralInternal(contractData.sellerCommitment, remainingCollateral);
            }
        }
    }
    
    /**
     * @notice Settles an expired derivative contract
     * @dev Calculates final payoff and distributes funds to contract participants
     * @param contractId The ID of the contract to settle
     * @custom:security Protected against reentrancy attacks
     * @custom:validation Only settles contracts past their expiration time
     */
    function settleExpiredContract(uint256 contractId) external nonReentrant validContract(contractId) {
        DerivativeContract storage contractData = contracts[contractId];
        uint256 currentTime = block.timestamp;
        if (currentTime < contractData.expiryTime - TIMESTAMP_TOLERANCE + 1) revert ContractNotExpired();
        
        uint256 currentPrice = assetPrices[contractData.underlyingAsset];
        if (currentPrice == 0) revert PriceNotAvailable();
        
        uint256 payoff = _calculatePayoff(contractData, currentPrice);
        
        if (payoff > 0) {
            contractData.status = SettlementStatus.SETTLED;
            
            uint256 settlementFee = (payoff * SETTLEMENT_FEE_BPS) / 10000;
            // CRITICAL FIX: Prevent underflow if settlementFee exceeds payoff
            if (settlementFee > payoff) {
                settlementFee = payoff; // Cap fee to payoff amount
            }
            uint256 netPayoff = payoff - settlementFee;
            
            protocolFees += settlementFee;
            // Prevent underflow: ensure payoff doesn't exceed totalValueLocked
            if (payoff > totalValueLocked) {
                totalValueLocked = 0;
            } else {
                totalValueLocked -= payoff;
            }
            
            // Emit event before external calls
            emit ContractSettled(contractId, contractData.status, currentPrice, payoff);
            
            // Auto-settle to buyer's commitment
            PRIVATE_TOKEN.transferBetweenCommitmentsInternal(
                contractData.sellerCommitment,
                contractData.buyerCommitment,
                netPayoff
            );
            
            // Release remaining collateral
            // CRITICAL FIX: Prevent underflow in collateral calculation
            if (contractData.collateral > payoff) {
                unchecked {
                    uint256 remainingCollateral = contractData.collateral - payoff;
                    PRIVATE_TOKEN.unlockCollateralInternal(contractData.sellerCommitment, remainingCollateral);
                }
            }
        } else {
            contractData.status = SettlementStatus.EXPIRED;
            // Emit event before external calls
            emit ContractSettled(contractId, contractData.status, currentPrice, payoff);
            // Release all collateral to seller
            PRIVATE_TOKEN.unlockCollateralInternal(contractData.sellerCommitment, contractData.collateral);
        }
    }
    
    /**
     * @notice Adds liquidity to an asset pool for derivatives trading
     * @dev Validates ZK proof and calculates proportional shares for liquidity provider
     * @param asset Asset identifier for the liquidity pool
     * @param amount Amount of tokens to add to the pool
     * @param commitment Privacy commitment for the liquidity provider
     * @param zkProof ZK proof validating the liquidity provision
     */
    function addLiquidity(
        bytes32 asset,
        uint256 amount,
        bytes32 commitment,
        bytes calldata zkProof
    ) external {
        (, uint256[] memory pubs) = _verifyDerivativeProof(zkProof);
        if (bytes32(pubs[2]) != commitment) revert InvalidDerivativePublicInputs();
        if (amount == 0) revert InvalidAmount();
        
        uint256 shares;
        if (liquidityPools[asset] == 0) {
            shares = amount; // First liquidity provider gets 1:1 shares
        } else {
            shares = (amount * poolShares[asset]) / liquidityPools[asset];
        }
        
        liquidityPools[asset] += amount;
        poolShares[asset] += shares;
        
        // Emit event before external call
        emit LiquidityAdded(asset, commitment, amount, shares);
        
        // Transfer tokens to pool
        PRIVATE_TOKEN.transferToPoolInternal(commitment, address(this), amount);
    }
    
    /**
     * @notice Updates the price of an asset (in production, this would be done by oracles)
     * @dev Updates asset price and timestamp, restricted to owner or governance
     * @param asset Asset identifier to update price for
     * @param price New price value for the asset
     */
    function updatePrice(bytes32 asset, uint256 price) external onlyGovernance {
        if (price == 0) revert InvalidPrice();
        
        assetPrices[asset] = price;
        priceTimestamps[asset] = block.timestamp;
        emit PriceUpdated(asset, price, block.timestamp);
    }
    
    /**
     * @notice Emergency manual price update - USE ONLY WHEN ORACLES FAIL
     * @dev This function should only be used in emergency situations when oracle feeds are unavailable
     * @param asset The asset identifier
     * @param price The new price
     * @param reason Emergency reason for manual override
     */
    function emergencyUpdatePrice(bytes32 asset, uint256 price, string calldata reason) external onlyGovernance {
        if (price == 0) revert InvalidPrice();
        
        // Log the emergency override for transparency
        emit EmergencyPriceOverride(asset, price, reason, block.timestamp);
        
        assetPrices[asset] = price;
        priceTimestamps[asset] = block.timestamp;
        emit PriceUpdated(asset, price, block.timestamp);
    }
    
    /**
     * @notice Adds an oracle address for a specific asset (legacy Chainlink-only)
     * @param asset The asset identifier
     * @param oracle The Chainlink oracle contract address
     */
    function addOracle(bytes32 asset, address oracle) external onlyGovernance {
        if (oracle == address(0)) revert InvalidOracleAddress();
        oracleConfigs[asset].oracles.push(oracle);
        ++oracleConfigs[asset].count;
        
        // Set default required confirmations if first oracle
        if (oracleConfigs[asset].requiredConfirmations == 0) {
            oracleConfigs[asset].requiredConfirmations = MIN_ORACLE_CONFIRMATIONS;
        }
    }

    /**
     * @notice Set multi-oracle aggregator for an asset (new multi-oracle support)
     * @param asset The asset identifier
     * @param aggregator Address of MultiOracleAggregator contract
     */
    function setMultiOracleAggregator(bytes32 asset, address aggregator) external onlyGovernance {
        if (aggregator == address(0)) revert InvalidOracleAddress();
        multiOracleAggregators[asset] = aggregator;
        useMultiOracle[asset] = true;
    }

    /**
     * @notice Disable multi-oracle aggregator for an asset (fallback to legacy)
     * @param asset The asset identifier
     */
    function disableMultiOracle(bytes32 asset) external onlyGovernance {
        useMultiOracle[asset] = false;
    }
    
    /**
     * @notice Sets the required number of oracle confirmations for an asset
     * @param asset The asset identifier
     * @param confirmations Number of required confirmations
     */
    function setRequiredConfirmations(bytes32 asset, uint256 confirmations) external onlyGovernance {
        if (confirmations == 0 || confirmations > oracleConfigs[asset].count) revert InsufficientOracleConfirmations();
        oracleConfigs[asset].requiredConfirmations = confirmations;
    }
    
    /**
     * @notice Authorizes or deauthorizes a keeper for automatic price updates
     * @param keeper The keeper address
     * @param authorized Whether the keeper is authorized
     */
    function setKeeperAuthorization(address keeper, bool authorized) external onlyGovernance {
        authorizedKeepers[keeper] = authorized;
    }
    
    /**
     * @notice Sets the update interval for an asset
     * @param asset The asset identifier
     * @param interval Update interval in seconds
     */
    function setUpdateInterval(bytes32 asset, uint256 interval) external onlyGovernance {
        if (interval > MAX_UPDATE_INTERVAL) revert InvalidUpdateInterval();
        updateIntervals[asset] = interval;
    }
    
    /**
     * @notice Checks if a price update is needed for an asset
     * @param asset The asset to check
     * @return Whether an update is needed
     */
    function isPriceUpdateNeeded(bytes32 asset) external view returns (bool) {
        uint256 interval = updateIntervals[asset];
        if (interval == 0) interval = DEFAULT_UPDATE_INTERVAL;

        uint256 ts = priceTimestamps[asset];
        if (ts > block.timestamp) return true;

        return block.timestamp - ts > interval - 1;
    }
    
    /**
     * @notice Updates price from multiple oracles with validation
     * @param asset The asset to update price for
     */
    function updatePriceFromOracle(bytes32 asset) external {
        // Check authorization - governance or authorized keeper
        if (msg.sender != governanceContract && !authorizedKeepers[msg.sender]) {
            revert UnauthorizedKeeper();
        }
        
        // Use multi-oracle aggregator if configured
        if (useMultiOracle[asset] && multiOracleAggregators[asset] != address(0)) {
            // Update price via MultiOracleAggregator
            (uint256 aggregatedPrice, uint256 timestamp, , bool isValid) = 
                MultiOracleAggregator(multiOracleAggregators[asset]).updatePrice(asset);
            
            if (!isValid) revert PriceNotAvailable();
            
            assetPrices[asset] = aggregatedPrice;
            priceTimestamps[asset] = timestamp;
            
            emit PriceUpdated(asset, aggregatedPrice, timestamp);
            return;
        }
        
        // Fallback to legacy Chainlink oracle implementation
        address[] memory oracles = oracleConfigs[asset].oracles;
        if (oracles.length == 0) revert NoOracleSetForAsset();
        
        // Check if update is needed (for keepers, governance can always update)
        if (msg.sender != governanceContract && !_isUpdateNeeded(asset)) {
            return; // Update not needed yet
        }
        
        // Fetch and validate oracle prices
        (uint256[] memory prices, uint256 validPrices) = _fetchOraclePrices(oracles);
        
        // Check if we have enough valid prices
        if (validPrices < oracleConfigs[asset].requiredConfirmations) revert InsufficientOracleConfirmations();
        
        // Calculate and validate median price
        uint256 medianPrice = _calculateMedianPrice(prices, validPrices);
        if (!_validatePriceDeviation(prices, validPrices, medianPrice)) revert PriceDeviationTooHigh();
        
        // Update price and timestamp
        assetPrices[asset] = medianPrice;
        priceTimestamps[asset] = block.timestamp;
        
        emit PriceUpdated(asset, medianPrice, block.timestamp);
    }

    /**
     * @notice Checks if price update is needed based on interval
     * @dev Internal function to determine update necessity
     * @param asset The asset to check
     * @return bool True if update is needed
     */
    function _isUpdateNeeded(bytes32 asset) internal view returns (bool) {
        uint256 interval = updateIntervals[asset];
        if (interval == 0) interval = DEFAULT_UPDATE_INTERVAL;

        uint256 ts = priceTimestamps[asset];
        if (ts > block.timestamp) return true;

        return block.timestamp - ts > interval - 1;
    }

    /**
     * @notice Fetches prices from multiple oracles with validation
     * @dev Internal function to collect and validate oracle data
     * @param oracles Array of oracle addresses
     * @return prices Array of valid prices
     * @return validPrices Number of valid prices collected
     */
    function _fetchOraclePrices(
        address[] memory oracles
    ) internal view returns (uint256[] memory prices, uint256 validPrices) {
        prices = new uint256[](oracles.length);
        validPrices = 0;
        
        // Fetch prices from all oracles
        for (uint256 i = 0; i < oracles.length; ++i) {
            try AggregatorV3Interface(oracles[i]).latestRoundData() returns (
                uint80 roundId,
                int256 price,
                uint256 /* startedAt */,
                uint256 updatedAt,
                uint80 answeredInRound
            ) {
                // Validate oracle response
                if (price < 1) continue;
                if (updatedAt == 0) continue;
                if (updatedAt > block.timestamp || block.timestamp - updatedAt > PRICE_STALENESS_THRESHOLD) {
                    continue;
                }
                if (roundId != answeredInRound) continue; // Round not complete
                
                prices[validPrices] = uint256(price);
                ++validPrices;
            } catch {
                // Oracle call failed, skip this oracle
                continue;
            }
        }
    }
    
    /**
     * @notice Checks if price data is fresh enough for operations
     * @param asset The asset to check
     * @return bool True if price is fresh
     */
    function isPriceFresh(bytes32 asset) external view returns (bool) {
        uint256 ts = priceTimestamps[asset];
        if (ts > block.timestamp) return false;

        return block.timestamp - ts < PRICE_STALENESS_THRESHOLD + 1;
    }
    
    /**
     * @notice Calculates the required collateral for a derivative contract
     * @dev Determines collateral based on derivative type and current market conditions
     * @param derivativeType Type of derivative (call, put, or future)
     * @param notionalAmount Notional amount of the contract
     * @param strikePrice Strike price of the derivative
     * @param asset Underlying asset identifier
     * @return Required collateral amount for the contract
     */
    function _calculateCollateral(
        DerivativeType derivativeType,
        uint256 notionalAmount,
        uint256 strikePrice,
        bytes32 asset
    ) internal view returns (uint256) {
        uint256 currentPrice = assetPrices[asset];
        if (currentPrice == 0) revert PriceNotAvailable();
        
        // Use range-based logic to avoid incorrect-equality warnings
        uint8 contractTypeValue = uint8(derivativeType);
        if (contractTypeValue < 1) { // CALL_OPTION = 0
            // For call options, collateral is the notional amount
            return notionalAmount;
        } else if (contractTypeValue < 2) { // PUT_OPTION = 1
            // For put options, collateral is strike price * notional
            return (strikePrice * notionalAmount) / 1e18;
        } else {
            // For futures, collateral is a percentage of notional value
            return (notionalAmount * currentPrice * 20) / (100 * 1e18); // 20% margin
        }
    }
    
    /**
     * @notice Calculates the payoff for a derivative contract
     * @dev Determines payoff based on derivative type and current vs strike price
     * @param contractData Contract details including type and strike price
     * @param currentPrice Current market price of the underlying asset
     * @return Payoff amount for the contract
     */
    function _calculatePayoff(
        DerivativeContract memory contractData,
        uint256 currentPrice
    ) internal pure returns (uint256) {
        // Use mapping approach to avoid incorrect-equality warnings
        uint8 typeValue = uint8(contractData.derivativeType);
        
        // Handle CALL_OPTION (0)
        if (typeValue < 1) {
            if (currentPrice > contractData.strikePrice) {
                return ((currentPrice - contractData.strikePrice) * contractData.notionalAmount) / 1e18;
            }
        }
        // Handle PUT_OPTION (1) 
        else if (typeValue < 2) {
            if (contractData.strikePrice > currentPrice) {
                return ((contractData.strikePrice - currentPrice) * contractData.notionalAmount) / 1e18;
            }
        }
        // Handle FUTURE (2)
        else {
            // Futures always settle to the difference
            if (currentPrice > contractData.strikePrice) {
                return ((currentPrice - contractData.strikePrice) * contractData.notionalAmount) / 1e18;
            } else {
                return ((contractData.strikePrice - currentPrice) * contractData.notionalAmount) / 1e18;
            }
        }
        
        return 0;
    }
    
    /**
     * @notice Retrieves complete contract details
     * @param contractId The ID of the contract to retrieve
     * @return The complete derivative contract data
     */
    function getContract(uint256 contractId) external view returns (DerivativeContract memory) {
        return contracts[contractId];
    }
    
    /**
     * @notice Gets the current price and timestamp for an asset
     * @param asset The asset identifier
     * @return price The current price of the asset
     * @return timestamp The timestamp of the last price update
     */
    function getAssetPrice(bytes32 asset) external view returns (uint256 price, uint256 timestamp) {
        return (assetPrices[asset], priceTimestamps[asset]);
    }
    
    /**
     * @notice Gets liquidity pool information for an asset
     * @param asset The asset identifier
     * @return totalLiquidity The total liquidity in the pool
     * @return totalShares The total shares issued for the pool
     */
    function getLiquidityPool(bytes32 asset) external view returns (uint256 totalLiquidity, uint256 totalShares) {
        return (liquidityPools[asset], poolShares[asset]);
    }
    
    /**
     * @notice Intrinsic payoff at a hypothetical spot (no stored contract required).
     * @dev Mirrors `_calculatePayoff` for integrators and the Arweave pricing UI. Premium is **not** implied here.
     */
    function previewIntrinsicPayoff(
        DerivativeType derivativeType,
        uint256 strikePrice,
        uint256 notionalAmount,
        uint256 spotPrice
    ) external pure returns (uint256) {
        if (strikePrice == 0 || notionalAmount == 0) return 0;
        DerivativeContract memory stub = DerivativeContract({
            id: 0,
            derivativeType: derivativeType,
            optionStyle: OptionStyle.EUROPEAN,
            status: SettlementStatus.ACTIVE,
            underlyingAsset: bytes32(0),
            strikePrice: strikePrice,
            premium: 0,
            notionalAmount: notionalAmount,
            collateral: 0,
            creationTime: 0,
            expiryTime: 0,
            exerciseTime: 0,
            buyerCommitment: bytes32(0),
            sellerCommitment: bytes32(0),
            settlementCommitment: bytes32(0),
            isPrivate: true,
            privacyNullifier: bytes32(0)
        });
        return _calculatePayoff(stub, spotPrice);
    }

    /**
     * @notice Required seller collateral for a hypothetical contract at `spotPrice`.
     * @dev Same rules as `_calculateCollateral` but accepts spot directly (pre-trade quoting).
     */
    function previewRequiredCollateral(
        DerivativeType derivativeType,
        uint256 notionalAmount,
        uint256 strikePrice,
        uint256 spotPrice
    ) external pure returns (uint256) {
        if (notionalAmount == 0) return 0;
        if (spotPrice == 0) revert PriceNotAvailable();
        uint8 contractTypeValue = uint8(derivativeType);
        if (contractTypeValue < 1) {
            return notionalAmount;
        } else if (contractTypeValue < 2) {
            return (strikePrice * notionalAmount) / 1e18;
        }
        return (notionalAmount * spotPrice * 20) / (100 * 1e18);
    }

    /**
     * @notice Calculates the current payoff for a contract
     * @param contractId The ID of the contract
     * @return The current payoff amount
     */
    function calculateCurrentPayoff(uint256 contractId) external view validContract(contractId) returns (uint256) {
        DerivativeContract memory contractData = contracts[contractId];
        uint256 currentPrice = assetPrices[contractData.underlyingAsset];
        return _calculatePayoff(contractData, currentPrice);
    }
    
    /**
     * @notice Checks if a contract is currently in the money
     * @param contractId The ID of the contract to check
     * @return True if the contract has positive payoff
     */
    function isContractInTheMoney(uint256 contractId) external view validContract(contractId) returns (bool) {
        return this.calculateCurrentPayoff(contractId) > 0;
    }

    /**
     * @notice Calculates median price from array of prices
     * @param prices Array of prices
     * @param length Number of valid prices
     * @return Median price
     */
    function _calculateMedianPrice(uint256[] memory prices, uint256 length) internal pure returns (uint256) {
        if (length == 0) return 0;
        if (length == 1) return prices[0];
        
        // Sort prices (simple bubble sort for small arrays)
        for (uint256 i = 0; i < length - 1; ++i) {
            for (uint256 j = 0; j < length - i - 1; ++j) {
                if (prices[j] > prices[j + 1]) {
                    uint256 temp = prices[j];
                    prices[j] = prices[j + 1];
                    prices[j + 1] = temp;
                }
            }
        }
        
        // Return median
        if (length % 2 == 0) {
            return (prices[length / 2 - 1] + prices[length / 2]) / 2;
        } else {
            return prices[length / 2];
        }
    }
    
    /**
     * @notice Validates that price deviation is within acceptable range
     * @param prices Array of prices
     * @param length Number of valid prices
     * @param medianPrice The calculated median price
     * @return True if deviation is acceptable
     */
    function _validatePriceDeviation(
        uint256[] memory prices, 
        uint256 length, 
        uint256 medianPrice
    ) internal pure returns (bool) {
        if (length < 2) return true; // No deviation check needed for single price
        
        for (uint256 i = 0; i < length; ++i) {
            uint256 deviation;
            if (prices[i] > medianPrice) {
                deviation = ((prices[i] - medianPrice) * 10000) / medianPrice;
            } else {
                deviation = ((medianPrice - prices[i]) * 10000) / medianPrice;
            }
            
            if (deviation > MAX_PRICE_DEVIATION) {
                return false;
            }
        }
        
        return true;
    }

    /**
     * @notice Register the AGS/quote liquidity pool used for keeper spot sync.
     * @dev Prefer Sonic listed oracles (Chainlink/Pyth/API3/…) when an AGS feed exists;
     *      until then, pool mid is the honest on-chain mark for AGS/SONIC.
     */
    function setPriceSourcePool(bytes32 asset, address pool) external onlyGovernance {
        if (pool == address(0)) revert InvalidOracleAddress();
        priceSourcePools[asset] = pool;
        emit PriceSourcePoolSet(asset, pool);
    }

    /**
     * @notice Pull spot from the configured public AGS/quote pool (quote wei per 1e18 AGS).
     * @dev Callable by governance or authorized keepers. Reverts when the pool has no depth
     *      (e.g. pre-TGE) — use `updatePrice` for a governance bootstrap mark in that case.
     */
    function syncPriceFromPool(bytes32 asset) external {
        if (
            msg.sender != governanceContract &&
            !GovernanceAccessLib.isGovernanceTimelockOrCore(governanceContract, timelockController, msg.sender) &&
            !authorizedKeepers[msg.sender]
        ) {
            revert UnauthorizedAccess();
        }
        address pool = priceSourcePools[asset];
        if (pool == address(0)) revert PriceSourcePoolNotSet();

        (uint256 reserveAGS, uint256 reserveQuote) = IPublicLiquidityPoolReserves(pool).getReserves();
        if (reserveAGS == 0 || reserveQuote == 0) revert PoolReservesEmpty();

        uint256 price = (reserveQuote * 1e18) / reserveAGS;
        if (price == 0) revert InvalidPrice();

        assetPrices[asset] = price;
        priceTimestamps[asset] = block.timestamp;
        emit PriceUpdated(asset, price, block.timestamp);
    }

    /**
     * @notice Converts packed derivative proof bytes into Groth16 limbs + public inputs.
     * @dev Layout: 8 × uint256 proof || 6 × uint256 publicInputs (matches `derivative.circom`).
     */
    function _convertProofData(bytes memory proof)
        internal
        pure
        returns (uint256[8] memory convertedProof, uint256[] memory publicInputs)
    {
        if (proof.length < DERIVATIVE_PROOF_BYTES) revert InvalidProofLength();

        convertedProof = ProofUtils.convertProofFromMemory(proof);
        publicInputs = new uint256[](DERIVATIVE_PUBLIC_INPUTS);
        // solhint-disable-next-line no-inline-assembly
        assembly ("memory-safe") {
            let src := add(add(proof, 0x20), 256)
            let dst := add(publicInputs, 0x20)
            mstore(dst, mload(src))
            mstore(add(dst, 0x20), mload(add(src, 0x20)))
            mstore(add(dst, 0x40), mload(add(src, 0x40)))
            mstore(add(dst, 0x60), mload(add(src, 0x60)))
            mstore(add(dst, 0x80), mload(add(src, 0x80)))
            mstore(add(dst, 0xa0), mload(add(src, 0xa0)))
        }
    }
    
}

interface IPublicLiquidityPoolReserves {
    function getReserves() external view returns (uint256 reserveAGS, uint256 reserveQuote);
}

/**
 * @title PrivateDerivatives DAO Transformation Complete
 * @notice PrivateDerivatives has been successfully transformed into a fully decentralized contract
 * 
 * KEY CHANGES MADE:
 * ==================
 * 1. ✅ REMOVED CENTRALIZED CONTROL:
 *    - Eliminated Ownable inheritance
 *    - Removed all onlyOwner modifiers
 *    - No single point of failure or admin control
 * 
 * 2. ✅ IMPLEMENTED DAO GOVERNANCE:
 *    - Governance set in constructor (no owner setup phase)
 *    - All administrative operations now require DAO approval
 *    - Governance can be updated through DAO vote via setGovernance()
 * 
 * 3. ✅ GOVERNANCE-CONTROLLED FUNCTIONS:
 *    - updatePrice() - DAO controls price oracle updates
 *    - emergencyUpdatePrice() - DAO controls emergency price overrides
 *    - addOracle() - DAO manages oracle configurations
 *    - setRequiredConfirmations() - DAO sets oracle requirements
 *    - setKeeperAuthorization() - DAO manages keeper addresses
 *    - setUpdateInterval() - DAO configures update intervals
 *    - setGovernance() - DAO can update governance contract
 * 
 * 4. ✅ REMOVED PAUSE MECHANISM:
 *    - No pause/unpause functionality (true decentralization)
 *    - Market decides - no intervention mechanism
 *    - Aligns with Austrian Economics: spontaneous market order
 *    - No single point of failure, even through governance
 * 
 * 5. ✅ MAINTAINED SECURITY:
 *    - All critical functions require DAO consensus
 *    - Price oracle management is decentralized
 *    - No emergency pause creates true market autonomy
 *    - Austrian Economics principles fully preserved
 * 
 * SECURITY IMPLICATIONS:
 * ======================
 * - Derivatives trading is fully autonomous - no pause mechanism
 * - No single entity (even governance) can halt market operations
 * - Market participants retain full control through voluntary exchange
 * - True decentralization: no intervention mechanism, pure market-driven
 * - If critical issues arise, governance can propose contract upgrades/migrations
 * 
 * AUSTRIAN ECONOMICS PRINCIPLES:
 * ==============================
 * - Spontaneous Order: Market coordinates without central intervention
 * - Voluntary Exchange: No forced pause disrupts voluntary transactions
 * - Market Process: Continuous market operation without artificial halts
 * - Individual Sovereignty: Users maintain full control, no authority can stop them
 * 
 * This transformation ensures that derivatives trading follows Austrian Economics
 * principles of decentralized coordination and market-driven consensus, with no
 * centralized admin, owner, or pause mechanism. The market is truly autonomous.
 */