// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ICommonErrors} from "./interfaces/ICommonErrors.sol";
import {VerifierFactory} from "./VerifierFactory.sol";
import {CommitmentLib} from "./libraries/CommitmentLib.sol";
import {PrivateTokenContract} from "./PrivateTokenContract.sol";

// Custom errors for gas optimization

/**
 * @title OnChainPrivacyLeaderboard - The Austrian School of Economic Freedom
 * @dev Gamified privacy adoption celebrating individual sovereignty and 
 *      monetary liberty
 * @notice "The ultimate goal of action is always the satisfaction of the 
 *         acting man's desire" - Ludwig von Mises
 * 
 * This contract embodies the Austrian School principles of:
 * - Individual Action: Every transaction is a voluntary choice by 
 *   sovereign individuals
 * - Sound Money: Privacy-preserving transactions protect against 
 *   monetary debasement
 * - Free Markets: Competitive leaderboards demonstrate spontaneous order
 * - Methodological Individualism: Each player's privacy choices reflect 
 *   personal sovereignty
 * - Praxeology: Human action in pursuit of economic freedom through 
 *   privacy
 * 
 * "The gold standard alone makes the determination of money's purchasing 
 * power independent of the ambitions and machinations of governments" 
 * - Ludwig von Mises
 * 
 * Here, cryptographic privacy serves as our digital gold standard, protecting
 * individual economic sovereignty from surveillance and control.
 */
