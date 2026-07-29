// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "../interfaces/IVerifierFactory.sol";
import "../interfaces/IVerifier.sol";
import "../Groth16Verifier.sol";
import "../CeremonyVerifier.sol";

// Mock ERC20 token for testing
contract MockAGSToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;
    string public name = "Aegis Token";
    string public symbol = "AGS";
    uint8 public decimals = 18;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        emit Transfer(from, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }
}

// Mock ZK Verifier for testing
contract MockZKVerifier is IVerifier {
    bool public shouldVerify = true;
    uint256 public verificationCount = 0;
    
    function setShouldVerify(bool _shouldVerify) external {
        shouldVerify = _shouldVerify;
    }
    
    function setVerificationResult(bool _result) external {
        shouldVerify = _result;
    }
    
    function incrementVerificationCount() external {
        verificationCount++;
    }
    
    function verifyProof(
        uint256[2] memory /* a */,
        uint256[2][2] memory /* b */,
        uint256[2] memory /* c */,
        uint256[] memory /* publicInputs */
    ) external view override returns (bool) {
        return shouldVerify;
    }
    
    function verifyProof(
        uint256[8] calldata /* proof */,
        uint256[] calldata /* publicInputs */
    ) external view override returns (bool) {
        return shouldVerify;
    }
    
    function getVerificationKeyHash() external pure override returns (bytes32) {
        return keccak256("mock_verification_key");
    }
    
    function isProductionKey() external pure override returns (bool) {
        return false; // Mock is always development
    }
    
    function getCeremonyId() external pure override returns (bytes32) {
        return keccak256("mock_ceremony");
    }
    
    function validateProductionSafety() external pure override {
        // Mock implementation - no validation needed
    }
}

