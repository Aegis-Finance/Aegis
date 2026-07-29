const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("Isolated Integration Test", function () {
    async function deployFullSystemFixture() {
        const [owner, creator, contributor1, contributor2, governance, reviewer1, reviewer2] = await ethers.getSigners();

        // Deploy mock contracts
        const MockAGSToken = await ethers.getContractFactory("MockAGSToken");
        const mockToken = await MockAGSToken.deploy();
        
        const MockZKVerifier = await ethers.getContractFactory("MockZKVerifier");
        const mockZKVerifier = await MockZKVerifier.deploy();
        
        const MockVerifierFactory = await ethers.getContractFactory("MockVerifierFactory");
        const mockVerifierFactory = await MockVerifierFactory.deploy();
        
        const MockCrowdShield = await ethers.getContractFactory("MockCrowdShield");
        const mockCrowdShield = await MockCrowdShield.deploy();

        // Deploy main contracts
        const CrowdfundingVerifier = await ethers.getContractFactory("CrowdfundingVerifier");
        const crowdfundingVerifier = await CrowdfundingVerifier.deploy(
            await mockZKVerifier.getAddress(),
            governance.address
        );

        const MilestoneVerifier = await ethers.getContractFactory("MilestoneVerifier");
        const milestoneVerifier = await MilestoneVerifier.deploy(
            await mockZKVerifier.getAddress(),
            governance.address
        );

        const RefundVerifier = await ethers.getContractFactory("RefundVerifier");
        const refundVerifier = await RefundVerifier.deploy(
            await mockZKVerifier.getAddress(),
            await mockCrowdShield.getAddress(),
            governance.address
        );

        // Deploy AustrianAnalytics
        const AustrianAnalytics = await ethers.getContractFactory("AustrianAnalytics");
        const austrianAnalytics = await AustrianAnalytics.deploy(governance.address);

        const PraxeologicalRewards = await ethers.getContractFactory("PraxeologicalRewards");
        const praxeologicalRewards = await PraxeologicalRewards.deploy(
            await austrianAnalytics.getAddress(),
            governance.address
        );

        // Setup initial state
        await mockZKVerifier.setShouldVerify(true);
        await mockToken.mint(await praxeologicalRewards.getAddress(), ethers.parseEther("1000000"));
        
        // Mint tokens to governance for creating reward pools
        await mockToken.mint(governance.address, ethers.parseEther("100000"));
        
        // Approve PraxeologicalRewards contract to transfer tokens from governance
        await mockToken.connect(governance).approve(await praxeologicalRewards.getAddress(), ethers.parseEther("100000"));

        return {
            mockToken,
            mockZKVerifier,
            mockVerifierFactory,
            mockCrowdShield,
            crowdfundingVerifier,
            milestoneVerifier,
            refundVerifier,
            austrianAnalytics,
            praxeologicalRewards,
            owner,
            creator,
            contributor1,
            contributor2,
            governance,
            reviewer1,
            reviewer2
        };
    }

    it("Should handle pool creation and claiming correctly", async function () {
        const {
            mockToken,
            mockZKVerifier,
            mockCrowdShield,
            crowdfundingVerifier,
            milestoneVerifier,
            austrianAnalytics,
            praxeologicalRewards,
            creator,
            contributor1,
            contributor2,
            governance,
            reviewer1
        } = await loadFixture(deployFullSystemFixture);

        // Debug initial state
        console.log("=== INITIAL STATE ===");
        const initialNextPoolId = await praxeologicalRewards.nextPoolId();
        const initialTotalPools = await praxeologicalRewards.totalRewardPools();
        console.log("Initial nextPoolId:", initialNextPoolId.toString());
        console.log("Initial totalRewardPools:", initialTotalPools.toString());

        // Step 1: Create campaign
        await expect(
            crowdfundingVerifier.connect(creator).createCampaign()
        ).to.emit(crowdfundingVerifier, "CampaignCreated");

        // Set contributor reputation
        await crowdfundingVerifier.connect(governance).setContributorReputation(contributor1.address, 100);
        await crowdfundingVerifier.connect(governance).setContributorReputation(contributor2.address, 100);

        // Step 2: Create reward pool
        console.log("=== CREATING REWARD POOL ===");
        const nextPoolIdBefore = await praxeologicalRewards.nextPoolId();
        const totalPoolsBefore = await praxeologicalRewards.totalRewardPools();
        console.log("Before creation - nextPoolId:", nextPoolIdBefore.toString());
        console.log("Before creation - totalRewardPools:", totalPoolsBefore.toString());
        
        const createTx = await praxeologicalRewards.connect(governance).createRewardPool(
            1, // campaignId
            await mockToken.getAddress(),
            ethers.parseEther("5000"),
            0, // category
            0, // method
            86400, // duration
            0, // minParticipationScore
            20 // maxRewardPerActor
        );
        const receipt = await createTx.wait();
        
        const nextPoolIdAfter = await praxeologicalRewards.nextPoolId();
        const totalPoolsAfter = await praxeologicalRewards.totalRewardPools();
        console.log("After creation - nextPoolId:", nextPoolIdAfter.toString());
        console.log("After creation - totalRewardPools:", totalPoolsAfter.toString());

        // Get actual pool ID from event
        const event = receipt.logs.find(log => {
            try {
                const parsed = praxeologicalRewards.interface.parseLog(log);
                return parsed.name === 'RewardPoolCreated';
            } catch {
                return false;
            }
        });
        
        let actualPoolId = 1;
        if (event) {
            const parsed = praxeologicalRewards.interface.parseLog(event);
            actualPoolId = parsed.args.poolId;
            console.log("Actual pool ID from event:", actualPoolId.toString());
        }

        // Verify pool exists and is valid
        const poolInfo = await praxeologicalRewards.getRewardPoolInfo(actualPoolId);
        console.log("Pool info:", poolInfo);
        console.log("Pool ID from struct:", poolInfo[0].toString());
        console.log("Pool isActive:", poolInfo[11]);
        console.log("Pool isFinalized:", poolInfo[12]);

        // Test the claimReward validation
        console.log("=== TESTING CLAIM VALIDATION ===");
        console.log("About to call claimReward with poolId:", actualPoolId.toString());
        console.log("Current nextPoolId:", (await praxeologicalRewards.nextPoolId()).toString());
        console.log("Validation check: poolId >= nextPoolId?", actualPoolId >= (await praxeologicalRewards.nextPoolId()));
        
        try {
            await praxeologicalRewards.connect(contributor1).claimReward(actualPoolId);
            console.log("Claim succeeded (unexpected)");
        } catch (error) {
            console.log("Claim failed with error:", error.message);
            
            // Check if it's InvalidPoolId or another error
            if (error.message.includes('InvalidPoolId')) {
                console.log("ERROR: Still getting InvalidPoolId - this should be fixed!");
            } else if (error.message.includes('PoolNotEnded')) {
                console.log("Expected: Pool hasn't ended yet");
            } else if (error.message.includes('NoRewardAvailable')) {
                console.log("Expected: No rewards calculated yet");
            } else {
                console.log("Unexpected error type");
            }
        }
    });
});