// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title ICommonErrors
 * @author Aegis Protocol Team
 * @dev Shared interface for common error definitions across the Aegis ecosystem
 * @notice Centralizes error definitions to prevent duplicate declarations and maintain consistency
 */
interface ICommonErrors {
    // ============ GENERAL ERRORS ============
    /// @notice Thrown when a proof has an invalid length
    error InvalidProofLength();
    
    /// @notice Thrown when there is insufficient balance for an operation
    error InsufficientBalance();
    
    /// @notice Thrown when an invalid address is provided
    error InvalidAddress();
    
    /// @notice Thrown when a zero address is provided
    error ZeroAddress();
    
    /// @notice Thrown when a zero amount is provided
    error ZeroAmount();
    
    /// @notice Thrown when unauthorized access is attempted
    error UnauthorizedAccess();
    
    /// @notice Thrown when an invalid amount is provided
    error InvalidAmount();
    
    /// @notice Thrown when amount must be greater than zero
    error AmountMustBeGreaterThanZero();
    
    /// @notice Thrown when an empty array is provided
    error EmptyArray();
    
    /// @notice Thrown when array lengths don't match
    error ArrayLengthMismatch();
    
    /// @notice Thrown when array lengths are mismatched
    error MismatchedArrays();
    
    /// @notice Thrown when a string is too long
    error StringTooLong();
    
    /// @notice Thrown when a string is too short
    error StringTooShort();
    
    /// @notice Thrown when a transfer fails
    error TransferFailed();
    
    /// @notice Thrown when only owner can perform action
    error NotOwner();
    
    /// @notice Thrown when only owner can perform action
    error OnlyOwner();
    
    /// @notice Thrown when caller is not contract owner
    error NotContractOwner();
    
    /// @notice Thrown when index is out of bounds
    error IndexOutOfBounds();
    
    /// @notice Thrown when input length is invalid
    error InvalidInputLength();
    
    // ============ BOND MANAGEMENT ERRORS ============
    /// @notice Thrown when a bond is not active or has already been slashed
    error BondNotActiveOrAlreadySlashed();
    
    /// @notice Thrown when a bond release operation fails
    error BondReleaseFailed();
    
    /// @notice Thrown when attempting to release a bond that is still locked
    error BondStillLocked();
    
    /// @notice Thrown when slash amount exceeds the bond amount
    error SlashAmountExceedsBond();
    
    /// @notice Thrown when bond index is invalid
    error InvalidBondIndex();
    
    /// @notice Thrown when bond amount is insufficient
    error InsufficientBondAmount();
    
    // ============ CAMPAIGN MANAGEMENT ERRORS ============
    /// @notice Thrown when caller is not the campaign creator
    error NotCampaignCreator();
    
    /// @notice Thrown when campaign management is not active
    error CampaignManagementNotActive();
    
    /// @notice Thrown when milestone does not exist
    error MilestoneDoesNotExist();
    
    /// @notice Thrown when management already exists
    error ManagementAlreadyExists();
    
    /// @notice Thrown when milestone configuration is invalid
    error InvalidMilestoneConfiguration();
    
    /// @notice Thrown when description hash is invalid
    error InvalidDescriptionHash();
    
    /// @notice Thrown when target amount is invalid
    error InvalidTargetAmount();
    
    /// @notice Thrown when duration is invalid
    error InvalidDuration();
    
    /// @notice Thrown when deliverable hash is invalid
    error InvalidDeliverableHash();
    
    /// @notice Thrown when voter threshold is insufficient
    error InsufficientVoterThreshold();
    
    /// @notice Thrown when there are no more milestones
    error NoMoreMilestones();
    
    /// @notice Thrown when milestone is not pending
    error MilestoneNotPending();
    
    /// @notice Thrown when funding is insufficient for milestone
    error InsufficientFundingForMilestone();
    
    /// @notice Thrown when milestone is not active
    error MilestoneNotActive();
    
    /// @notice Thrown when milestone deadline has passed
    error MilestoneDeadlinePassed();
    
    /// @notice Thrown when evidence hash is invalid
    error InvalidEvidenceHash();
    
    /// @notice Thrown when milestone is not submitted
    error MilestoneNotSubmitted();
    
    /// @notice Thrown when already registered as reviewer
    error AlreadyRegisteredAsReviewer();
    
    /// @notice Thrown when must be contributor to review
    error MustBeContributorToReview();
    
    /// @notice Thrown when not registered as reviewer
    error NotRegisteredAsReviewer();
    
    /// @notice Thrown when already voted
    error AlreadyVoted();
    
    /// @notice Thrown when milestone is not approved
    error MilestoneNotApproved();
    
    /// @notice Thrown when milestone is not found in campaign
    error MilestoneNotFoundInCampaign();
    