// Mock VerifierFactory for testing
contract MockVerifierFactory is IVerifierFactory {
    mapping(bytes32 => address) private _verifiers;
    address[] private _allVerifiers;
    bytes32[] private _supportedVerifierKeys;
    mapping(bytes32 => string) private _circuitNames;
    mapping(address => bool) private _isVerifier;
    mapping(address => bool) private _isProductionVerifier;
    mapping(bytes32 => bytes32) private _circuitCeremonyIds;
    mapping(bytes32 => bool) private _circuitRegistered;
    
    MockZKVerifier public defaultVerifier;
    CeremonyVerifier public ceremonyVerifier;
    address public override governanceContract;
    
    function _key(string memory circuitType) private pure returns (bytes32) {
        return keccak256(bytes(circuitType));
    }
    
    constructor() {
        defaultVerifier = new MockZKVerifier();
        ceremonyVerifier = new CeremonyVerifier(address(this)); // Use this contract as governance for testing
        
        // Initialize some default verifiers
        _addVerifier("auction", address(defaultVerifier));
        _addVerifier("tokendistribution", address(defaultVerifier));
        _addVerifier("sybil-protection", address(defaultVerifier));
        _addVerifier("transfer", address(defaultVerifier));
        _addVerifier("mint", address(defaultVerifier));
        _addVerifier("transfer-optimized", address(defaultVerifier));
        _addVerifier("mint-optimized", address(defaultVerifier));
        _addVerifier("privacy", address(defaultVerifier));
        _addVerifier("governance", address(defaultVerifier));
        _addVerifier("bridge", address(defaultVerifier));
        _addVerifier("derivative", address(defaultVerifier));
        _addVerifier("reward", address(defaultVerifier));
        _addVerifier("farming", address(defaultVerifier));
        _addVerifier("insurance", address(defaultVerifier));
        _addVerifier("analytics", address(defaultVerifier));
        _addVerifier("leaderboard", address(defaultVerifier));
        _addVerifier("emergency", address(defaultVerifier));
        // Align with `VerifierFactory` supportedVerifierTypes for integration tests
        _addVerifier("auction-claim", address(defaultVerifier));
        _addVerifier("crowdfunding", address(defaultVerifier));
        _addVerifier("milestone", address(defaultVerifier));
        _addVerifier("refund", address(defaultVerifier));
        _addVerifier("aggregator", address(defaultVerifier));
        _addVerifier("private-amm", address(defaultVerifier));
        _addVerifier("staking", address(defaultVerifier));
        _addVerifier("lending-tenor", address(defaultVerifier));
        _addVerifier("lending-liquidity", address(defaultVerifier));
        _addVerifier("lending-repay", address(defaultVerifier));
        _addVerifier("lending-withdraw", address(defaultVerifier));
        _addVerifier("lending-liquidate", address(defaultVerifier));
        _addVerifier("bonding-curve-purchase", address(defaultVerifier));
        _addVerifier("bonding-curve-sell", address(defaultVerifier));
        _addVerifier("batch", address(defaultVerifier));
        _addVerifier("recursive", address(defaultVerifier));
        _addVerifier("transfer-unshield", address(defaultVerifier));
        _addVerifier("shielded-transfer", address(defaultVerifier));
        _addVerifier("transfer-to-pool", address(defaultVerifier));
        _addVerifier("transfer-commitment-internal", address(defaultVerifier));
        _addVerifier("transfer-commitment-action", address(defaultVerifier));
    }
    
    function _addVerifier(string memory circuitType, address verifier) internal {
        bytes32 key = _key(circuitType);
        _verifiers[key] = verifier;
        if (!_isVerifier[verifier]) {
            _allVerifiers.push(verifier);
        }
        if (!_circuitRegistered[key]) {
            _circuitRegistered[key] = true;
            _supportedVerifierKeys.push(key);
            _circuitNames[key] = circuitType;
        }
        _isVerifier[verifier] = true;
        _isProductionVerifier[verifier] = true;
        _circuitCeremonyIds[key] = key;
    }
    
    // Public function for testing to add verifiers
    function addVerifier(string memory circuitType, address verifier) external {
        _addVerifier(circuitType, verifier);
    }
    
    // IVerifierFactory implementation
    function setGovernanceContract(address _governance) external override {
        governanceContract = _governance;
    }
    
    function deployVerifier(
        string calldata circuitType,
        Groth16Verifier.VerifyingKey calldata,
        Groth16Verifier.CeremonyMetadata calldata
    ) external override returns (address verifier) {
        verifier = address(new MockZKVerifier());
        _addVerifier(circuitType, verifier);
        return verifier;
    }
    
    function updateVerifier(
        string calldata circuitType,
        Groth16Verifier.VerifyingKey calldata,
        Groth16Verifier.CeremonyMetadata calldata
    ) external override {
        bytes32 key = _key(circuitType);
        address newVerifier = address(new MockZKVerifier());
        _verifiers[key] = newVerifier;
        if (!_circuitRegistered[key]) {
            _circuitRegistered[key] = true;
            _supportedVerifierKeys.push(key);
        }
        _circuitNames[key] = circuitType;
        if (!_isVerifier[newVerifier]) {
            _allVerifiers.push(newVerifier);
        }
        _isVerifier[newVerifier] = true;
        _isProductionVerifier[newVerifier] = true;
        _circuitCeremonyIds[key] = key;
    }
    
    function removeVerifier(string calldata circuitType) external override {
        bytes32 key = _key(circuitType);
        address verifier = _verifiers[key];
        delete _verifiers[key];
        _isVerifier[verifier] = false;
        delete _isProductionVerifier[verifier];
    }
    
    function getVerifier(string calldata verifierType) external view override returns (address) {
        address verifier = _verifiers[_key(verifierType)];
        require(verifier != address(0), "Verifier not found");
        return verifier;
    }
    
    function verifyProof(
        string calldata circuitType,
        uint256[8] calldata /* proof */,
        uint256[] calldata /* publicInputs */
    ) external view override returns (bool) {
        address verifier = _verifiers[_key(circuitType)];
        require(verifier != address(0), "Verifier not found");
        return MockZKVerifier(verifier).shouldVerify();
    }
    
    function getAllVerifiers() external view override returns (address[] memory) {
        return _allVerifiers;
    }
    
    function getVerifierCount() external view override returns (uint256) {
        return _allVerifiers.length;
    }
    
    function hasVerifier(string calldata circuitType) external view override returns (bool) {
        return _verifiers[_key(circuitType)] != address(0);
    }
    
    function getVerificationKeyHash(string calldata circuitType) external pure override returns (bytes32) {
        return keccak256(abi.encodePacked(circuitType, "vk_hash"));
    }
    
    function getSupportedVerifierTypes() external view override returns (string[] memory) {
        uint256 length = _supportedVerifierKeys.length;
        string[] memory names = new string[](length);
        for (uint256 i = 0; i < length; i++) {
            names[i] = _circuitNames[_supportedVerifierKeys[i]];
        }
        return names;
    }
    
    function transferOptimizedVerifier() external view override returns (address) {
        return _verifiers[_key("transfer-optimized")];
    }
    
    function mintOptimizedVerifier() external view override returns (address) {
        return _verifiers[_key("mint-optimized")];
    }
    
    function privacyVerifier() external view override returns (address) {
        return _verifiers[_key("privacy")];
    }
    
    function governanceVerifier() external view override returns (address) {
        return _verifiers[_key("governance")];
    }
    
    function bridgeVerifier() external view override returns (address) {
        return _verifiers[_key("bridge")];
    }
    
    function derivativeVerifier() external view override returns (address) {
        return _verifiers[_key("derivative")];
    }
    
    function getCeremonyId(string calldata circuitType) external view override returns (bytes32) {
        return _circuitCeremonyIds[_key(circuitType)];
    }
    
    function isProduction(address verifier) external view override returns (bool) {
        return _isProductionVerifier[verifier];
    }
    
    function CEREMONY_VERIFIER() external view override returns (CeremonyVerifier) {
        return ceremonyVerifier;
    }
    
    // Additional functions for testing
    function isVerifierSupported(string memory verifierType) external view returns (bool) {
        return _verifiers[_key(verifierType)] != address(0);
    }
    
    function setMockVerifier(string memory verifierType, bool shouldVerify) external {
        address verifier = _verifiers[_key(verifierType)];
        require(verifier != address(0), "Verifier not found");
        MockZKVerifier(verifier).setShouldVerify(shouldVerify);
    }

    // Add setVerifier function for testing integration
    function setVerifier(string memory circuitType, address verifier) external {
        bytes32 key = _key(circuitType);
        _verifiers[key] = verifier;
        if (!_isVerifier[verifier]) {
            _allVerifiers.push(verifier);
        }
        if (!_circuitRegistered[key]) {
            _circuitRegistered[key] = true;
            _supportedVerifierKeys.push(key);
        }
        _circuitNames[key] = circuitType;
        _isVerifier[verifier] = true;
        _isProductionVerifier[verifier] = true;
        _circuitCeremonyIds[key] = key;
    }

    // IVerifierFactory public accessors
    function verifiers(string calldata circuitType) external view override returns (address) {
        return _verifiers[_key(circuitType)];
    }

    function allVerifiers(uint256 index) external view override returns (address) {
        return _allVerifiers[index];
    }

    function supportedVerifierTypes(uint256 index) external view override returns (string memory) {
        return _circuitNames[_supportedVerifierKeys[index]];
    }

    function circuitCeremonyIds(string calldata circuitType) external view override returns (bytes32) {
        return _circuitCeremonyIds[_key(circuitType)];
    }

    function isVerifier(address verifier) external view override returns (bool) {
        return _isVerifier[verifier];
    }

    function isProductionVerifier(address verifier) external view override returns (bool) {
        return _isProductionVerifier[verifier];
    }
}

