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
import {IPrivateCreditProfile} from "./interfaces/IPrivateCreditProfile.sol";

/**
 * @title PrivateLendingContract
 * @author Aegis Protocol Team
 * @notice Privacy-preserving lending and borrowing with zero-knowledge proofs
 * @dev Privacy-preserving lending and borrowing with zero-knowledge proofs.
 *      Borrow APR uses an aggregate **utilization curve** (no per-user inputs); each loan stores a fixed `borrowRateBps` at origination.
 *      **Credit rationing (aggregate):** when the pool is already crowded, the max **single** new draw (as a share of `totalLiquidity`) tightens—quantity rationing at the **system** level without identity-based screening.
 *      **Liquidity exit:** aggregate `withdrawLiquidity` per block is capped vs pool size at the first exit in the block (`WITHDRAW_RUN_GUARD_BPS`) to slow coordinated drains without identifying withdrawers.
 *      **LP disclosure:** no deposit-insurance analogue—see `docs/PRIVATE_LENDING_LP_RISK_NOTE.md`.
 *      **Moral hazard / covenants:** on-chain analogues—collateral, liquidation, pauses, caps, aggregate snapshots—see `docs/MORAL_HAZARD_COVENANTS_AND_MONITORING.md`.
 *      **Term structure / duration risk:** borrow proofs bind `tenorSeconds` (30d / 90d / 365d) via circuit `lending-tenor`; interest accrual is capped at maturity; liquidation if undercollateralized **or** past maturity—`docs/TERM_STRUCTURE_DURATION_AND_REPRICING.md`.
 * Supports anonymous borrowers, collateral proofs, and ZK-based liquidations
 */
