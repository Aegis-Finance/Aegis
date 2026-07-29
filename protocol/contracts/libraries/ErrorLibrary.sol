// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title ErrorLibrary
 * @notice Centralized error definitions for the Aegis ecosystem
 * @dev This library consolidates all custom errors to reduce code duplication
 */
library ErrorLibrary {
    // ============ COMMON ERRORS ============
    error InvalidProofLength();
    error InsufficientBalance();
    error InvalidAddress();
    error ZeroAddress();
    error ZeroAmount();
    error UnauthorizedAccess();
    error InvalidAmount();
    error AmountMustBeGreaterThanZero();
    error EmptyArray();
    error ArrayLengthMismatch();
    error MismatchedArrays();
    error StringTooLong();
    error StringTooShort();
    error TransferFailed();
    error NotOwner();
    error OnlyOwner();
    error NotContractOwner();
    error IndexOutOfBounds();
    error InvalidInputLength();

    // ============ CAMPAIGN ERRORS ============
    error CampaignNotFound();
    error CampaignNotActive();
    error CampaignDeadlinePassed();
    error CampaignAlreadyRegistered();
    error CampaignNotEligibleForFeedback();
    error NotCampaignCreator();
    error CampaignManagementNotActive();
    error InvalidCampaignId();

    // ============ MILESTONE ERRORS ============
    error MilestoneNotFound();
    error MilestoneDoesNotExist();
    error MilestoneAlreadyComplete();
    error MilestoneNotPending();
    error MilestoneNotActive();
    error MilestoneDeadlinePassed();
    error MilestoneNotSubmitted();
    error MilestoneNotApproved();
    error MilestoneNotFoundInCampaign();
    error InsufficientFundingForMilestone();
    error InvalidMilestoneConfiguration();
    error NoMoreMilestones();
    error ManagementAlreadyExists();
    error InvalidDescriptionHash();
    error InvalidTargetAmount();
    error InvalidDuration();
    error InvalidDeliverableHash();
    error InvalidEvidenceHash();

    // ============ BOND ERRORS ============
    error BondNotActiveOrAlreadySlashed();
    error BondReleaseFailed();
    error BondStillLocked();
    error SlashAmountExceedsBond();
    error InvalidBondIndex();
    error InsufficientBondAmount();

    // ============ REPUTATION ERRORS ============
    error InsufficientReputation();
    error InvalidRating();
    error InvalidWeightSum();
    error InvalidRange();
    error InvalidMetricValue();
    error InvalidComplexityScore();
    error InvalidPrivacyScore();
    error InvalidRiskScore();

    // ============ PROFILE ERRORS ============
    error CreatorProfileRequired();
    error CreatorProfileDoesNotExist();
    error InvalidProfileDescription();
    error InvalidProfileName();
    error DescriptionTooLong();
    error InvalidSkillName();
    error InvalidEndorsementText();
    error EndorsementTextTooLong();
    error FeedbackTextTooLong();
    error FeedbackAlreadyProvided();

    // ============ VOTING & GOVERNANCE ERRORS ============
    error ProposalNotFound();
    error InvalidProposalId();
    error ProposalNotActive();
    error ProposalExpired();
    error ProposalAlreadyExecuted();
    error ProposalNotQueued();
    error ExecutionDelayNotMet();
    error ProposalExecutionFailed();
    error ProposalNotSucceeded();
    error VotingPeriodEnded();
    error VotingPeriodNotStarted();
    error VotingStillActive();
    error NoVotingPower();
    error InsufficientVotingPower();
    error InvalidVotingPower();
    error InsufficientQuorum();
    error InsufficientVoterThreshold();
    error AlreadyVoted();
    error AlreadyRegisteredAsReviewer();
    error MustBeContributorToReview();
    error NotRegisteredAsReviewer();

    // ============ ZK PROOF ERRORS ============
    error InvalidZKProof();
    error NullifierAlreadyUsed();
    error CommitmentAlreadyExists();
    error CommitmentNotFound();
    error InvalidCommitment();
    error InvalidProof();
    error InvalidVerifier();
    error InvalidVerifierAddress();
    error ProofVerificationFailed();
    error InvalidPublicInputs();
    error InvalidPublicInputsLength();
    error InvalidVerificationKey();
    error InvalidFieldElement();
    error CannotComputeInverseOfZero();
    error CannotInvertZeroInFp2();
    error InvalidCurvePoint();
    error InvalidProofFormat();
    error ProofExpired();
    error ProofNotVerified();
    error InvalidProofType();
    error ProofTimestampTooFuture();
    error ProofTimestampTooOld();
    error ProofAlreadyVerified();
    error InvalidProofHash();

    // ============ REFUND ERRORS ============
    error RefundsNotEnabled();
    error RefundDeadlinePassed();
    error MaxRefundsReached();
    error ContributorLimitReached();
    error ContributorAlreadyRefunded();
    error InsufficientRefundPool();
    error RefundAlreadyProcessed();
    error RefundNotApproved();
    error InvalidRefundAmount();
    error RefundRequestNotFound();
    error RefundFailed();
    error NoFundsToRefund();
    error RefundNotAvailable();

    // ============ CONTRIBUTION ERRORS ============
    error MaxContributionsReached();
    error NotVerifiedBacker();
    error InsufficientStake();
    error InsufficientStakeAmount();
    error CannotStakeZero();

    // ============ REVIEW ERRORS ============
    error MaxReviewsReached();
    error ReviewerLimitReached();
    error ReviewerAlreadyReviewed();

    // ============ CEREMONY ERRORS ============
    error CircuitNotConfigured();
    error CeremonyNotActive();
    error CeremonyAlreadyFinalized();
    error ParticipantAlreadyJoined();
    error MaxParticipantsReached();
    error ContributionDeadlinePassed();
    error InvalidContribution();
    error CeremonyNotFound();
    error UnauthorizedParticipant();

    // ============ ANALYTICS ERRORS ============
    error AnalysisNotActive();
    error InsufficientData();
    error UpdateTooFrequent();
    error InvalidActionType();
    error ActorNotFound();
    error UpdateIntervalTooShort();
    error ActivityThresholdTooShort();
    error MinActionsTooLow();

    // ============ REWARD ERRORS ============
    error PoolAlreadyFinalized();
    error InsufficientPoolBalance();
    error NoRewardAvailable();
    error RewardAlreadyClaimed();
    error InvalidRewardMetrics();
    error InvalidTemporalAdjustment();
    error InvalidMarketProcessFactors();
    error InvalidTotalAmount();
    error MaxRewardTooHigh();
    error InvalidWeights();
    error InvalidTimeWindow();
    error InvalidDecayFactor();
    error PoolNotEnded();

    // ============ PROJECT ERRORS ============
    error NotProjectCreator();
    error ProjectDoesNotExist();
    error ProjectAlreadyRegistered();
    error InvalidTitleLength();
    error TooManyTags();
    error InvalidPromotionLevel();
    error InvalidCategory();
    error InvalidPromotionPackage();
    error InsufficientPayment();
    error InteractionAlreadyRecorded();
    error RatingDisabled();
    error InvalidCategoryName();
    error CategoryAlreadyExists();

    // ============ ESCROW ERRORS ============
    error EscrowDoesNotExist();
    error EscrowAlreadyExists();
    error OnlyCrowdShieldCanDeposit();
    error AmountMustBePositive();
    error MilestoneEscrowDisabled();
    error InsufficientAvailableFunds();
    error InvalidUnlockTime();
    error InvalidLockIndex();
    error FundsAlreadyUnlocked();
    error NotMilestoneLock();
    error LockPeriodNotExpired();
    error ReleaseDelayNotMet();
    error ETHTransferFailed();
    error ETHRefundFailed();
    error EmergencyWithdrawalDisabled();
    error EscrowFeeTooHigh();
    error InterestFeeTooHigh();
    error EmergencyFeeTooHigh();
    error InterestRateTooHigh();
    error InvalidReleaseDelay();

    // ============ PERCENTAGE & VALIDATION ERRORS ============
    error InvalidPercentage();

    // ============ TIMESTAMP ERRORS ============
    error FutureTimestamp();
    error FutureTimestampNotAllowed();
    error TimestampTooOld();
    error ActionTooOld();
    error SubmissionTooOld();
    error VoteTimestampTooFarInFuture();
    error VoteTimestampTooOld();
    error RequestTimestampTooFarInFuture();
    error RequestTimestampTooOld();
    error TimestampOverflow();
    error InvalidIncidentTimestamp();
    error InvalidCeremonyTimestamp();

    // ============ GOVERNANCE SPECIFIC ERRORS ============
    error UnauthorizedOperation();
    error UnauthorizedGovernanceAccess();
    error InvalidGovernanceAddress();
    error InvalidGovernanceParameter();
    error GovernanceAlreadySet();
    error GovernanceExecutionFailed();
    error InvalidProposalThreshold();
    error InvalidQuorumThreshold();
    error InvalidVotingPeriod();
    error InvalidProposalType();
    error CannotCancelProposal();
    error NoActionsProvided();
    error TooManyActions();
    error EmptyTitle();
    error EmptyDescription();
    error TooManyTargets();
    error NoTargetsToExecute();
    error InsufficientGasForExecution();
    error InvalidTargetAddress();
    error TargetNotContract();
    error GasLimitTooHigh();

    // ============ MERKLE TREE ERRORS ============
    error InvalidMerkleRoot();
    error InvalidMerkleProof();
    error InvalidMerkleRootValue();

    // ============ DAO ERRORS ============
    error DAOVoteNotFound();
    error DAOVoteNotPassed();

    // ============ MULTISIG ERRORS ============
    error InvalidOwners();
    error InvalidOwner();
    error OwnerAlreadyExists();
    error InvalidThreshold();
    error MultiSigAlreadyExists();
    error InvalidMultiSig();
    error InsufficientOwners();
    error InvalidOwnerCount();
    error CannotRemoveLastOwner();
    error TransactionNotExists();
    error TransactionAlreadyExecuted();
    error TransactionAlreadyConfirmed();
    error TransactionNotConfirmed();
    error InsufficientConfirmations();
    error TransactionFailed();

    // ============ POOL & LIQUIDITY ERRORS ============
    error PoolNotFound();
    error PoolAlreadyExists();
    error PoolNotActive();
    error PoolEnded();
    error InvalidPoolId();
    error InvalidPoolAddress();
    error InsufficientLiquidity();
    error InsufficientReserves();
    error ZeroLiquidity();
    error InsufficientInitialLiquidity();
    error InvalidPoolReserves();
    error InvalidTotalLiquidity();
    error InsufficientLiquidityMinted();
    error InsufficientOutputAmounts();
    error InvalidAmounts();
    error KInvariantViolated();
    error InvalidSwapAmount();
    error SlippageExceeded();
    error TransactionDeadlineExceeded();
    error InvalidTokenPair();
    error InvalidTokenAddress();
    error TokenAlreadySet();
    error TokenNotSet();
    error TokenTransferFailed();

    // ============ STAKING ERRORS ============
    error InvalidStakeAmount();
    error AmountBelowMinimum();
    error AmountAboveMaximum();
    error LockDurationTooShort();
    error LockDurationTooLong();
    error PositionNotActive();
    error CannotUnstakeZero();
    error AmountExceedsStake();
    error UnstakeNotReady();
    error UnstakeDelayNotMet();
    error InvalidRewardRate();
    error InvalidMinStake();
    error InvalidMaxStake();
    error NoRewardsAvailable();
    error NoRewardsToClaim();
    error NoRewardsToCompound();
    error InsufficientRewardPoolBalance();
    error InsufficientRewardBalance();
    error InsufficientRewardPool();
    error InvalidRewardConfiguration();
    error RewardPeriodNotEnded();
    error InsufficientEndorsementStake();
    error InsufficientIncentiveTransfer();

    // ============ EPOCH ERRORS ============
    error InvalidEpoch();
    error EpochNotReady();
    error FutureEpoch();
    error EpochTooOld();
    error EpochAlreadyFinalized();
    error CannotFinalizeCurrentEpoch();
    error CurrentSeasonNotEnded();

    // ============ BATCH PROCESSING ERRORS ============
    error BatchNotFound();
    error InvalidBatchSize();
    error BatchTooSmall();
    error BatchTooLarge();
    error BatchAlreadyVerified();
    error BatchNotPending();
    error BatchNotReadyForVerification();
    error BatchVerificationFailed();
    error InvalidProofCount();
    error EmptyBatchNotAllowed();
    error BatchLimitPerBlockExceeded();
    error ExceedsMaxVerificationsPerBlock();
    error InsufficientGasForBatch();
    error NullifierAlreadyUsedInBatch();
    error NoSubmissionsProcessedSuccessfully();

    // ============ VERIFIER FACTORY ERRORS ============
    error VerifierAlreadyExists();
    error VerifierNotFound();
    error VerifierCallFailed();
    error VerifierNotAvailable();
    error InvalidFactoryAddress();
    error CircuitTypeNotSupported();
    error EmptyCircuitType();
    error InvalidCeremonyMetadata();
    error CeremonyNotValidated();
    error ProductionKeyRequired();
    error DevelopmentKeyInProduction();
    error ProductionKeyViolation();
    error ImmutableVerifierViolation();
    error InsufficientParticipants();
    error EmptyCircuitName();

    // ============ INSURANCE ERRORS ============
    error InvalidPolicyId();
    error PolicyNotActive();
    error CoverageTooLow();
    error CoverageTooHigh();
    error PeriodTooShort();
    error PeriodTooLong();
    error InvalidDeductible();
    error InvalidClaimAmount();
    error IncidentOutsideCoveragePeriod();
    error ClaimPeriodExpired();
    error ClaimExceedsMaxAmount();
    error InvalidClaimId();
    error ClaimNotPending();
    error ClaimNotApproved();
    error AssessorNullifierUsed();
    error InvalidAssessmentScore();
    error InsufficientPoolFunds();

    // ============ DERIVATIVES ERRORS ============
    error InvalidContractId();
    error ContractNotActive();
    error ContractExpired();
    error ContractNotExpired();
    error ExpiryTooSoon();
    error ExpiryTooFar();
    error InvalidStrikePrice();
    error InvalidNotionalAmount();
    error InvalidPremium();
    error CannotExerciseFutures();
    error EuropeanOptionExerciseRestriction();

    // ============ ORACLE ERRORS ============
    error InvalidPrice();
    error PriceNotAvailable();
    error PriceTooStale();
    error PriceDataIsStale();
    error InvalidOracleAddress();
    error NoOracleSetForAsset();
    error OraclePriceInvalid();
    error OracleRoundNotComplete();
    error PriceDeviationTooHigh();
    error InsufficientOracleConfirmations();
    error InvalidUpdateInterval();
    error UnauthorizedKeeper();
    error UnauthorizedOracle();

    // ============ LENDING ERRORS ============
    error InsufficientCollateral();
    error LoanNotFound();
    error LoanNotActive();
    error InvalidLoanAmount();
    error CollateralNotLiquidatable();
    error ExcessiveLiquidation();
    error InsufficientRepayment();

    // ============ SOVEREIGNTY ERRORS ============
    error SovereignNotRegistered();
    error SovereignAlreadyRegistered();
    error InvalidLibertyNickname();
    error LibertyNicknameTooLong();
    error InvalidAustrianMentor();
    error NoActiveLibertyCycle();
    error IndividualActionCooldownActive();
    error InvalidCompetitionName();
    error InvalidPrizePool();
    error InvalidMaxParticipants();
    error CompetitionNotFound();
    error CompetitionNotActive();
    error CompetitionEnded();
    error CompetitionNotEnded();
    error CompetitionFull();
    error AlreadyJoined();

    // ============ MINING ERRORS ============
    error DailyMiningCapExceeded();
    error InsufficientPrivacyMiningPool();
    error InsufficientZKProofRewardPool();
    error AirdropAlreadyClaimedForRoot();
    error InsufficientAirdropPool();
    error NoFundingProvided();

    // ============ EMERGENCY ERRORS ============
    error InvalidEmergencyState();
    error InvalidEmergencyType();
    error EmergencyAlreadyExecuted();
    error ThresholdNotMet();
    error InvalidTargets();
    error CircuitBreaker();
    error UnauthorizedEmergencyType();
    error CircuitNotCompromised();
    error InvalidEvidence();

    // ============ ALLOCATION ERRORS ============
    error AllocationAlreadyCompleted();
    error AllocationAddressNotSet();
    error InsufficientTokenBalance();
    error AllocationMismatch();
    error InvalidAllocation();
    error InvalidBeneficiary();
    error CliffNotReached();
    error NoTokensAvailable();
    error VestingNotStarted();
    error VestingNotFound();
    error VestingAlreadyRevoked();
    error InsufficientVestedTokens();
    error CliffExceedsDuration();
    error VestingAlreadyExists();
    error NoVestingSchedule();
    error VestingRevokedError();
    error NoTokensToRelease();
    error VestingNotRevocable();
    error AlreadyRevoked();
    error UnauthorizedCaller();

    // ============ TOKEN ERRORS ============
    error InvalidGovernanceContract();
    error DelegationRestrictedError();
    error DelegationCooldownActive();
    error InvalidTier();
    error InvalidMultiplier();
    error SenderSanctioned();
    error SenderNotCompliant();
    error RecipientSanctioned();
    error RecipientNotCompliant();

    // ============ CROWDFUNDING SPECIFIC ERRORS ============
    error InvalidCrowdShieldAddress();
    error InvalidCampaignManagerAddress();
    error InvalidDashboardAddress();

    // ============ PROCESSOR ERRORS ============
    error NotActiveProcessor();
    error NotJobProcessor();
    error JobNotProcessing();
    error CannotDeregisterWithActiveJobs();
    error AlreadyRegistered();
    error NoAvailableProcessor();
    error InvalidCapacity();
    error TargetBatchSizeTooSmall();
    error TargetBatchSizeTooLarge();
    error InvalidWaitTime();
    error InvalidCompressionThreshold();
    error InvalidGasOptimizationTarget();
    error InsufficientGasSavings();

    // ============ RECURSION ERRORS ============
    error InvalidRecursionDepth();
    error MaxRecursionExceeded();
    error ChildProofNotFound();

    // ============ DISTRIBUTION ERRORS ============
    error InvalidDistributionConfig();
    error DistributionTooEarly();
    error InvalidInterval();
    error FeeMRegistrationFailed();

    // ============ SUPPLY ERRORS ============
    error SupplyCapExceeded();
    error InitialSupplyExceedsMaximum();

    // ============ CONTRACT AUTHORIZATION ERRORS ============
    error UnauthorizedContract();
    error InvalidContractAddress();

    // ============ DELEGATION ERRORS ============
    error NoPowerToDelegate();
    error CannotDelegateToSelf();
    error NoActiveDelegation();
}