    /// @notice Thrown when campaign is already registered
    error CampaignAlreadyRegistered();
    
    /// @notice Thrown when campaign is not eligible for feedback
    error CampaignNotEligibleForFeedback();
    
    // ============ ZK PROOF ERRORS ============
    /// @notice Thrown when ZK proof is invalid
    error InvalidZKProof();
    
    /// @notice Thrown when nullifier is already used
    error NullifierAlreadyUsed();
    
    /// @notice Thrown when commitment already exists
    error CommitmentAlreadyExists();
    
    /// @notice Thrown when commitment is not found
    error CommitmentNotFound();
    
    /// @notice Thrown when commitment is invalid
    error InvalidCommitment();
    
    /// @notice Thrown when proof is invalid
    error InvalidProof();
    
    /// @notice Thrown when verifier is invalid
    error InvalidVerifier();
    
    /// @notice Thrown when verifier address is invalid
    error InvalidVerifierAddress();
    
    /// @notice Thrown when proof verification fails
    error ProofVerificationFailed();
    
    /// @notice Thrown when public inputs are invalid
    error InvalidPublicInputs();
    
    /// @notice Thrown when public inputs length is invalid
    error InvalidPublicInputsLength();
    
    /// @notice Thrown when verification key is invalid
    error InvalidVerificationKey();
    
    /// @notice Thrown when field element is invalid
    error InvalidFieldElement();
    
    /// @notice Thrown when cannot compute inverse of zero
    error CannotComputeInverseOfZero();
    
    /// @notice Thrown when cannot invert zero in Fp2
    error CannotInvertZeroInFp2();
    
    /// @notice Thrown when curve point is invalid
    error InvalidCurvePoint();
    
    /// @notice Thrown when proof format is invalid
    error InvalidProofFormat();
    
    /// @notice Thrown when proof is expired
    error ProofExpired();
    
    /// @notice Thrown when proof is not verified
    error ProofNotVerified();
    
    /// @notice Thrown when proof type is invalid
    error InvalidProofType();
    
    /// @notice Thrown when proof timestamp is too far in future
    error ProofTimestampTooFuture();
    
    /// @notice Thrown when proof timestamp is too old
    error ProofTimestampTooOld();
    
    /// @notice Thrown when proof already verified
    error ProofAlreadyVerified();
    
    /// @notice Thrown when proof hash is invalid
    error InvalidProofHash();
    
    // ============ TIMESTAMP ERRORS ============
    /// @notice Thrown when timestamp is in the future
    error FutureTimestamp();
    
    /// @notice Thrown when future timestamp is not allowed
    error FutureTimestampNotAllowed();
    
    /// @notice Thrown when timestamp is too old
    error TimestampTooOld();
    
    /// @notice Thrown when action is too old
    error ActionTooOld();
    
    /// @notice Thrown when submission is too old
    error SubmissionTooOld();
    
    /// @notice Thrown when vote timestamp is too far in future
    error VoteTimestampTooFarInFuture();
    
    /// @notice Thrown when vote timestamp is too old
    error VoteTimestampTooOld();
    
    /// @notice Thrown when request timestamp is too far in future
    error RequestTimestampTooFarInFuture();
    
    /// @notice Thrown when request timestamp is too old
    error RequestTimestampTooOld();
    
    /// @notice Thrown when timestamp overflow occurs
    error TimestampOverflow();
    
    /// @notice Thrown when incident timestamp is invalid
    error InvalidIncidentTimestamp();
    
    /// @notice Thrown when ceremony timestamp is invalid
    error InvalidCeremonyTimestamp();
    
    // ============ GOVERNANCE ERRORS ============
    /// @notice Thrown when proposal is not found
    error ProposalNotFound();
    
    /// @notice Thrown when proposal ID is invalid
    error InvalidProposalId();
    
    /// @notice Thrown when proposal is not active
    error ProposalNotActive();
    
    /// @notice Thrown when proposal is expired
    error ProposalExpired();
    
    /// @notice Thrown when proposal is already executed
    error ProposalAlreadyExecuted();
    
    /// @notice Thrown when proposal is not queued
    error ProposalNotQueued();
    
    /// @notice Thrown when execution delay is not met
    error ExecutionDelayNotMet();
    
    /// @notice Thrown when proposal execution fails
    error ProposalExecutionFailed();
    
    /// @notice Thrown when proposal is not succeeded
    error ProposalNotSucceeded();
    
    /// @notice Thrown when voting period has ended
    error VotingPeriodEnded();
    
    /// @notice Thrown when voting period has not started
    error VotingPeriodNotStarted();
    
    /// @notice Thrown when voting is still active
    error VotingStillActive();
    
    /// @notice Thrown when there is no voting power
    error NoVotingPower();
    
