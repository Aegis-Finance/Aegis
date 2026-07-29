// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./interfaces/ICommonErrors.sol";

import {VerifierFactory} from "./VerifierFactory.sol";
import {CommitmentLib} from "./libraries/CommitmentLib.sol";
import {PrivateTokenContract} from "./PrivateTokenContract.sol";
import {GovernanceAccessLib} from "./libraries/GovernanceAccessLib.sol";
import {ProofUtils} from "./utils/ProofUtils.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Custom errors for gas optimization

/**
 * @title DecentralizedPrivacyRewards
 * @author Aegis Protocol Team
 * @notice Implements privacy mining, proof rewards, and anonymous airdrops
 * @dev Fully decentralized privacy rewards system with ZK-proof verification.
 *      **Incentive economics:** large fixed rates (`PRIVACY_MINING_RATE`, `ZK_PROOF_BONUS`) plus caps (`DAILY_MINING_CAP`,
 *      `epochMiningAmount`) trade off **subsidy for privacy work** vs **procyclical dilution** risk (cf. aggressive
 *      liquidity mining in DeFi crises). Governance should treat emissions as **quasi-fiscal** policy: monitor
 *      pool balances, Sybil resistance, and whether `userEpochMining` limits align with product goals—see
 *      `docs/PRIVACY_REWARDS_INCENTIVE_AND_CAP_POLICY.md`.
 */
