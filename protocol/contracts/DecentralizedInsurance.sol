// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {VerifierFactory} from "./VerifierFactory.sol";
import {CommitmentLib} from "./libraries/CommitmentLib.sol";
import {PrivateTokenContract} from "./PrivateTokenContract.sol";
import {ICommonErrors} from "./interfaces/ICommonErrors.sol";

/**
 * @title DecentralizedInsurance
 * @dev Anonymous insurance coverage with ZK-proof privacy and automated claims
 * @notice Supports multiple insurance types with private coverage and claims.
 * @notice Aggregate pool / coverage economics (no per-user surveillance): see `docs/INSURANCE_AND_TREASURY_AGGREGATE_BUFFERS.md`. Dashboards: `getInsuranceMarketSnapshot()`.
 */
contract DecentralizedInsurance is ICommonErrors {
    using CommitmentLib for bytes32;

    /// @dev `insurancePool` is accounting-only in the constructor; AGS must already sit in
    ///      `PRIVATE_TOKEN.transparentBalances(address(this))` for pays. Non-zero seeds without a matching transfer are unsafe.
    error InitialPoolMustBeZero();

    // Custom errors for gas optimization

    // Core contracts
    PrivateTokenContract public immutable PRIVATE_TOKEN;
    VerifierFactory public immutable VERIFIER_FACTORY;
    
    // Circuit identifier for insurance proofs
    string private constant INSURANCE_CIRCUIT = "insurance";
    
    // Insurance types
    enum InsuranceType { SMART_CONTRACT, DEFI_PROTOCOL, STABLECOIN_DEPEG, SLASHING, BRIDGE, HEALTH, CROP, BUSINESS }
    enum ClaimStatus { PENDING, APPROVED, REJECTED, PAID }
    enum PolicyStatus { ACTIVE, EXPIRED, CANCELLED, CLAIMED }
    
    // Insurance parameters
    uint256 public constant MIN_COVERAGE_PERIOD = 7 days;
    uint256 public constant MAX_COVERAGE_PERIOD = 365 days;
    uint256 public constant MIN_COVERAGE_AMOUNT = 1000e18;
    uint256 public constant MAX_COVERAGE_AMOUNT = 10_000_000e18;
    uint256 public constant CLAIM_PERIOD = 30 days;
    uint256 public constant PREMIUM_PRECISION = 10000; // 100% = 10000
    
    // Timestamp security constants
    uint256 private constant TIMESTAMP_TOLERANCE = 900; // 15 minutes tolerance for timestamp comparisons
    uint256 private constant MAX_FUTURE_TOLERANCE = 300; // 5 minutes max future tolerance
    uint256 private constant MAX_PAST_TOLERANCE = 3600; // 1 hour max past tolerance
    
    // Global state
    uint256 public nextPolicyId;
    uint256 public nextClaimId;
    uint256 public totalCoverageAmount;
    uint256 public totalPremiumsCollected;
    uint256 public totalClaimsPaid;
    uint256 public insurancePool;
    
    // Policy storage
    mapping(uint256 => InsurancePolicy) public policies;
    mapping(uint256 => Claim) public claims;
    mapping(bytes32 => bool) public nullifierUsed;
    mapping(bytes32 => uint256) public commitmentToPolicy;
    mapping(InsuranceType => uint256) public basePremiumRates; // in basis points
    mapping(InsuranceType => uint256) public riskMultipliers;
    
    // Risk assessment
    mapping(bytes32 => uint256) public protocolRiskScores;
    mapping(bytes32 => uint256) public lastRiskUpdate;
    mapping(address => bool) public authorizedOracles;
    
    struct InsurancePolicy {
        uint256 id;
        InsuranceType insuranceType;
        PolicyStatus status;
        
        bytes32 insuredCommitment;
        bytes32 protocolIdentifier;
        uint256 coverageAmount;
        uint256 premiumAmount;
        uint256 premiumRate; // in basis points
        
        uint256 startTime;
        uint256 endTime;
        uint256 lastPremiumPayment;
        
        bytes32 privacyNullifier;
        bool isPrivate;
        
        // Risk parameters
        uint256 riskScore;
        uint256 deductible;
        uint256 maxClaimAmount;
    }
    
    struct Claim {
        uint256 id;
        uint256 policyId;
        ClaimStatus status;
        
        bytes32 claimantCommitment;
        bytes32 incidentHash;
        uint256 claimAmount;
        uint256 incidentTime;
        uint256 claimTime;
        uint256 assessmentTime;
        
        bytes32 evidenceHash;
        bytes32 assessorNullifier;
        uint256 assessmentScore;
        
        bool isPrivate;
        bytes32 privacyNullifier;
    }
    
    struct PolicyParams {
        InsuranceType insuranceType;
        bytes32 protocolIdentifier;
        uint256 coverageAmount;
        uint256 coveragePeriod;
        uint256 deductible;
        bytes32 insuredCommitment;
        bytes32 nullifier;
        bytes zkProof;
    }
    
    struct ClaimParams {
        uint256 policyId;
        bytes32 incidentHash;
        uint256 claimAmount;
        uint256 incidentTime;
        bytes32 evidenceHash;
        bytes32 claimantCommitment;
        bytes32 nullifier;
        bytes zkProof;
    }
    
    // Events
    event PolicyCreated(
        uint256 indexed policyId,
        InsuranceType indexed insuranceType,
        bytes32 indexed protocolIdentifier,
        uint256 coverageAmount,
        uint256 premiumAmount
    );
    
    event PremiumPaid(
        uint256 indexed policyId,
        bytes32 indexed insuredCommitment,
        uint256 amount,
        uint256 timestamp
    );
    
    event ClaimSubmitted(
        uint256 indexed claimId,
        uint256 indexed policyId,
        bytes32 indexed incidentHash,
        uint256 claimAmount
    );
    
    event ClaimAssessed(
        uint256 indexed claimId,
        ClaimStatus status,
        uint256 assessmentScore,
        bytes32 assessorNullifier
    );
    
    event ClaimPaid(
        uint256 indexed claimId,
        uint256 indexed policyId,
        bytes32 indexed claimantCommitment,
        uint256 amount
    );
    
    event RiskScoreUpdated(
        bytes32 indexed protocolIdentifier,
        uint256 oldScore,
        uint256 newScore,
        uint256 timestamp
    );
    
    event InsurancePoolFunded(
        bytes32 indexed funderCommitment,
        uint256 amount,
        uint256 newPoolSize
    );
    
    modifier validPolicy(uint256 policyId) {
        if (policyId > nextPolicyId) revert InvalidPolicyId();
        if (policies[policyId].status != PolicyStatus.ACTIVE) revert PolicyNotActive();
        _;
    }
    
    modifier onlyValidProof(bytes memory proof, bytes32 commitment) {
        (uint256[8] memory convertedProof, uint256[] memory publicInputs) = _convertProofData(proof, commitment);
        if (!VERIFIER_FACTORY.verifyProof(INSURANCE_CIRCUIT, convertedProof, publicInputs)) revert InvalidZKProof();
        _;
    }
    
    modifier onlyAuthorizedOracle() {
        if (!authorizedOracles[msg.sender]) revert UnauthorizedOracle();
        _;
    }
    
    /**
     * @param _privateToken AGS token (fixed supply; no mint from this contract).
     * @param _verifierFactory Verifier factory for insurance proofs.
     * @param _initialPool Must be **zero**: fund the pool after deploy via `fundInsurancePool` and/or premiums so
     *        `insurancePool` and `transparentBalances(address(this))` stay aligned.
     */
    constructor(
        address _privateToken,
        address _verifierFactory,
        uint256 _initialPool
    ) {
        if (_initialPool != 0) revert InitialPoolMustBeZero();
        PRIVATE_TOKEN = PrivateTokenContract(_privateToken);
        VERIFIER_FACTORY = VerifierFactory(_verifierFactory);
        insurancePool = _initialPool;
        
        nextPolicyId = 1;
        nextClaimId = 1;
        
        // Initialize base premium rates (in basis points)
        basePremiumRates[InsuranceType.SMART_CONTRACT] = 200; // 2%
        basePremiumRates[InsuranceType.DEFI_PROTOCOL] = 300; // 3%
        basePremiumRates[InsuranceType.STABLECOIN_DEPEG] = 150; // 1.5%
        basePremiumRates[InsuranceType.SLASHING] = 100; // 1%
        basePremiumRates[InsuranceType.BRIDGE] = 500; // 5%
        basePremiumRates[InsuranceType.HEALTH] = 400; // 4%
        basePremiumRates[InsuranceType.CROP] = 350; // 3.5%
        basePremiumRates[InsuranceType.BUSINESS] = 450; // 4.5%
        
        // Initialize risk multipliers
        riskMultipliers[InsuranceType.SMART_CONTRACT] = 150;
        riskMultipliers[InsuranceType.DEFI_PROTOCOL] = 200;
        riskMultipliers[InsuranceType.STABLECOIN_DEPEG] = 100;
        riskMultipliers[InsuranceType.SLASHING] = 120;
        riskMultipliers[InsuranceType.BRIDGE] = 300;
        riskMultipliers[InsuranceType.HEALTH] = 180;
        riskMultipliers[InsuranceType.CROP] = 160;
        riskMultipliers[InsuranceType.BUSINESS] = 170;
        
        // Initialize authorized oracles (deployer is initially authorized)
        authorizedOracles[msg.sender] = true;
    }
    
    /**
     * @dev Create a new insurance policy
     * @param params Policy creation parameters with ZK proof
     */
    function createPolicy(
        PolicyParams calldata params
    ) external onlyValidProof(params.zkProof, params.insuredCommitment) returns (uint256) {
        if (nullifierUsed[params.nullifier]) revert NullifierAlreadyUsed();
        if (params.coverageAmount < MIN_COVERAGE_AMOUNT) revert CoverageTooLow();
        if (params.coverageAmount > MAX_COVERAGE_AMOUNT) revert CoverageTooHigh();
        if (params.coveragePeriod < MIN_COVERAGE_PERIOD) revert PeriodTooShort();
        if (params.coveragePeriod > MAX_COVERAGE_PERIOD) revert PeriodTooLong();
        if (params.deductible >= params.coverageAmount) revert InvalidDeductible();
        
        nullifierUsed[params.nullifier] = true;
        
        // Calculate premium
        uint256 riskScore = protocolRiskScores[params.protocolIdentifier];
        if (riskScore == 0) riskScore = 500; // Default medium risk
        
        uint256 premiumRate = _calculatePremiumRate(params.insuranceType, riskScore);
        
        // Safe premium calculation to prevent overflow
        // Break down the calculation: (coverageAmount * premiumRate * coveragePeriod) / (PREMIUM_PRECISION * 365 days)
        uint256 premiumAmount;
        unchecked {
            // First multiply coverageAmount * premiumRate, check for overflow
            uint256 intermediate = params.coverageAmount * premiumRate;
            if (intermediate / params.coverageAmount != premiumRate) {
                revert CoverageTooHigh(); // Overflow occurred
            }
            // Then multiply by coveragePeriod
            uint256 numerator = intermediate * params.coveragePeriod;
            if (numerator / intermediate != params.coveragePeriod) {
                revert PeriodTooLong(); // Overflow occurred
            }
            // Finally divide by denominator
            uint256 denominator = PREMIUM_PRECISION * 365 days;
            premiumAmount = numerator / denominator;
        }
        
        uint256 policyId = nextPolicyId++;
        
        // Create policy with safe timestamp handling
        uint256 currentTime = block.timestamp;
        uint256 endTime;
        
        // Safe addition to prevent overflow
        if (currentTime > type(uint256).max - params.coveragePeriod) {
            revert PeriodTooLong();
        }
        endTime = currentTime + params.coveragePeriod;
        
        policies[policyId] = InsurancePolicy({
            id: policyId,
            insuranceType: params.insuranceType,
            status: PolicyStatus.ACTIVE,
            insuredCommitment: params.insuredCommitment,
            protocolIdentifier: params.protocolIdentifier,
            coverageAmount: params.coverageAmount,
            premiumAmount: premiumAmount,
            premiumRate: premiumRate,
            startTime: currentTime,
            endTime: endTime,
            lastPremiumPayment: currentTime,
            privacyNullifier: params.nullifier,
            isPrivate: true,
            riskScore: riskScore,
            deductible: params.deductible,
            maxClaimAmount: params.coverageAmount - params.deductible
        });
        
        // Update global state
        totalCoverageAmount += params.coverageAmount;
        totalPremiumsCollected += premiumAmount;
        insurancePool += premiumAmount;
        commitmentToPolicy[params.insuredCommitment] = policyId;
        
        // Emit event before external call
        emit PolicyCreated(
            policyId,
            params.insuranceType,
            params.protocolIdentifier,
            params.coverageAmount,
            premiumAmount
        );
        
        // Transfer premium
        PRIVATE_TOKEN.transferToPoolInternal(
            params.insuredCommitment,
            address(this),
            premiumAmount
        );
        
        return policyId;
    }
    
    /**
     * @dev Submit an insurance claim
     * @param params Claim submission parameters with ZK proof
     */
    function submitClaim(
         ClaimParams calldata params
     ) external 
       validPolicy(params.policyId) 
       onlyValidProof(params.zkProof, params.claimantCommitment) 
       returns (uint256) {
         if (nullifierUsed[params.nullifier]) revert NullifierAlreadyUsed();
         if (params.claimAmount == 0) revert InvalidClaimAmount();
         if (!_isValidTimestamp(params.incidentTime, false)) revert InvalidIncidentTimestamp();
         
         // Check if incident time is within coverage period
         if (!_isTimeInRange(
             policies[params.policyId].startTime, 
             policies[params.policyId].endTime, 
             params.incidentTime
         )) revert IncidentOutsideCoveragePeriod();
         // Safe timestamp handling for claim period validation
         uint256 currentTime = block.timestamp;
         uint256 claimDeadline;
         
         // Safe addition to prevent overflow
         if (policies[params.policyId].endTime > type(uint256).max - CLAIM_PERIOD) {
             claimDeadline = type(uint256).max;
         } else {
             claimDeadline = policies[params.policyId].endTime + CLAIM_PERIOD;
         }
         
         if (!_isTimeInRange(0, claimDeadline, currentTime)) revert ClaimPeriodExpired();
       
       InsurancePolicy storage policy = policies[params.policyId];
       if (params.claimAmount > policy.maxClaimAmount) revert ClaimExceedsMaxAmount();
        
        nullifierUsed[params.nullifier] = true;
        
        uint256 claimId = nextClaimId++;
        
        // Create claim with safe timestamp handling
        claims[claimId] = Claim({
            id: claimId,
            policyId: params.policyId,
            status: ClaimStatus.PENDING,
            claimantCommitment: params.claimantCommitment,
            incidentHash: params.incidentHash,
            claimAmount: params.claimAmount,
            incidentTime: params.incidentTime,
            claimTime: currentTime, // Use already validated currentTime
            assessmentTime: 0,
            evidenceHash: params.evidenceHash,
            assessorNullifier: bytes32(0),
            assessmentScore: 0,
            isPrivate: true,
            privacyNullifier: params.nullifier
        });
        
        emit ClaimSubmitted(
            claimId,
            params.policyId,
            params.incidentHash,
            params.claimAmount
        );
        
        return claimId;
    }
    
    /**
     * @dev Assess a claim (automated or oracle-based)
     * @param claimId Claim to assess
     * @param approved Whether claim is approved
     * @param assessmentScore Assessment score (0-1000)
     * @param assessorNullifier Assessor's nullifier
     * @param zkProof ZK proof of assessment
     */
    function assessClaim(
        uint256 claimId,
        bool approved,
        uint256 assessmentScore,
        bytes32 assessorNullifier,
        bytes calldata zkProof
    ) external onlyValidProof(zkProof, assessorNullifier) {
        if (claimId >= nextClaimId) revert InvalidClaimId();
        if (claims[claimId].status != ClaimStatus.PENDING) revert ClaimNotPending();
        if (nullifierUsed[assessorNullifier]) revert AssessorNullifierUsed();
        if (assessmentScore > 1000) revert InvalidAssessmentScore();
        
        nullifierUsed[assessorNullifier] = true;
        
        Claim storage claim = claims[claimId];
        claim.status = approved ? ClaimStatus.APPROVED : ClaimStatus.REJECTED;
        claim.assessmentTime = block.timestamp;
        claim.assessorNullifier = assessorNullifier;
        claim.assessmentScore = assessmentScore;
        
        emit ClaimAssessed(claimId, claim.status, assessmentScore, assessorNullifier);
        
        // Auto-pay if approved and sufficient funds
        if (approved && insurancePool >= claim.claimAmount) {
            _payClaim(claimId);
        }
    }
    
    /**
     * @dev Pay an approved claim
     * @param claimId Claim to pay
     */
    function payClaim(uint256 claimId) external {
        if (claimId >= nextClaimId) revert InvalidClaimId();
        if (claims[claimId].status != ClaimStatus.APPROVED) revert ClaimNotApproved();
        
        _payClaim(claimId);
    }
    
    /**
     * @dev Internal function to pay a claim
     * @param claimId Claim to pay
     */
    function _payClaim(uint256 claimId) internal {
        Claim storage claim = claims[claimId];
        if (claim.status != ClaimStatus.APPROVED) revert ClaimNotApproved();
        if (insurancePool < claim.claimAmount) revert InsufficientPoolFunds();
        
        claim.status = ClaimStatus.PAID;
        
        // Update global state with underflow protection
        // CRITICAL FIX: Prevent underflow (check already done above, but safe to use unchecked)
        unchecked {
            insurancePool -= claim.claimAmount;
            totalClaimsPaid += claim.claimAmount;
        }
        
        // Update policy status
        policies[claim.policyId].status = PolicyStatus.CLAIMED;
        
        // Emit event before external call
        emit ClaimPaid(
            claimId,
            claim.policyId,
            claim.claimantCommitment,
            claim.claimAmount
        );
        
        // Transfer claim amount
        PRIVATE_TOKEN.transferFromPool(
            address(this),
            claim.claimantCommitment,
            claim.claimAmount
        );
    }
    
    /**
     * @dev Fund the insurance pool
     * @param amount Amount to fund
     * @param funderCommitment Funder's commitment
     * @param zkProof ZK proof
     */
    function fundInsurancePool(
        uint256 amount,
        bytes32 funderCommitment,
        bytes calldata zkProof
    ) external onlyValidProof(zkProof, funderCommitment) {
        if (amount == 0) revert InvalidAmount();
        
        insurancePool += amount;
        
        // Emit event before external call
        emit InsurancePoolFunded(funderCommitment, amount, insurancePool);
        
        // Transfer tokens to pool
        PRIVATE_TOKEN.transferToPoolInternal(funderCommitment, address(this), amount);
    }
    
    /**
     * @dev Update protocol risk score
     * @param protocolIdentifier Protocol to update
     * @param newRiskScore New risk score (0-1000)
     */
    function updateRiskScore(
        bytes32 protocolIdentifier,
        uint256 newRiskScore
    ) external onlyAuthorizedOracle {
        if (newRiskScore > 1000) revert InvalidRiskScore();
        
        uint256 oldScore = protocolRiskScores[protocolIdentifier];
        uint256 currentTime = block.timestamp;
        
        protocolRiskScores[protocolIdentifier] = newRiskScore;
        lastRiskUpdate[protocolIdentifier] = currentTime;
        
        emit RiskScoreUpdated(protocolIdentifier, oldScore, newRiskScore, currentTime);
    }
    
    /**
     * @dev Calculate premium rate based on insurance type and risk score
     * @param insuranceType Type of insurance
     * @param riskScore Risk score (0-1000)
     * @return Premium rate in basis points
     */
    function _calculatePremiumRate(
        InsuranceType insuranceType,
        uint256 riskScore
    ) internal view returns (uint256) {
        uint256 basePremium = basePremiumRates[insuranceType];
        uint256 riskMultiplier = riskMultipliers[insuranceType];
        
        // Apply risk adjustment: base + (base * risk_score * multiplier / 100_000)
        uint256 riskPrecision = 100_000; // 100,000 for risk calculation precision
        uint256 riskAdjustment = (basePremium * riskScore * riskMultiplier) / riskPrecision;
        
        return basePremium + riskAdjustment;
    }
    
    /**
     * @dev Cancel a policy (with partial refund)
     * @param policyId Policy to cancel
     * @param cancellationCommitment Commitment for refund
     * @param nullifier Unique nullifier
     * @param zkProof ZK proof
     */
    function cancelPolicy(
        uint256 policyId,
        bytes32 cancellationCommitment,
        bytes32 nullifier,
        bytes calldata zkProof
    ) external validPolicy(policyId) onlyValidProof(zkProof, cancellationCommitment) {
        if (nullifierUsed[nullifier]) revert NullifierAlreadyUsed();
        
        nullifierUsed[nullifier] = true;
        
        InsurancePolicy storage policy = policies[policyId];
        policy.status = PolicyStatus.CANCELLED;
        
        // Calculate refund (proportional to remaining time) with safe arithmetic
        uint256 currentTime = block.timestamp;
        uint256 remainingTime = _timestampAfter(policy.endTime, currentTime) ? 
                               policy.endTime - currentTime : 0;
        uint256 totalTime = policy.endTime - policy.startTime;
        uint256 refundAmount = (policy.premiumAmount * remainingTime) / totalTime;
        
        // Apply cancellation fee (10%)
        uint256 cancellationFee = refundAmount / 10;
        refundAmount -= cancellationFee;
        
        // Update state before external calls to prevent reentrancy
        totalCoverageAmount -= policy.coverageAmount;
        
        if (refundAmount > 0) {
            insurancePool -= refundAmount;
            PRIVATE_TOKEN.transferFromPool(
                address(this),
                cancellationCommitment,
                refundAmount
            );
        }
    }
    
    // View functions
    function getPolicy(uint256 policyId) external view returns (InsurancePolicy memory) {
        return policies[policyId];
    }
    
    function getClaim(uint256 claimId) external view returns (Claim memory) {
        return claims[claimId];
    }
    
    function getProtocolRiskScore(bytes32 protocolIdentifier) external view returns (uint256, uint256) {
        return (protocolRiskScores[protocolIdentifier], lastRiskUpdate[protocolIdentifier]);
    }
    
    function calculatePremium(
        InsuranceType insuranceType,
        bytes32 protocolIdentifier,
        uint256 coverageAmount,
        uint256 coveragePeriod
    ) external view returns (uint256) {
        uint256 riskScore = protocolRiskScores[protocolIdentifier];
        if (riskScore == 0) riskScore = 500;
        
        uint256 premiumRate = _calculatePremiumRate(insuranceType, riskScore);
        return (coverageAmount * premiumRate * coveragePeriod) / (PREMIUM_PRECISION * 365 days);
    }
    
    function getPoolStats() external view returns (uint256, uint256, uint256, uint256) {
        return (insurancePool, totalCoverageAmount, totalPremiumsCollected, totalClaimsPaid);
    }

    /**
     * @notice One-call **aggregate** snapshot for dashboards (Mishkin-style solvency transparency; no per-policy identities).
     * @return poolWei Tokens reserved to pay claims (`insurancePool`).
     * @return outstandingCoverageWei Sum of active coverage notionals (`totalCoverageAmount`).
     * @return premiumsCollectedWei Lifetime premiums (`totalPremiumsCollected`).
     * @return claimsPaidWei Lifetime claims paid (`totalClaimsPaid`).
     * @return coverageToPoolBps `outstandingCoverage * 10000 / max(pool,1)` — stress of coverage vs liquid buffer (capped at `type(uint256).max` scale-safe via checked mul).
     * @return lossRatioBps `claimsPaid * 10000 / max(premiums,1)` — aggregate experience (0 if no premiums yet).
     */
    function getInsuranceMarketSnapshot()
        external
        view
        returns (
            uint256 poolWei,
            uint256 outstandingCoverageWei,
            uint256 premiumsCollectedWei,
            uint256 claimsPaidWei,
            uint256 coverageToPoolBps,
            uint256 lossRatioBps
        )
    {
        poolWei = insurancePool;
        outstandingCoverageWei = totalCoverageAmount;
        premiumsCollectedWei = totalPremiumsCollected;
        claimsPaidWei = totalClaimsPaid;
        if (poolWei == 0) {
            coverageToPoolBps = outstandingCoverageWei > 0 ? type(uint256).max : 0;
        } else {
            coverageToPoolBps = (outstandingCoverageWei * 10000) / poolWei;
        }
        if (premiumsCollectedWei == 0) {
            lossRatioBps = 0;
        } else {
            lossRatioBps = (claimsPaidWei * 10000) / premiumsCollectedWei;
        }
    }
    
    /**
     * @notice Returns the address of the private token contract
     * @return The address of the PRIVATE_TOKEN contract
     */
    function privateToken() external view returns (address) {
        return address(PRIVATE_TOKEN);
    }
    
    function isClaimValid(uint256 claimId) external view returns (bool) {
         if (claimId >= nextClaimId) return false;
         
         Claim memory claim = claims[claimId];
         InsurancePolicy memory policy = policies[claim.policyId];
         
         // Safe timestamp handling for claim validation
         uint256 currentTime = block.timestamp;
         uint256 claimDeadline;
         
         // Safe addition to prevent overflow
         if (policy.endTime > type(uint256).max - CLAIM_PERIOD) {
             claimDeadline = type(uint256).max;
         } else {
             claimDeadline = policy.endTime + CLAIM_PERIOD;
         }
         
         return _isTimeInRange(policy.startTime, policy.endTime, claim.incidentTime) &&
                _isTimeInRange(0, claimDeadline, currentTime);
     }
    
    /**
     * @dev Convert proof data from bytes format to the format expected by IVerifier
     * @param proof The proof in bytes format
     * @param commitment The commitment in bytes32 format
     * @return convertedProof The proof converted to uint256[8]
     * @return publicInputs The commitment converted to uint256[] array
     */
     function _convertProofData(bytes memory proof, bytes32 commitment) 
         internal 
         pure 
         returns (uint256[8] memory convertedProof, uint256[] memory publicInputs) 
     {
         if (proof.length < 256) revert InvalidProofLength();
         
         // Convert bytes proof to uint256[8] using minimal assembly
         // solhint-disable-next-line no-inline-assembly
         assembly ("memory-safe") {
             let proofPtr := add(proof, 0x20)
             mstore(convertedProof, mload(proofPtr))
             mstore(add(convertedProof, 0x20), mload(add(proofPtr, 0x20)))
             mstore(add(convertedProof, 0x40), mload(add(proofPtr, 0x40)))
             mstore(add(convertedProof, 0x60), mload(add(proofPtr, 0x60)))
         }
         // solhint-disable-next-line no-inline-assembly
         assembly ("memory-safe") {
             let proofPtr := add(proof, 0x20)
             mstore(add(convertedProof, 0x80), mload(add(proofPtr, 0x80)))
             mstore(add(convertedProof, 0xa0), mload(add(proofPtr, 0xa0)))
             mstore(add(convertedProof, 0xc0), mload(add(proofPtr, 0xc0)))
             mstore(add(convertedProof, 0xe0), mload(add(proofPtr, 0xe0)))
         }
         
         // Convert bytes32 commitment to uint256[] array
         publicInputs = new uint256[](1);
         publicInputs[0] = uint256(commitment);
     }
     
     /**
      * @dev Validates timestamp to prevent manipulation attacks
      * @param timestamp The timestamp to validate
      * @param allowFuture Whether to allow future timestamps within tolerance
      * @return isValid Whether the timestamp is valid
      */
     function _isValidTimestamp(uint256 timestamp, bool allowFuture) internal view returns (bool) {
         uint256 currentTime = block.timestamp;
         
         // Check if timestamp is too far in the past
         if (timestamp + MAX_PAST_TOLERANCE < currentTime) {
             return false;
         }
         
         // Check if timestamp is in the future
         if (timestamp > currentTime) {
             if (!allowFuture) {
                 return false;
             }
             // Allow small future tolerance for clock skew
             if (timestamp > currentTime + MAX_FUTURE_TOLERANCE) {
                 return false;
             }
         }
         
         return true;
     }
     
     /**
      * @dev Validates time range with tolerance
      * @param startTime Start of the time range
      * @param endTime End of the time range
      * @param checkTime Time to check against the range
      * @return isValid Whether the time is within the valid range
      */
     function _isTimeInRange(uint256 startTime, uint256 endTime, uint256 checkTime) internal pure returns (bool) {
         // Add tolerance to the range to prevent edge case issues
         return checkTime >= startTime && checkTime <= endTime + TIMESTAMP_TOLERANCE;
     }

     /**
      * @dev Safe timestamp comparison for ordering
      * @param timestamp1 First timestamp
      * @param timestamp2 Second timestamp
      * @return isAfter Whether timestamp1 is after timestamp2 (with tolerance)
      */
     function _timestampAfter(uint256 timestamp1, uint256 timestamp2) internal pure returns (bool) {
         return timestamp1 > timestamp2 + TIMESTAMP_TOLERANCE;
     }
 }