    /// @notice Thrown when voting power is insufficient
    error InsufficientVotingPower();
    
    /// @notice Thrown when voting power is invalid
    error InvalidVotingPower();
    
    /// @notice Thrown when there is no power to delegate
    error NoPowerToDelegate();
    
    /// @notice Thrown when cannot delegate to self
    error CannotDelegateToSelf();
    
    /// @notice Thrown when there is no active delegation
    error NoActiveDelegation();
    
    /// @notice Thrown when cannot cancel proposal
    error CannotCancelProposal();
    
    /// @notice Thrown when no actions are provided
    error NoActionsProvided();
    
    /// @notice Thrown when too many actions are provided
    error TooManyActions();
    
    /// @notice Thrown when title is empty
    error EmptyTitle();
    
    /// @notice Thrown when description is empty
    error EmptyDescription();
    
    /// @notice Thrown when too many targets are provided
    error TooManyTargets();
    
    /// @notice Thrown when no targets to execute
    error NoTargetsToExecute();
    
    /// @notice Thrown when insufficient gas for execution
    error InsufficientGasForExecution();
    
    /// @notice Thrown when target address is invalid
    error InvalidTargetAddress();
    
    /// @notice Thrown when target is not a contract
    error TargetNotContract();
    
    /// @notice Thrown when gas limit is too high
    error GasLimitTooHigh();
    
    /// @notice Thrown when merkle root is invalid
    error InvalidMerkleRoot();
    
    /// @notice Thrown when merkle proof is invalid
    error InvalidMerkleProof();
    
    /// @notice Thrown when merkle root value is invalid
    error InvalidMerkleRootValue();
    
    /// @notice Thrown when DAO vote is not found
    error DAOVoteNotFound();
    
    /// @notice Thrown when DAO vote has not passed
    error DAOVoteNotPassed();
    
    /// @notice Thrown when quorum is insufficient
    error InsufficientQuorum();
    
    /// @notice Thrown when unauthorized operation is attempted
    error UnauthorizedOperation();
    
    /// @notice Thrown when unauthorized governance access is attempted
    error UnauthorizedGovernanceAccess();
    
    /// @notice Thrown when governance address is invalid
    error InvalidGovernanceAddress();
    
    /// @notice Thrown when governance parameter is invalid
    error InvalidGovernanceParameter();
    
    /// @notice Thrown when governance already set
    error GovernanceAlreadySet();
    
    /// @notice Thrown when governance execution fails
    error GovernanceExecutionFailed();
    
    /// @notice Thrown when proposal threshold is invalid
    error InvalidProposalThreshold();
    
    /// @notice Thrown when quorum threshold is invalid
    error InvalidQuorumThreshold();
    
    /// @notice Thrown when voting period is invalid
    error InvalidVotingPeriod();
    
    /// @notice Thrown when proposal type is invalid
    error InvalidProposalType();
    
    // ============ MULTISIG ERRORS ============
    /// @notice Thrown when owners are invalid
    error InvalidOwners();
    
    /// @notice Thrown when owner is invalid
    error InvalidOwner();
    
    /// @notice Thrown when owner already exists
    error OwnerAlreadyExists();
    
    /// @notice Thrown when threshold is invalid
    error InvalidThreshold();
    
    /// @notice Thrown when multisig already exists
    error MultiSigAlreadyExists();
    
    /// @notice Thrown when multisig is invalid
    error InvalidMultiSig();
    
    /// @notice Thrown when there are insufficient owners
    error InsufficientOwners();
    
    /// @notice Thrown when owner count is invalid
    error InvalidOwnerCount();
    
    /// @notice Thrown when cannot remove last owner
    error CannotRemoveLastOwner();
    
    /// @notice Thrown when transaction does not exist
    error TransactionNotExists();
    
    /// @notice Thrown when transaction is already executed
    error TransactionAlreadyExecuted();
    
    /// @notice Thrown when transaction is already confirmed
    error TransactionAlreadyConfirmed();
    
    /// @notice Thrown when transaction is not confirmed
    error TransactionNotConfirmed();
    
    /// @notice Thrown when confirmations are insufficient
    error InsufficientConfirmations();
    
    /// @notice Thrown when transaction fails
    error TransactionFailed();
    
    // ============ POOL/LIQUIDITY ERRORS ============
    /// @notice Thrown when pool is not found
    error PoolNotFound();
    
    /// @notice Thrown when pool already exists
    error PoolAlreadyExists();
    
    /// @notice Thrown when pool is not active
    error PoolNotActive();
    
    /// @notice Thrown when pool has ended
    error PoolEnded();
    
    /// @notice Thrown when pool ID is invalid
    error InvalidPoolId();
    
    /// @notice Thrown when pool address is invalid
    error InvalidPoolAddress();
    
    /// @notice Thrown when liquidity is insufficient
    error InsufficientLiquidity();
    
