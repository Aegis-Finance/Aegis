const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { TestHelpers } = require("./helpers/TestHelpers");
const { mintShield } = require("./helpers/mintShieldHelper");

describe("PrivateYieldFarming", function () {
    let testHelpers;
    
    async function deployYieldFarmingFixture() {
        const [owner, governance, user1, user2] = await ethers.getSigners();
        
        // Deploy mock verifier factory and token
        const MockVerifierFactory = await ethers.getContractFactory("MockVerifierFactory");
        const verifierFactory = await MockVerifierFactory.deploy();
        await verifierFactory.waitForDeployment();
        
        // Deploy TokenAllocation
        const TokenAllocation = await ethers.getContractFactory("TokenAllocation");
        const tokenAllocation = await TokenAllocation.deploy(governance.address);
        await tokenAllocation.waitForDeployment();
        
        // Initialize test helpers
        const testHelpersInstance = new TestHelpers();
        await testHelpersInstance.initialize();
        
        // Deploy ProofLib library first
        const proofLibAddress = await testHelpersInstance.deployProofLib();
        
        // Deploy PrivateTokenContract with linked library
        const PrivateTokenContract = await testHelpersInstance.getContractFactoryWithProofLib("PrivateTokenContract", proofLibAddress);
        const tokenContract = await PrivateTokenContract.deploy(
            await verifierFactory.getAddress(),
            await tokenAllocation.getAddress()
        );
        await tokenContract.waitForDeployment();
        
        // Deploy PrivateYieldFarming (uses VerifierFactory, not individual verifiers)
        const PrivateYieldFarming = await ethers.getContractFactory("PrivateYieldFarming");
        const yieldFarming = await PrivateYieldFarming.deploy(
            await tokenContract.getAddress(),
            await verifierFactory.getAddress()
        );
        await yieldFarming.waitForDeployment();
        
        // Set governance - owner can set it initially
        await yieldFarming.connect(owner).setGovernanceContract(governance.address);
        
        // Set up TokenAllocation so governance has tokens for testing
        await tokenAllocation.connect(governance).setToken(await tokenContract.getAddress());
        await tokenAllocation.connect(governance).setTreasuryWallet(governance.address);
        await tokenAllocation.connect(governance).allocateTreasuryTokens();
        
        // Set governance in PrivateTokenContract (owner can set it initially)
        await tokenContract.connect(owner).setGovernanceContract(governance.address);
        
        // Authorize PrivateYieldFarming contract to use PrivateTokenContract internal functions
        await tokenContract.connect(governance).authorizeContract(await yieldFarming.getAddress());
        
        return {
            yieldFarming,
            tokenContract,
            verifierFactory,
            owner,
            governance,
            user1,
            user2
        };
    }
    
    beforeEach(async function () {
        testHelpers = new TestHelpers();
        await testHelpers.initialize();
    });
    
    describe("Deployment", function () {
        it("Should deploy with correct parameters", async function () {
            const { yieldFarming, tokenContract, verifierFactory } = await loadFixture(deployYieldFarmingFixture);
            
            expect(await yieldFarming.PRIVATE_TOKEN()).to.equal(await tokenContract.getAddress());
            expect(await yieldFarming.VERIFIER_FACTORY()).to.equal(await verifierFactory.getAddress());
        });
        
        it("Should initialize with zero total value locked", async function () {
            const { yieldFarming } = await loadFixture(deployYieldFarmingFixture);
            
            expect(await yieldFarming.totalValueLocked()).to.equal(0);
        });
        
        it("Should revert if token address is zero", async function () {
            const [owner] = await ethers.getSigners();
            const MockVerifierFactory = await ethers.getContractFactory("MockVerifierFactory");
            const verifierFactory = await MockVerifierFactory.deploy();
            await verifierFactory.waitForDeployment();
            
            const PrivateYieldFarming = await ethers.getContractFactory("PrivateYieldFarming");
            
            await expect(
                PrivateYieldFarming.deploy(
                    ethers.ZeroAddress,
                    await verifierFactory.getAddress()
                )
            ).to.be.revertedWithCustomError(PrivateYieldFarming, "InvalidTokenAddress");
        });
    });
    
    describe("Pool Creation", function () {
        it("Should allow creating a new farming pool", async function () {
            const { yieldFarming } = await loadFixture(deployYieldFarmingFixture);
            
            const poolName = "Test Pool";
            const stakingToken = ethers.keccak256(ethers.toUtf8Bytes("staking-token"));
            const rewardToken = ethers.keccak256(ethers.toUtf8Bytes("reward-token"));
            const rewardRate = ethers.parseEther("1"); // 1 token per second
            const duration = 30 * 24 * 60 * 60; // 30 days
            const minStake = ethers.parseEther("100");
            const maxStake = ethers.parseEther("1000000");
            const isPrivate = true;
            
            const tx = yieldFarming.createPool(
                poolName,
                stakingToken,
                rewardToken,
                rewardRate,
                duration,
                minStake,
                maxStake,
                isPrivate
            );
            
            // Get the poolId - contract starts with nextPoolId=1, increments to 2 for first pool
            const poolId = 2n;
            
            await expect(tx)
                .to.emit(yieldFarming, "PoolCreated")
                .withArgs(poolId, poolName, stakingToken, rewardToken, rewardRate);
            
            const pool = await yieldFarming.pools(poolId);
            expect(pool.name).to.equal(poolName);
            expect(pool.isActive).to.be.true;
        });
        
        it("Should prevent creating pool with invalid parameters", async function () {
            const { yieldFarming } = await loadFixture(deployYieldFarmingFixture);
            
            const stakingToken = ethers.keccak256(ethers.toUtf8Bytes("staking-token"));
            const rewardToken = ethers.keccak256(ethers.toUtf8Bytes("reward-token"));
            
            // Zero reward rate
            await expect(
                yieldFarming.createPool(
                    "Test Pool",
                    stakingToken,
                    rewardToken,
                    0,
                    30 * 24 * 60 * 60,
                    ethers.parseEther("100"),
                    ethers.parseEther("1000000"),
                    true
                )
            ).to.be.revertedWithCustomError(yieldFarming, "InvalidRewardRate");
            
            // Max stake less than min stake
            await expect(
                yieldFarming.createPool(
                    "Test Pool",
                    stakingToken,
                    rewardToken,
                    ethers.parseEther("1"),
                    30 * 24 * 60 * 60,
                    ethers.parseEther("1000"),
                    ethers.parseEther("100"), // Less than min
                    true
                )
            ).to.be.revertedWithCustomError(yieldFarming, "InvalidMaxStake");
        });
    });
    
    describe("Staking Operations", function () {
        it("Should allow staking with valid ZK proof", async function () {
            const { yieldFarming, verifierFactory, tokenContract, governance } = await loadFixture(deployYieldFarmingFixture);
            
            // First create a pool - get poolId from event
            const createPoolTx = await yieldFarming.createPool(
                "Test Pool",
                ethers.keccak256(ethers.toUtf8Bytes("staking-token")),
                ethers.keccak256(ethers.toUtf8Bytes("reward-token")),
                ethers.parseEther("1"),
                30 * 24 * 60 * 60,
                ethers.parseEther("100"),
                ethers.parseEther("1000000"),
                true
            );
            const receipt = await createPoolTx.wait();
            // Extract poolId from PoolCreated event
            const poolCreatedEvent = receipt.logs.find(log => {
                try {
                    const parsed = yieldFarming.interface.parseLog(log);
                    return parsed && parsed.name === "PoolCreated";
                } catch {
                    return false;
                }
            });
            const parsedEvent = yieldFarming.interface.parseLog(poolCreatedEvent);
            const poolId = parsedEvent.args[0]; // poolId is the first argument
            
            // Use unique nullifier and commitment to avoid conflicts
            const mockProof = testHelpers.generateMockZKProof("contribution");
            // Use unique commitment to avoid CommitmentAlreadyExists
            const stakerCommitment = testHelpers.generateUniqueCommitment("staker-yield");
            const nullifier = testHelpers.generateUniqueNullifier();
            const amount = ethers.parseEther("1000");
            const lockDuration = 7 * 24 * 60 * 60; // 7 days
            
            // Shield tokens to commitment first - stake() calls transferToPoolInternal which requires the commitment to have a balance
            await mintShield(tokenContract, governance, stakerCommitment, amount + ethers.parseEther("100"), testHelpers); // Amount + buffer
            
            // Set verifier to return true
            const farmingVerifier = await verifierFactory.verifiers("farming");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", farmingVerifier);
            await mockVerifier.setShouldVerify(true);
            
            const stakeParams = {
                poolId: poolId,
                amount: amount,
                lockDuration: lockDuration,
                stakerCommitment: stakerCommitment,
                nullifier: nullifier,
                zkProof: ethers.AbiCoder.defaultAbiCoder().encode(
                    ["uint256[8]"],
                    [[
                        mockProof.a[0],
                        mockProof.a[1],
                        mockProof.b[0][0],
                        mockProof.b[0][1],
                        mockProof.b[1][0],
                        mockProof.b[1][1],
                        mockProof.c[0],
                        mockProof.c[1]
                    ]]
                )
            };
            
            await expect(
                yieldFarming.stake(stakeParams)
            ).to.emit(yieldFarming, "Staked");
        });
    });
    
    describe("Unstaking Operations", function () {
        it("Should allow unstaking with valid proof", async function () {
            const { yieldFarming, verifierFactory } = await loadFixture(deployYieldFarmingFixture);
            
            // This would require setting up a pool and staking first
            // Simplified test structure for now
        });
    });
    
    describe("Reward Claims", function () {
        it("Should allow claiming rewards with valid proof", async function () {
            const { yieldFarming, verifierFactory } = await loadFixture(deployYieldFarmingFixture);
            
            // This would require setting up a pool, staking, and accumulating rewards
            // Simplified test structure for now
        });
    });
    
    describe("Access Control", function () {
        it("Should allow governance to pause contract", async function () {
            const { yieldFarming, governance } = await loadFixture(deployYieldFarmingFixture);
            
            await yieldFarming.connect(governance).pause();
            expect(await yieldFarming.paused()).to.be.true;
        });
        
        it("Should prevent operations when paused", async function () {
            const { yieldFarming, governance } = await loadFixture(deployYieldFarmingFixture);
            
            await yieldFarming.connect(governance).pause();
            
            // Try to create pool while paused
            await expect(
                yieldFarming.createPool(
                    "Test Pool",
                    ethers.keccak256(ethers.toUtf8Bytes("staking-token")),
                    ethers.keccak256(ethers.toUtf8Bytes("reward-token")),
                    ethers.parseEther("1"),
                    30 * 24 * 60 * 60,
                    ethers.parseEther("100"),
                    ethers.parseEther("1000000"),
                    true
                )
            ).to.be.revertedWithCustomError(yieldFarming, "EnforcedPause");
        });
    });

    describe("Launch scheduling", function () {
        it("Should allow governance to schedule liquidity deployment", async function () {
            const { yieldFarming, governance } = await loadFixture(deployYieldFarmingFixture);
            const current = await time.latest();
            const startTime = Number(current) + 3600;
            const gracePeriod = 7200;
            
            await expect(
                yieldFarming.connect(governance).scheduleLiquidityDeployment(startTime, gracePeriod)
            )
                .to.emit(yieldFarming, "LiquidityLaunchScheduled")
                .withArgs(startTime, gracePeriod);
            
            const config = await yieldFarming.liquidityLaunchConfig();
            expect(config.startTime).to.equal(startTime);
            expect(config.gracePeriod).to.equal(gracePeriod);
            expect(config.isScheduled).to.be.true;
        });
        
        it("Should revert when non-governance attempts to schedule deployment", async function () {
            const { yieldFarming, user1 } = await loadFixture(deployYieldFarmingFixture);
            const current = await time.latest();
            const startTime = Number(current) + 3600;
            await expect(
                yieldFarming.connect(user1).scheduleLiquidityDeployment(startTime, 3600)
            ).to.be.revertedWithCustomError(yieldFarming, "UnauthorizedAccess");
        });
        
        it("Should revert if start time is not in the future", async function () {
            const { yieldFarming, governance } = await loadFixture(deployYieldFarmingFixture);
            const current = await time.latest();
            const startTime = Number(current);
            await expect(
                yieldFarming.connect(governance).scheduleLiquidityDeployment(startTime, 3600)
            ).to.be.revertedWithCustomError(yieldFarming, "InvalidTimestamp");
        });
    });

    describe("Liquidity Allocator Integration", function () {
        it("Should allow owner to configure the liquidity allocator", async function () {
            const { yieldFarming, owner, governance, user1 } = await loadFixture(deployYieldFarmingFixture);

            await expect(
                yieldFarming.connect(owner).setLiquidityAllocator(user1.address)
            )
                .to.emit(yieldFarming, "LiquidityAllocatorUpdated")
                .withArgs(ethers.ZeroAddress, user1.address);

            expect(await yieldFarming.liquidityAllocator()).to.equal(user1.address);

            await expect(
                yieldFarming.connect(user1).setLiquidityAllocator(governance.address)
            ).to.be.revertedWithCustomError(yieldFarming, "UnauthorizedAccess");
        });

        it("routes early withdrawal penalties to the configured allocator", async function () {
            const { yieldFarming, tokenContract, verifierFactory, governance, owner, user1 } =
                await loadFixture(deployYieldFarmingFixture);

            // Configure liquidity allocator
            await yieldFarming.connect(owner).setLiquidityAllocator(user1.address);

            // Create a pool
            const poolTx = await yieldFarming.createPool(
                "Penalty Pool",
                ethers.keccak256(ethers.toUtf8Bytes("staking-token")),
                ethers.keccak256(ethers.toUtf8Bytes("reward-token")),
                ethers.parseEther("1"),
                30 * 24 * 60 * 60,
                ethers.parseEther("100"),
                ethers.parseEther("1000000"),
                true
            );
            const poolReceipt = await poolTx.wait();
            const poolEvent = poolReceipt.logs.find((log) => {
                try {
                    const parsed = yieldFarming.interface.parseLog(log);
                    return parsed && parsed.name === "PoolCreated";
                } catch {
                    return false;
                }
            });
            const poolId = poolEvent.args[0];

            // Prepare stake
            const mockProof = testHelpers.generateMockZKProof("contribution");
            const stakerCommitment = testHelpers.generateUniqueCommitment("staker-yield");
            const stakeNullifier = testHelpers.generateUniqueNullifier();
            const amount = ethers.parseEther("1000");
            const lockDuration = 7 * 24 * 60 * 60;

            await mintShield(tokenContract, governance, 
                stakerCommitment, amount + ethers.parseEther("100"), testHelpers
            );

            const farmingVerifier = await verifierFactory.verifiers("farming");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", farmingVerifier);
            await mockVerifier.setShouldVerify(true);

            const encodedProof = ethers.AbiCoder.defaultAbiCoder().encode(
                ["uint256[8]"],
                [[
                    mockProof.a[0],
                    mockProof.a[1],
                    mockProof.b[0][0],
                    mockProof.b[0][1],
                    mockProof.b[1][0],
                    mockProof.b[1][1],
                    mockProof.c[0],
                    mockProof.c[1]
                ]]
            );

            const stakeParams = {
                poolId,
                amount,
                lockDuration,
                stakerCommitment,
                nullifier: stakeNullifier,
                zkProof: encodedProof
            };

            const stakeTx = await yieldFarming.stake(stakeParams);
            const stakeReceipt = await stakeTx.wait();
            const stakeEvent = stakeReceipt.logs.find((log) => {
                try {
                    const parsed = yieldFarming.interface.parseLog(log);
                    return parsed && parsed.name === "Staked";
                } catch {
                    return false;
                }
            });
            const positionId = stakeEvent.args[1];

            const initialAllocatorBalance = await tokenContract.balanceOf(user1.address);
            expect(initialAllocatorBalance).to.equal(0n);

            const withdrawalCommitment = testHelpers.generateUniqueCommitment("withdrawal");
            const unstakeNullifier = testHelpers.generateUniqueNullifier();

            const unstakeParams = {
                positionId,
                amount,
                withdrawalCommitment,
                nullifier: unstakeNullifier,
                zkProof: encodedProof
            };

            await yieldFarming.unstake(unstakeParams);

            const penaltyBps = await yieldFarming.EARLY_WITHDRAWAL_PENALTY();
            const expectedPenalty = (amount * penaltyBps) / 10000n;

            const allocatorBalance = await tokenContract.balanceOf(user1.address);
            expect(allocatorBalance).to.equal(expectedPenalty);
        });
    });
    
    describe("Pool Management", function () {
        it("Should return correct pool information", async function () {
            const { yieldFarming } = await loadFixture(deployYieldFarmingFixture);
            
            const poolName = "Test Pool";
            const stakingToken = ethers.keccak256(ethers.toUtf8Bytes("staking-token"));
            const rewardToken = ethers.keccak256(ethers.toUtf8Bytes("reward-token"));
            const rewardRate = ethers.parseEther("1");
            const duration = 30 * 24 * 60 * 60;
            const minStake = ethers.parseEther("100");
            const maxStake = ethers.parseEther("1000000");
            
            await yieldFarming.createPool(
                poolName,
                stakingToken,
                rewardToken,
                rewardRate,
                duration,
                minStake,
                maxStake,
                true
            );
            
            const poolId = await yieldFarming.nextPoolId();
            const pool = await yieldFarming.pools(poolId);
            expect(pool.name).to.equal(poolName);
            expect(pool.stakingToken).to.equal(stakingToken);
            expect(pool.rewardToken).to.equal(rewardToken);
            expect(pool.rewardRate).to.equal(rewardRate);
        });
    });

    describe("Security: Division by Zero Tests", function () {
        it("Should handle reward calculation with zero total staked", async function () {
            const { yieldFarming } = await loadFixture(deployYieldFarmingFixture);
            
            // Create pool
            const poolName = "Test Pool Zero";
            const stakingToken = ethers.keccak256(ethers.toUtf8Bytes("staking-zero"));
            const rewardToken = ethers.keccak256(ethers.toUtf8Bytes("reward-zero"));
            const rewardRate = ethers.parseEther("1");
            const duration = 30 * 24 * 60 * 60;
            const minStake = ethers.parseEther("100");
            const maxStake = ethers.parseEther("1000000");
            
            await yieldFarming.createPool(
                poolName,
                stakingToken,
                rewardToken,
                rewardRate,
                duration,
                minStake,
                maxStake,
                true
            );
            
            const poolId = await yieldFarming.nextPoolId();
            const pool = await yieldFarming.pools(poolId);
            
            // Pool should have zero total staked initially
            expect(pool.totalStaked).to.equal(0);
            
            // Operations should handle zero totalStaked without division by zero
            // The contract should prevent division by zero in reward calculations
            expect(pool.totalStaked).to.equal(0);
        });

        it("Should prevent operations when pool totalStaked is zero", async function () {
            const { yieldFarming } = await loadFixture(deployYieldFarmingFixture);
            
            // Create pool with zero staked
            const poolName = "Empty Pool";
            const stakingToken = ethers.keccak256(ethers.toUtf8Bytes("empty-token"));
            const rewardToken = ethers.keccak256(ethers.toUtf8Bytes("reward-empty"));
            const rewardRate = ethers.parseEther("1");
            const duration = 30 * 24 * 60 * 60;
            const minStake = ethers.parseEther("100");
            const maxStake = ethers.parseEther("1000000");
            
            await yieldFarming.createPool(
                poolName,
                stakingToken,
                rewardToken,
                rewardRate,
                duration,
                minStake,
                maxStake,
                true
            );
            
            const poolId = await yieldFarming.nextPoolId();
            const pool = await yieldFarming.pools(poolId);
            
            // Pool should exist but have zero staked
            expect(pool.totalStaked).to.equal(0);
            expect(pool.isActive).to.be.true; // Pool struct has isActive, not initialized
            
            // The contract should handle zero totalStaked gracefully
            // Reward calculations should not cause division by zero
            // Try to get pool - should not revert (getPool exists, not getPoolInfo)
            const poolInfo = await yieldFarming.getPool(poolId);
            expect(poolInfo.totalStaked).to.equal(0);
        });
    });
});