contract DecentralizedPrivacyRewards is ICommonErrors {
    using CommitmentLib for bytes32;
    using SafeERC20 for IERC20;

    // Core contracts
    /// @notice The private token contract used for rewards distribution
    PrivateTokenContract public immutable PRIVATE_TOKEN;
    /// @notice The verifier factory contract for ZK proof verification
    VerifierFactory public immutable VERIFIER_FACTORY;
    
    // Governance
    /// @notice The governance contract address for administrative functions
    address public governanceContract;

    /// @notice Optional `AegisTimelockController` for delayed governance execution.
    address public timelockController;

    event TimelockControllerUpdated(address indexed previousTimelock, address indexed newTimelock);
    
    // Circuit identifier for reward proofs
    string private constant REWARD_CIRCUIT = "reward";
    
    // Privacy mining parameters
    /// @notice Base reward rate for privacy mining actions (100 tokens per action)
    uint256 public constant PRIVACY_MINING_RATE = 100e18; // 100 tokens per privacy action
    /// @notice Bonus reward for ZK proof complexity (50 tokens base bonus)
    uint256 public constant ZK_PROOF_BONUS = 50e18; // 50 tokens bonus for ZK proofs
    /// @notice Maximum tokens that can be mined per day (10,000 tokens)
    uint256 public constant DAILY_MINING_CAP = 10000e18; // 10,000 tokens per day
    /// @notice Duration of each mining epoch (1 day)
    uint256 public constant EPOCH_DURATION = 1 days;
    
    // Timestamp security constants
    uint256 private constant TIMESTAMP_TOLERANCE = 900; // 15 minutes tolerance for timestamp comparisons
    uint256 private constant MAX_FUTURE_TOLERANCE = 300; // 5 minutes tolerance for future timestamps
    uint256 private constant MAX_PAST_TOLERANCE = 3600; // 1 hour tolerance for past timestamps

    // Reward pools
    /// @notice Total tokens available for privacy mining rewards
    uint256 public privacyMiningPool;
    /// @notice Total tokens available for ZK proof complexity rewards
    uint256 public zkProofRewardPool;
    /// @notice Total tokens available for anonymous airdrops
    uint256 public airdropPool;
    /// @notice Current mining epoch number
    uint256 public currentEpoch;
    /// @notice Timestamp of the last epoch update
    uint256 public lastEpochUpdate;
    
    // Privacy action tracking (anonymous)
    /// @notice Tracks whether a nullifier has been used to prevent double-spending
    mapping(bytes32 => bool) public nullifierUsed;
    /// @notice Total amount mined in each epoch for daily cap enforcement
    mapping(uint256 => uint256) public epochMiningAmount;
    /// @notice Tracks rewards earned by each commitment for transparency
    mapping(bytes32 => uint256) public commitmentRewards;
    /// @notice Tracks mining amount per user per epoch for rate limiting
    mapping(address => uint256) public userEpochMining;
    
    // Airdrop merkle trees for anonymous distribution
    /// @notice Tracks whether an airdrop has been claimed for a specific merkle root
    mapping(bytes32 => bool) public airdropClaimed;
    /// @notice Maps airdrop round numbers to their corresponding merkle roots
    mapping(uint256 => bytes32) public airdropMerkleRoots;
    /// @notice Current airdrop round number for merkle tree management
    uint256 public currentAirdropRound;
    
    // Privacy score system
    /// @notice Maps commitments to their calculated privacy scores
    mapping(bytes32 => uint256) public privacyScores;
    /// @notice Maximum possible privacy score for reward calculations
    uint256 public constant MAX_PRIVACY_SCORE = 1000;

    /// @notice Canonical 30% ecosystem tranche from `TokenAllocation` is 6.3M (18 decimals). Default convenience split is equal thirds; governance may call `creditRewardPoolsFromBalance` with any other split that fits `balanceOf(this)`.
    uint256 public constant DEFAULT_ECOSYSTEM_PRIVACY = 2_100_000 * 1e18;
    uint256 public constant DEFAULT_ECOSYSTEM_ZK = 2_100_000 * 1e18;
    uint256 public constant DEFAULT_ECOSYSTEM_AIRDROP = 2_100_000 * 1e18;
    
    // Events
    /// @notice Emitted when a privacy mining reward is claimed
    /// @param commitment The commitment hash for the privacy action
    /// @param amount The reward amount distributed
    /// @param privacyScore The calculated privacy score for the action
    event PrivacyMiningReward(bytes32 indexed commitment, uint256 indexed amount, uint256 indexed privacyScore);
    
    /// @notice Emitted when a ZK proof complexity reward is claimed
    /// @param nullifier The unique nullifier for the proof
    /// @param amount The reward amount distributed
    /// @param proofComplexity The complexity score of the ZK proof
    event ZKProofReward(bytes32 indexed nullifier, uint256 indexed amount, uint256 indexed proofComplexity);
    
    /// @notice Emitted when an anonymous airdrop is claimed
    /// @param merkleRoot The merkle root used for the airdrop claim
    /// @param nullifier The unique nullifier for the claim
    /// @param amount The airdrop amount claimed
    event AirdropClaimed(bytes32 indexed merkleRoot, bytes32 indexed nullifier, uint256 indexed amount);
    
    /// @notice Emitted when a new epoch begins
    /// @param epoch The new epoch number
    /// @param totalMined The total amount mined in the previous epoch
    event EpochUpdated(uint256 indexed epoch, uint256 indexed totalMined);
    
    /// @notice Emitted when a privacy score is updated for a commitment
    /// @param commitment The commitment hash
    /// @param newScore The updated privacy score
    event PrivacyScoreUpdated(bytes32 indexed commitment, uint256 indexed newScore);
    
    /// @notice Emitted when reward pools are funded
    /// @param privacyPool The amount added to the privacy mining pool
    /// @param zkPool The amount added to the ZK proof reward pool
    /// @param airdropPool The amount added to the airdrop pool
    event RewardPoolFunded(uint256 indexed privacyPool, uint256 indexed zkPool, uint256 indexed airdropPool);
    
    // Structs
    struct PrivacyAction {
        bytes32 commitment;
        bytes32 nullifier;
        uint256 actionType; // 1: transfer, 2: stake, 3: lend, 4: swap
        uint256 timestamp;
        bytes zkProof;
    }
    
    struct AirdropClaim {
        bytes32 merkleRoot;
        bytes32 nullifier;
        bytes32[] merkleProof;
        uint256 amount;
        bytes zkProof;
    }
    
    modifier validEpoch() {
        if (block.timestamp > lastEpochUpdate + EPOCH_DURATION - TIMESTAMP_TOLERANCE - 1) {
            _updateEpoch();
        }
        _;
    }
    
    modifier onlyValidProof(bytes memory proof, bytes32 commitment) {
        (uint256[8] memory convertedProof, uint256[] memory publicInputs) = _convertProofData(proof, commitment);
        if (!VERIFIER_FACTORY.verifyProof(REWARD_CIRCUIT, convertedProof, publicInputs)) revert InvalidZKProof();
        _;
    }
    
    /**
     * @notice Initializes the DecentralizedPrivacyRewards contract
     * @param _privateToken Address of the private token contract
     * @param _verifierFactory Address of the verifier factory contract
     * @param _governance Address of the governance contract for DAO control
     * @param _initialPrivacyPool Initial funding for the privacy mining pool
     * @param _initialZkPool Initial funding for the ZK proof reward pool
     * @param _initialAirdropPool Initial funding for the airdrop pool
     */
    constructor(
        address _privateToken,
        address _verifierFactory,
        address _governance,
        uint256 _initialPrivacyPool,
        uint256 _initialZkPool,
        uint256 _initialAirdropPool
    ) {
        if (_privateToken == address(0)) revert InvalidTokenAddress();
        if (_verifierFactory == address(0)) revert InvalidVerifierAddress();
        if (_governance == address(0)) revert InvalidAddress();
        
        PRIVATE_TOKEN = PrivateTokenContract(_privateToken);
        VERIFIER_FACTORY = VerifierFactory(_verifierFactory);
        governanceContract = _governance;
        
        privacyMiningPool = _initialPrivacyPool;
        zkProofRewardPool = _initialZkPool;
        airdropPool = _initialAirdropPool;
        
        currentEpoch = 1;
        lastEpochUpdate = block.timestamp;
        
        emit RewardPoolFunded(_initialPrivacyPool, _initialZkPool, _initialAirdropPool);
    }
    
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
        if (_governance == address(0)) revert InvalidAddress();
        governanceContract = _governance;
    }
    
    /**
     * @notice Claims privacy mining rewards for performing private actions
     * @param action Privacy action details with ZK proof
     */
    function claimPrivacyMiningReward(
        PrivacyAction calldata action
    ) external validEpoch onlyValidProof(action.zkProof, action.commitment) {
        if (nullifierUsed[action.nullifier]) revert NullifierAlreadyUsed();
        
        // Safe timestamp validation with tolerance
        uint256 currentTime = block.timestamp;
        if (action.timestamp > currentTime + MAX_FUTURE_TOLERANCE) revert FutureTimestamp();
        if (action.timestamp < currentTime - MAX_PAST_TOLERANCE) revert ActionTooOld();
        
        // Prevent double spending
        nullifierUsed[action.nullifier] = true;
        
        // Check daily mining cap
        if (epochMiningAmount[currentEpoch] + PRIVACY_MINING_RATE > DAILY_MINING_CAP) revert DailyMiningCapExceeded();
        
        // Calculate privacy score based on action complexity
        uint256 privacyScore = _calculatePrivacyScore(action);
        privacyScores[action.commitment] = privacyScore;
        
        // Calculate reward with privacy score multiplier
        uint256 baseReward = PRIVACY_MINING_RATE;
        // Fix divide-before-multiply: multiply first, then divide
        uint256 totalReward = baseReward + (baseReward * privacyScore) / MAX_PRIVACY_SCORE;
        
        // Ensure sufficient pool balance
        if (privacyMiningPool < totalReward) revert InsufficientPrivacyMiningPool();
        
        // Update tracking
        privacyMiningPool -= totalReward;
        epochMiningAmount[currentEpoch] += totalReward;
        userEpochMining[msg.sender] += totalReward;
        commitmentRewards[action.commitment] = totalReward;
        
        // Emit events before external call
        emit PrivacyMiningReward(action.commitment, totalReward, privacyScore);
        emit PrivacyScoreUpdated(action.commitment, privacyScore);
        
        // Austrian Economic Principle: Transfer from existing supply, don't mint new tokens
        // "Inflation is a policy that cannot last" - Ludwig von Mises
        // Transfer rewards from this contract's balance to user's transparent balance
        // User can then shield tokens to commitments if desired for privacy
        if (PRIVATE_TOKEN.balanceOf(address(this)) < totalReward) revert InsufficientRewardPoolBalance();
        // CRITICAL: Use SafeERC20 to ensure transfer success and prevent unchecked transfer vulnerabilities
        IERC20(address(PRIVATE_TOKEN)).safeTransfer(msg.sender, totalReward);
    }
    
    /**
     * @notice Claims ZK proof complexity rewards
     * @param nullifier Unique nullifier for the proof
     * @param proofComplexity Complexity score of the ZK proof
     * @param zkProof ZK proof of complexity calculation
     */
    function claimZKProofReward(
        bytes32 nullifier,
        uint256 proofComplexity,
        bytes calldata zkProof
    ) external validEpoch onlyValidProof(zkProof, nullifier) {
        if (nullifierUsed[nullifier]) revert NullifierAlreadyUsed();
        if (proofComplexity == 0 || proofComplexity > 1000) revert InvalidComplexityScore();
        
        nullifierUsed[nullifier] = true;
        
        // Calculate reward based on proof complexity
        uint256 complexityBonus = (ZK_PROOF_BONUS * proofComplexity) / 1000;
        uint256 totalReward = ZK_PROOF_BONUS + complexityBonus;
        
        if (zkProofRewardPool < totalReward) revert InsufficientZKProofRewardPool();
        
        zkProofRewardPool -= totalReward;
        
        // Austrian Economic Principle: Transfer from existing supply, don't mint new tokens
        // "Sound money requires a fixed supply" - Murray Rothbard
        // Transfer rewards from this contract's balance to user's transparent balance
        if (PRIVATE_TOKEN.balanceOf(address(this)) < totalReward) revert InsufficientRewardPoolBalance();
        
        // Emit event before external call
        emit ZKProofReward(nullifier, totalReward, proofComplexity);
        
        // CRITICAL: Use SafeERC20 to ensure transfer success and prevent unchecked transfer vulnerabilities
        IERC20(address(PRIVATE_TOKEN)).safeTransfer(msg.sender, totalReward);
    }
    
    /**
     * @notice Claims anonymous airdrop using merkle proof
     * @param claim Airdrop claim with merkle proof and ZK proof
     */
    function claimAirdrop(
        AirdropClaim calldata claim
    ) external onlyValidProof(claim.zkProof, claim.nullifier) {
        if (nullifierUsed[claim.nullifier]) revert NullifierAlreadyUsed();
        if (airdropClaimed[claim.merkleRoot]) revert AirdropAlreadyClaimedForRoot();
        if (airdropMerkleRoots[currentAirdropRound] != claim.merkleRoot) revert InvalidMerkleRoot();
        
        // Verify merkle proof
        bytes32 leaf = keccak256(abi.encodePacked(claim.nullifier, claim.amount));
        if (!_verifyMerkleProof(claim.merkleProof, claim.merkleRoot, leaf)) revert InvalidMerkleProof();
        
        if (airdropPool < claim.amount) revert InsufficientAirdropPool();
        
        nullifierUsed[claim.nullifier] = true;
        airdropClaimed[claim.merkleRoot] = true;
        airdropPool -= claim.amount;
        
        // Austrian Economic Principle: Transfer from existing supply, don't mint new tokens
        // "The gold standard was the world standard of the age of capitalism" - Ludwig von Mises
        // Transfer airdrop from this contract's balance to user's transparent balance
        if (PRIVATE_TOKEN.balanceOf(address(this)) < claim.amount) revert InsufficientRewardPoolBalance();
        
        // Emit event before external call
        emit AirdropClaimed(claim.merkleRoot, claim.nullifier, claim.amount);
        
        // CRITICAL: Use SafeERC20 to ensure transfer success and prevent unchecked transfer vulnerabilities
        IERC20(address(PRIVATE_TOKEN)).safeTransfer(msg.sender, claim.amount);
    }
    
    /**
     * @notice Funds reward pools by pulling tokens from the caller (governance).
     * @param privacyAmount Amount to add to privacy mining pool
     * @param zkAmount Amount to add to ZK proof reward pool
     * @param airdropAmount Amount to add to airdrop pool
     */
    function fundRewardPools(
        uint256 privacyAmount,
        uint256 zkAmount,
        uint256 airdropAmount
    ) external onlyGovernance {
        uint256 totalAmount = privacyAmount + zkAmount + airdropAmount;
        if (totalAmount == 0) revert NoFundingProvided();
        
        // Update state before external calls to prevent reentrancy
        privacyMiningPool += privacyAmount;
        zkProofRewardPool += zkAmount;
        airdropPool += airdropAmount;
        
        // Emit event before external call
        emit RewardPoolFunded(privacyAmount, zkAmount, airdropAmount);
        
        // Transfer tokens from sender
        if (!PRIVATE_TOKEN.transferFrom(msg.sender, address(this), totalAmount)) revert TransferFailed();
    }

    /**
     * @notice Credits reward pool counters from tokens already held by this contract (e.g. after `TokenAllocation` transfer).
     * @dev Does not pull tokens; ensures `balanceOf(this) >=` sum of pool counters after the credit so claims stay solvent.
     * @param privacyAmount Amount to add to the privacy mining pool accounting
     * @param zkAmount Amount to add to the ZK proof reward pool accounting
     * @param airdropAmount Amount to add to the airdrop pool accounting
     */
    function creditRewardPoolsFromBalance(
        uint256 privacyAmount,
        uint256 zkAmount,
        uint256 airdropAmount
    ) external onlyGovernance {
        _creditRewardPoolsFromBalance(privacyAmount, zkAmount, airdropAmount);
    }

    /**
     * @notice Governance convenience: credit the default 6.3M split (2.1M / 2.1M / 2.1M) from tokens already on this contract.
     * @dev Reverts if pools were partially credited or constructor pre-funded pools such that `reserved + 6.3M > balance`. Use `creditRewardPoolsFromBalance` for a custom split.
     */
    function creditDefaultEcosystemTrancheFromBalance() external onlyGovernance {
        _creditRewardPoolsFromBalance(
            DEFAULT_ECOSYSTEM_PRIVACY,
            DEFAULT_ECOSYSTEM_ZK,
            DEFAULT_ECOSYSTEM_AIRDROP
        );
    }

    function _creditRewardPoolsFromBalance(
        uint256 privacyAmount,
        uint256 zkAmount,
        uint256 airdropAmount
    ) internal {
        uint256 add = privacyAmount + zkAmount + airdropAmount;
        if (add == 0) revert NoFundingProvided();

        uint256 reserved = privacyMiningPool + zkProofRewardPool + airdropPool;
        uint256 bal = IERC20(address(PRIVATE_TOKEN)).balanceOf(address(this));
        if (reserved + add > bal) revert InsufficientBalance();

        privacyMiningPool += privacyAmount;
        zkProofRewardPool += zkAmount;
        airdropPool += airdropAmount;

        emit RewardPoolFunded(privacyAmount, zkAmount, airdropAmount);
    }
    
    /**
     * @notice Sets new airdrop merkle root for anonymous distribution
     * @param merkleRoot New merkle root for airdrop claims
     */
    function setAirdropMerkleRoot(bytes32 merkleRoot) external onlyGovernance {
        if (merkleRoot == bytes32(0)) revert InvalidMerkleRootValue();
        
        ++currentAirdropRound;
        airdropMerkleRoots[currentAirdropRound] = merkleRoot;
    }
    
    /**
     * @notice Calculates privacy score based on action complexity
     * @param action Privacy action details
     * @return Privacy score (0-1000)
     */
    function _calculatePrivacyScore(PrivacyAction calldata action) internal view returns (uint256) {
        uint256 score = 100; // Base score
        
        // Action type multiplier
        if (action.actionType == 1) score += 100; // Transfer
        else if (action.actionType == 2) score += 150; // Stake
        else if (action.actionType == 3) score += 200; // Lend
        else if (action.actionType == 4) score += 250; // Swap
        
        // Proof complexity bonus (based on proof size)
        uint256 proofComplexity = (action.zkProof.length * 10) / 32; // Rough complexity measure
        score += proofComplexity;
        
        // Time-based bonus for recent actions (claim path allows slight future skew via MAX_FUTURE_TOLERANCE)
        uint256 timeDiff = action.timestamp > block.timestamp
            ? 0
            : block.timestamp - action.timestamp;
        if (timeDiff < 10 minutes) score += 100;
        else if (timeDiff < 30 minutes) score += 50;
        
        return score > MAX_PRIVACY_SCORE ? MAX_PRIVACY_SCORE : score;
    }
    
    /**
     * @notice Updates epoch and resets daily limits
     */
    function _updateEpoch() internal {
        emit EpochUpdated(currentEpoch, epochMiningAmount[currentEpoch]);
        
        ++currentEpoch;
        lastEpochUpdate = block.timestamp;
        epochMiningAmount[currentEpoch] = 0;
    }
    
    /**
     * @notice Verifies merkle proof for airdrop claims
     * @param proof Merkle proof array
     * @param root Merkle root
     * @param leaf Leaf to verify
     * @return True if proof is valid
     */
    function _verifyMerkleProof(
        bytes32[] calldata proof,
        bytes32 root,
        bytes32 leaf
    ) internal pure returns (bool) {
        bytes32 computedHash = leaf;
        
        for (uint256 i = 0; i < proof.length; ++i) {
            bytes32 proofElement = proof[i];
            if (computedHash <= proofElement) { // solhint-disable-line gas-strict-inequalities
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
            } else {
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            }
        }
        
        return computedHash == root;
    }
    
    // View functions
    /**
     * @notice Gets the privacy score for a given commitment
     * @param commitment The commitment hash to query
     * @return The privacy score (0-1000) for the commitment
     */
    function getPrivacyScore(bytes32 commitment) external view returns (uint256) {
        return privacyScores[commitment];
    }
    
    /**
     * @notice Gets the total amount mined in the current epoch
     * @return The total tokens mined in the current epoch
     */
    function getCurrentEpochMining() external view returns (uint256) {
        return epochMiningAmount[currentEpoch];
    }
    
    /**
     * @notice Gets the remaining mining capacity for the current epoch
     * @return The remaining tokens that can be mined in the current epoch
     */
    function getRemainingDailyMining() external view returns (uint256) {
        uint256 mined = epochMiningAmount[currentEpoch];
        return mined > DAILY_MINING_CAP - 1 ? 0 : DAILY_MINING_CAP - mined;
    }
    
    /**
     * @notice Gets the current balances of all reward pools
     * @return privacyPool The privacy mining pool balance
     * @return zkPool The ZK proof reward pool balance
     * @return airdropPoolBalance The airdrop pool balance
     */
    function getRewardPools() external view returns (uint256, uint256, uint256) {
        return (privacyMiningPool, zkProofRewardPool, airdropPool);
    }
    
    /**
     * @notice Checks if a nullifier has been used to prevent double-spending
     * @param nullifier The nullifier hash to check
     * @return True if the nullifier has been used, false otherwise
     */
    function isNullifierUsed(bytes32 nullifier) external view returns (bool) {
        return nullifierUsed[nullifier];
    }
    
    /**
     * @notice Gets the Merkle root for the current airdrop round
     * @return The Merkle root hash for the current airdrop round
     */
    function getCurrentAirdropRoot() external view returns (bytes32) {
        return airdropMerkleRoots[currentAirdropRound];
    }
    
    /**
     * @notice Gets the total rewards earned by a commitment
     * @param commitment The commitment hash to query
     * @return The total rewards earned by the commitment
     */
    function getCommitmentRewards(bytes32 commitment) external view returns (uint256) {
        return commitmentRewards[commitment];
    }

    /**
     * @notice Gets the total amount mined in a specific epoch
     * @param epoch The epoch number to query
     * @return The total tokens mined in the specified epoch
     */
    function getEpochMiningAmount(uint256 epoch) external view returns (uint256) {
        return epochMiningAmount[epoch];
    }

    /**
     * @notice Gets the amount mined by a specific user in the current epoch
     * @param user The user address to query
     * @return The tokens mined by the user in the current epoch
     */
    function getUserEpochMining(address user) external view returns (uint256) {
        return userEpochMining[user];
    }

    /**
     * @notice Gets the current statistics of all reward pools
     * @return privacyPool The privacy mining pool balance
     * @return zkPool The ZK proof reward pool balance
     * @return airdropPoolBalance The airdrop pool balance
     */
    function getPoolStats() external view returns (uint256, uint256, uint256) {
        return (privacyMiningPool, zkProofRewardPool, airdropPool);
    }

    /**
     * @notice Gets the address of the private token contract
     * @return The address of the PRIVATE_TOKEN contract
     */
    function privateToken() external view returns (address) {
        return address(PRIVATE_TOKEN);
    }

    /**
     * @notice Gets the address of the verifier factory contract
     * @return The address of the VERIFIER_FACTORY contract
     */
    function verifierFactory() external view returns (address) {
        return address(VERIFIER_FACTORY);
    }
    
    /**
     * @notice Converts proof data for verification using optimized library
     * @param proof The ZK proof bytes
     * @param commitment The commitment value
     * @return convertedProof The proof converted to uint256[8]
     * @return publicInputs The commitment converted to uint256[] array
     */
    function _convertProofData(bytes memory proof, bytes32 commitment) 
        internal 
        pure 
        returns (uint256[8] memory convertedProof, uint256[] memory publicInputs) 
    {
        convertedProof = ProofUtils.convertProofFromMemory(proof);
        publicInputs = new uint256[](1);
        publicInputs[0] = uint256(commitment);
    }
}