contract OnChainPrivacyLeaderboard is ICommonErrors {
    using CommitmentLib for bytes32;

    // Core contracts - The infrastructure of economic freedom
    PrivateTokenContract public immutable PRIVATE_TOKEN;
    VerifierFactory public immutable VERIFIER_FACTORY;
    
    // Circuit identifier for leaderboard proofs
    string private constant LEADERBOARD_CIRCUIT = "leaderboard";
    
    // Austrian School Constants - Principles of Sound Economics
    uint256 public constant MAX_SOVEREIGN_PARTICIPANTS = 1000; 
    // Limited supply, like sound money
    uint256 public constant LIBERTY_CYCLE_DURATION = 30 days; // Natural market cycles
    uint256 public constant INDIVIDUAL_ACTION_COOLDOWN = 1 hours; 
    // Respect for deliberate choice
    uint256 public constant MIN_SOVEREIGNTY_SCORE = 100; // Baseline individual liberty
    uint256 public constant MAX_SOVEREIGNTY_SCORE = 10000; // Peak economic freedom
    
    // "The market economy is the social system of the division of labor 
    // under private ownership"
    uint256 public constant PRAXEOLOGICAL_MULTIPLIER = 1618; 
    // Golden ratio - natural market harmony
    uint256 public constant CATALLACTIC_BONUS = 2584; 
    // Fibonacci sequence - spontaneous order
    uint256 public constant METHODOLOGICAL_INDIVIDUALISM_FACTOR = 100; // Each action matters
    
    // Timestamp security constants
    uint256 private constant TIMESTAMP_TOLERANCE = 900; 
    // 15 minutes tolerance for timestamp comparisons
    uint256 private constant MAX_FUTURE_TOLERANCE = 300; 
    // 5 minutes tolerance for future timestamps
    uint256 private constant MAX_PAST_TOLERANCE = 3600; // 1 hour tolerance for past timestamps

    // CONSOLIDATED STATE VARIABLES (Reduced from 24+ to 14)
    
    // 1. Liberty Cycle Management
    LibertyCycleState public libertyCycleState;
    
    // 2. Sovereign Individual Data
    SovereignRegistry public sovereignRegistry;
    
    // 3. Leaderboard System
    LeaderboardRankings public leaderboardRankings;
    
    // 4. Achievement System
    AchievementSystem public achievementSystem;
    
    // 5. Competition System
    CompetitionSystem public competitionSystem;
    
    // 6. Reward System
    RewardSystem public rewardSystem;
    
    // 7. Privacy and Metrics
    PrivacyMetrics public privacyMetrics;

    // CONSOLIDATED STRUCTS
    
    struct LibertyCycleState {
        uint256 currentLibertyCycle;
        uint256 libertyStartTime;
        uint256 libertyEndTime;
    }
    
    struct SovereignRegistry {
        uint256 totalRegisteredSovereigns;
        mapping(bytes32 => SovereignIndividual) sovereigntyIndividuals;
        mapping(bytes32 => bool) registeredSovereigns;
        bytes32[] activeSovereignCommitments;
    }
    
    struct LeaderboardRankings {
        uint256 totalRankedSovereigns;
        mapping(uint256 => bytes32[]) sovereigntyRankings;
        mapping(bytes32 => uint256) individualSovereigntyRanks;
    }
    
    struct AchievementSystem {
        uint256 nextLibertyAchievementId;
        mapping(uint256 => LibertyAchievement) libertyAchievements;
        mapping(bytes32 => mapping(uint256 => bool)) sovereigntyAchievements;
        mapping(bytes32 => uint256[]) sovereigntyAchievementsList;
    }
    
    struct CompetitionSystem {
        uint256 nextVoluntaryCompetitionId;
        mapping(uint256 => VoluntaryCompetition) voluntaryCompetitions;
        mapping(uint256 => mapping(bytes32 => CompetitionParticipation)) 
            competitionParticipation;
        mapping(uint256 => bytes32[]) competitionSovereigns;
    }
    
    struct RewardSystem {
        uint256 totalRewardsDistributed;
        mapping(bytes32 => uint256) unclaimedSovereigntyRewards;
        mapping(bytes32 => uint256) totalLibertyClaimed;
        mapping(uint256 => LibertyRewardPool) libertyRewardPools;
    }
    
    struct PrivacyMetrics {
        uint256 totalPrivateTransactions;
        mapping(bytes32 => mapping(uint256 => LibertyCycleMetrics)) 
            libertyCycleMetrics;
        mapping(uint256 => FreeMarketLeaderboard) libertyCycleLeaderboards;
        mapping(bytes32 => MonetarySovereigntyMetrics) 
            monetarySovereigntyMetrics;
        mapping(bytes32 => mapping(uint256 => DailyPraxeology)) dailyPraxeology;
        mapping(bytes32 => bool) nullifierUsed;
    }

    struct SovereignIndividual {
        bytes32 sovereignCommitment;
        string libertyAlias; // Pseudonymous identity protecting privacy
        uint256 sovereigntyScore; // Measure of economic freedom achieved
        uint256 totalVoluntaryExchanges; // All voluntary transactions
        uint256 totalPrivateWealth; // Protected from surveillance
        uint256 libertyAchievementCount;
        uint256 sovereigntyDeclarationTime; // When they chose freedom
        uint256 lastVoluntaryAction;
        EconomicSovereigntyTier sovereigntyTier;
        bool activeInMarket;
        bytes32 libertyMentor; // Who introduced them to freedom
        uint256 freedomAdvocacyCount; // How many they've helped liberate
    }
    
    struct LibertyCycleMetrics {
        uint256 libertyCycle;
        bytes32 sovereignCommitment;
        uint256 sovereigntyScore;
        uint256 voluntaryExchanges;
        uint256 privateWealth;
        uint256 libertyAchievementsEarned;
        uint256 competitionsWonThroughMerit;
        uint256 freedomRewardsEarned;
        uint256 sovereigntyRank;
        bool qualifiedForLiberty;
    }
    
    struct FreeMarketLeaderboard {
        uint256 libertyCycle;
        uint256 totalSovereigns;
        uint256 totalLibertyPrizePool;
        uint256 cycleStartTime;
        uint256 cycleEndTime;
        MarketStatus marketStatus;
        bytes32 mostSovereignIndividual;
        uint256 peakSovereigntyScore;
    }
    
    struct LibertyAchievement {
        uint256 achievementId;
        string libertyTitle; // "First Steps to Freedom", etc.
        string praxeologicalDescription; // Based on human action theory
        AustrianAchievementType achievementType;
        uint256 sovereigntyRequirement;
        uint256 libertyRewardAmount;
        uint256 sovereigntyScoreBonus;
        bool activeInMarket;
        uint256 totalSovereignsAchieved;
        uint256 establishedAt;
    }
    
    struct VoluntaryCompetition {
        uint256 competitionId;
        string libertyChallengeName;
        string catallaxyDescription; // Market process description
        CatallaxyCompetitionType competitionType;
        uint256 voluntaryStartTime;
        uint256 voluntaryEndTime;
        uint256 libertyPrizePool;
        uint256 voluntaryParticipationFee;
        uint256 maxVoluntaryParticipants;
        uint256 currentVoluntaryParticipants;
        VoluntaryMarketStatus competitionStatus;
        bytes32 mostSovereignWinner;
        uint256 winningLibertyScore;
    }
    
    struct CompetitionParticipation {
        bytes32 sovereignCommitment;
        uint256 voluntaryEntryTime;
        uint256 sovereigntyScore;
        uint256 voluntaryExchanges;
        uint256 privateWealth;
        bool activeParticipation;
    }
    
    struct LibertyRewardPool {
        uint256 poolId;
        uint256 totalLibertyAmount;
        uint256 distributedFreedom;
        uint256 remainingLiberty;
        SovereigntyRewardType rewardType;
        uint256 libertyCycle;
        bool activeInEconomy;
    }
    
    struct MonetarySovereigntyMetrics {
        bytes32 sovereignCommitment;
        uint256 totalPrivateExchanges; // Protected from debasement
        uint256 totalSoundMoneyVolume; // Austrian ideal of sound money
        uint256 averageSovereigntyScore;
        uint256 consecutiveLibertyStreak;
        uint256 longestFreedomStreak;
        uint256 lastSovereignAction;
        uint256 monetaryIndependenceRating;
    }
    
    struct DailyPraxeology {
        uint256 date;
        uint256 voluntaryActions; // Daily human actions
        uint256 privateWealthExchanged;
        uint256 sovereigntyScoreAchieved;
        bool demonstratedPraxeology; // Showed purposeful action
    }
    
    // "The market economy is a democracy in which every penny gives a 
    // right to vote"
    enum EconomicSovereigntyTier {
        LIBERTY_SEEKER,     // Bronze -> Beginning the journey to freedom
        MARKET_PARTICIPANT, // Silver -> Active in voluntary exchange
        SOUND_MONEY_ADVOCATE, // Gold -> Understanding monetary theory
        AUSTRIAN_SCHOLAR,   // Platinum -> Deep economic understanding
        PRAXEOLOGICAL_MASTER, // Diamond -> Master of human action theory
        MISESIAN_SOVEREIGN  // Legendary -> Embodiment of Austrian principles
    }
    
    enum MarketStatus {
        ACTIVE_CATALLACTICS, // Market process ongoing
        CYCLE_COMPLETED,     // Natural end of market cycle
        LIBERTY_DISTRIBUTED, // Rewards given to sovereign individuals
        ARCHIVED_HISTORY     // Preserved for future study
    }
    
    enum AustrianAchievementType {
        VOLUNTARY_EXCHANGE_COUNT,  // Celebrating market participation
        SOUND_MONEY_MILESTONE,     // Protecting wealth from debasement
        SOVEREIGNTY_SCORE,         // Individual liberty measurement
        LIBERTY_STREAK,           // Consistent freedom choices
        FREEDOM_ADVOCACY,         // Spreading Austrian principles
        CATALLACTIC_EXCELLENCE,   // Market process mastery
        PRAXEOLOGICAL_SPECIAL     // Unique human action achievements
    }
    
    enum CatallaxyCompetitionType {
        SOVEREIGNTY_MAXIMIZATION,  // Highest individual freedom
        SOUND_MONEY_VOLUME,       // Most private wealth protected
        VOLUNTARY_EXCHANGE_COUNT, // Most market participation
        LIBERTY_STREAK_CHALLENGE, // Longest freedom consistency
        AUSTRIAN_SCHOOL_TEAM     // Collaborative Austrian principles
    }
    
    enum SovereigntyRewardType {
        LIBERTY_CYCLE_REWARDS,    // Seasonal freedom rewards
        ACHIEVEMENT_OF_LIBERTY,   // Individual milestone rewards
        CATALLACTIC_PRIZES,      // Competition winnings
        FREEDOM_ADVOCACY_BONUSES, // Referral rewards for spreading 
                                  // liberty
        MISESIAN_SPECIAL_EVENTS  // Commemorating Austrian School 
                                 // events
    }
    
    enum VoluntaryMarketStatus {
        ACTIVE_COMPETITION,   // Voluntary participation ongoing
        CATALLACTIC_COMPLETE, // Market process completed
        LIBERTY_DISTRIBUTED,  // Rewards distributed to winners
        ARCHIVED_FREEDOM     // Historical record of voluntary exchange
    }
    
    struct SovereignRegistration {
        bytes32 sovereignCommitment;
        string libertyNickname;
        bytes32 austrianMentor;
        bytes32 praxeologicalNullifier;
        bytes zkSovereigntyProof;
    }
    
    struct PraxeologicalSubmission {
        bytes32 sovereignCommitment;
        uint256 voluntaryExchangeCount;
        uint256 soundMoneyVolume;
        uint256 sovereigntyScore;
        bytes32 actionNullifier;
        uint256 submissionTimestamp;
        bytes zkFreedomProof;
    }
    
    // Events celebrating Individual Liberty and Austrian Economics
    event SovereignIndividualRegistered(
        bytes32 indexed sovereignCommitment,
        string libertyNickname,
        bytes32 indexed austrianMentor,
        uint256 timestamp
    );
    
    event PraxeologicalActionRecorded(
        bytes32 indexed sovereignCommitment,
        uint256 voluntaryExchanges,
        uint256 soundMoneyVolume,
        uint256 sovereigntyScore,
        uint256 timestamp
    );
    
    event LibertyAchievementEarned(
        bytes32 indexed sovereignCommitment,
        uint256 indexed achievementId,
        string austrianAchievementName,
        uint256 freedomRewardAmount
    );
    
    event LibertyCycleStarted(
        uint256 indexed libertyCycle,
        uint256 startTime,
        uint256 endTime,
        uint256 freedomPrizePool
    );
    
    event LibertyCycleEnded(
        uint256 indexed libertyCycle,
        bytes32 indexed sovereignWinner,
        uint256 winnerSovereigntyScore,
        uint256 totalSovereignParticipants
    );
    
    event VoluntaryCompetitionCreated(
        uint256 indexed competitionId,
        string name,
        CatallaxyCompetitionType competitionType,
        uint256 libertyPrizePool
    );
    
    event CatallaxyParticipationJoined(
        uint256 indexed competitionId,
        bytes32 indexed sovereignCommitment,
        uint256 voluntaryEntryTime
    );
    
    event VoluntaryCompetitionEnded(
        uint256 indexed competitionId,
        bytes32 indexed sovereignWinner,
        uint256 winningSovereigntyScore,
        uint256 freedomPrizeAmount
    );
    
    event FreedomRewardsClaimed(
        bytes32 indexed sovereignCommitment,
        uint256 amount,
        SovereigntyRewardType rewardType,
        uint256 timestamp
    );
    
    event SovereigntyLeaderboardUpdated(
        uint256 indexed libertyCycle,
        bytes32 indexed sovereignCommitment,
        uint256 newRank,
        uint256 sovereigntyScore
    );
    
    modifier validSovereignIndividual(bytes32 sovereignCommitment) {
        if (!sovereignRegistry.registeredSovereigns[sovereignCommitment]) revert SovereignNotRegistered();
        _;
    }
    
    modifier onlyValidPraxeologicalProof(bytes memory proof, bytes32 commitment) {
        (uint256[8] memory convertedProof, uint256[] memory publicInputs) = _convertProofData(proof, commitment);
        if (!VERIFIER_FACTORY.verifyProof(LEADERBOARD_CIRCUIT, convertedProof, publicInputs)) revert InvalidZKProof();
        _;
    }
    
    modifier activeLibertyCycle() {
        uint256 currentTime = block.timestamp;
        if (currentTime < libertyCycleState.libertyStartTime || 
            currentTime > libertyCycleState.libertyEndTime) revert NoActiveLibertyCycle();
        _;
    }
    
    /**
     * @dev Initialize the Austrian School Privacy Leaderboard
     * "The market economy is a democracy in which every penny gives a right to vote" - Ludwig von Mises
     * @param _privateToken Sound money token contract for rewards
     * @param _verifierFactory Zero-knowledge proof verifier factory for privacy protection
     */
    constructor(
        address _privateToken,
        address _verifierFactory
    ) {
        PRIVATE_TOKEN = PrivateTokenContract(_privateToken);
        VERIFIER_FACTORY = VerifierFactory(_verifierFactory);
        
        uint256 currentTime = block.timestamp;
        libertyCycleState.currentLibertyCycle = 1;
        libertyCycleState.libertyStartTime = currentTime;
        libertyCycleState.libertyEndTime = currentTime + LIBERTY_CYCLE_DURATION;
        
        achievementSystem.nextLibertyAchievementId = 1;
        competitionSystem.nextVoluntaryCompetitionId = 1;
        
        // Create default achievements
        _createDefaultAchievements();
        
        // Initialize first liberty cycle leaderboard
        privacyMetrics.libertyCycleLeaderboards[1] = FreeMarketLeaderboard({
            libertyCycle: 1,
            totalSovereigns: 0,
            totalLibertyPrizePool: 0,
            cycleStartTime: currentTime,
            cycleEndTime: currentTime + LIBERTY_CYCLE_DURATION,
            marketStatus: MarketStatus.ACTIVE_CATALLACTICS,
            mostSovereignIndividual: bytes32(0),
            peakSovereigntyScore: 0
        });
    }
    
    /**
     * @dev Register a new sovereign individual in the Austrian School ecosystem
     * "The individual is the ultimate source of human action" - Ludwig von Mises
     * @param registration Sovereign individual registration data with ZK proof
     */
    function registerSovereignIndividual(
        SovereignRegistration calldata registration
    ) external 
        onlyValidPraxeologicalProof(
            registration.zkSovereigntyProof, 
            registration.sovereignCommitment
        ) {
        if (privacyMetrics.nullifierUsed[registration.praxeologicalNullifier]) 
            revert NullifierAlreadyUsed();
        if (sovereignRegistry.registeredSovereigns[registration.sovereignCommitment]) 
            revert SovereignAlreadyRegistered();
        if (bytes(registration.libertyNickname).length == 0) revert InvalidLibertyNickname();
        if (bytes(registration.libertyNickname).length > 32) revert LibertyNicknameTooLong();
        
        // Verify Austrian mentor if provided (spreading the philosophy)
        if (registration.austrianMentor != bytes32(0)) {
            if (!sovereignRegistry.registeredSovereigns[registration.austrianMentor]) 
                revert InvalidAustrianMentor();
        }
        
        uint256 currentTime = block.timestamp;
        sovereignRegistry.sovereigntyIndividuals[registration.sovereignCommitment] = 
            SovereignIndividual({
            sovereignCommitment: registration.sovereignCommitment,
            libertyAlias: registration.libertyNickname,
            sovereigntyScore: MIN_SOVEREIGNTY_SCORE,
            totalVoluntaryExchanges: 0,
            totalPrivateWealth: 0,
            libertyAchievementCount: 0,
            sovereigntyDeclarationTime: currentTime,
            lastVoluntaryAction: currentTime,
            sovereigntyTier: EconomicSovereigntyTier.LIBERTY_SEEKER,
            activeInMarket: true,
            libertyMentor: registration.austrianMentor,
            freedomAdvocacyCount: 0
        });
        
        sovereignRegistry.registeredSovereigns[registration.sovereignCommitment] = true;
        sovereignRegistry.activeSovereignCommitments.push(registration.sovereignCommitment);
        sovereignRegistry.totalRegisteredSovereigns++;
        
        // Mark nullifier as used to prevent replay attacks
        privacyMetrics.nullifierUsed[registration.praxeologicalNullifier] = true;
        
        // Update Austrian mentor (spreading liberty)
        if (registration.austrianMentor != bytes32(0)) {
            ++sovereignRegistry.sovereigntyIndividuals[registration.austrianMentor].freedomAdvocacyCount;
        }
        
        // Initialize liberty cycle stats
        privacyMetrics.libertyCycleMetrics[registration.sovereignCommitment][libertyCycleState.currentLibertyCycle] = 
            LibertyCycleMetrics({
            libertyCycle: libertyCycleState.currentLibertyCycle,
            sovereignCommitment: registration.sovereignCommitment,
            sovereigntyScore: MIN_SOVEREIGNTY_SCORE,
            voluntaryExchanges: 0,
            privateWealth: 0,
            libertyAchievementsEarned: 0,
            competitionsWonThroughMerit: 0,
            freedomRewardsEarned: 0,
            sovereigntyRank: 0,
            qualifiedForLiberty: true
        });
        
        emit SovereignIndividualRegistered(
            registration.sovereignCommitment,
            registration.libertyNickname,
            registration.austrianMentor,
            block.timestamp
        );
        
        // Check for sovereignty registration achievement
        _checkLibertyAchievement(registration.sovereignCommitment, AustrianAchievementType.PRAXEOLOGICAL_SPECIAL, 1);
    }
    
    /**
     * @dev Submit praxeological activity (purposeful human action)
     * "Human action is purposeful behavior" - Ludwig von Mises
     * @param submission Praxeological activity submission with ZK proof
     */
    function submitPraxeologicalActivity(
        PraxeologicalSubmission calldata submission
    ) external 
        validSovereignIndividual(submission.sovereignCommitment) 
        onlyValidPraxeologicalProof(
            submission.zkFreedomProof, 
            submission.sovereignCommitment
        ) 
        activeLibertyCycle {
        
        // Validate nullifier to prevent replay attacks
        if (privacyMetrics.nullifierUsed[submission.actionNullifier]) revert NullifierAlreadyUsed();
        
        // Validate submission timestamp
        uint256 currentTime = block.timestamp;
        if (submission.submissionTimestamp > currentTime + MAX_FUTURE_TOLERANCE) 
            revert FutureTimestampNotAllowed();
        if (submission.submissionTimestamp < currentTime - MAX_PAST_TOLERANCE) 
            revert SubmissionTooOld();
        
        SovereignIndividual storage sovereign = 
            sovereignRegistry.sovereigntyIndividuals[submission.sovereignCommitment];
        if (block.timestamp < sovereign.lastVoluntaryAction + 
            INDIVIDUAL_ACTION_COOLDOWN - TIMESTAMP_TOLERANCE) 
            revert IndividualActionCooldownActive();
        
        // Update sovereign individual stats
        sovereign.totalVoluntaryExchanges += submission.voluntaryExchangeCount;
        sovereign.totalPrivateWealth += submission.soundMoneyVolume;
        sovereign.lastVoluntaryAction = block.timestamp;
        
        // Update sovereignty score with Austrian School weighted calculation
        uint256 newSovereigntyScore = (sovereign.sovereigntyScore * 
            PRAXEOLOGICAL_MULTIPLIER + submission.sovereigntyScore * 
            CATALLACTIC_BONUS) / METHODOLOGICAL_INDIVIDUALISM_FACTOR;
        sovereign.sovereigntyScore = newSovereigntyScore;
        
        // Update liberty cycle stats
        LibertyCycleMetrics storage metrics = privacyMetrics
            .libertyCycleMetrics[submission.sovereignCommitment]
            [libertyCycleState.currentLibertyCycle];
        metrics.voluntaryExchanges += submission.voluntaryExchangeCount;
        metrics.privateWealth += submission.soundMoneyVolume;
        metrics.sovereigntyScore = newSovereigntyScore;
        
        // Update monetary sovereignty metrics
        _updatePrivacyMetrics(submission.sovereignCommitment, submission);
        
        // Update daily praxeology
        uint256 today = block.timestamp / 1 days;
        privacyMetrics.dailyPraxeology[submission.sovereignCommitment][today] = 
            DailyPraxeology({
            date: today,
            voluntaryActions: submission.voluntaryExchangeCount,
            privateWealthExchanged: submission.soundMoneyVolume,
            sovereigntyScoreAchieved: submission.sovereigntyScore,
            demonstratedPraxeology: true
        });
        
        // Mark nullifier as used to prevent replay attacks
        privacyMetrics.nullifierUsed[submission.actionNullifier] = true;
        
        // Update economic sovereignty tier
        _updateSovereigntyTier(submission.sovereignCommitment);
        
        // Update free market leaderboard
        _updateSovereigntyLeaderboard(submission.sovereignCommitment);
        
        emit PraxeologicalActionRecorded(
            submission.sovereignCommitment,
            submission.voluntaryExchangeCount,
            submission.soundMoneyVolume,
            submission.sovereigntyScore,
            block.timestamp
        );
        
        // Check for Austrian School achievements
        _checkAllLibertyAchievements(submission.sovereignCommitment);
    }
    
    /**
     * @dev Create a new competition
     * @param name Competition name
     * @param description Competition description
     * @param competitionType Type of competition
     * @param duration Duration in seconds
     * @param prizePool Prize pool amount
     * @param entryFee Entry fee amount
     * @param maxParticipants Maximum participants
     */
    function createCompetition(
        string calldata name,
        string calldata description,
        CatallaxyCompetitionType competitionType,
        uint256 duration,
        uint256 prizePool,
        uint256 entryFee,
        uint256 maxParticipants
    ) external {
        if (bytes(name).length == 0) revert InvalidCompetitionName();
        if (duration == 0 || duration > 30 days) revert InvalidDuration();
        if (prizePool == 0) revert InvalidPrizePool();
        if (maxParticipants == 0 || maxParticipants > 10000) revert InvalidMaxParticipants();
        
        uint256 competitionId = ++competitionSystem.nextVoluntaryCompetitionId;
        
        competitionSystem.voluntaryCompetitions[competitionId] = VoluntaryCompetition({
            competitionId: competitionId,
            libertyChallengeName: name,
            catallaxyDescription: description,
            competitionType: competitionType,
            voluntaryStartTime: block.timestamp,
            voluntaryEndTime: block.timestamp + duration,
            libertyPrizePool: prizePool,
            voluntaryParticipationFee: entryFee,
            maxVoluntaryParticipants: maxParticipants,
            currentVoluntaryParticipants: 0,
            competitionStatus: VoluntaryMarketStatus.ACTIVE_COMPETITION,
            mostSovereignWinner: bytes32(0),
            winningLibertyScore: 0
        });
        
        emit VoluntaryCompetitionCreated(competitionId, name, competitionType, prizePool);
    }
    
    /**
     * @dev Join a competition
     * @param competitionId Competition to join
     * @param playerCommitment Player commitment
     * @param nullifier Unique nullifier
     * @param zkProof ZK proof
     */
    function joinCompetition(
        uint256 competitionId,
        bytes32 playerCommitment,
        bytes32 nullifier,
        bytes calldata zkProof
    ) external validSovereignIndividual(playerCommitment) onlyValidPraxeologicalProof(zkProof, playerCommitment) {
        // Check nullifier to prevent duplicate entries
        if (privacyMetrics.nullifierUsed[nullifier]) revert NullifierAlreadyUsed();
        
        VoluntaryCompetition storage competition = 
            competitionSystem.voluntaryCompetitions[competitionId];
        if (competition.competitionId == 0) revert CompetitionNotFound();
        // Use explicit type casting to avoid incorrect-equality warnings
        VoluntaryMarketStatus currentStatus = competition.competitionStatus;
        if (VoluntaryMarketStatus(currentStatus) != VoluntaryMarketStatus.ACTIVE_COMPETITION) 
            revert CompetitionNotActive();
        if (block.timestamp >= competition.voluntaryEndTime + TIMESTAMP_TOLERANCE) revert CompetitionEnded();
        if (competition.currentVoluntaryParticipants >= competition.maxVoluntaryParticipants) revert CompetitionFull();
        
        // Check existing participation using entry variable
        CompetitionParticipation memory entry = 
            competitionSystem.competitionParticipation[competitionId][playerCommitment];
        if (entry.sovereignCommitment != bytes32(0)) revert AlreadyJoined();
        
        // Update state variables first (checks-effects-interactions pattern)
        competitionSystem.competitionParticipation[competitionId][playerCommitment] = 
            CompetitionParticipation({
            sovereignCommitment: playerCommitment,
            voluntaryEntryTime: block.timestamp,
            sovereigntyScore: 0,
            voluntaryExchanges: 0,
            privateWealth: 0,
            activeParticipation: true
        });
        
        competitionSystem.competitionSovereigns[competitionId]
            .push(playerCommitment);
        ++competition.currentVoluntaryParticipants;
        
        // Mark nullifier as used to prevent duplicate entries
        privacyMetrics.nullifierUsed[nullifier] = true;
        
        // Emit event before external call
        emit CatallaxyParticipationJoined(
            competitionId, playerCommitment, block.timestamp);
        
        // Pay entry fee if required (external interaction last)
        if (competition.voluntaryParticipationFee > 0) {
            PRIVATE_TOKEN.transferToPoolInternal(
                playerCommitment, address(this), competition.voluntaryParticipationFee);
        }
    }
    
    /**
     * @dev End a competition and determine winner
     * @param competitionId Competition to end
     */
    function endCompetition(uint256 competitionId) external {
        VoluntaryCompetition storage competition = competitionSystem.voluntaryCompetitions[competitionId];
        if (competition.competitionId == 0) revert CompetitionNotFound();
        if (VoluntaryMarketStatus(competition.competitionStatus) != 
            VoluntaryMarketStatus.ACTIVE_COMPETITION) revert CompetitionNotActive();
        if (block.timestamp < competition.voluntaryEndTime - TIMESTAMP_TOLERANCE) 
            revert CompetitionNotEnded();
        
        // Find winner
        bytes32 winner = bytes32(0);
        uint256 winningScore = 0;
        
        bytes32[] memory participants = 
            competitionSystem.competitionSovereigns[competitionId];
        uint256 participantsLength = participants.length;
        for (uint256 i = 0; i < participantsLength; i++) {
            CompetitionParticipation memory entry = competitionSystem
                .competitionParticipation[competitionId][participants[i]];
            
            // Only consider active participants for winner determination
            if (!entry.activeParticipation) continue;
            
            uint256 score = _calculateCatallaxyScore(competitionId, participants[i]);
            
            if (score > winningScore) {
                winningScore = score;
                winner = participants[i];
            }
        }
        
        competition.competitionStatus = 
            VoluntaryMarketStatus.CATALLACTIC_COMPLETE;
        competition.mostSovereignWinner = winner;
        competition.winningLibertyScore = winningScore;
        
        // Distribute prizes
        if (winner != bytes32(0)) {
            rewardSystem.unclaimedSovereigntyRewards[winner] += competition.libertyPrizePool;
            ++privacyMetrics.libertyCycleMetrics[winner][libertyCycleState.currentLibertyCycle]
            .competitionsWonThroughMerit;
            privacyMetrics.libertyCycleMetrics[winner][libertyCycleState.currentLibertyCycle]
                .freedomRewardsEarned += competition.libertyPrizePool;
        }
        
        emit VoluntaryCompetitionEnded(competitionId, winner, winningScore, competition.libertyPrizePool);
    }
    
    /**
     * @dev Claim accumulated rewards
     * @param playerCommitment Player commitment
     * @param nullifier Unique nullifier
     * @param zkProof ZK proof
     */
    function claimRewards(
        bytes32 playerCommitment,
        bytes32 nullifier,
        bytes calldata zkProof
    ) external validSovereignIndividual(playerCommitment) onlyValidPraxeologicalProof(zkProof, playerCommitment) {
        // Check nullifier to prevent duplicate claims
        if (privacyMetrics.nullifierUsed[nullifier]) revert NullifierAlreadyUsed();
        
        uint256 rewardAmount = rewardSystem.unclaimedSovereigntyRewards[playerCommitment];
        if (rewardAmount == 0) revert NoRewardsToClaim();
        
        rewardSystem.unclaimedSovereigntyRewards[playerCommitment] = 0;
        rewardSystem.totalLibertyClaimed[playerCommitment] += rewardAmount;
        
        // Mark nullifier as used to prevent duplicate claims
        privacyMetrics.nullifierUsed[nullifier] = true;
        
        // Emit event before external call
        emit FreedomRewardsClaimed(
            playerCommitment, 
            rewardAmount, 
            SovereigntyRewardType.LIBERTY_CYCLE_REWARDS, 
            block.timestamp
        );
        
        PRIVATE_TOKEN.transferFromPool(address(this), playerCommitment, rewardAmount);
    }
    
    /**
     * @dev Start new season
     */
    function startNewSeason() external {
        uint256 currentTime = block.timestamp;
        if (currentTime <= libertyCycleState.libertyEndTime) revert CurrentSeasonNotEnded();
        
        // End current season
        _endCurrentLibertyCycle();
        
        // Start new season
        ++libertyCycleState.currentLibertyCycle;
        libertyCycleState.libertyStartTime = currentTime;
        libertyCycleState.libertyEndTime = currentTime + LIBERTY_CYCLE_DURATION;
        
        _createLibertyCycleLeaderboard();
        
        emit LibertyCycleStarted(
            libertyCycleState.currentLibertyCycle, 
            libertyCycleState.libertyStartTime, 
            libertyCycleState.libertyEndTime, 
            0
        );
    }
    
    /**
     * @dev Internal function to initialize liberty achievements
     * @notice "The ultimate goal of action is always the satisfaction of the 
     * acting man's desire" - Ludwig von Mises
     */
    function _initializeLibertyAchievements() internal {
        // Praxeological Action achievements - Human Action in pursuit of freedom
        _createLibertyAchievement(
            "First Act of Sovereignty", 
            "Complete your first voluntary exchange in privacy", 
            AustrianAchievementType.PRAXEOLOGICAL_SPECIAL, 
            1, 
            100e18, 
            50
        );
        _createLibertyAchievement(
            "Methodological Individualist", 
            "Complete 10 voluntary exchanges", 
            AustrianAchievementType.PRAXEOLOGICAL_SPECIAL, 
            10, 
            500e18, 
            100
        );
        _createLibertyAchievement(
            "Austrian School Graduate", 
            "Complete 100 voluntary exchanges", 
            AustrianAchievementType.PRAXEOLOGICAL_SPECIAL, 
            100, 
            2000e18, 
            200
        );
        _createLibertyAchievement(
            "Praxeological Master", 
            "Complete 1000 voluntary exchanges", 
            AustrianAchievementType.PRAXEOLOGICAL_SPECIAL, 
            1000, 
            10_000e18, 
            500
        );
        
        // Sound Money achievements - Protecting wealth from debasement
        _createLibertyAchievement(
            "Sound Money Advocate", 
            "Protect 1000 tokens from surveillance", 
            AustrianAchievementType.SOUND_MONEY_MILESTONE, 
            1000e18, 
            200e18, 
            75
        );
        _createLibertyAchievement(
            "Monetary Sovereignty Defender", 
            "Protect 100,000 tokens from debasement", 
            AustrianAchievementType.SOUND_MONEY_MILESTONE, 
            100_000e18, 
            5_000e18, 
            300
        );
        _createLibertyAchievement(
            "Digital Gold Standard", 
            "Protect 1,000,000 tokens through privacy", 
            AustrianAchievementType.SOUND_MONEY_MILESTONE, 
            1_000_000e18, 
            25_000e18, 
            750
        );
        
        // Economic Sovereignty achievements - Individual liberty scores
        _createLibertyAchievement(
            "Liberty Awakening", 
            "Achieve sovereignty score of 5000", 
            AustrianAchievementType.SOVEREIGNTY_SCORE, 
            5000, 
            1000e18, 
            200
        );
        _createLibertyAchievement(
            "Freedom Fighter", 
            "Achieve sovereignty score of 8000", 
            AustrianAchievementType.SOVEREIGNTY_SCORE, 
            8000, 
            3000e18, 
            400
        );
        _createLibertyAchievement(
            "Sovereign Individual", 
            "Achieve sovereignty score of 9500", 
            AustrianAchievementType.SOVEREIGNTY_SCORE, 
            9500, 
            10_000e18, 
            1000
        );
        
        // Catallactic Consistency achievements - Market participation streaks
        _createLibertyAchievement(
            "Consistent Market Participant", 
            "Maintain 7-day voluntary exchange streak", 
            AustrianAchievementType.LIBERTY_STREAK, 
            7, 
            500e18, 
            150
        );
        _createLibertyAchievement(
            "Dedicated Free Market Actor", 
            "Maintain 30-day voluntary exchange streak", 
            AustrianAchievementType.LIBERTY_STREAK, 
            30, 
            2500e18, 
            500
        );
        _createLibertyAchievement(
            "Lifelong Liberty Advocate", 
            "Maintain 100-day voluntary exchange streak", 
            AustrianAchievementType.LIBERTY_STREAK, 
            100, 
            15000e18, 
            1500
        );
        
        // Freedom Evangelism achievements - Spreading liberty
        _createLibertyAchievement(
            "Liberty Mentor", 
            "Guide 5 new sovereigns to freedom", 
            AustrianAchievementType.FREEDOM_ADVOCACY, 
            5, 
            1000e18, 
            200
        );
        _createLibertyAchievement(
            "Austrian Ambassador", 
            "Guide 25 new sovereigns to economic freedom", 
            AustrianAchievementType.FREEDOM_ADVOCACY, 
            25, 
            7500e18, 
            750
        );
        _createLibertyAchievement(
            "Mises Evangelist", 
            "Guide 100 new sovereigns to monetary sovereignty", 
            AustrianAchievementType.FREEDOM_ADVOCACY, 
            100, 
            50000e18, 
            2000
        );
    }
    
    /**
     * @dev Create a new liberty achievement
     * @notice "The ultimate goal of action is always the satisfaction of 
     * the acting man's desire" - Ludwig von Mises
     */
    function _createLibertyAchievement(
        string memory libertyTitle,
        string memory catallaxyDescription,
        AustrianAchievementType achievementType,
        uint256 sovereigntyRequirement,
        uint256 libertyRewardAmount,
        uint256 sovereigntyScoreBonus
    ) internal {
        uint256 currentTime = block.timestamp;
        achievementSystem.libertyAchievements[achievementSystem.nextLibertyAchievementId] = 
            LibertyAchievement({
            achievementId: achievementSystem.nextLibertyAchievementId,
            libertyTitle: libertyTitle,
            praxeologicalDescription: catallaxyDescription,
            achievementType: achievementType,
            sovereigntyRequirement: sovereigntyRequirement,
            libertyRewardAmount: libertyRewardAmount,
            sovereigntyScoreBonus: sovereigntyScoreBonus,
            activeInMarket: true,
            totalSovereignsAchieved: 0,
            establishedAt: currentTime
        });
        
        ++achievementSystem.nextLibertyAchievementId;
    }
    
    /**
     * @dev Check all liberty achievements for a sovereign individual
     * @notice "Human action is purposeful behavior" - Ludwig von Mises
     */
    function _checkAllLibertyAchievements(bytes32 sovereignCommitment) internal {
        for (uint256 i = 1; i < achievementSystem.nextLibertyAchievementId; i++) {
            if (!achievementSystem.sovereigntyAchievements[sovereignCommitment][i] && 
                achievementSystem.libertyAchievements[i].activeInMarket) {
                _checkSpecificLibertyAchievement(sovereignCommitment, i);
            }
        }
    }
    
    /**
     * @dev Check specific liberty achievement by ID
     * @notice "The market economy is the social system of the division of 
     * labor under private ownership" - Ludwig von Mises
     */
    function _checkSpecificLibertyAchievement(
        bytes32 sovereignCommitment,
        uint256 achievementId
    ) internal {
        LibertyAchievement memory achievement = achievementSystem.libertyAchievements[achievementId];
        SovereignIndividual storage sovereign = 
            sovereignRegistry.sovereigntyIndividuals[sovereignCommitment];
        MonetarySovereigntyMetrics memory metrics = 
            privacyMetrics.monetarySovereigntyMetrics[sovereignCommitment];
        
        bool achieved = false;
        
        // Check achievement requirements based on type
        if (achievement.achievementType == AustrianAchievementType.PRAXEOLOGICAL_SPECIAL) {
            // For registration achievement, just check if registered
            achieved = true; // Already registered if this function is called
        } else if (achievement.achievementType == AustrianAchievementType.SOVEREIGNTY_SCORE) {
            achieved = metrics.averageSovereigntyScore >= achievement.sovereigntyRequirement;
        } else if (achievement.achievementType == AustrianAchievementType.SOUND_MONEY_MILESTONE) {
            achieved = sovereign.totalPrivateWealth >= achievement.sovereigntyRequirement;
        } else if (achievement.achievementType == AustrianAchievementType.VOLUNTARY_EXCHANGE_COUNT) {
            achieved = sovereign.totalVoluntaryExchanges >= achievement.sovereigntyRequirement;
        } else if (achievement.achievementType == AustrianAchievementType.LIBERTY_STREAK) {
            achieved = metrics.consecutiveLibertyStreak >= achievement.sovereigntyRequirement;
        } else if (achievement.achievementType == AustrianAchievementType.FREEDOM_ADVOCACY) {
            achieved = sovereign.freedomAdvocacyCount >= achievement.sovereigntyRequirement;
        } else {
            // For other types, use sovereignty score
            achieved = metrics.averageSovereigntyScore >= achievement.sovereigntyRequirement;
        }
        
        if (achieved) {
            _awardLibertyAchievement(sovereignCommitment, achievementId);
        }
    }
    
    /**
     * @dev Check specific liberty achievement (legacy function for compatibility)
     */
    function _checkLibertyAchievement(
        bytes32 sovereignCommitment,
        AustrianAchievementType achievementType,
        uint256 sovereigntyRequirement
    ) internal {
        // For the "First Sovereign" achievement when registering
        if (achievementType == AustrianAchievementType.PRAXEOLOGICAL_SPECIAL && sovereigntyRequirement == 1) {
            _checkSpecificLibertyAchievement(sovereignCommitment, 1);
        } else {
            // Check all achievements
            _checkAllLibertyAchievements(sovereignCommitment);
        }
    }
    
    /**
     * @dev Award liberty achievement to sovereign individual
     * @notice "The ultimate goal of action is always the satisfaction of the acting man's desire" - Ludwig von Mises
     */
    function _awardLibertyAchievement(bytes32 sovereignCommitment, uint256 achievementId) internal {
        LibertyAchievement storage achievement = 
            achievementSystem.libertyAchievements[achievementId];
        SovereignIndividual storage sovereign = 
            sovereignRegistry.sovereigntyIndividuals[sovereignCommitment];
        
        achievementSystem.sovereigntyAchievements[sovereignCommitment][achievementId] = 
            true;
        achievementSystem.sovereigntyAchievementsList[sovereignCommitment].push(
            achievementId);
        
        ++sovereign.libertyAchievementCount;
        
        // Update sovereignty metrics through praxeological action
        LibertyCycleMetrics storage cycleMetrics = 
            privacyMetrics.libertyCycleMetrics[sovereignCommitment][libertyCycleState.currentLibertyCycle];
        cycleMetrics.sovereigntyScore += achievement.sovereigntyScoreBonus;
        
        // Ensure sovereignty score doesn't exceed maximum
        if (cycleMetrics.sovereigntyScore > MAX_SOVEREIGNTY_SCORE) {
            cycleMetrics.sovereigntyScore = MAX_SOVEREIGNTY_SCORE;
        }
        
        ++achievement.totalSovereignsAchieved;
        
        // Award freedom rewards
        rewardSystem.unclaimedSovereigntyRewards[sovereignCommitment] += 
            achievement.libertyRewardAmount;
        ++cycleMetrics.libertyAchievementsEarned;
        cycleMetrics.freedomRewardsEarned += achievement.libertyRewardAmount;
        
        emit LibertyAchievementEarned(
            sovereignCommitment,
            achievementId,
            achievement.libertyTitle,
            achievement.libertyRewardAmount
        );
    }
    
    /**
     * @dev Update privacy metrics
     */
    function _updatePrivacyMetrics(
        bytes32 sovereignCommitment,
        PraxeologicalSubmission calldata submission
    ) internal {
        MonetarySovereigntyMetrics storage metrics = 
            privacyMetrics.monetarySovereigntyMetrics[sovereignCommitment];
        
        uint256 previousLastAction = metrics.lastSovereignAction;

        metrics.sovereignCommitment = sovereignCommitment;
        metrics.totalPrivateExchanges += submission.voluntaryExchangeCount;
        metrics.totalSoundMoneyVolume += submission.soundMoneyVolume;
        metrics.lastSovereignAction = block.timestamp;
        
        // Update average sovereignty score
        // Use totalPrivateExchanges to check if this is the first submission 
        // (more robust than == 0)
        if (metrics.totalPrivateExchanges <= 1) { 
            // First submission after increment above
            metrics.averageSovereigntyScore = submission.sovereigntyScore;
        } else {
            metrics.averageSovereigntyScore = 
                (metrics.averageSovereigntyScore * 9 + submission.sovereigntyScore) / 10;
        }
        
        // Update liberty streak (use timestamp *before* this update; previously always 0 days)
        uint256 daysSinceLastActivity = previousLastAction == 0
            ? type(uint256).max
            : (block.timestamp - previousLastAction) / 1 days;
        if (daysSinceLastActivity <= 1) {
            ++metrics.consecutiveLibertyStreak;
            if (metrics.consecutiveLibertyStreak > metrics.longestFreedomStreak) {
                metrics.longestFreedomStreak = metrics.consecutiveLibertyStreak;
            }
        } else {
            metrics.consecutiveLibertyStreak = 1;
        }
        
        // Calculate monetary independence rating
        metrics.monetaryIndependenceRating = 
            _calculateSovereigntyRating(sovereignCommitment);
    }
    
    /**
     * @dev Calculate sovereignty rating based on Austrian School principles
     */
    function _calculateSovereigntyRating(bytes32 sovereignCommitment) internal view returns (uint256) {
        SovereignIndividual memory sovereign = 
            sovereignRegistry.sovereigntyIndividuals[sovereignCommitment];
        MonetarySovereigntyMetrics memory metrics = 
            privacyMetrics.monetarySovereigntyMetrics[sovereignCommitment];
        
        uint256 sovereigntyWeight = (sovereign.sovereigntyScore * 40) / MAX_SOVEREIGNTY_SCORE;
        uint256 soundMoneyWeight = (metrics.totalSoundMoneyVolume * 30) / 1_000_000e18; 
        // Normalize to 1M sound money units
        uint256 catallaxyWeight = (metrics.consecutiveLibertyStreak * 20) / 100; 
        // Normalize to 100 days of market participation
        uint256 praxeologyWeight = (metrics.totalPrivateExchanges * 10) / 1000; 
        // Normalize to 1000 voluntary exchanges
        
        uint256 sovereigntyRating = 
            sovereigntyWeight + soundMoneyWeight + catallaxyWeight + praxeologyWeight;
        return sovereigntyRating > 100 ? 100 : sovereigntyRating;
    }
    
    /**
     * @dev Update sovereignty tier based on Austrian School principles 
     * and market participation
     */
    function _updateSovereigntyTier(bytes32 sovereignCommitment) internal {
        SovereignIndividual storage sovereign = 
            sovereignRegistry.sovereigntyIndividuals[sovereignCommitment];
        uint256 sovereigntyScore = sovereign.sovereigntyScore;
        uint256 voluntaryExchanges = sovereign.totalVoluntaryExchanges;
        
        EconomicSovereigntyTier newTier = EconomicSovereigntyTier.LIBERTY_SEEKER;
        
        if (sovereigntyScore >= 9000 && voluntaryExchanges >= 1000) {
            newTier = EconomicSovereigntyTier.MISESIAN_SOVEREIGN; 
            // Ultimate free market advocate
        } else if (sovereigntyScore >= 7500 && voluntaryExchanges >= 500) {
            newTier = EconomicSovereigntyTier.PRAXEOLOGICAL_MASTER; 
            // Master of spontaneous order
        } else if (sovereigntyScore >= 6000 && voluntaryExchanges >= 250) {
            newTier = EconomicSovereigntyTier.AUSTRIAN_SCHOLAR; 
            // Expert in human action
        } else if (sovereigntyScore >= 4000 && voluntaryExchanges >= 100) {
            newTier = EconomicSovereigntyTier.SOUND_MONEY_ADVOCATE; 
            // Strong advocate for economic freedom
        } else if (sovereigntyScore >= 2000 && voluntaryExchanges >= 25) {
            newTier = EconomicSovereigntyTier.MARKET_PARTICIPANT; 
            // Active in voluntary exchange
        }
        
        sovereign.sovereigntyTier = newTier;
    }
    
    /**
     * @dev Update sovereignty leaderboard rankings based on 
     * free market principles
     */
    function _updateSovereigntyLeaderboard(bytes32 sovereignCommitment) internal {
        LibertyCycleMetrics storage metrics = 
            privacyMetrics.libertyCycleMetrics[sovereignCommitment][libertyCycleState.currentLibertyCycle];
        
        // Update sovereignty leaderboard position
        bytes32[] storage rankings = 
            leaderboardRankings.sovereigntyRankings[libertyCycleState.currentLibertyCycle];
        
        // Remove sovereign individual from current position if exists
        uint256 rankingsLength = rankings.length;
        for (uint256 i = 0; i < rankingsLength; i++) {
            if (rankings[i] == sovereignCommitment) {
                // Remove from current position
                for (uint256 j = i; j < rankingsLength - 1; j++) {
                    rankings[j] = rankings[j + 1];
                }
                rankings.pop();
                --rankingsLength; // Update cached length after pop
                break;
            }
        }
        
        // Find new position based on sovereignty score
        uint256 newPosition = rankingsLength;
        for (uint256 i = 0; i < rankingsLength; i++) {
            if (metrics.sovereigntyScore > 
                privacyMetrics.libertyCycleMetrics[rankings[i]][libertyCycleState.currentLibertyCycle]
                .sovereigntyScore) {
                newPosition = i;
                break;
            }
        }
        
        // Insert at new position
        rankings.push(bytes32(0));
        for (uint256 i = rankings.length - 1; i > newPosition; i--) {
            rankings[i] = rankings[i - 1];
        }
        rankings[newPosition] = sovereignCommitment;
        
        // Update rank
        metrics.sovereigntyRank = newPosition + 1;
        leaderboardRankings.individualSovereigntyRanks[sovereignCommitment] = 
            newPosition + 1;
        
        // Limit leaderboard size to maintain efficiency
        if (rankings.length > MAX_SOVEREIGN_PARTICIPANTS) {
            rankings.pop();
        }
        
        emit SovereigntyLeaderboardUpdated(
            libertyCycleState.currentLibertyCycle, 
            sovereignCommitment, 
            newPosition + 1, 
            metrics.sovereigntyScore
        );
    }
    
    /**
     * @dev Calculate catallactic score based on Austrian School 
     * market principles
     */
    function _calculateCatallaxyScore(
        uint256 competitionId, 
        bytes32 sovereignCommitment
    ) internal view returns (uint256) {
        VoluntaryCompetition memory competition = 
            competitionSystem.voluntaryCompetitions[competitionId];
        CompetitionParticipation memory participation = 
            competitionSystem.competitionParticipation[competitionId][sovereignCommitment];
        LibertyCycleMetrics memory metrics = 
            privacyMetrics.libertyCycleMetrics[sovereignCommitment][libertyCycleState.currentLibertyCycle];
        
        // Use range-based logic to avoid incorrect-equality warnings
        uint8 compTypeValue = uint8(competition.competitionType);
        
        if (compTypeValue < 1) { // SOVEREIGNTY_MAXIMIZATION = 0
            // Combine sovereignty score with participation-specific metrics
            return metrics.sovereigntyScore + participation.sovereigntyScore;
        }
        if (compTypeValue < 2) { // SOUND_MONEY_VOLUME = 1
            // Use participation private wealth if available, otherwise use metrics
            return participation.privateWealth > 0 ? participation.privateWealth : metrics.privateWealth;
        }
        if (compTypeValue < 3) { // VOLUNTARY_EXCHANGE_COUNT = 2
            // Use participation voluntary exchanges if available, otherwise use metrics
            return participation.voluntaryExchanges > 0 ? participation.voluntaryExchanges : metrics.voluntaryExchanges;
        }
        if (compTypeValue < 4) { // LIBERTY_STREAK_CHALLENGE = 3
            return privacyMetrics.monetarySovereigntyMetrics[sovereignCommitment]
                .consecutiveLibertyStreak;
        }
        
        return 0;
    }
    
    /**
     * @dev Create liberty cycle leaderboard based on Austrian School principles
     */
    function _createLibertyCycleLeaderboard() internal {
        privacyMetrics.libertyCycleLeaderboards[libertyCycleState.currentLibertyCycle] = 
            FreeMarketLeaderboard({
                libertyCycle: libertyCycleState.currentLibertyCycle,
                totalSovereigns: 0,
                totalLibertyPrizePool: 0,
                cycleStartTime: libertyCycleState.libertyStartTime,
                cycleEndTime: libertyCycleState.libertyEndTime,
                marketStatus: MarketStatus.ACTIVE_CATALLACTICS,
                mostSovereignIndividual: bytes32(0),
                peakSovereigntyScore: 0
            });
    }
    
    /**
     * @dev End current liberty cycle based on Austrian School market completion
     */
    function _endCurrentLibertyCycle() internal {
        FreeMarketLeaderboard storage leaderboard = 
            privacyMetrics.libertyCycleLeaderboards[libertyCycleState.currentLibertyCycle];
        leaderboard.marketStatus = MarketStatus.CYCLE_COMPLETED;
        
        bytes32[] memory rankings = 
            leaderboardRankings.sovereigntyRankings[libertyCycleState.currentLibertyCycle];
        if (rankings.length > 0) {
            leaderboard.mostSovereignIndividual = rankings[0];
            leaderboard.peakSovereigntyScore = 
                privacyMetrics.libertyCycleMetrics[rankings[0]][libertyCycleState.currentLibertyCycle].sovereigntyScore;
        }
        
        leaderboard.totalSovereigns = rankings.length;
        
        emit LibertyCycleEnded(
            libertyCycleState.currentLibertyCycle, 
            leaderboard.mostSovereignIndividual, 
            leaderboard.peakSovereigntyScore, 
            rankings.length
        );
    }
    
    /**
     * @dev Create default achievements for the leaderboard
     */
    function _createDefaultAchievements() internal {
        // First Sovereign Achievement
        achievementSystem.libertyAchievements[1] = LibertyAchievement({
            achievementId: 1,
            libertyTitle: "First Sovereign",
            praxeologicalDescription: "Register as a sovereign individual",
            achievementType: AustrianAchievementType.PRAXEOLOGICAL_SPECIAL,
            sovereigntyRequirement: 1,
            libertyRewardAmount: 100e18,
            sovereigntyScoreBonus: 10,
            activeInMarket: true,
            totalSovereignsAchieved: 0,
            establishedAt: block.timestamp
        });
        
        // Sound Money Advocate Achievement
        achievementSystem.libertyAchievements[2] = LibertyAchievement({
            achievementId: 2,
            libertyTitle: "Sound Money Advocate",
            praxeologicalDescription: "Accumulate 1000 units of sound money",
            achievementType: AustrianAchievementType.SOUND_MONEY_MILESTONE,
            sovereigntyRequirement: 1000e18,
            libertyRewardAmount: 500e18,
            sovereigntyScoreBonus: 25,
            activeInMarket: true,
            totalSovereignsAchieved: 0,
            establishedAt: block.timestamp
        });
        
        // Market Participant Achievement
        achievementSystem.libertyAchievements[3] = LibertyAchievement({
            achievementId: 3,
            libertyTitle: "Market Participant",
            praxeologicalDescription: "Complete 10 voluntary exchanges",
            achievementType: AustrianAchievementType.VOLUNTARY_EXCHANGE_COUNT,
            sovereigntyRequirement: 10,
            libertyRewardAmount: 250e18,
            sovereigntyScoreBonus: 15,
            activeInMarket: true,
            totalSovereignsAchieved: 0,
            establishedAt: block.timestamp
        });
        
        achievementSystem.nextLibertyAchievementId = 4;
    }
    
    // View functions - Austrian School Economic Inquiry
    function getSovereignIndividual(bytes32 sovereignCommitment) 
        external view returns (SovereignIndividual memory) {
        return sovereignRegistry.sovereigntyIndividuals[sovereignCommitment];
    }
    
    function sovereigntyIndividuals(bytes32 sovereignCommitment) 
        external view returns (SovereignIndividual memory) {
        return sovereignRegistry.sovereigntyIndividuals[sovereignCommitment];
    }
    
    function getLibertyCycleMetrics(bytes32 sovereignCommitment, uint256 libertyCycle) 
        external view returns (LibertyCycleMetrics memory) {
        return privacyMetrics.libertyCycleMetrics[sovereignCommitment][libertyCycle];
    }
    
    function getFreeMarketLeaderboard(uint256 libertyCycle) 
        external view returns (FreeMarketLeaderboard memory) {
        return privacyMetrics.libertyCycleLeaderboards[libertyCycle];
    }
    
    function getSovereigntyRankings(uint256 libertyCycle) external view returns (bytes32[] memory) {
        return leaderboardRankings.sovereigntyRankings[libertyCycle];
    }
    
    function getLibertyAchievement(uint256 achievementId) external view returns (LibertyAchievement memory) {
        return achievementSystem.libertyAchievements[achievementId];
    }
    
    function getSovereignAchievements(bytes32 sovereignCommitment) external view returns (uint256[] memory) {
        return achievementSystem.sovereigntyAchievementsList[sovereignCommitment];
    }
    
    function getVoluntaryCompetition(uint256 competitionId) external view returns (VoluntaryCompetition memory) {
        return competitionSystem.voluntaryCompetitions[competitionId];
    }
    
    function getCatallaxyParticipation(
        uint256 competitionId, 
        bytes32 sovereignCommitment
    ) external view returns (CompetitionParticipation memory) {
        return competitionSystem.competitionParticipation[competitionId][sovereignCommitment];
    }
    
    function getMonetarySovereigntyMetrics(bytes32 sovereignCommitment) 
        external view returns (MonetarySovereigntyMetrics memory) {
        return privacyMetrics.monetarySovereigntyMetrics[sovereignCommitment];
    }
    
    function getDailyPraxeology(bytes32 sovereignCommitment, uint256 date) 
        external view returns (DailyPraxeology memory) {
        return privacyMetrics.dailyPraxeology[sovereignCommitment][date];
    }
    
    function getUnclaimedSovereigntyRewards(bytes32 sovereignCommitment) 
        external view returns (uint256) {
        return rewardSystem.unclaimedSovereigntyRewards[sovereignCommitment];
    }
    
    function getTotalFreedomRewardsClaimed(bytes32 sovereignCommitment) 
        external view returns (uint256) {
        return rewardSystem.totalLibertyClaimed[sovereignCommitment];
    }
    
    function getIndividualSovereigntyRank(bytes32 sovereignCommitment) 
        external view returns (uint256) {
        return leaderboardRankings.individualSovereigntyRanks[sovereignCommitment];
    }
    
    function getActiveSovereignsCount() external view returns (uint256) {
        return sovereignRegistry.activeSovereignCommitments.length;
    }
    
    function getCurrentLibertyCycleInfo() 
        external view returns (uint256, uint256, uint256) {
        return (
            libertyCycleState.currentLibertyCycle, 
            libertyCycleState.libertyStartTime, 
            libertyCycleState.libertyEndTime
        );
    }
    
    function hasLibertyAchievement(bytes32 sovereignCommitment, uint256 achievementId) 
        external view returns (bool) {
        return achievementSystem.sovereigntyAchievements[sovereignCommitment][achievementId];
    }
    
    // Additional getter functions required by tests
    function privateToken() external view returns (address) {
        return address(PRIVATE_TOKEN);
    }
    
    function verifierFactory() external view returns (address) {
        return address(VERIFIER_FACTORY);
    }
    
    function nextLibertyAchievementId() external view returns (uint256) {
        return achievementSystem.nextLibertyAchievementId;
    }
    
    function nextVoluntaryCompetitionId() external view returns (uint256) {
        return competitionSystem.nextVoluntaryCompetitionId;
    }
    
    function registeredSovereigns(bytes32 sovereignCommitment) external view returns (bool) {
        return sovereignRegistry.registeredSovereigns[sovereignCommitment];
    }
    
    function totalRegisteredSovereigns() external view returns (uint256) {
        return sovereignRegistry.totalRegisteredSovereigns;
    }
    
    function libertyAchievements(uint256 achievementId) external view returns (LibertyAchievement memory) {
        return achievementSystem.libertyAchievements[achievementId];
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

}