    /// @notice Thrown when reserves are insufficient
    error InsufficientReserves();
    
    /// @notice Thrown when liquidity is zero
    error ZeroLiquidity();
    
    /// @notice Thrown when initial liquidity is insufficient
    error InsufficientInitialLiquidity();
    
    /// @notice Thrown when pool reserves are invalid
    error InvalidPoolReserves();
    
    /// @notice Thrown when total liquidity is invalid
    error InvalidTotalLiquidity();
    
    /// @notice Thrown when liquidity minted is insufficient
    error InsufficientLiquidityMinted();
    
    /// @notice Thrown when output amounts are insufficient
    error InsufficientOutputAmounts();
    
    /// @notice Thrown when amounts are invalid
    error InvalidAmounts();
    
    /// @notice Thrown when K invariant is violated
    error KInvariantViolated();
    
    /// @notice Thrown when swap amount is invalid
    error InvalidSwapAmount();
    
    /// @notice Thrown when slippage is exceeded
    error SlippageExceeded();
    
    /// @notice Thrown when transaction deadline is exceeded
    error TransactionDeadlineExceeded();
    
    /// @notice Thrown when token pair is invalid
    error InvalidTokenPair();
    
    /// @notice Thrown when token address is invalid
    error InvalidTokenAddress();
    
    /// @notice Thrown when token is already set
    error TokenAlreadySet();
    
    /// @notice Thrown when token is not set
    error TokenNotSet();
    
    /// @notice Thrown when token transfer fails
    error TokenTransferFailed();
    
    // ============ STAKING/REWARDS ERRORS ============
    /// @notice Thrown when stake amount is invalid
    error InvalidStakeAmount();
    
    /// @notice Thrown when stake amount is insufficient
    error InsufficientStakeAmount();
    
    /// @notice Thrown when cannot stake zero
    error CannotStakeZero();
    
    /// @notice Thrown when amount is below minimum
    error AmountBelowMinimum();
    
    /// @notice Thrown when amount is above maximum
    error AmountAboveMaximum();
    
    /// @notice Thrown when lock duration is too short
    error LockDurationTooShort();
    
    /// @notice Thrown when lock duration is too long
    error LockDurationTooLong();
    
    /// @notice Thrown when position is not active
    error PositionNotActive();
    
    /// @notice Thrown when cannot unstake zero
    error CannotUnstakeZero();
    
    /// @notice Thrown when amount exceeds stake
    error AmountExceedsStake();
    
    /// @notice Thrown when unstake is not ready
    error UnstakeNotReady();
    
    /// @notice Thrown when unstake delay is not met
    error UnstakeDelayNotMet();
    
    /// @notice Thrown when reward rate is invalid
    error InvalidRewardRate();
    
    /// @notice Thrown when minimum stake is invalid
    error InvalidMinStake();
    
    /// @notice Thrown when maximum stake is invalid
    error InvalidMaxStake();
    
    /// @notice Thrown when no rewards are available
    error NoRewardsAvailable();
    
    /// @notice Thrown when no reward is available (singular form)
    error NoRewardAvailable();
    
    /// @notice Thrown when no rewards to claim
    error NoRewardsToClaim();
    
    /// @notice Thrown when reward has already been claimed
    error RewardAlreadyClaimed();
    
    /// @notice Thrown when no rewards to compound
    error NoRewardsToCompound();
    
    /// @notice Thrown when reward pool balance is insufficient
    error InsufficientRewardPoolBalance();
    
    /// @notice Thrown when reward balance is insufficient
    error InsufficientRewardBalance();
    
    /// @notice Thrown when reward pool is insufficient
    error InsufficientRewardPool();
    
    /// @notice Thrown when reward configuration is invalid
    error InvalidRewardConfiguration();
    
    /// @notice Thrown when reward period has not ended
    error RewardPeriodNotEnded();
    
    /// @notice Thrown when endorsement stake is insufficient
    error InsufficientEndorsementStake();
    
    /// @notice Thrown when incentive transfer is insufficient
    error InsufficientIncentiveTransfer();
    
    // ============ EPOCH/TIME ERRORS ============
    /// @notice Thrown when epoch is invalid
    error InvalidEpoch();
    
    /// @notice Thrown when epoch is not ready
    error EpochNotReady();
    
    /// @notice Thrown when epoch is in the future
    error FutureEpoch();
    
    /// @notice Thrown when epoch is too old
    error EpochTooOld();
    
    /// @notice Thrown when epoch is already finalized
    error EpochAlreadyFinalized();
    
    /// @notice Thrown when cannot finalize current epoch
    error CannotFinalizeCurrentEpoch();
    
    /// @notice Thrown when current season has not ended
    error CurrentSeasonNotEnded();
    