/**
 * @title MockBridgeToken
 * @notice Minimal token interface used to exercise CrossChainPrivacyBridge liquidity flows in tests.
 * @dev Tracks per-commitment balances and pool balances without enforcing ZK commitments.
 */
contract MockBridgeToken {
    mapping(bytes32 => uint256) private _commitmentBalances;
    mapping(address => uint256) private _poolBalances;

    event CommitmentSeeded(bytes32 indexed commitment, uint256 amount);
    event PoolSeeded(address indexed pool, uint256 amount);

    function seedCommitment(bytes32 commitment, uint256 amount) external {
        _commitmentBalances[commitment] += amount;
        emit CommitmentSeeded(commitment, amount);
    }

    function seedPool(address pool, uint256 amount) external {
        _poolBalances[pool] += amount;
        emit PoolSeeded(pool, amount);
    }

    function transferToPoolInternal(
        bytes32 commitment,
        address poolAddress,
        uint256 amount
    ) external {
        uint256 balance = _commitmentBalances[commitment];
        if (balance < amount) revert("MockBridgeToken: insufficient commitment");
        unchecked {
            _commitmentBalances[commitment] = balance - amount;
            _poolBalances[poolAddress] += amount;
        }
    }

    function transferFromPool(
        address poolAddress,
        bytes32 commitment,
        uint256 amount
    ) external {
        uint256 balance = _poolBalances[poolAddress];
        if (balance < amount) revert("MockBridgeToken: insufficient pool balance");
        unchecked {
            _poolBalances[poolAddress] = balance - amount;
            _commitmentBalances[commitment] += amount;
        }
    }

    function getCommitmentBalance(bytes32 commitment) external view returns (uint256) {
        return _commitmentBalances[commitment];
    }

    function getPoolBalance(address poolAddress) external view returns (uint256) {
        return _poolBalances[poolAddress];
    }
}

/// @notice Minimal FeeM registry mock used for testing registration flows.
contract MockFeeMRegistry {
    bool public shouldSucceed = true;
    bool public wasCalled;
    uint256 public latestCategory;

    event FeeMRegistered(address indexed registrant, uint256 indexed category);

    function setShouldSucceed(bool value) external {
        shouldSucceed = value;
    }

    function selfRegister(uint256 category) external returns (bool) {
        wasCalled = true;
        latestCategory = category;
        require(shouldSucceed, "MockFeeMRegistry: registration blocked");
        emit FeeMRegistered(msg.sender, category);
        return true;
    }
}

