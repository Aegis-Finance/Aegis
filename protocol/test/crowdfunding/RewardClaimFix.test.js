const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Reward Claim Fix Test", function () {
    let owner, user1;
    let praxeologicalRewards, mockToken;

    beforeEach(async function () {
        [owner, user1] = await ethers.getSigners();

        // Deploy mock contracts for dependencies
        const MockVerifierFactory = await ethers.getContractFactory("MockVerifierFactory");
        const mockGovernance = await MockVerifierFactory.deploy();
        await mockGovernance.waitForDeployment();

        // Deploy mock token and mint tokens to owner
        const MockToken = await ethers.getContractFactory("MockAGSToken");
        mockToken = await MockToken.deploy();
        await mockToken.waitForDeployment();
        
        // Deploy PraxeologicalRewards with owner as governance
        const PraxeologicalRewards = await ethers.getContractFactory("PraxeologicalRewards");
        praxeologicalRewards = await PraxeologicalRewards.deploy(
            owner.address, // _austrianAnalytics (use owner for simplicity)
            owner.address  // _governance (use owner as governance)
        );
        await praxeologicalRewards.waitForDeployment();
        
        // Mint tokens to owner for reward pool funding
        await mockToken.mint(owner.address, ethers.parseEther("1000"));
        
        // Approve PraxeologicalRewards to spend tokens
        await mockToken.approve(praxeologicalRewards.target, ethers.parseEther("1000"));

        // Store mock contracts for use in tests
        this.mockToken = mockToken;
        this.mockGovernance = mockGovernance;
    });

    it("Should not throw InvalidPoolId error when claiming from valid pool", async function () {
        console.log("=== Testing Pool Creation and Claim ===");

        // Check initial state
        const initialNextPoolId = await praxeologicalRewards.nextPoolId();
        const initialTotalPools = await praxeologicalRewards.totalRewardPools();
        console.log(`Initial nextPoolId: ${initialNextPoolId}`);
        console.log(`Initial totalRewardPools: ${initialTotalPools}`);

        // Create a reward pool with correct parameters
        const tx = await praxeologicalRewards.createRewardPool(
            1, // campaignId
            await this.mockToken.getAddress(), // rewardToken
            ethers.parseEther("100"), // totalAmount
            0, // category (assuming 0 is valid)
            0, // method (assuming 0 is valid)
            3600, // duration (1 hour)
            0, // minParticipationScore
            25 // maxRewardPerActor (25% of pool)
        );
        const receipt = await tx.wait();

        // Get pool ID from event
        const event = receipt.logs.find(log => {
            try {
                const parsed = praxeologicalRewards.interface.parseLog(log);
                return parsed.name === "RewardPoolCreated";
            } catch (e) {
                return false;
            }
        });
        
        const poolId = event ? praxeologicalRewards.interface.parseLog(event).args.poolId : null;
        console.log(`Pool ID from event: ${poolId}`);

        // Check state after pool creation
        const afterNextPoolId = await praxeologicalRewards.nextPoolId();
        const afterTotalPools = await praxeologicalRewards.totalRewardPools();
        console.log(`After creation nextPoolId: ${afterNextPoolId}`);
        console.log(`After creation totalRewardPools: ${afterTotalPools}`);

        // Test the validation logic
        console.log(`Testing validation: poolId >= nextPoolId? ${poolId >= afterNextPoolId}`);

        // Try to claim reward - should NOT throw InvalidPoolId error
        try {
            await praxeologicalRewards.connect(user1).claimReward(poolId);
            console.log("✅ Claim succeeded (unexpected but good)");
        } catch (error) {
            const iface = praxeologicalRewards.interface;
            let errorName = error?.errorName;

            if (!errorName && (error?.data || error?.error?.data)) {
                const revertData = error.data ?? error.error?.data;
                try {
                    errorName = iface.parseError(revertData).name;
                } catch (parseErr) {
                    console.log("⚠️ Unable to parse revert data:", parseErr);
                }
            }

            console.log(`Claim failed with custom error: ${errorName ?? error.message}`);

            expect(errorName).to.not.equal("InvalidPoolId");

            const expectedErrors = new Set([
                "PoolNotEnded",
                "NoRewardAvailable",
                "InsufficientBalance"
            ]);

            expect(expectedErrors.has(errorName)).to.equal(true, "Unexpected revert reason");
            console.log("✅ Got expected error (not InvalidPoolId)");
        }

        console.log("=== Test completed successfully ===");
    });
});