    // ============ BATCH/AGGREGATION ERRORS ============
    /// @notice Thrown when batch is not found
    error BatchNotFound();
    
    /// @notice Thrown when batch size is invalid
    error InvalidBatchSize();
    
    /// @notice Thrown when batch is too small
    error BatchTooSmall();
    
    /// @notice Thrown when batch is too large
    error BatchTooLarge();
    
    /// @notice Thrown when batch is already verified
    error BatchAlreadyVerified();
    
    /// @notice Thrown when batch is not pending
    error BatchNotPending();
    
    /// @notice Thrown when batch is not ready for verification
    error BatchNotReadyForVerification();
    
    /// @notice Thrown when batch verification fails
    error BatchVerificationFailed();
    
    /// @notice Thrown when proof count is invalid
    error InvalidProofCount();
    
    /// @notice Thrown when empty batch is not allowed
    error EmptyBatchNotAllowed();
    
    /// @notice Thrown when batch limit per block is exceeded
    error BatchLimitPerBlockExceeded();
    
    /// @notice Thrown when max verifications per block are exceeded
    error ExceedsMaxVerificationsPerBlock();
    
    /// @notice Thrown when insufficient gas for batch
    error InsufficientGasForBatch();
    
    /// @notice Thrown when nullifier is already used in batch
    error NullifierAlreadyUsedInBatch();
    
    /// @notice Thrown when no submissions are processed successfully
    error NoSubmissionsProcessedSuccessfully();
    
    // ============ VERIFIER ERRORS ============
    /// @notice Thrown when verifier already exists
    error VerifierAlreadyExists();
    
    /// @notice Thrown when verifier is not found
    error VerifierNotFound();
    
    /// @notice Thrown when verifier call fails
    error VerifierCallFailed();
    
    /// @notice Thrown when verifier is not available
    error VerifierNotAvailable();
    
    /// @notice Thrown when factory address is invalid
    error InvalidFactoryAddress();
    
    /// @notice Thrown when circuit type is not supported
    error CircuitTypeNotSupported();
    
    /// @notice Thrown when circuit type is empty
    error EmptyCircuitType();
    
    /// @notice Thrown when ceremony metadata is invalid
    error InvalidCeremonyMetadata();
    
    /// @notice Thrown when ceremony is not validated
    error CeremonyNotValidated();
    
    /// @notice Thrown when production key is required
    error ProductionKeyRequired();
    
    /// @notice Thrown when development key is used in production
    error DevelopmentKeyInProduction();
    
    /// @notice Thrown when production key violation occurs
    error ProductionKeyViolation();
    
    /// @notice Thrown when immutable verifier violation occurs
    error ImmutableVerifierViolation();
    
    /// @notice Thrown when participants are insufficient
    error InsufficientParticipants();
    
    /// @notice Thrown when circuit name is empty
    error EmptyCircuitName();
    
    // ============ INSURANCE/POLICY ERRORS ============
    /// @notice Thrown when policy ID is invalid
    error InvalidPolicyId();
    
    /// @notice Thrown when policy is not active
    error PolicyNotActive();
    
    /// @notice Thrown when coverage is too low
    error CoverageTooLow();
    
    /// @notice Thrown when coverage is too high
    error CoverageTooHigh();
    
    /// @notice Thrown when period is too short
    error PeriodTooShort();
    
    /// @notice Thrown when period is too long
    error PeriodTooLong();
    
    /// @notice Thrown when deductible is invalid
    error InvalidDeductible();
    
    /// @notice Thrown when claim amount is invalid
    error InvalidClaimAmount();
    
    /// @notice Thrown when incident is outside coverage period
    error IncidentOutsideCoveragePeriod();
    
    /// @notice Thrown when claim period has expired
    error ClaimPeriodExpired();
    
    /// @notice Thrown when claim exceeds maximum amount
    error ClaimExceedsMaxAmount();
    
    /// @notice Thrown when claim ID is invalid
    error InvalidClaimId();
    
    /// @notice Thrown when claim is not pending
    error ClaimNotPending();
    
    /// @notice Thrown when claim is not approved
    error ClaimNotApproved();
    
    /// @notice Thrown when assessor nullifier is used
    error AssessorNullifierUsed();
    
    /// @notice Thrown when assessment score is invalid
    error InvalidAssessmentScore();
    
    /// @notice Thrown when pool funds are insufficient
    error InsufficientPoolFunds();
    
    // ============ DERIVATIVES/TRADING ERRORS ============
    /// @notice Thrown when contract ID is invalid
    error InvalidContractId();
    
    /// @notice Thrown when contract is not active
    error ContractNotActive();
    
    /// @notice Thrown when contract has expired
    error ContractExpired();
    
    /// @notice Thrown when contract is not expired
    error ContractNotExpired();
    