/**
 * @title MockCrowdShield
 * @notice Mock implementation of AegisCrowdShield for testing RefundVerifier
 */
contract MockCrowdShield {
    /// @dev Must match `AegisCrowdShield.CampaignStatus` ordinals (RefundVerifier decodes `getCampaign` ABI).
    enum CampaignStatus {
        Active,
        Successful,
        Failed,
        Withdrawn,
        Disputed,
        Refunding
    }

    // Austrian Economics Core Principles
    struct IndividualSovereigntyConfig {
        bool enablePrivateContributions;    // ZK-based private funding
        bool enableMarketDrivenDisputes;    // Peer-to-peer dispute resolution
        bool enableVoluntaryCompliance;     // Optional regulatory compliance
        bool enableSpontaneousOrder;        // Emergent campaign organization
        uint256 minimumStakeForSovereignty; // Economic skin in the game
        uint256 minimumContribution;
        uint256 maximumContribution;
    }

    struct CampaignSovereignty {
        address creator;                    // Campaign sovereign authority
        bytes32 commitmentHash;            // ZK commitment to campaign details
        uint256 targetAmount;              // Funding goal in wei
        uint256 deadline;                  // Campaign deadline
        address paymentToken;              // ERC20 token or ETH (address(0))
        bool isPrivate;                    // ZK-based private campaign
        IndividualSovereigntyConfig config; // Sovereignty configuration
        uint256 totalRaised;              // Current funding amount
        uint256 contributorCount;          // Number of individual contributors
        CampaignStatus status;             // Current campaign state
        bytes32 merkleRoot;                // Merkle root for contributor verification
        uint256 withdrawUnlocksAt;         // Must mirror `AegisCrowdShield.CampaignSovereignty` layout
    }
    
    struct ContributorSovereignty {
        uint256 amount;
        uint256 timestamp;
        bool isPrivate;
        bool refunded;
    }
    
    mapping(uint256 => CampaignSovereignty) public campaigns;
    mapping(uint256 => mapping(address => ContributorSovereignty)) public contributions;
    mapping(address => uint256[]) public creatorCampaigns;
    mapping(address => uint256[]) public contributorCampaigns;
    
    uint256 public nextCampaignId = 1;
    
    function getCampaign(uint256 campaignId) external view returns (CampaignSovereignty memory) {
        return campaigns[campaignId];
    }
    
    function getContribution(uint256 campaignId, address contributor) 
        external 
        view 
        returns (ContributorSovereignty memory) 
    {
        return contributions[campaignId][contributor];
    }
    
    function getCreatorCampaigns(address creator) external view returns (uint256[] memory) {
        return creatorCampaigns[creator];
    }
    
    function getContributorCampaigns(address contributor) external view returns (uint256[] memory) {
        return contributorCampaigns[contributor];
    }
    
    // Mock functions for testing
    function createMockCampaign(
        address creator,
        uint256 targetAmount,
        uint256 raisedAmount,
        uint256 deadline,
        CampaignStatus status
    ) external returns (uint256) {
        uint256 campaignId = nextCampaignId++;
        
        IndividualSovereigntyConfig memory defaultConfig = IndividualSovereigntyConfig({
            enablePrivateContributions: false,
            enableMarketDrivenDisputes: true,
            enableVoluntaryCompliance: false,
            enableSpontaneousOrder: true,
            minimumStakeForSovereignty: 0,
            minimumContribution: 1,
            maximumContribution: type(uint256).max
        });
        
        campaigns[campaignId] = CampaignSovereignty({
            creator: creator,
            commitmentHash: bytes32(0),
            targetAmount: targetAmount,
            deadline: deadline,
            paymentToken: address(0), // ETH
            isPrivate: false,
            config: defaultConfig,
            totalRaised: raisedAmount,
            contributorCount: 0,
            status: status,
            merkleRoot: bytes32(0),
            withdrawUnlocksAt: 0
        });
        
        creatorCampaigns[creator].push(campaignId);
        return campaignId;
    }
    
    function createMockContribution(
        uint256 campaignId,
        address contributor,
        uint256 amount,
        bool refunded
    ) external {
        contributions[campaignId][contributor] = ContributorSovereignty({
            amount: amount,
            timestamp: block.timestamp,
            isPrivate: false,
            refunded: refunded
        });
        
        contributorCampaigns[contributor].push(campaignId);
    }
    
    function setCampaignStatus(uint256 campaignId, CampaignStatus status) external {
        campaigns[campaignId].status = status;
    }
}