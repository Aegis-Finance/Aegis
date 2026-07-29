// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./interfaces/ICommonErrors.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {CommitmentLib} from "./libraries/CommitmentLib.sol";
import {ProofLib} from "./libraries/ProofLib.sol";
import {GovernanceAccessLib} from "./libraries/GovernanceAccessLib.sol";
import {PrivateTokenContract} from "./PrivateTokenContract.sol";
import {VerifierFactory} from "./VerifierFactory.sol";

// Custom errors for gas optimization

/**
 * @title PrivateAMMContract
 * @author Aegis Protocol Team
 * @notice **Groth16-gated AMM module** — swaps and liquidity operations require a valid `private-amm` proof for allowed `op` codes; **pool reserves and pool state remain public on-chain** (standard EVM reads + events).
 * @dev **Do not read “private” as “hidden liquidity.”** The `private-amm` circuit proves **layout / range / per-op policy** constraints on public inputs; it does **not** (today) embed full keccak256 commitment opening soundness vs `CommitmentLib` — see `circuits/private-amm.circom` header and **`docs/liquidity/PUBLIC_VS_PRIVATE_AMM.md`**.
 *      **Guardrail → failure mode map** (for governance / audits; see `docs/PRIVATE_AMM_FAILURE_MODES.md`):
 *      `FEE_RATE` compensates LPs for adverse selection; `MAX_SLIPPAGE` / `MIN_AMOUNT` bound user input mistakes and dust;
 *      `MAX_K_DEVIATION_PPM` / `K_INVARIANT_ALERT_PPM` detect rounding or manipulation vs constant product;
 *      `MAX_PRICE_IMPACT_BPS` limits trade size vs depth; `FLASH_LOAN_THRESHOLD_BPS` flags single-block reserve shocks.
 *      User-facing privacy is **limited to what the proof + commitment/nullifier design actually enforce**; depth and timing metadata remain adversarial axes on a public L1.
 */