    /// @notice Thrown when expiry is too soon
    error ExpiryTooSoon();
    
    /// @notice Thrown when expiry is too far
    error ExpiryTooFar();
    
    /// @notice Thrown when strike price is invalid
    error InvalidStrikePrice();
    
    /// @notice Thrown when notional amount is invalid
    error InvalidNotionalAmount();
    
    /// @notice Thrown when premium is invalid
    error InvalidPremium();
    
    /// @notice Thrown when cannot exercise futures
    error CannotExerciseFutures();
    
    /// @notice Thrown when European option exercise restriction applies
    error EuropeanOptionExerciseRestriction();
    
    /// @notice Thrown when price is invalid
    error InvalidPrice();
    
    /// @notice Thrown when price is not available
    error PriceNotAvailable();
    
    /// @notice Thrown when price is too stale
    error PriceTooStale();
    
    /// @notice Thrown when price data is stale
    error PriceDataIsStale();
    
    /// @notice Thrown when oracle address is invalid
    error InvalidOracleAddress();
    
    /// @notice Thrown when no oracle is set for asset
    error NoOracleSetForAsset();
    
    /// @notice Thrown when oracle price is invalid
    error OraclePriceInvalid();
    
    /// @notice Thrown when oracle round is not complete
    error OracleRoundNotComplete();
    
    /// @notice Thrown when price deviation is too high
    error PriceDeviationTooHigh();
    
    /// @notice Thrown when oracle confirmations are insufficient
    error InsufficientOracleConfirmations();
    
    /// @notice Thrown when update interval is invalid
    error InvalidUpdateInterval();
    
    /// @notice Thrown when keeper is unauthorized
    error UnauthorizedKeeper();
    
    /// @notice Thrown when oracle is unauthorized
    error UnauthorizedOracle();
    
    // ============ LENDING/COLLATERAL ERRORS ============
    /// @notice Thrown when collateral is insufficient
    error InsufficientCollateral();
    
    /// @notice Thrown when loan is not found
    error LoanNotFound();
    
    /// @notice Thrown when loan is not active
    error LoanNotActive();
    
    /// @notice Thrown when loan amount is invalid
    error InvalidLoanAmount();
    
    /// @notice Thrown when collateral is not liquidatable
    error CollateralNotLiquidatable();
    
    /// @notice Thrown when liquidation is excessive
    error ExcessiveLiquidation();
    
    /// @notice Thrown when repayment is insufficient
    error InsufficientRepayment();
    
    // ============ ESCROW ERRORS ============
    /// @notice Thrown when escrow does not exist
    error EscrowDoesNotExist();
    
    /// @notice Thrown when escrow already exists
    error EscrowAlreadyExists();
    
    /// @notice Thrown when interest rate is too high
    error InterestRateTooHigh();
    
    /// @notice Thrown when release delay is invalid
    error InvalidReleaseDelay();
    
    // ============ VALIDATION ERRORS ============
    /// @notice Thrown when profile description is invalid
    error InvalidProfileDescription();
    
    /// @notice Thrown when endorsement text is invalid
    error InvalidEndorsementText();
    
    /// @notice Thrown when profile name is invalid
    error InvalidProfileName();
    
    /// @notice Thrown when description is too long
    error DescriptionTooLong();
    
    /// @notice Thrown when feedback text is too long
    error FeedbackTextTooLong();
    
    /// @notice Thrown when skill name is invalid
    error InvalidSkillName();
    
    /// @notice Thrown when endorsement text is too long
    error EndorsementTextTooLong();
    
    /// @notice Thrown when rating is invalid
    error InvalidRating();
    
    /// @notice Thrown when weight sum is invalid
    error InvalidWeightSum();
    
    /// @notice Thrown when range is invalid
    error InvalidRange();
    
    /// @notice Thrown when metric value is invalid
    error InvalidMetricValue();
    
    /// @notice Thrown when complexity score is invalid
    error InvalidComplexityScore();
    
    /// @notice Thrown when privacy score is invalid
    error InvalidPrivacyScore();
    
    /// @notice Thrown when risk score is invalid
    error InvalidRiskScore();
    
    // ============ COMPETITION/LEADERBOARD ERRORS ============
    /// @notice Thrown when sovereign is not registered
    error SovereignNotRegistered();
    
    /// @notice Thrown when sovereign is already registered
    error SovereignAlreadyRegistered();
    
    /// @notice Thrown when liberty nickname is invalid
    error InvalidLibertyNickname();
    
    /// @notice Thrown when liberty nickname is too long
    error LibertyNicknameTooLong();
    
    /// @notice Thrown when Austrian mentor is invalid
    error InvalidAustrianMentor();
    
    /// @notice Thrown when no active liberty cycle exists
    error NoActiveLibertyCycle();
    