contract PrivateLendingContract is Ownable, ReentrancyGuard, Pausable , ICommonErrors{
    using CommitmentLib for CommitmentLib.Commitment;
    using ProofLib for ProofLib.ZKProof;
    
    // Lending parameters
    /// @notice Minimum collateral ratio required for loans (150%)
    uint256 public constant COLLATERAL_RATIO = 150; // 150% collateralization required
    /// @notice Liquidation threshold for undercollateralized loans (120%)
    uint256 public constant LIQUIDATION_THRESHOLD = 120; // 120% liquidation threshold
    /// @notice Penalty applied during liquidation (10%)
    uint256 public constant LIQUIDATION_PENALTY = 10; // 10% liquidation penalty
    /// @notice Floor annual borrow rate at ~zero utilization (5%). Actual APR is fixed per loan at open (`LoanInfo.borrowRateBps`).
    uint256 public constant INTEREST_RATE = 500; // 500 bps = 5% — floor; per-loan rate may be higher from utilization curve
    /// @notice Utilization (in bps of total assets) at which the borrow curve kinks upward
    uint256 public constant BORROW_KINK_UTILIZATION_BPS = 8000;
    /// @notice Annual borrow rate (bps) at the kink utilization
    uint256 public constant BORROW_RATE_AT_KINK_BPS = 1200;
    /// @notice Maximum annual borrow rate (bps) at 100% utilization — caps procyclical extremes
    uint256 public constant BORROW_MAX_BPS = 2500;
    /// @notice Minimum loan amount allowed (1 AGS)
    uint256 public constant MIN_LOAN_AMOUNT = 1e18; // 1 AGS minimum
    /// @notice Standard loan duration (365 days) — used when `LoanInfo.tenorSeconds == 0` (pre-tenor storage / tests)
    uint256 public constant LOAN_DURATION = 365 days;

    /// @notice Allowed borrow tenors (seconds), aligned with `circuits/lending_tenor.circom`
    uint256 private constant TENOR_30D_SECONDS = 2592000;
    uint256 private constant TENOR_90D_SECONDS = 7776000;
    uint256 private constant TENOR_365D_SECONDS = 31536000;
    
    // Timestamp security constants
    uint256 private constant TIMESTAMP_TOLERANCE = 900; // 15 minutes tolerance for timestamp comparisons
    
    /// @notice VerifierFactory circuit keys (fixed public I/O per operation; Groth16)
    string private constant LENDING_LIQUIDITY_CIRCUIT = "lending-liquidity";
    string private constant LENDING_TENOR_CIRCUIT = "lending-tenor";
    string private constant LENDING_REPAY_CIRCUIT = "lending-repay";
    string private constant LENDING_WITHDRAW_CIRCUIT = "lending-withdraw";
    string private constant LENDING_LIQUIDATE_CIRCUIT = "lending-liquidate";
    
    // Contract references
    /// @notice The Aegis token contract used for lending operations
    PrivateTokenContract public immutable AEGIS_TOKEN;
    /// @notice Factory contract for managing ZK proof verifiers
    VerifierFactory public immutable VERIFIER_FACTORY;
    
    // Lending state
    /// @notice Total amount of liquidity provided to the lending pool
    uint256 public totalLiquidity;
    /// @notice Total amount currently borrowed from the lending pool
    uint256 public totalBorrowed;
    /// @notice Available liquidity in the lending pool
    uint256 public liquidityPool;

    /// @notice Max share of **block-start** `liquidityPool` that may exit via `withdrawLiquidity` in one block (aggregate; reduces run-style drains, no per-user data).
    uint256 public constant WITHDRAW_RUN_GUARD_BPS = 2500; // 25% per block, protocol-wide total

    /// @notice Utilization **after** a hypothetical draw at or below this bps ⇒ loose concentration cap (`CONCENTRATION_CAP_LOOSE_BPS`).
    uint256 public constant CONCENTRATION_LOOSE_UTIL_BPS = 7000;
    /// @notice Utilization **after** a hypothetical draw at or above this bps ⇒ tight cap (`CONCENTRATION_CAP_TIGHT_BPS`).
    uint256 public constant CONCENTRATION_TIGHT_UTIL_BPS = 8800;
    /// @notice Loose single-draw cap as bps of `totalLiquidity` (5%) when the pool is not crowded.
    uint256 public constant CONCENTRATION_CAP_LOOSE_BPS = 500;
    /// @notice Tight single-draw cap (1%) under stress—quantity rationing, still aggregate-only.
    uint256 public constant CONCENTRATION_CAP_TIGHT_BPS = 100;
    uint256 private _withdrawRunBlock;
    uint256 private _withdrawRunPoolStart;
    uint256 private _withdrawRunCumulative;
    
    // Commitment tracking
    /// @notice Mapping to track used collateral commitments
    mapping(bytes32 => bool) public collateralCommitments;
    /// @notice Mapping to track used loan commitments
    mapping(bytes32 => bool) public loanCommitments;
    /// @notice Mapping to track used nullifiers in lending operations
    mapping(bytes32 => bool) public lendingNullifiers;
    
    // Loan tracking
    /// @notice Mapping from loan ID to loan information
    mapping(bytes32 => LoanInfo) public loans;
    /// @notice Mapping from loan ID to collateral amount
    mapping(bytes32 => uint256) public collateralAmounts;
    /// @notice Mapping from loan ID to loan creation timestamp
    mapping(bytes32 => uint256) public loanTimestamps;
    
    // Liquidity provider tracking
    /// @notice Mapping from commitment to liquidity shares
    mapping(bytes32 => uint256) public liquidityShares;
    /// @notice Mapping from commitment to liquidity provision timestamp
    mapping(bytes32 => uint256) public liquidityTimestamps;
    
    struct LoanInfo {
        bytes32 collateralCommitment;
        bytes32 loanCommitment;
        uint256 principal;
        uint256 collateralAmount;
        uint256 timestamp;
        bool active;
        /// @notice Annual borrow rate in basis points, fixed at loan origination from aggregate utilization only (no user deanonymization).
        uint256 borrowRateBps;
        /// @notice Loan tenor in seconds (30d / 90d / 365d from proof); `0` means legacy / use `LOAN_DURATION` for maturity and accrual cap.
        uint256 tenorSeconds;
    }
    
    // Events
    /// @notice Emitted when collateral is deposited for a loan
    /// @param commitment The commitment hash for the collateral
    /// @param amount The amount of collateral deposited
    /// @param timestamp The timestamp when collateral was deposited
    event CollateralDeposited(
        bytes32 indexed commitment,
        uint256 indexed amount,
        uint256 indexed timestamp
    );
    /// @notice Emitted when a loan is issued against collateral
    /// @param loanId The unique identifier for the loan
    /// @param collateralCommitment The commitment hash for the collateral
    /// @param loanCommitment The commitment hash for the loan
    /// @param principal The principal amount of the loan
    /// @param collateralAmount The amount of collateral backing the loan
    /// @param tenorSeconds Loan tenor in seconds (must match an allowed tenor in `lending_tenor.circom`)
    event LoanIssued(
        bytes32 indexed loanId,
        bytes32 indexed collateralCommitment,
        bytes32 indexed loanCommitment,
        uint256 principal,
        uint256 collateralAmount,
        uint256 tenorSeconds
    );
    /// @notice Emitted when a loan is repaid
    /// @param loanId The unique identifier for the loan
    /// @param repaymentNullifier The nullifier for the repayment transaction
    /// @param amount The amount repaid including interest
    event LoanRepaid(
        bytes32 indexed loanId,
        bytes32 indexed repaymentNullifier,
        uint256 indexed amount
    );
    /// @notice Emitted when a loan is liquidated
    /// @param loanId The unique identifier for the liquidated loan
    /// @param liquidatorCommitment The commitment hash for the liquidator
    /// @param collateralSeized The amount of collateral seized in liquidation
    event LiquidationExecuted(
        bytes32 indexed loanId,
        bytes32 indexed liquidatorCommitment,
        uint256 indexed collateralSeized
    );
    /// @notice Emitted when liquidity is provided to the lending pool
    /// @param commitment The commitment hash for the liquidity provision
    /// @param amount The amount of liquidity provided
    /// @param shares The number of liquidity shares received
    event LiquidityProvided(
        bytes32 indexed commitment,
        uint256 indexed amount,
        uint256 indexed shares
    );
    /// @notice Emitted when liquidity is withdrawn from the lending pool
    /// @param nullifier The nullifier for the withdrawal transaction
    /// @param outputCommitment The commitment hash for the withdrawal output
    /// @param amount The amount of liquidity withdrawn
    event LiquidityWithdrawn(
        bytes32 indexed nullifier,
        bytes32 indexed outputCommitment,
        uint256 indexed amount
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
    error InvalidLoanTenor();

    // Governance
    /// @notice Optional `PrivateCreditProfile` hub for proof-gated borrow paths.
    address public privateCreditProfileHub;

    /// @notice Basis-point discount applied to stored borrow rate when credit proof passes (governance cap).
    uint16 public creditVerifiedBorrowDiscountBps;

    /// @notice Address of the governance contract that can perform administrative functions
    address public governanceContract;
    address public timelockController;

    event TimelockControllerUpdated(address indexed previousTimelock, address indexed newTimelock);
    event PrivateCreditProfileHubUpdated(address indexed previous, address indexed next);
    event CreditVerifiedBorrowDiscountUpdated(uint16 previousBps, uint16 nextBps);
    error CreditVerificationFailed();
    
    /**
     * @notice Initializes the private lending contract with token and verifier factory
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
    
    /**
     * @notice Sets the timelock allowed to execute governance-gated calls via `TimelockController.execute`.
     */
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

    function setPrivateCreditProfileHub(address hub) external onlyOwnerOrGovernance {
        emit PrivateCreditProfileHubUpdated(privateCreditProfileHub, hub);
        privateCreditProfileHub = hub;
    }

    function setCreditVerifiedBorrowDiscountBps(uint16 discountBps) external onlyOwnerOrGovernance {
        if (discountBps > 2000) revert InvalidAmount();
        emit CreditVerifiedBorrowDiscountUpdated(creditVerifiedBorrowDiscountBps, discountBps);
        creditVerifiedBorrowDiscountBps = discountBps;
    }

    function _isAllowedTenor(uint256 tenorSeconds) internal pure returns (bool) {
        return tenorSeconds == TENOR_30D_SECONDS
            || tenorSeconds == TENOR_90D_SECONDS
            || tenorSeconds == TENOR_365D_SECONDS;
    }

    function _loanMaturitySeconds(LoanInfo memory loan) internal pure returns (uint256) {
        return loan.tenorSeconds == 0 ? LOAN_DURATION : loan.tenorSeconds;
    }

    /// @dev Elapsed seconds for linear APR accrual, floored by `TIMESTAMP_TOLERANCE`, capped at maturity.
    function _interestSecsElapsed(LoanInfo memory loan) internal view returns (uint256) {
        if (block.timestamp <= loan.timestamp) {
            return 0;
        }
        uint256 raw = block.timestamp - loan.timestamp;
        uint256 elapsed = raw > TIMESTAMP_TOLERANCE ? raw : TIMESTAMP_TOLERANCE;
        uint256 cap = _loanMaturitySeconds(loan);
        return elapsed > cap ? cap : elapsed;
    }

    function _accruedInterestWei(LoanInfo memory loan) internal view returns (uint256) {
        uint256 timeElapsed = _interestSecsElapsed(loan);
        uint256 rateBps = loan.borrowRateBps == 0 ? INTEREST_RATE : loan.borrowRateBps;
        return (loan.principal * rateBps * timeElapsed) / (10000 * 365 days);
    }

    /**
     * @notice Provides liquidity to the lending pool
     * @dev Provides liquidity to the lending pool
     * @param proof The ZK proof data
     * @param publicInputs Public inputs: [inputNullifier, outputCommitment, amount]
     */
    function provideLiquidity(
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external nonReentrant whenNotPaused {
        // Validate input length
        ProofLib.requireValidInputLength(publicInputs, 3);
        
        // Extract public inputs
        bytes32 inputNullifier = ProofLib.extractNullifier(publicInputs, 0);
        bytes32 outputCommitment = ProofLib.extractCommitment(publicInputs, 1);
        uint256 amount = ProofLib.extractAmount(publicInputs, 2);
        
        // Validate parameters
        if (amount == 0) revert InvalidLoanAmount();
        if (lendingNullifiers[inputNullifier]) revert NullifierAlreadyUsed();
        if (liquidityShares[outputCommitment] > 0) revert CommitmentAlreadyExists();
        
        // Verify the ZK proof using VerifierFactory
        if (!VERIFIER_FACTORY.verifyProof(LENDING_LIQUIDITY_CIRCUIT, proof, publicInputs)) {
            revert ProofVerificationFailed();
        }
        
        // Calculate shares
        uint256 shares = totalLiquidity == 0 ? amount : (amount * totalLiquidity) / liquidityPool;
        
        // Update state
        lendingNullifiers[inputNullifier] = true;
        liquidityShares[outputCommitment] = shares;
        liquidityTimestamps[outputCommitment] = block.timestamp;
        totalLiquidity += shares;
        liquidityPool += amount;
        
        emit LiquidityProvided(outputCommitment, amount, shares);
    }
    
    /**
     * @notice Deposits collateral and borrows against it
     * @dev Deposits collateral and borrows against it
     * @param proof The ZK proof data
     * @param publicInputs Public inputs: [collateralNullifier, collateralCommitment, loanCommitment, 
     *                     collateralAmount, loanAmount, tenorSeconds] — circuit `lending-tenor`
     */
    function borrowWithCollateral(
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external nonReentrant whenNotPaused {
        _borrowWithCollateralInternal(proof, publicInputs);
    }

    /**
     * @notice Borrow with `credit-profile` proof for eligibility (optional rate discount via governance).
     */
    function borrowWithCollateralAndCreditProfile(
        uint256 minScoreRequired,
        uint256[8] calldata creditProof,
        uint256[] calldata creditPublicInputs,
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external nonReentrant whenNotPaused {
        if (privateCreditProfileHub == address(0)) revert CreditVerificationFailed();
        bool passed = IPrivateCreditProfile(privateCreditProfileHub).verifyCreditForLending(
            minScoreRequired,
            creditProof,
            creditPublicInputs
        );
        if (!passed) revert CreditVerificationFailed();
        _borrowWithCollateralInternal(proof, publicInputs);
    }

    function _borrowWithCollateralInternal(
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) internal {
        // Validate input length
        ProofLib.requireValidInputLength(publicInputs, 6);
        
        // Extract public inputs
        bytes32 collateralNullifier = ProofLib.extractNullifier(publicInputs, 0);
        bytes32 collateralCommitment = ProofLib.extractCommitment(publicInputs, 1);
        bytes32 loanCommitment = ProofLib.extractCommitment(publicInputs, 2);
        uint256 collateralAmount = ProofLib.extractAmount(publicInputs, 3);
        uint256 loanAmount = ProofLib.extractAmount(publicInputs, 4);
        uint256 tenorSeconds = ProofLib.extractAmount(publicInputs, 5);
        if (!_isAllowedTenor(tenorSeconds)) revert InvalidLoanTenor();
        
        // Enhanced solvency and economic invariant checks
        _validateLoanSolvency(collateralAmount, loanAmount);
        _validateSystemSolvency(loanAmount);
        _validateEconomicInvariants(loanAmount);
        
        // Validate parameters
        if (collateralAmount == 0) revert InvalidAmount();
        if (loanAmount < MIN_LOAN_AMOUNT) revert InvalidLoanAmount();
        if (loanAmount > liquidityPool) revert InsufficientLiquidity();
        if (collateralAmount * 100 < loanAmount * COLLATERAL_RATIO) revert InsufficientCollateral();
        if (lendingNullifiers[collateralNullifier]) revert NullifierAlreadyUsed();
        if (collateralCommitments[collateralCommitment]) revert CommitmentAlreadyExists();
        if (loanCommitments[loanCommitment]) revert CommitmentAlreadyExists();
        
        // Verify the ZK proof using VerifierFactory
        if (!VERIFIER_FACTORY.verifyProof(LENDING_TENOR_CIRCUIT, proof, publicInputs)) {
            revert ProofVerificationFailed();
        }
        
        _createLoanAndUpdateState(
            collateralNullifier, 
            collateralCommitment, 
            loanCommitment, 
            collateralAmount, 
            loanAmount,
            tenorSeconds
        );
    }
    
    /**
     * @notice Creates a loan and updates contract state
     * @dev Creates a loan and updates contract state
     * @param collateralNullifier The nullifier for the collateral
     * @param collateralCommitment The commitment for the collateral
     * @param loanCommitment The commitment for the loan
     * @param collateralAmount The amount of collateral
     * @param loanAmount The amount of the loan
     * @param tenorSeconds Borrow tenor from proof (must be an allowed tenor)
     */
    function _createLoanAndUpdateState(
        bytes32 collateralNullifier,
        bytes32 collateralCommitment,
        bytes32 loanCommitment,
        uint256 collateralAmount,
        uint256 loanAmount,
        uint256 tenorSeconds
    ) internal {
        // Create loan ID
        bytes32 loanId = keccak256(
            abi.encodePacked(collateralCommitment, loanCommitment, block.timestamp)
        );
        
        // Update state
        lendingNullifiers[collateralNullifier] = true;
        collateralCommitments[collateralCommitment] = true;
        loanCommitments[loanCommitment] = true;
        
        loans[loanId] = LoanInfo({
            collateralCommitment: collateralCommitment,
            loanCommitment: loanCommitment,
            principal: loanAmount,
            collateralAmount: collateralAmount,
            timestamp: block.timestamp,
            active: true,
            borrowRateBps: _borrowRateBpsAfterNewLoan(loanAmount),
            tenorSeconds: tenorSeconds
        });
        
        collateralAmounts[collateralCommitment] = collateralAmount;
        loanTimestamps[loanCommitment] = block.timestamp;
        
        // CRITICAL FIX: Prevent underflow when borrowing
        if (liquidityPool < loanAmount) revert InsufficientLiquidity();
        
        unchecked {
            totalBorrowed += loanAmount;
            liquidityPool -= loanAmount;
        }
        
        emit CollateralDeposited(collateralCommitment, collateralAmount, block.timestamp);
        emit LoanIssued(loanId, collateralCommitment, loanCommitment, loanAmount, collateralAmount, tenorSeconds);
    }
    
    /**
     * @notice Repays a loan and retrieves collateral
     * @dev Repays a loan and retrieves collateral
     * @param proof The ZK proof data
     * @param publicInputs Public inputs: [loanNullifier, repaymentNullifier, collateralOutputCommitment, 
     *                     loanId, repaymentAmount]
     */
    function repayLoan(
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external nonReentrant whenNotPaused {
        // Validate input length
        ProofLib.requireValidInputLength(publicInputs, 5);
        
        // Extract public inputs
        bytes32 loanNullifier = ProofLib.extractNullifier(publicInputs, 0);
        bytes32 repaymentNullifier = ProofLib.extractNullifier(publicInputs, 1);
        // Extract collateral output commitment (unused in current implementation)
        ProofLib.extractCommitment(publicInputs, 2);
        bytes32 loanId = bytes32(publicInputs[3]);
        uint256 repaymentAmount = ProofLib.extractAmount(publicInputs, 4);
        
        // Validate loan exists and is active
        if (repaymentAmount == 0) revert InvalidAmount();
        LoanInfo storage loan = loans[loanId];
        if (!loan.active) revert LoanNotActive();
        if (lendingNullifiers[loanNullifier]) revert NullifierAlreadyUsed();
        if (lendingNullifiers[repaymentNullifier]) revert NullifierAlreadyUsed();
        
        uint256 interest = _accruedInterestWei(loan);
        uint256 totalRepayment = loan.principal + interest;
        
        if (repaymentAmount < totalRepayment) revert InsufficientRepayment();
        
        // Verify the ZK proof using VerifierFactory
        if (!VERIFIER_FACTORY.verifyProof(LENDING_REPAY_CIRCUIT, proof, publicInputs)) {
            revert ProofVerificationFailed();
        }
        
        // Update state with underflow protection
        lendingNullifiers[loanNullifier] = true;
        lendingNullifiers[repaymentNullifier] = true;
        loan.active = false;
        
        // CRITICAL FIX: Prevent underflow when repaying loan
        if (totalBorrowed < loan.principal) revert InsufficientLiquidity();
        
        unchecked {
            totalBorrowed -= loan.principal;
            liquidityPool += repaymentAmount;
        }
        
        emit LoanRepaid(loanId, repaymentNullifier, repaymentAmount);
    }
    
    /**
     * @notice Liquidates a loan that is undercollateralized **or** past maturity
     * @param proof The ZK proof data
     * @param publicInputs Public inputs: [liquidatorNullifier, liquidatorCommitment, loanId, liquidationAmount]
     */
    function liquidateLoan(
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external nonReentrant whenNotPaused {
        // Validate input length
        ProofLib.requireValidInputLength(publicInputs, 4);
        
        // Extract public inputs
        bytes32 liquidatorNullifier = ProofLib.extractNullifier(publicInputs, 0);
        bytes32 liquidatorCommitment = ProofLib.extractCommitment(publicInputs, 1);
        bytes32 loanId = bytes32(publicInputs[2]);
        uint256 liquidationAmount = ProofLib.extractAmount(publicInputs, 3);
        
        // Validate loan exists and is active
        LoanInfo storage loan = loans[loanId];
        if (!loan.active) revert LoanNotActive();
        if (lendingNullifiers[liquidatorNullifier]) revert NullifierAlreadyUsed();
        
        uint256 interest = _accruedInterestWei(loan);
        uint256 totalDebt = loan.principal + interest;
        
        bool undercollateralized = loan.collateralAmount * 100 < totalDebt * LIQUIDATION_THRESHOLD;
        bool overdue = block.timestamp >= loan.timestamp + _loanMaturitySeconds(loan);
        if (!undercollateralized && !overdue) {
            revert CollateralNotLiquidatable();
        }
        
        // Verify the ZK proof using VerifierFactory
        if (!VERIFIER_FACTORY.verifyProof(LENDING_LIQUIDATE_CIRCUIT, proof, publicInputs)) {
            revert ProofVerificationFailed();
        }
        
        // Calculate liquidation amounts
        uint256 collateralSeized = (liquidationAmount * (100 + LIQUIDATION_PENALTY)) / 100;
        if (collateralSeized > loan.collateralAmount) revert ExcessiveLiquidation();
        
        // Update state with underflow protection
        lendingNullifiers[liquidatorNullifier] = true;
        loan.active = false;
        
        // CRITICAL FIX: Prevent underflow when liquidating loan
        if (totalBorrowed < loan.principal) revert InsufficientLiquidity();
        
        unchecked {
            totalBorrowed -= loan.principal;
            liquidityPool += liquidationAmount;
        }
        
        emit LiquidationExecuted(loanId, liquidatorCommitment, collateralSeized);
    }
    
    /**
     * @notice Withdraws liquidity from the pool
     * @dev Withdraws liquidity from the pool
     * @param proof The ZK proof data
     * @param publicInputs Public inputs: [liquidityNullifier, outputCommitment, shares, amount]
     */
    function withdrawLiquidity(
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external nonReentrant whenNotPaused {
        // Validate input length
        ProofLib.requireValidInputLength(publicInputs, 4);
        
        // Extract public inputs
        bytes32 liquidityNullifier = ProofLib.extractNullifier(publicInputs, 0);
        bytes32 outputCommitment = ProofLib.extractCommitment(publicInputs, 1);
        uint256 shares = ProofLib.extractAmount(publicInputs, 2);
        uint256 amount = ProofLib.extractAmount(publicInputs, 3);
        
        // Validate parameters
        if (lendingNullifiers[liquidityNullifier]) revert NullifierAlreadyUsed();
        if (amount > liquidityPool) revert InsufficientLiquidity();

        _enforceWithdrawalRunGuard(amount);
        
        // Verify the ZK proof using VerifierFactory
        if (!VERIFIER_FACTORY.verifyProof(LENDING_WITHDRAW_CIRCUIT, proof, publicInputs)) {
            revert ProofVerificationFailed();
        }
        
        // CRITICAL FIX: Prevent underflow in state updates
        if (totalLiquidity < shares) revert InsufficientLiquidity();
        if (liquidityPool < amount) revert InsufficientLiquidity();
        
        unchecked {
            totalLiquidity -= shares;
            liquidityPool -= amount;
        }

        _recordWithdrawalRunGuard(amount);
        
        emit LiquidityWithdrawn(liquidityNullifier, outputCommitment, amount);
    }
    
    /**
     * @notice Returns loan information
     * @param loanId The loan ID to query
     * @return loan The loan information
     */
    function getLoanInfo(bytes32 loanId) external view returns (LoanInfo memory loan) {
        return loans[loanId];
    }
    
    /**
     * @notice Calculates current debt for a loan including interest
     * @param loanId The loan ID to query
     * @return totalDebt The total debt including interest
     */
    function calculateCurrentDebt(bytes32 loanId) external view returns (uint256 totalDebt) {
        LoanInfo memory loan = loans[loanId];
        if (!loan.active) return 0;
        
        return loan.principal + _accruedInterestWei(loan);
    }

    /**
     * @notice Annual borrow rate implied by **current** aggregate pool state (no identities).
     * @dev Same curve as at origination for a hypothetical infinitesimal borrow; stealth-preserving.
     */
    function currentAggregateBorrowRateBps() external view returns (uint256) {
        return _borrowRateBpsFromUtil(_utilizationBpsFrom(totalBorrowed, liquidityPool));
    }

    /**
     * @notice Annual borrow rate (bps) that would apply if `additionalBorrow` were opened now; uses only aggregates.
     */
    function previewBorrowRateBpsFor(uint256 additionalBorrow) external view returns (uint256) {
        return _borrowRateBpsAfterNewLoan(additionalBorrow);
    }

    /**
     * @notice Fixed annual rate (bps) locked at open for this loan; zero means pre-upgrade loan (uses base).
     */
    function getLoanBorrowRateBps(bytes32 loanId) external view returns (uint256) {
        uint256 r = loans[loanId].borrowRateBps;
        return r == 0 ? INTEREST_RATE : r;
    }

    /**
     * @notice Largest new principal (wei) that passes aggregate origination checks (reserves, concentration rationing, 90% util ceiling, interest floor)—excludes collateral/ZK.
     * @dev Binary search upper bound for integrators; still **no** per-user data.
     */
    function previewMaxNewLoanWei() external view returns (uint256 maxWei) {
        return _previewMaxNewLoanAllInvariants();
    }

    /**
     * @notice Returns pool statistics
     * @return _totalLiquidity Total liquidity shares
     * @return _liquidityPool Available liquidity amount
     * @return _totalBorrowed Total borrowed amount
     * @return utilizationRate Pool utilization rate (basis points)
     */
    function getPoolStats() external view returns (
        uint256 _totalLiquidity,
        uint256 _liquidityPool,
        uint256 _totalBorrowed,
        uint256 utilizationRate
    ) {
        uint256 totalPool = liquidityPool + totalBorrowed;
        uint256 utilization = totalPool > 0 ? (totalBorrowed * 10000) / totalPool : 0;

        return (totalLiquidity, liquidityPool, totalBorrowed, utilization);
    }

    /**
     * @notice Aggregate withdrawal throttle for the current block (stealth-preserving: no identities).
     * @return checkpointBlock Block number for which `cumulative` and `cap` apply (`0` if no withdraw yet this block).
     * @return poolAtBlockStart `liquidityPool` snapshot at first withdraw this block (same as current if none yet).
     * @return cumulativeWei Sum of token amounts already withdrawn this block via `withdrawLiquidity`.
     * @return capWei Max allowed cumulative withdrawals this block (`WITHDRAW_RUN_GUARD_BPS` of pool at block start).
     */
    function getWithdrawalRunGuardState()
        external
        view
        returns (uint256 checkpointBlock, uint256 poolAtBlockStart, uint256 cumulativeWei, uint256 capWei)
    {
        if (_withdrawRunBlock != block.number) {
            return (0, liquidityPool, 0, (liquidityPool * WITHDRAW_RUN_GUARD_BPS) / 10000);
        }
        capWei = (_withdrawRunPoolStart * WITHDRAW_RUN_GUARD_BPS) / 10000;
        return (_withdrawRunBlock, _withdrawRunPoolStart, _withdrawRunCumulative, capWei);
    }

    /**
     * @notice One-call **aggregate** snapshot for dashboards, bots, and stress monitoring (no per-user data).
     * @dev Observable **system** state only: utilization, price of credit, exit throttle, pause bit.
     */
    function getLendingMarketSnapshot()
        external
        view
        returns (
            uint256 totalLiquidityShares,
            uint256 liquidityPoolWei,
            uint256 totalBorrowedWei,
            uint256 utilizationBps,
            uint256 spotBorrowRateBps,
            uint256 withdrawRunCheckpointBlock,
            uint256 withdrawRunPoolStartWei,
            uint256 withdrawRunCumulativeWei,
            uint256 withdrawRunCapWei,
            bool isPaused,
            uint256 concentrationCapBpsAtCurrentUtil,
            uint256 maxSingleLoanByConcentrationAtCurrentUtilWei,
            uint256 previewMaxNewLoanWeiUpperBound
        )
    {
        totalLiquidityShares = totalLiquidity;
        liquidityPoolWei = liquidityPool;
        totalBorrowedWei = totalBorrowed;
        uint256 totalPool = liquidityPoolWei + totalBorrowedWei;
        utilizationBps = totalPool > 0 ? (totalBorrowedWei * 10000) / totalPool : 0;
        spotBorrowRateBps = _borrowRateBpsFromUtil(_utilizationBpsFrom(totalBorrowedWei, liquidityPoolWei));
        (withdrawRunCheckpointBlock, withdrawRunPoolStartWei, withdrawRunCumulativeWei, withdrawRunCapWei) =
            this.getWithdrawalRunGuardState();
        isPaused = paused();
        concentrationCapBpsAtCurrentUtil = _maxConcentrationCapBps(
            _utilizationBpsFrom(totalBorrowedWei, liquidityPoolWei)
        );
        maxSingleLoanByConcentrationAtCurrentUtilWei =
            (totalLiquidityShares * concentrationCapBpsAtCurrentUtil) / 10000;
        previewMaxNewLoanWeiUpperBound = _previewMaxNewLoanAllInvariants();
    }
    
    /**
     * @notice Checks if a loan is liquidatable
     * @param loanId The loan ID to check
     * @return True if the loan can be liquidated
     */
    function isLiquidatable(bytes32 loanId) external view returns (bool) {
        LoanInfo memory loan = loans[loanId];
        if (!loan.active) return false;
        
        uint256 totalDebt = loan.principal + _accruedInterestWei(loan);
        bool undercollateralized = loan.collateralAmount * 100 < totalDebt * LIQUIDATION_THRESHOLD;
        bool overdue = block.timestamp >= loan.timestamp + _loanMaturitySeconds(loan);
        return undercollateralized || overdue;
    }
    
    /**
     * @notice Limits **aggregate** `withdrawLiquidity` outflow per block vs pool size at first exit in the block (bank-run analogue; stealth-safe).
     */
    function _enforceWithdrawalRunGuard(uint256 amount) internal {
        if (amount == 0) {
            return;
        }
        if (block.number != _withdrawRunBlock) {
            _withdrawRunBlock = block.number;
            _withdrawRunPoolStart = liquidityPool;
            _withdrawRunCumulative = 0;
        }
        uint256 cap = (_withdrawRunPoolStart * WITHDRAW_RUN_GUARD_BPS) / 10000;
        if (_withdrawRunCumulative + amount > cap) {
            revert WithdrawalRunGuardExceeded();
        }
    }

    function _recordWithdrawalRunGuard(uint256 amount) internal {
        if (amount == 0) {
            return;
        }
        unchecked {
            _withdrawRunCumulative += amount;
        }
    }
    
    /**
     * @notice Verifier updates are now handled through VerifierFactory by governance
     * @dev VerifierFactory manages all verifier updates through governance
     * These functions are deprecated - verifiers are updated via VerifierFactory.updateVerifier() by governance
     */
    // Verifier updates are handled by VerifierFactory through governance
    
    /**
     * @notice Pauses the contract (governance only - DAO controlled)
     */
    function pause() external onlyGovernance {
        _pause();
    }
    
    /**
     * @notice Unpauses the contract (governance only - DAO controlled)
     */
    function unpause() external onlyGovernance {
        _unpause();
    }

    // ============ SOLVENCY AND ECONOMIC INVARIANT VALIDATION ============

    /**
     * @notice Utilization of borrowed funds: `borrowed / (borrowed + cash)` in basis points (0–10000).
     * @dev Uses only aggregate balances — no per-user leakage.
     */
    function _utilizationBpsFrom(uint256 borrowed, uint256 cash) internal pure returns (uint256) {
        uint256 t = borrowed + cash;
        if (t == 0) {
            return 0;
        }
        return (borrowed * 10000) / t;
    }

    /**
     * @notice Piecewise linear borrow curve: low APR when the pool is idle, steeper past kink (market discipline, still stealth).
     */
    function _borrowRateBpsFromUtil(uint256 uBps) internal pure returns (uint256 r) {
        if (uBps >= 10000) {
            return BORROW_MAX_BPS;
        }
        uint256 kink = BORROW_KINK_UTILIZATION_BPS;
        uint256 base = INTEREST_RATE;
        uint256 atKink = BORROW_RATE_AT_KINK_BPS;
        uint256 maxBps = BORROW_MAX_BPS;
        if (uBps <= kink) {
            if (kink == 0) {
                return base;
            }
            r = base + ((atKink - base) * uBps) / kink;
        } else {
            uint256 hiSpan = 10000 - kink;
            if (hiSpan == 0) {
                return maxBps;
            }
            r = atKink + ((maxBps - atKink) * (uBps - kink)) / hiSpan;
        }
    }

    /**
     * @notice Borrow APR (bps/year) after a new loan of `loanAmount` is booked (matches snapshot at origination).
     */
    function _borrowRateBpsAfterNewLoan(uint256 loanAmount) internal view returns (uint256) {
        uint256 b = totalBorrowed + loanAmount;
        uint256 c = liquidityPool - loanAmount;
        return _borrowRateBpsFromUtil(_utilizationBpsFrom(b, c));
    }

    /**
     * @notice **Concentration policy:** single-draw cap vs `totalLiquidity` ramps down as `utilBpsAfter` approaches full pool use (aggregate only; no identities).
     */
    function _maxConcentrationCapBps(uint256 utilBpsAfter) internal pure returns (uint256 capBps) {
        if (utilBpsAfter <= CONCENTRATION_LOOSE_UTIL_BPS) {
            return CONCENTRATION_CAP_LOOSE_BPS;
        }
        if (utilBpsAfter >= CONCENTRATION_TIGHT_UTIL_BPS) {
            return CONCENTRATION_CAP_TIGHT_BPS;
        }
        uint256 span = CONCENTRATION_TIGHT_UTIL_BPS - CONCENTRATION_LOOSE_UTIL_BPS;
        uint256 drop = CONCENTRATION_CAP_LOOSE_BPS - CONCENTRATION_CAP_TIGHT_BPS;
        capBps = CONCENTRATION_CAP_LOOSE_BPS - (drop * (utilBpsAfter - CONCENTRATION_LOOSE_UTIL_BPS)) / span;
    }

    /**
     * @dev Mirrors `_validateSystemSolvency` + `_validateEconomicInvariants` for a candidate principal (no collateral checks).
     */
    function _passesOriginationInvariants(uint256 newLoanAmount) internal view returns (bool) {
        if (newLoanAmount == 0 || newLoanAmount > liquidityPool) {
            return false;
        }
        if (newLoanAmount < MIN_LOAN_AMOUNT) {
            return false;
        }
        uint256 projectedBorrowed = totalBorrowed + newLoanAmount;
        if (projectedBorrowed > totalLiquidity) {
            return false;
        }
        uint256 minimumReserve = (totalLiquidity * 10) / 100;
        uint256 remainingLiquidity = liquidityPool - newLoanAmount;
        if (remainingLiquidity < minimumReserve) {
            return false;
        }
        uint256 uAfter = _utilizationBpsFrom(projectedBorrowed, remainingLiquidity);
        uint256 capBps = _maxConcentrationCapBps(uAfter);
        if (newLoanAmount > (totalLiquidity * capBps) / 10000) {
            return false;
        }
        if (totalLiquidity == 0) {
            return false;
        }
        uint256 utilizationRate = ((totalBorrowed + newLoanAmount) * 100) / totalLiquidity;
        if (utilizationRate > 90) {
            return false;
        }
        uint256 rateBps = _borrowRateBpsAfterNewLoan(newLoanAmount);
        uint256 projectedInterest = (newLoanAmount * rateBps) / 10000;
        if (projectedInterest == 0) {
            return false;
        }
        uint256 minimumViableInterest = newLoanAmount / 1000;
        if (projectedInterest < minimumViableInterest) {
            return false;
        }
        return true;
    }

    function _previewMaxNewLoanAllInvariants() internal view returns (uint256 maxWei) {
        if (liquidityPool == 0 || totalLiquidity == 0) {
            return 0;
        }
        if (!_passesOriginationInvariants(MIN_LOAN_AMOUNT)) {
            return 0;
        }
        uint256 lo = MIN_LOAN_AMOUNT;
        uint256 hi = liquidityPool;
        if (lo > hi) {
            return 0;
        }
        unchecked {
            for (uint256 i; i < 48; ++i) {
                if (lo >= hi) {
                    break;
                }
                uint256 mid = (lo + hi + 1) >> 1;
                if (_passesOriginationInvariants(mid)) {
                    lo = mid;
                } else {
                    hi = mid - 1;
                }
            }
        }
        return lo;
    }

    /**
     * @notice Validates individual loan solvency (collateral vs principal).
     * @dev Ensures sound collateralization and prevents over-leveraging.
     * @param collateralAmount Amount of collateral backing the loan
     * @param loanAmount Principal amount being borrowed
     */
    function _validateLoanSolvency(uint256 collateralAmount, uint256 loanAmount) internal pure {
        // Collateral must back the loan on-chain (no uncollateralized mint).
        if (collateralAmount == 0) revert InvalidAmount();
        
        // Enhanced collateral ratio check with safety buffer
        // CRITICAL: Multiply before divide to avoid precision loss
        // Calculate requiredCollateral = loanAmount * COLLATERAL_RATIO / 100
        uint256 requiredCollateral = (loanAmount * COLLATERAL_RATIO) / 100;
        if (collateralAmount < requiredCollateral) revert InsufficientCollateral();
        
        // Additional safety buffer for market volatility (20% above minimum)
        // CRITICAL: Multiply before divide - calculate directly from loanAmount to avoid precision loss
        // safetyBuffer = loanAmount * COLLATERAL_RATIO * 120 / 10000
        uint256 safetyBuffer = (loanAmount * COLLATERAL_RATIO * 120) / 10000;
        if (collateralAmount < safetyBuffer) revert InsufficientCollateralBuffer();
    }

    /**
     * @notice Validates system-wide solvency to prevent fractional reserve lending
     * @dev Ensures total borrowed never exceeds available liquidity
     * @param newLoanAmount Amount of new loan being issued
     */
    function _validateSystemSolvency(uint256 newLoanAmount) internal view {
        // Invariant: booked borrows cannot exceed recorded liquidity (full-reserve style accounting).
        uint256 projectedBorrowed = totalBorrowed + newLoanAmount;
        if (projectedBorrowed > totalLiquidity) revert SystemInsolvency();
        
        // Maintain minimum liquidity reserve (10% of total)
        uint256 minimumReserve = (totalLiquidity * 10) / 100;
        uint256 remainingLiquidity = liquidityPool - newLoanAmount;
        if (remainingLiquidity < minimumReserve) revert InsufficientReserves();
        
        // Credit rationing (aggregate): max single draw tightens as post-draw utilization rises
        uint256 uAfter = _utilizationBpsFrom(projectedBorrowed, remainingLiquidity);
        uint256 capBps = _maxConcentrationCapBps(uAfter);
        uint256 maxSingleLoan = (totalLiquidity * capBps) / 10000;
        if (newLoanAmount > maxSingleLoan) revert LoanTooLarge();
    }

    /**
     * @notice Validates economic invariants for sustainable lending.
     * @dev Utilization and interest viability checks at origination.
     * @param loanAmount Amount being borrowed
     */
    function _validateEconomicInvariants(uint256 loanAmount) internal view {
        // Utilization rate check - prevent over-utilization
        // CRITICAL FIX: Prevent division by zero
        if (totalLiquidity == 0) revert InsufficientLiquidity();
        uint256 utilizationRate = ((totalBorrowed + loanAmount) * 100) / totalLiquidity;
        if (utilizationRate > 90) revert UtilizationTooHigh();
        
        // Interest rate sustainability check (annualized at the rate that would apply to this draw)
        uint256 rateBps = _borrowRateBpsAfterNewLoan(loanAmount);
        uint256 projectedInterest = (loanAmount * rateBps) / 10000;
        if (projectedInterest == 0) revert UnsustainableInterestRate();
        
        // Minimum economic viability - loan must generate meaningful interest
        uint256 minimumViableInterest = loanAmount / 1000; // 0.1% minimum
        if (projectedInterest < minimumViableInterest) revert LoanNotEconomicallyViable();
    }

    // ============ CUSTOM ERRORS FOR SOLVENCY VALIDATION ============

    /// @notice Thrown when collateral buffer is insufficient for market volatility
    error InsufficientCollateralBuffer();
    
    /// @notice Thrown when system becomes insolvent (borrowed > liquidity)
    error SystemInsolvency();
    
    /// @notice Thrown when single loan exceeds concentration limits
    error LoanTooLarge();
    
    /// @notice Thrown when utilization rate exceeds safe thresholds
    error UtilizationTooHigh();
    
    /// @notice Thrown when interest rate structure is unsustainable
    error UnsustainableInterestRate();
    
    /// @notice Thrown when aggregate withdrawals in one block exceed `WITHDRAW_RUN_GUARD_BPS` of block-start liquidity
    error WithdrawalRunGuardExceeded();

    /// @notice Thrown when loan amount is too small to be economically viable
    error LoanNotEconomicallyViable();
}