contract PrivateAMMContract is Ownable, ReentrancyGuard, Pausable , ICommonErrors{
    using CommitmentLib for CommitmentLib.Commitment;
    using ProofLib for ProofLib.ZKProof;
    
    // AMM parameters
    /// @notice Trading fee rate in basis points (0.3%)
    uint256 public constant FEE_RATE = 30; // 0.3% trading fee (30 basis points)
    /// @notice Minimum liquidity required for new pools
    uint256 public constant MIN_LIQUIDITY = 1000; // Minimum liquidity for new pools
    /// @notice Precision factor for calculations
    uint256 public constant PRECISION = 1e18;
    /// @notice Maximum allowed slippage in basis points (5%)
    uint256 public constant MAX_SLIPPAGE = 500; // 5% maximum slippage protection
    /// @notice Alert threshold (in parts-per-million) for k-invariant deviations
    uint256 public constant K_INVARIANT_ALERT_PPM = 1_000; // 0.1% deviation alert
    /// @notice Maximum allowed deviation (in parts-per-million) for k-invariant before reverting
    uint256 public constant MAX_K_DEVIATION_PPM = 20_000; // 2% hard limit on k deviation
    uint256 private constant PPM_DENOMINATOR = 1_000_000;
    
    // Security constants (aligned with PublicLiquidityPool)
    /// @notice Maximum price impact per swap (50% = 5000 bps) to prevent manipulation
    uint256 public constant MAX_PRICE_IMPACT_BPS = 5000; // 50% maximum price impact
    /// @notice Minimum amount to prevent dust attacks (1000 wei)
    uint256 public constant MIN_AMOUNT = 1_000;
    /// @notice Flash loan detection threshold (10% reserve change in single block)
    uint256 public constant FLASH_LOAN_THRESHOLD_BPS = 1000; // 10%
    uint256 private constant BPS = 10_000; // Basis points denominator
    
    // Timestamp security constants
    uint256 private constant TIMESTAMP_TOLERANCE = 900; // 15 minutes tolerance for timestamp comparisons
    
    // Circuit type for VerifierFactory — distinct from `aggregator` (used by `HyperOptimizedAggregator` / batch Merkle circuit).
    string private constant PRIVATE_AMM_CIRCUIT = "private-amm";

    /// @notice Length of `publicInputs` for `PRIVATE_AMM_CIRCUIT` Groth16: `[valid, op, s1..s8]` (see `circuits/private-amm.circom`). The circuit enforces op/padding, 248-bit range bounds, and per-op dust/layout rules; it does **not** embed keccak256 commitment openings (see Circom file header).
    uint256 private constant AMM_ZK_PUBLIC_INPUTS = 10;
    uint256 private constant AMM_ZK_VALID = 1;
    uint256 private constant AMM_ZK_OP_CREATE_POOL = 1;
    uint256 private constant AMM_ZK_OP_ADD_LIQUIDITY = 2;
    uint256 private constant AMM_ZK_OP_SWAP = 3;
    uint256 private constant AMM_ZK_OP_REMOVE_LIQUIDITY = 4;
    
    // Contract references
    /// @notice The Aegis token contract used as the base token in all pools
    PrivateTokenContract public immutable AEGIS_TOKEN;
    /// @notice Factory contract for managing ZK proof verifiers
    VerifierFactory public immutable VERIFIER_FACTORY;
    
    // Pool state
    struct Pool {
        uint256 reserveA; // Reserve of token A (AGS)
        uint256 reserveB; // Reserve of token B (external token)
        uint256 totalLiquidity; // Total liquidity shares
        uint256 kLast; // Last recorded k value for fee calculation
        address tokenB; // Address of token B
        bool initialized;
    }
    
    // Flash loan detection state
    struct FlashLoanData {
        uint256 previousReserveA; // Reserve A before potential flash loan
        uint256 previousReserveB; // Reserve B before potential flash loan
        uint32 lastBlockChecked; // Last block number checked for flash loans
    }
    
    /// @notice Flash loan detection data per pool
    mapping(bytes32 => FlashLoanData) public flashLoanData;
    
    /// @notice Mapping from pool ID to pool information
    mapping(bytes32 => Pool) public pools; // poolId => Pool
    /// @notice Mapping from token address to its corresponding pool ID
    mapping(bytes32 => bytes32) public poolTokens; // tokenB => poolId
    
    // Commitment tracking
    /// @notice Tracks used liquidity commitments to prevent double-spending
    mapping(bytes32 => bool) public liquidityCommitments;
    /// @notice Tracks used swap commitments to prevent double-spending
    mapping(bytes32 => bool) public swapCommitments;
    /// @notice Tracks used nullifiers in AMM operations to prevent double-spending
    mapping(bytes32 => bool) public ammNullifiers;
    
    // Liquidity provider tracking
    /// @notice Mapping from position ID to liquidity position details
    mapping(bytes32 => LiquidityPosition) public liquidityPositions;
    /// @notice Mapping from position ID to the number of liquidity shares owned
    mapping(bytes32 => uint256) public liquidityShares;
    
    struct LiquidityPosition {
        bytes32 poolId;
        bytes32 commitment;
        uint256 shares;
        uint256 timestamp;
        bool active;
    }
    
    // Events
    /**
     * @notice Emitted when a new trading pool is created
     * @param poolId Unique identifier for the created pool
     * @param tokenA Address of the first token (Aegis)
     * @param tokenB Address of the second token
     * @param initialReserveA Initial reserve amount of token A
     * @param initialReserveB Initial reserve amount of token B
     */
    event PoolCreated(
        bytes32 indexed poolId,
        address indexed tokenA,
        address indexed tokenB,
        uint256 initialReserveA,
        uint256 initialReserveB
    );
    
    /**
     * @notice Emitted when liquidity is added to a pool
     * @param poolId The pool receiving the liquidity
     * @param commitment The commitment hash for the liquidity position
     * @param amountA Amount of token A added
     * @param amountB Amount of token B added
     * @param liquidity Number of liquidity shares minted
     */
    event LiquidityAdded(
        bytes32 indexed poolId,
        bytes32 indexed commitment,
        uint256 indexed amountA,
        uint256 amountB,
        uint256 liquidity
    );
    
    /**
     * @notice Emitted when liquidity is removed from a pool
     * @param poolId The pool from which liquidity is removed
     * @param nullifier The nullifier used to spend the liquidity position
     * @param outputCommitmentA Output commitment for token A
     * @param outputCommitmentB Output commitment for token B
     * @param amountA Amount of token A withdrawn
     * @param amountB Amount of token B withdrawn
     */
    event LiquidityRemoved(
        bytes32 indexed poolId,
        bytes32 indexed nullifier,
        bytes32 indexed outputCommitmentA,
        bytes32 outputCommitmentB,
        uint256 amountA,
        uint256 amountB
    );
    
    /**
     * @notice Emitted when a swap is executed
     * @param poolId The pool where the swap occurred
     * @param inputNullifier The nullifier for the input commitment
     * @param outputCommitment The commitment for the output tokens
     * @param amountIn Amount of tokens swapped in
     * @param amountOut Amount of tokens received
     * @param isAToB True if swapping token A for B, false otherwise
     */
    event SwapExecuted(
        bytes32 indexed poolId,
        bytes32 indexed inputNullifier,
        bytes32 indexed outputCommitment,
        uint256 amountIn,
        uint256 amountOut,
        bool isAToB
    );

    /**
     * @notice Emitted when a k-invariant deviation exceeds the alert threshold
     * @param poolId The pool where the deviation occurred
     * @param previousK The previous k-invariant value
     * @param newK The new k-invariant value after the swap
     * @param deviationPpm Deviation expressed in parts-per-million
     */
    event KInvariantDeviationDetected(
        bytes32 indexed poolId,
        uint256 previousK,
        uint256 newK,
        uint256 deviationPpm
    );

    /// @notice Thrown when the k-invariant deviation breaches the allowed limit
    error KInvariantDeviationExceeded(uint256 deviationPpm, uint256 thresholdPpm);
    
    /// @notice Thrown when flash loan attack is detected
    error FlashLoanDetected();
    
    /// @notice Thrown when price impact exceeds maximum allowed
    error PriceImpactTooHigh(uint256 priceImpactBps, uint256 maxBps);
    
    /// @notice Thrown when K invariant decreases unexpectedly
    error KInvariantDecreased(uint256 previousK, uint256 newK);
    
    /**
     * @notice Emitted when a flash loan attack is detected
     * @param poolId The pool where the attack was detected
     * @param reserveChangeBps Reserve change in basis points
     * @param previousReserveA Reserve A before attack
     * @param previousReserveB Reserve B before attack
     * @param currentReserveA Reserve A after attack
     * @param currentReserveB Reserve B after attack
     */
    event FlashLoanDetectedEvent(
        bytes32 indexed poolId,
        uint256 reserveChangeBps,
        uint256 previousReserveA,
        uint256 previousReserveB,
        uint256 currentReserveA,
        uint256 currentReserveB
    );
    
    /**
     * @notice Emitted when price impact exceeds maximum allowed
     * @param poolId The pool where the high impact occurred
     * @param priceImpactBps Price impact in basis points
     * @param amountIn Input amount
     * @param amountOut Output amount
     */
    event PriceImpactExceeded(
        bytes32 indexed poolId,
        uint256 priceImpactBps,
        uint256 amountIn,
        uint256 amountOut
    );
    
    /**
     * @notice Emitted when trading fees are collected
     * @param poolId The pool from which fees are collected
     * @param feeAmount Amount of fees collected
     */
    event FeesCollected(
        bytes32 indexed poolId,
        uint256 indexed feeAmount
    );
    
    /**
     * @notice Emitted when a verifier contract address is updated
     * @param verifierType Type of verifier being updated
     * @param newVerifier New verifier contract address
     */
    event VerifierUpdated(
        string indexed verifierType,
        address indexed newVerifier
    );
    
    // Errors (InvalidProof is imported from ProofLib)

    // Governance
    /// @notice Address of the governance contract that can perform administrative functions
    address public governanceContract;

    /// @notice Optional `AegisTimelockController` for delayed governance execution.
    address public timelockController;

    event TimelockControllerUpdated(address indexed previousTimelock, address indexed newTimelock);
    
    /**
     * @notice Initializes the private AMM contract with token and verifier factory
     * @dev Constructor
     * @param _aegisToken Address of the Aegis token contract
     * @param _verifierFactory Address of the VerifierFactory contract
     */
    constructor(
        address _aegisToken,
        address _verifierFactory
    ) Ownable(msg.sender) {
        if (_aegisToken == address(0)) revert InvalidTokenAddress();
        if (_verifierFactory == address(0)) revert InvalidVerifierAddress();
        
        AEGIS_TOKEN = PrivateTokenContract(_aegisToken);
        VERIFIER_FACTORY = VerifierFactory(_verifierFactory);
    }
    
    // Governance modifiers
    /**
     * @notice Modifier to restrict access to governance contract only
     * @dev Ensures fully autonomous operation through governance
     */
    modifier onlyGovernance() {
        if (!GovernanceAccessLib.isGovernanceTimelockOrCore(governanceContract, timelockController, msg.sender)) {
            revert UnauthorizedAccess();
        }
        _;
    }
    
    /**
     * @notice Modifier to restrict access to owner or governance contract
     * @dev Allows both owner and governance to perform administrative functions
     */
    modifier onlyOwnerOrGovernance() {
        if (msg.sender != owner() && !GovernanceAccessLib.isGovernanceTimelockOrCore(governanceContract, timelockController, msg.sender)) {
            revert UnauthorizedAccess();
        }
        _;
    }

    function setTimelockController(address newTimelock) external onlyOwner {
        emit TimelockControllerUpdated(timelockController, newTimelock);
        timelockController = newTimelock;
    }
    
    /**
     * @notice Sets the governance contract address (owner only, one-time setup)
     * @param _governance Address of the governance contract
     * @dev Once set, governance contract gains administrative privileges alongside owner
     */
    function setGovernanceContract(address _governance) external onlyOwner {
        if (_governance == address(0)) revert InvalidTokenAddress();
        if (governanceContract != address(0)) revert UnauthorizedAccess(); // Prevent multiple changes
        
        governanceContract = _governance;
        emit VerifierUpdated("governance", _governance);
    }
    
    /**
     * @notice Validates pool creation inputs
     * @dev Validates pool creation inputs
     * @param tokenB Address of the second token in the pair
     * @param poolId The generated pool identifier
     * @param nullifierA First nullifier
     * @param nullifierB Second nullifier
     * @param commitmentA First commitment
     * @param commitmentB Second commitment
     * @param amountA Amount of token A
     * @param amountB Amount of token B
     */
    function _validatePoolCreation(
        address tokenB,
        bytes32 poolId,
        bytes32 nullifierA,
        bytes32 nullifierB,
        bytes32 commitmentA,
        bytes32 commitmentB,
        uint256 amountA,
        uint256 amountB
    ) internal view {
        if (tokenB == address(0) || tokenB == address(AEGIS_TOKEN)) revert InvalidTokenPair();
        if (pools[poolId].initialized) revert PoolAlreadyExists();
        if (ammNullifiers[nullifierA] || ammNullifiers[nullifierB]) revert NullifierAlreadyUsed();
        if (liquidityCommitments[commitmentA] || liquidityCommitments[commitmentB]) revert CommitmentAlreadyExists();
        if (amountA < MIN_LIQUIDITY || amountB < MIN_LIQUIDITY) revert InsufficientInitialLiquidity();
        // Prevent dust attacks
        if (amountA < MIN_AMOUNT || amountB < MIN_AMOUNT) revert AmountBelowMinimum();
    }

    function _requireAmmZkLayout(uint256[] calldata publicInputs, uint256 expectedOp) private pure {
        ProofLib.requireValidInputLength(publicInputs, AMM_ZK_PUBLIC_INPUTS);
        if (publicInputs[0] != AMM_ZK_VALID) revert InvalidPublicInputs();
        if (publicInputs[1] != expectedOp) revert InvalidPublicInputs();
    }

    function _requireAmmTrailingZeroPair(uint256[] calldata publicInputs) private pure {
        if (publicInputs[8] != 0 || publicInputs[9] != 0) revert InvalidPublicInputs();
    }

    /**
     * @notice Creates a new trading pool
     * @dev Creates a new trading pool
     * @param tokenB Address of the second token in the pair
     * @param proof The ZK proof data
     * @param publicInputs Public Groth16 inputs: `[valid, op, s1..s8]` with `op = AMM_ZK_OP_CREATE_POOL`,
     *        `s1..s6` = nullifierA, nullifierB, commitmentA, commitmentB, amountA, amountB; `s7 = s8 = 0`.
     */
    function createPool(
        address tokenB,
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external nonReentrant whenNotPaused {
        _requireAmmZkLayout(publicInputs, AMM_ZK_OP_CREATE_POOL);
        _requireAmmTrailingZeroPair(publicInputs);

        bytes32 nullifierA = ProofLib.extractNullifier(publicInputs, 2);
        bytes32 nullifierB = ProofLib.extractNullifier(publicInputs, 3);
        bytes32 commitmentA = ProofLib.extractCommitment(publicInputs, 4);
        bytes32 commitmentB = ProofLib.extractCommitment(publicInputs, 5);
        uint256 amountA = ProofLib.extractAmount(publicInputs, 6);
        uint256 amountB = ProofLib.extractAmount(publicInputs, 7);

        bytes32 poolId = keccak256(abi.encodePacked(address(AEGIS_TOKEN), tokenB));

        _validatePoolCreation(tokenB, poolId, nullifierA, nullifierB, commitmentA, commitmentB, amountA, amountB);

        if (!VERIFIER_FACTORY.verifyProof(PRIVATE_AMM_CIRCUIT, proof, publicInputs)) {
            revert ProofVerificationFailed();
        }
        
        // Verify K invariant is non-zero and valid
        uint256 k = amountA * amountB;
        if (k == 0) revert KInvariantViolated();
        
        uint256 liquidity = sqrt(k);
        if (liquidity < MIN_LIQUIDITY + 1) revert InsufficientLiquidity();
        
        _initializePoolAndState(
            poolId, tokenB, nullifierA, nullifierB, 
            commitmentA, commitmentB, amountA, amountB, liquidity
        );
    }
    
    /**
     * @notice Validates liquidity addition inputs and pool state
     * @dev Validates liquidity addition inputs and pool state
     * @param poolId The pool identifier
     * @param nullifierA First nullifier
     * @param nullifierB Second nullifier
     * @param commitmentA First commitment
     * @param commitmentB Second commitment
     */
    function _validateLiquidityAddition(
        bytes32 poolId,
        bytes32 nullifierA,
        bytes32 nullifierB,
        bytes32 commitmentA,
        bytes32 commitmentB
    ) internal view {
        Pool storage pool = pools[poolId];
        if (!pool.initialized) revert PoolNotFound();
        if (ammNullifiers[nullifierA] || ammNullifiers[nullifierB]) revert NullifierAlreadyUsed();
        if (liquidityCommitments[commitmentA] || liquidityCommitments[commitmentB]) revert CommitmentAlreadyExists();
        if (pool.reserveA == 0 || pool.reserveB == 0) revert InvalidPoolReserves();
        if (pool.totalLiquidity == 0) revert InvalidTotalLiquidity();
    }

    /**
     * @notice Calculates optimal amounts and liquidity for addition
     * @dev Calculates optimal amounts and liquidity for addition
     * @param pool The pool storage reference
     * @param amountA Desired amount A
     * @param amountB Desired amount B
     * @param minLiquidity Minimum liquidity expected
     * @return finalAmountA Final amount A to use
     * @return finalAmountB Final amount B to use
     * @return liquidity Liquidity tokens to mint
     */
    function _calculateLiquidityAmounts(
        Pool storage pool,
        uint256 amountA,
        uint256 amountB,
        uint256 minLiquidity
    ) internal view returns (uint256 finalAmountA, uint256 finalAmountB, uint256 liquidity) {
        // Prevent dust attacks
        if (amountA < MIN_AMOUNT || amountB < MIN_AMOUNT) {
            revert AmountBelowMinimum();
        }
        
        // Fix divide-before-multiply: avoid intermediate division results
        // Check if amountA * pool.reserveB <= amountB * pool.reserveA (equivalent to optimalAmountB <= amountB)
        if ((amountA * pool.reserveB) < (amountB * pool.reserveA) + 1) {
            finalAmountA = amountA;
            // CRITICAL FIX: Prevent division by zero
            if (pool.reserveA == 0) revert InsufficientReserves();
            finalAmountB = (amountA * pool.reserveB) / pool.reserveA;
            
            // Verify finalAmountB is valid (non-zero)
            if (finalAmountB < MIN_AMOUNT) revert AmountBelowMinimum();
            
            // Fix divide-before-multiply: use cross-multiplication to avoid using division results
            if (pool.totalLiquidity == 0) revert InsufficientLiquidityMinted();
            liquidity = (amountA * pool.totalLiquidity) / pool.reserveA;
        } else {
            // CRITICAL FIX: Prevent division by zero
            if (pool.reserveB == 0) revert InsufficientReserves();
            finalAmountA = (amountB * pool.reserveA) / pool.reserveB;
            finalAmountB = amountB;
            
            // Verify finalAmountA is valid (non-zero)
            if (finalAmountA < MIN_AMOUNT) revert AmountBelowMinimum();
            
            // Fix divide-before-multiply: similar logic for the else branch
            if (pool.totalLiquidity == 0) revert InsufficientLiquidityMinted();
            liquidity = (amountB * pool.totalLiquidity) / pool.reserveB;
        }
        
        if (liquidity < minLiquidity) revert InsufficientLiquidityMinted();
        if (liquidity == 0) revert InsufficientLiquidityMinted();
    }

    /**
     * @notice Initializes a new pool and updates contract state
     * @dev Initializes a new pool and updates contract state
     * @param poolId The pool identifier
     * @param tokenB Address of the second token
     * @param nullifierA First nullifier
     * @param nullifierB Second nullifier
     * @param commitmentA First commitment
     * @param commitmentB Second commitment
     * @param amountA Amount of token A
     * @param amountB Amount of token B
     * @param liquidity Calculated liquidity amount
     */
    function _initializePoolAndState(
        bytes32 poolId,
        address tokenB,
        bytes32 nullifierA,
        bytes32 nullifierB,
        bytes32 commitmentA,
        bytes32 commitmentB,
        uint256 amountA,
        uint256 amountB,
        uint256 liquidity
    ) internal {
        pools[poolId] = Pool({
            reserveA: amountA,
            reserveB: amountB,
            totalLiquidity: liquidity,
            kLast: amountA * amountB,
            tokenB: tokenB,
            initialized: true
        });
        
        poolTokens[keccak256(abi.encodePacked(tokenB))] = poolId;
        
        ammNullifiers[nullifierA] = true;
        ammNullifiers[nullifierB] = true;
        liquidityCommitments[commitmentA] = true;
        liquidityCommitments[commitmentB] = true;
        
        uint256 currentTime = block.timestamp;
        bytes32 positionId = keccak256(abi.encodePacked(commitmentA, commitmentB, currentTime));
        liquidityPositions[positionId] = LiquidityPosition({
            poolId: poolId,
            commitment: commitmentA,
            shares: liquidity,
            timestamp: currentTime,
            active: true
        });
        
        liquidityShares[commitmentA] = liquidity;
        
        emit PoolCreated(poolId, address(AEGIS_TOKEN), tokenB, amountA, amountB);
        emit LiquidityAdded(poolId, commitmentA, amountA, amountB, liquidity);
    }

    /**
     * @notice Detects flash loan attacks by checking reserve changes within same block
     * @dev Compares current reserves with previous block's reserves to detect >10% changes
     * @param poolId The pool identifier
     * @param reserveA Current reserve A
     * @param reserveB Current reserve B
     * @return detected Whether flash loan was detected
     */
    function _detectFlashLoan(
        bytes32 poolId,
        uint256 reserveA,
        uint256 reserveB
    ) internal view returns (bool detected) {
        FlashLoanData memory data = flashLoanData[poolId];
        
        // Only check if we have previous data and it's in the same block
        if (data.lastBlockChecked > 0 && uint256(data.lastBlockChecked) == block.number) {
            if (data.previousReserveA == 0 || data.previousReserveB == 0) {
                return false; // No baseline for comparison
            }
            
            // Calculate percentage change
            uint256 reserveAChange = reserveA > data.previousReserveA
                ? reserveA - data.previousReserveA
                : data.previousReserveA - reserveA;
            uint256 reserveBChange = reserveB > data.previousReserveB
                ? reserveB - data.previousReserveB
                : data.previousReserveB - reserveB;
            
            uint256 reserveAChangeBps = (reserveAChange * BPS) / data.previousReserveA;
            uint256 reserveBChangeBps = (reserveBChange * BPS) / data.previousReserveB;
            
            // Flash loan detected if >10% change in same block
            if (reserveAChangeBps > FLASH_LOAN_THRESHOLD_BPS || reserveBChangeBps > FLASH_LOAN_THRESHOLD_BPS) {
                return true;
            }
        }
        
        return false;
    }
    
    /**
     * @notice Calculates price impact of a swap
     * @dev Returns price impact in basis points
     * @param amountOut Output amount
     * @param reserveOut Output token reserve
     * @return priceImpactBps Price impact in basis points
     */
    function _calculatePriceImpact(uint256 amountOut, uint256 reserveOut) 
    internal pure returns (uint256 priceImpactBps) {
        if (reserveOut == 0) return BPS; // 100% impact if reserve is zero
        priceImpactBps = (amountOut * BPS) / reserveOut;
    }

    /**
     * @notice Executes the swap calculation and updates pool reserves
     * @dev Executes the swap calculation and updates pool reserves with security checks
     * @param poolId The pool identifier
     * @param pool The pool storage reference
     * @param amountIn Input amount
     * @param minAmountOut Minimum output amount expected
     * @param isAToB Direction of swap (true for A to B, false for B to A)
     * @return amountOut The calculated output amount
     */
    function _executeSwapCalculation(
        bytes32 poolId,
        Pool storage pool,
        uint256 amountIn,
        uint256 minAmountOut,
        bool isAToB
    ) internal returns (uint256 amountOut) {
        // Prevent dust attacks
        if (amountIn < MIN_AMOUNT) revert AmountBelowMinimum();
        
        // Flash loan detection - check before swap
        bool flashLoanDetected = _detectFlashLoan(poolId, pool.reserveA, pool.reserveB);
        if (flashLoanDetected) {
            emit FlashLoanDetectedEvent(
                poolId,
                0, // Will be calculated if needed
                pool.reserveA,
                pool.reserveB,
                pool.reserveA,
                pool.reserveB
            );
            revert FlashLoanDetected();
        }
        
        // Store reserves before swap for flash loan detection
        uint256 reserveABefore = pool.reserveA;
        uint256 reserveBBefore = pool.reserveB;
        
        uint256 amountInWithFee = amountIn * (BPS - FEE_RATE) / BPS;
        if (amountInWithFee == 0) revert InvalidAmount();
        
        if (isAToB) {
            if (pool.reserveA == 0 || pool.reserveB == 0) revert InsufficientReserves();
            
            // Calculate output using constant product formula
            amountOut = getAmountOut(amountInWithFee, pool.reserveA, pool.reserveB);
            if (amountOut < MIN_AMOUNT) revert AmountBelowMinimum();
            if (amountOut < minAmountOut) revert SlippageExceeded();
            
            // Price impact protection: prevent >50% price manipulation
            uint256 priceImpactBps = _calculatePriceImpact(amountOut, pool.reserveB);
            if (priceImpactBps > MAX_PRICE_IMPACT_BPS) {
                emit PriceImpactExceeded(poolId, priceImpactBps, amountIn, amountOut);
                revert PriceImpactTooHigh(priceImpactBps, MAX_PRICE_IMPACT_BPS);
            }
            
            // CRITICAL FIX: Prevent underflow - ensure reserve has enough before subtracting
            if (pool.reserveB < amountOut) revert InsufficientReserves();
            
            // Calculate new reserves
            uint256 newReserveA = pool.reserveA + amountIn;
            uint256 newReserveB = pool.reserveB - amountOut;
            
            // Verify K invariant BEFORE updating reserves
            uint256 kBeforeSwap = pool.kLast;
            uint256 newK = newReserveA * newReserveB;
            
            // K must increase due to fees (or stay same in edge cases)
            if (newK < kBeforeSwap) {
                revert KInvariantDecreased(kBeforeSwap, newK);
            }
            
            // Update reserves
            unchecked {
                pool.reserveA = newReserveA;
                pool.reserveB = newReserveB;
            }
        } else {
            if (pool.reserveB == 0 || pool.reserveA == 0) revert InsufficientReserves();
            
            // Calculate output using constant product formula
            amountOut = getAmountOut(amountInWithFee, pool.reserveB, pool.reserveA);
            if (amountOut < MIN_AMOUNT) revert AmountBelowMinimum();
            if (amountOut < minAmountOut) revert SlippageExceeded();
            
            // Price impact protection: prevent >50% price manipulation
            uint256 priceImpactBps = _calculatePriceImpact(amountOut, pool.reserveA);
            if (priceImpactBps > MAX_PRICE_IMPACT_BPS) {
                emit PriceImpactExceeded(poolId, priceImpactBps, amountIn, amountOut);
                revert PriceImpactTooHigh(priceImpactBps, MAX_PRICE_IMPACT_BPS);
            }
            
            // CRITICAL FIX: Prevent underflow - ensure reserve has enough before subtracting
            if (pool.reserveA < amountOut) revert InsufficientReserves();
            
            // Calculate new reserves
            uint256 newReserveB = pool.reserveB + amountIn;
            uint256 newReserveA = pool.reserveA - amountOut;
            
            // Verify K invariant BEFORE updating reserves
            uint256 kBeforeSwapB = pool.kLast;
            uint256 newK = newReserveA * newReserveB;
            
            // K must increase due to fees (or stay same in edge cases)
            if (newK < kBeforeSwapB) {
                revert KInvariantDecreased(kBeforeSwapB, newK);
            }
            
            // Update reserves
            unchecked {
                pool.reserveB = newReserveB;
                pool.reserveA = newReserveA;
            }
        }
        
        // Enhanced K invariant validation
        uint256 previousK = pool.kLast;
        uint256 finalK = pool.reserveA * pool.reserveB;
        
        // K should never decrease (fees ensure K increases)
        if (finalK < previousK) {
            revert KInvariantDecreased(previousK, finalK);
        }

        // Enhanced deviation monitoring
        if (previousK > 0) {
            uint256 deviation = finalK - previousK;
            if (deviation > 0) {
                // Prevent division by zero
                uint256 deviationPpm = (deviation * PPM_DENOMINATOR) / previousK;
                
                // Alert on significant deviations (>0.1%)
                if (deviationPpm >= K_INVARIANT_ALERT_PPM) {
                    emit KInvariantDeviationDetected(poolId, previousK, finalK, deviationPpm);
                }
                
                // Hard limit on deviations (>2%)
                if (deviationPpm > MAX_K_DEVIATION_PPM) {
                    revert KInvariantDeviationExceeded(deviationPpm, MAX_K_DEVIATION_PPM);
                }
            }
            
            // Verify K increased appropriately (should increase due to fees, not decrease)
            // With 0.3% fee, K should increase by approximately (fee_rate * amount_in * reserve_out / reserve_in)
            // We check that K didn't decrease unexpectedly
            if (finalK < previousK) {
                revert KInvariantDecreased(previousK, finalK);
            }
        }

        pool.kLast = finalK;
        
        // Update flash loan detection data
        flashLoanData[poolId] = FlashLoanData({
            previousReserveA: reserveABefore,
            previousReserveB: reserveBBefore,
            lastBlockChecked: uint32(block.number)
        });
        
        // Post-swap flash loan detection
        bool postSwapFlashLoan = _detectFlashLoan(poolId, pool.reserveA, pool.reserveB);
        if (postSwapFlashLoan) {
            uint256 reserveAChange = pool.reserveA > reserveABefore
                ? pool.reserveA - reserveABefore
                : reserveABefore - pool.reserveA;
            uint256 reserveBChange = pool.reserveB > reserveBBefore
                ? pool.reserveB - reserveBBefore
                : reserveBBefore - pool.reserveB;
            
            uint256 changeBps = reserveAChange > 0 
                ? (reserveAChange * BPS) / reserveABefore
                : (reserveBChange * BPS) / reserveBBefore;
            
            emit FlashLoanDetectedEvent(
                poolId,
                changeBps,
                reserveABefore,
                reserveBBefore,
                pool.reserveA,
                pool.reserveB
            );
            revert FlashLoanDetected();
        }
    }

    /**
     * @notice Adds liquidity to an existing pool
     * @dev Adds liquidity to an existing pool
     * @param poolId The pool identifier
     * @param proof The ZK proof data
     * @param publicInputs Public Groth16 inputs: `[valid, op, s1..s8]` with `op = AMM_ZK_OP_ADD_LIQUIDITY`,
     *        `s1..s8` = nullifierA, nullifierB, commitmentA, commitmentB, amountA, amountB, minLiquidity, deadline.
     */
    function addLiquidity(
        bytes32 poolId,
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external nonReentrant whenNotPaused {
        _requireAmmZkLayout(publicInputs, AMM_ZK_OP_ADD_LIQUIDITY);

        bytes32 nullifierA = ProofLib.extractNullifier(publicInputs, 2);
        bytes32 nullifierB = ProofLib.extractNullifier(publicInputs, 3);
        bytes32 commitmentA = ProofLib.extractCommitment(publicInputs, 4);
        bytes32 commitmentB = ProofLib.extractCommitment(publicInputs, 5);
        uint256 amountA = ProofLib.extractAmount(publicInputs, 6);
        uint256 amountB = ProofLib.extractAmount(publicInputs, 7);
        uint256 minLiquidity = ProofLib.extractAmount(publicInputs, 8);
        uint256 deadline = ProofLib.extractAmount(publicInputs, 9);

        // Validate deadline to prevent stale transactions
        if (block.timestamp > deadline + TIMESTAMP_TOLERANCE) revert TransactionDeadlineExceeded();

        _validateLiquidityAddition(poolId, nullifierA, nullifierB, commitmentA, commitmentB);

        if (!VERIFIER_FACTORY.verifyProof(PRIVATE_AMM_CIRCUIT, proof, publicInputs)) {
            revert ProofVerificationFailed();
        }
        
        Pool storage pool = pools[poolId];
        
        // Store reserves before addition for K invariant check
        uint256 reserveABefore = pool.reserveA;
        uint256 reserveBBefore = pool.reserveB;
        uint256 kBefore = reserveABefore * reserveBBefore;
        
        (uint256 finalAmountA, uint256 finalAmountB, uint256 liquidity) = 
            _calculateLiquidityAmounts(pool, amountA, amountB, minLiquidity);
        
        // Calculate new reserves
        uint256 newReserveA = pool.reserveA + finalAmountA;
        uint256 newReserveB = pool.reserveB + finalAmountB;
        uint256 newK = newReserveA * newReserveB;
        
        // K must increase when adding liquidity
        if (kBefore > 0 && newK < kBefore) {
            revert KInvariantDecreased(kBefore, newK);
        }
        
        // Update pool state
        pool.reserveA = newReserveA;
        pool.reserveB = newReserveB;
        pool.totalLiquidity += liquidity;
        pool.kLast = newK;
        
        // Verify K increased
        if (newK <= kBefore && kBefore > 0) {
            revert KInvariantDecreased(kBefore, newK);
        }
        
        ammNullifiers[nullifierA] = true;
        ammNullifiers[nullifierB] = true;
        liquidityCommitments[commitmentA] = true;
        liquidityCommitments[commitmentB] = true;
        
        bytes32 positionId = keccak256(abi.encodePacked(commitmentA, commitmentB, block.timestamp));
        liquidityPositions[positionId] = LiquidityPosition({
            poolId: poolId,
            commitment: commitmentA,
            shares: liquidity,
            timestamp: block.timestamp,
            active: true
        });
        
        liquidityShares[commitmentA] = liquidity;
        
        emit LiquidityAdded(poolId, commitmentA, finalAmountA, finalAmountB, liquidity);
    }
    
    /**
     * @notice Executes a private swap
     * @dev Executes a private swap
     * @param poolId The pool identifier
     * @param proof The ZK proof data
     * @param publicInputs Public Groth16 inputs: `[valid, op, s1..s8]` with `op = AMM_ZK_OP_SWAP`,
     *        `s1..s6` = inputNullifier, outputCommitment, amountIn, minAmountOut, isAToB (0/1), deadline; `s7 = s8 = 0`.
     */
    function swap(
        bytes32 poolId,
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external nonReentrant whenNotPaused {
        _requireAmmZkLayout(publicInputs, AMM_ZK_OP_SWAP);
        _requireAmmTrailingZeroPair(publicInputs);

        bytes32 inputNullifier = ProofLib.extractNullifier(publicInputs, 2);
        bytes32 outputCommitment = ProofLib.extractCommitment(publicInputs, 3);
        uint256 amountIn = ProofLib.extractAmount(publicInputs, 4);
        uint256 minAmountOut = ProofLib.extractAmount(publicInputs, 5);
        bool isAToB = publicInputs[6] != 0;
        uint256 deadline = ProofLib.extractAmount(publicInputs, 7);

        // Validate deadline to prevent stale transactions
        if (block.timestamp > deadline + TIMESTAMP_TOLERANCE) revert TransactionDeadlineExceeded();

        // Validate pool exists
        Pool storage pool = pools[poolId];
        if (!pool.initialized) revert PoolNotFound();
        if (ammNullifiers[inputNullifier]) revert NullifierAlreadyUsed();
        if (swapCommitments[outputCommitment]) revert CommitmentAlreadyExists();
        if (amountIn == 0) revert InvalidSwapAmount();

        // Prevent dust attacks
        if (amountIn < MIN_AMOUNT) revert AmountBelowMinimum();

        // Verify reserves are valid
        if (pool.reserveA == 0 || pool.reserveB == 0) revert InsufficientReserves();

        if (!VERIFIER_FACTORY.verifyProof(PRIVATE_AMM_CIRCUIT, proof, publicInputs)) {
            revert ProofVerificationFailed();
        }
        
        // Execute swap calculation and update reserves
        uint256 amountOut = _executeSwapCalculation(poolId, pool, amountIn, minAmountOut, isAToB);
        
        // Update state
        ammNullifiers[inputNullifier] = true;
        swapCommitments[outputCommitment] = true;
        
        emit SwapExecuted(poolId, inputNullifier, outputCommitment, amountIn, amountOut, isAToB);
    }
    
    /**
     * @notice Removes liquidity from a pool
     * @dev Removes liquidity from a pool
     * @param poolId The pool identifier
     * @param proof The ZK proof data
     * @param publicInputs Public Groth16 inputs: `[valid, op, s1..s8]` with `op = AMM_ZK_OP_REMOVE_LIQUIDITY`,
     *        `s1..s6` = liquidityNullifier, outputCommitmentA, outputCommitmentB, liquidity, minAmountA, minAmountB; `s7 = s8 = 0`.
     */
    function removeLiquidity(
        bytes32 poolId,
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external nonReentrant whenNotPaused {
        _requireAmmZkLayout(publicInputs, AMM_ZK_OP_REMOVE_LIQUIDITY);
        _requireAmmTrailingZeroPair(publicInputs);

        bytes32 liquidityNullifier = ProofLib.extractNullifier(publicInputs, 2);
        bytes32 outputCommitmentA = ProofLib.extractCommitment(publicInputs, 3);
        bytes32 outputCommitmentB = ProofLib.extractCommitment(publicInputs, 4);
        uint256 liquidity = ProofLib.extractAmount(publicInputs, 5);
        uint256 minAmountA = ProofLib.extractAmount(publicInputs, 6);
        uint256 minAmountB = ProofLib.extractAmount(publicInputs, 7);

        // Validate pool exists
        Pool storage pool = pools[poolId];
        if (!pool.initialized) revert PoolNotFound();
        if (ammNullifiers[liquidityNullifier]) revert NullifierAlreadyUsed();
        if (liquidity == 0 || liquidity > pool.totalLiquidity) revert ZeroLiquidity();

        if (!VERIFIER_FACTORY.verifyProof(PRIVATE_AMM_CIRCUIT, proof, publicInputs)) {
            revert ProofVerificationFailed();
        }
        
        // Calculate withdrawal amounts with division by zero protection
        // CRITICAL FIX: Prevent division by zero
        if (pool.totalLiquidity == 0) revert ZeroLiquidity();
        
        // Prevent dust withdrawals
        if (liquidity < MIN_AMOUNT) revert AmountBelowMinimum();
        
        uint256 amountA = (liquidity * pool.reserveA) / pool.totalLiquidity;
        uint256 amountB = (liquidity * pool.reserveB) / pool.totalLiquidity;
        
        // Verify amounts are valid
        if (amountA == 0 || amountB == 0) revert InsufficientOutputAmounts();
        if (amountA < MIN_AMOUNT || amountB < MIN_AMOUNT) {
            revert AmountBelowMinimum();
        }
        if (amountA < minAmountA || amountB < minAmountB) revert InsufficientOutputAmounts();
        
        // Store K before removal
        uint256 kBefore = pool.reserveA * pool.reserveB;
        
        // Calculate new reserves
        uint256 newReserveA = pool.reserveA - amountA;
        uint256 newReserveB = pool.reserveB - amountB;
        
        // Verify reserves don't go to zero
        if (newReserveA == 0 && newReserveB == 0 && pool.totalLiquidity > liquidity) {
            revert InsufficientReserves(); // Can't drain pool if others have liquidity
        }
        
        // Calculate new K
        uint256 newK = newReserveA * newReserveB;
        
        // K should decrease proportionally when removing liquidity
        // K_after = K_before * (shares_remaining / total_supply)^2 approximately
        if (kBefore > 0 && newK >= kBefore) {
            revert KInvariantDecreased(kBefore, newK); // K should decrease, not increase
        }
        
        // Update pool state
        pool.reserveA = newReserveA;
        pool.reserveB = newReserveB;
        pool.totalLiquidity -= liquidity;
        pool.kLast = newK;
        
        // Verify final K
        if (newK > kBefore && kBefore > 0) {
            revert KInvariantDecreased(kBefore, newK); // K shouldn't increase when removing
        }
        
        // Update state
        ammNullifiers[liquidityNullifier] = true;
        
        emit LiquidityRemoved(poolId, liquidityNullifier, outputCommitmentA, outputCommitmentB, amountA, amountB);
    }
    
    /**
     * @notice Calculates output amount for a given input
     * @dev Calculates output amount for a given input
     * @param amountIn Input amount
     * @param reserveIn Input token reserve
     * @param reserveOut Output token reserve
     * @return amountOut Output amount
     */
    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) public pure returns (uint256 amountOut) {
        if (amountIn == 0 || reserveIn == 0 || reserveOut == 0) revert InvalidAmounts();
        
        uint256 numerator = amountIn * reserveOut;
        uint256 denominator = reserveIn + amountIn;
        amountOut = numerator / denominator;
    }
    
    /**
     * @notice Calculates input amount for a given output
     * @dev Calculates input amount for a given output
     * @param amountOut Output amount
     * @param reserveIn Input token reserve
     * @param reserveOut Output token reserve
     * @return amountIn Input amount
     */
    function getAmountIn(
        uint256 amountOut,
        uint256 reserveIn,
        uint256 reserveOut
    ) public pure returns (uint256 amountIn) {
        if (amountOut == 0 || reserveIn == 0 || reserveOut < amountOut + 1) revert InvalidAmounts();
        
        uint256 numerator = reserveIn * amountOut;
        uint256 denominator = reserveOut - amountOut;
        amountIn = (numerator / denominator) + 1;
    }
    
    /**
     * @notice Returns pool information
     * @param poolId The pool identifier
     * @return pool The pool data
     */
    function getPool(bytes32 poolId) external view returns (Pool memory pool) {
        return pools[poolId];
    }
    
    /**
     * @notice Returns pool reserves
     * @param poolId The pool identifier
     * @return reserveA Reserve of token A
     * @return reserveB Reserve of token B
     */
    function getReserves(bytes32 poolId) external view returns (uint256 reserveA, uint256 reserveB) {
        Pool memory pool = pools[poolId];
        return (pool.reserveA, pool.reserveB);
    }
    
    /**
     * @notice Calculates square root using Babylonian method
     * @param y Input value
     * @return z Square root
     */
    function sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
    
    /**
     * @notice Verifier updates are now handled through VerifierFactory by governance
     * @dev VerifierFactory manages all verifier updates through governance
     * These functions are deprecated - verifiers are updated via VerifierFactory.updateVerifier() by governance
     */
    // Verifier updates are handled by VerifierFactory through governance
    
    /**
     * @notice Pauses the contract, preventing most operations (governance only - DAO controlled)
     */
    function pause() external onlyGovernance {
        _pause();
    }
    
    /**
     * @notice Unpauses the contract, allowing normal operations (governance only - DAO controlled)
     */
    function unpause() external onlyGovernance {
        _unpause();
    }
}