    /// @notice Thrown when individual action cooldown is active
    error IndividualActionCooldownActive();
    
    /// @notice Thrown when competition name is invalid
    error InvalidCompetitionName();
    
    /// @notice Thrown when prize pool is invalid
    error InvalidPrizePool();
    
    /// @notice Thrown when max participants is invalid
    error InvalidMaxParticipants();
    
    /// @notice Thrown when competition is not found
    error CompetitionNotFound();
    
    /// @notice Thrown when competition is not active
    error CompetitionNotActive();
    
    /// @notice Thrown when competition has ended
    error CompetitionEnded();
    
    /// @notice Thrown when competition is not ended
    error CompetitionNotEnded();
    
    /// @notice Thrown when competition is full
    error CompetitionFull();
    
    /// @notice Thrown when already joined competition
    error AlreadyJoined();
    
    // ============ MINING/REWARDS ERRORS ============
    /// @notice Thrown when daily mining cap is exceeded
    error DailyMiningCapExceeded();
    
    /// @notice Thrown when privacy mining pool is insufficient
    error InsufficientPrivacyMiningPool();
    
    /// @notice Thrown when ZK proof reward pool is insufficient
    error InsufficientZKProofRewardPool();
    
    /// @notice Thrown when airdrop is already claimed for root
    error AirdropAlreadyClaimedForRoot();
    
    /// @notice Thrown when airdrop pool is insufficient
    error InsufficientAirdropPool();
    
    /// @notice Thrown when no funding is provided
    error NoFundingProvided();
    
    // ============ GEOGRAPHIC/COMPLIANCE ERRORS ============
    /// @notice Thrown when jurisdiction is invalid
    error InvalidJurisdiction();
    
    /// @notice Thrown when user address is invalid
    error InvalidUserAddress();
    
    /// @notice Thrown when jurisdiction is prohibited
    error JurisdictionProhibited();
    
    /// @notice Thrown when jurisdiction is sanctioned
    error SanctionedJurisdiction();
    
    /// @notice Thrown when protocol is not available in jurisdiction
    error ProtocolNotAvailable();
    
    /// @notice Thrown when transaction exceeds limit
    error TransactionExceedsLimit();
    
    /// @notice Thrown when full access is blocked
    error FullAccessBlock();
    
    /// @notice Thrown when emergency mode is active
    error EmergencyModeActive();
    
    /// @notice Thrown when unverified jurisdiction limit is exceeded
    error UnverifiedJurisdictionLimit();
    
    /// @notice Thrown when status is invalid
    error InvalidStatus();
    
    /// @notice Thrown when risk level is invalid
    error InvalidRiskLevel();
    
    // ============ EMERGENCY/CIRCUIT BREAKER ERRORS ============
    /// @notice Thrown when emergency state is invalid
    error InvalidEmergencyState();
    
    /// @notice Thrown when emergency type is invalid
    error InvalidEmergencyType();
    
    /// @notice Thrown when emergency is already executed
    error EmergencyAlreadyExecuted();
    
    /// @notice Thrown when threshold is not met
    error ThresholdNotMet();
    
    /// @notice Thrown when invalid targets are provided
    error InvalidTargets();
    
    /// @notice Thrown when circuit breaker is triggered
    error CircuitBreaker();
    
    /// @notice Thrown when unauthorized emergency type is used
    error UnauthorizedEmergencyType();
    
    /// @notice Thrown when circuit is not compromised
    error CircuitNotCompromised();
    
    /// @notice Thrown when evidence is invalid
    error InvalidEvidence();
    
    // ============ VESTING/ALLOCATION ERRORS ============
    /// @notice Thrown when allocation is already completed
    error AllocationAlreadyCompleted();
    
    /// @notice Thrown when allocation address is not set
    error AllocationAddressNotSet();
    
    /// @notice Thrown when token balance is insufficient
    error InsufficientTokenBalance();
    
    /// @notice Thrown when allocation mismatch occurs
    error AllocationMismatch();
    
    /// @notice Thrown when allocation is invalid
    error InvalidAllocation();
    
    /// @notice Thrown when beneficiary is invalid
    error InvalidBeneficiary();
    
    /// @notice Thrown when cliff is not reached
    error CliffNotReached();
    
    /// @notice Thrown when no tokens are available
    error NoTokensAvailable();
    
    /// @notice Thrown when vesting has not started
    error VestingNotStarted();
    
    /// @notice Thrown when vesting is not found
    error VestingNotFound();
    
    /// @notice Thrown when vesting is already revoked
    error VestingAlreadyRevoked();
    
    /// @notice Thrown when vested tokens are insufficient
    error InsufficientVestedTokens();
    
    /// @notice Thrown when cliff exceeds duration
    error CliffExceedsDuration();
    
    /// @notice Thrown when vesting already exists
    error VestingAlreadyExists();
    
    /// @notice Thrown when no vesting schedule exists
    error NoVestingSchedule();
    
    /// @notice Thrown when vesting is revoked
    error VestingRevokedError();
    
    /// @notice Thrown when no tokens to release
    error NoTokensToRelease();
    
    /// @notice Thrown when vesting is not revocable
    error VestingNotRevocable();
    
    /// @notice Thrown when already revoked
    error AlreadyRevoked();
    
    /// @notice Thrown when caller is unauthorized
    error UnauthorizedCaller();
    
    /// @notice Thrown when governance contract is invalid
    error InvalidGovernanceContract();
    
    /// @notice Thrown when delegation is restricted
    error DelegationRestrictedError();
    
    /// @notice Thrown when delegation cooldown is active
    error DelegationCooldownActive();
    
    /// @notice Thrown when delegatee is sanctioned
    error DelegateeSanctioned();
    
    /// @notice Thrown when delegatee is not compliant
    error DelegateeNotCompliant();
    
    /// @notice Thrown when tier is invalid
    error InvalidTier();
    
    /// @notice Thrown when multiplier is invalid
    error InvalidMultiplier();
    
    /// @notice Thrown when sender is sanctioned
    error SenderSanctioned();
    
    /// @notice Thrown when sender is not compliant
    error SenderNotCompliant();
    
    /// @notice Thrown when recipient is sanctioned
    error RecipientSanctioned();
    
    /// @notice Thrown when recipient is not compliant
    error RecipientNotCompliant();
    
    /// @notice Thrown when not verified backer
    error NotVerifiedBacker();
    
    // ============ CREATOR/REPUTATION ERRORS ============
    /// @notice Thrown when creator profile is required
    error CreatorProfileRequired();
    
    /// @notice Thrown when creator profile does not exist
    error CreatorProfileDoesNotExist();
    
    /// @notice Thrown when feedback is already provided
    error FeedbackAlreadyProvided();
    
    /// @notice Thrown when CrowdShield address is invalid
    error InvalidCrowdShieldAddress();
    
    /// @notice Thrown when campaign manager address is invalid
    error InvalidCampaignManagerAddress();
    
    /// @notice Thrown when dashboard address is invalid
    error InvalidDashboardAddress();
    
    // ============ PROCESSOR/JOB ERRORS ============
    /// @notice Thrown when not active processor
    error NotActiveProcessor();
    
    /// @notice Thrown when not job processor
    error NotJobProcessor();
    
    /// @notice Thrown when job is not processing
    error JobNotProcessing();
    
    /// @notice Thrown when cannot deregister with active jobs
    error CannotDeregisterWithActiveJobs();
    
    /// @notice Thrown when already registered
    error AlreadyRegistered();
    
    /// @notice Thrown when no available processor
    error NoAvailableProcessor();
    
    /// @notice Thrown when capacity is invalid
    error InvalidCapacity();
    
    /// @notice Thrown when target batch size is too small
    error TargetBatchSizeTooSmall();
    
    /// @notice Thrown when target batch size is too large
    error TargetBatchSizeTooLarge();
    
    /// @notice Thrown when wait time is invalid
    error InvalidWaitTime();
    
    /// @notice Thrown when compression threshold is invalid
    error InvalidCompressionThreshold();
    
    /// @notice Thrown when gas optimization target is invalid
    error InvalidGasOptimizationTarget();
    
    /// @notice Thrown when insufficient gas savings
    error InsufficientGasSavings();
    
    // ============ RECURSION/AGGREGATION ERRORS ============
    /// @notice Thrown when recursion depth is invalid
    error InvalidRecursionDepth();
    
    /// @notice Thrown when max recursion is exceeded
    error MaxRecursionExceeded();
    
    /// @notice Thrown when child proof is not found
    error ChildProofNotFound();
    
    // ============ DISTRIBUTION/FEE ERRORS ============
    /// @notice Thrown when distribution config is invalid
    error InvalidDistributionConfig();
    
    /// @notice Thrown when distribution is too early
    error DistributionTooEarly();
    
    /// @notice Thrown when interval is invalid
    error InvalidInterval();
    
    /// @notice Thrown when FeeM registration fails
    error FeeMRegistrationFailed();
    
    // ============ SUPPLY/CAP ERRORS ============
    /// @notice Thrown when supply cap is exceeded
    error SupplyCapExceeded();
    
    /// @notice Thrown when initial supply exceeds maximum
    error InitialSupplyExceedsMaximum();
    
    // ============ CONTRACT/ACCESS ERRORS ============
    /// @notice Thrown when unauthorized contract access is attempted
    error UnauthorizedContract();
    
    /// @notice Thrown when contract is not authorized
    error InvalidContractAddress();
}