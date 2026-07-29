const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { TestHelpers } = require("./helpers/TestHelpers");

describe("OnChainPrivacyLeaderboard", function () {
    let testHelpers;
    
    async function deployLeaderboardFixture() {
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
        
        // Deploy OnChainPrivacyLeaderboard
        const OnChainPrivacyLeaderboard = await ethers.getContractFactory("OnChainPrivacyLeaderboard");
        const leaderboard = await OnChainPrivacyLeaderboard.deploy(
            await tokenContract.getAddress(),
            await verifierFactory.getAddress()
        );
        await leaderboard.waitForDeployment();
        
        return {
            leaderboard,
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
        it("Should deploy with correct token and verifier factory", async function () {
            const { leaderboard, tokenContract, verifierFactory } = await loadFixture(deployLeaderboardFixture);
            
            expect(await leaderboard.PRIVATE_TOKEN()).to.equal(await tokenContract.getAddress());
            expect(await leaderboard.VERIFIER_FACTORY()).to.equal(await verifierFactory.getAddress());
        });
        
        it("Should initialize with zero registered sovereigns", async function () {
            const { leaderboard } = await loadFixture(deployLeaderboardFixture);
            
            // Use the getter function for totalRegisteredSovereigns
            const totalRegistered = await leaderboard.totalRegisteredSovereigns();
            expect(totalRegistered).to.equal(0);
        });
        
        it("Should have correct constants", async function () {
            const { leaderboard } = await loadFixture(deployLeaderboardFixture);
            
            expect(await leaderboard.MAX_SOVEREIGN_PARTICIPANTS()).to.equal(1000);
            expect(await leaderboard.LIBERTY_CYCLE_DURATION()).to.equal(30 * 24 * 60 * 60); // 30 days
            expect(await leaderboard.MIN_SOVEREIGNTY_SCORE()).to.equal(100);
            expect(await leaderboard.MAX_SOVEREIGNTY_SCORE()).to.equal(10000);
        });
    });
    
    describe("Sovereign Registration", function () {
        it("Should allow registering sovereign individuals with valid proof", async function () {
            const { leaderboard, verifierFactory } = await loadFixture(deployLeaderboardFixture);
            
            const mockProof = testHelpers.generateMockZKProof("contribution");
            const sovereignCommitment = mockProof.commitment;
            const nullifier = mockProof.nullifier;
            const libertyNickname = "LibertySeeker";
            const austrianMentor = ethers.ZeroHash; // No mentor for first registration
            
            const leaderboardVerifier = await verifierFactory.verifiers("leaderboard");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", leaderboardVerifier);
            await mockVerifier.setShouldVerify(true);
            
            const registration = {
                sovereignCommitment: sovereignCommitment,
                libertyNickname: libertyNickname,
                austrianMentor: austrianMentor,
                praxeologicalNullifier: nullifier,
                zkSovereigntyProof: ethers.AbiCoder.defaultAbiCoder().encode(
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
                leaderboard.registerSovereignIndividual(registration)
            ).to.emit(leaderboard, "SovereignIndividualRegistered");
            
            // sovereignRegistry is a struct, access its fields through the leaderboard contract
            const sovereign = await leaderboard.sovereigntyIndividuals(sovereignCommitment);
            expect(sovereign.libertyAlias).to.equal(libertyNickname);
        });
        
        it("Should prevent duplicate registrations", async function () {
            const { leaderboard, verifierFactory } = await loadFixture(deployLeaderboardFixture);
            
            const mockProof = testHelpers.generateMockZKProof("contribution");
            const sovereignCommitment = mockProof.commitment;
            
            const leaderboardVerifier = await verifierFactory.verifiers("leaderboard");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", leaderboardVerifier);
            await mockVerifier.setShouldVerify(true);
            
            const registration1 = {
                sovereignCommitment: sovereignCommitment,
                libertyNickname: "Alias1",
                austrianMentor: ethers.ZeroHash,
                praxeologicalNullifier: mockProof.nullifier,
                zkSovereigntyProof: ethers.AbiCoder.defaultAbiCoder().encode(
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
            
            await leaderboard.registerSovereignIndividual(registration1);
            
            // Try to register again with same commitment (but different nullifier)
            const newProof = testHelpers.generateMockZKProof("contribution");
            // Use unique nullifier to avoid conflict with first registration
            const uniqueNullifier = testHelpers.generateUniqueNullifier();
            const registration2 = {
                sovereignCommitment: sovereignCommitment, // Same commitment should trigger SovereignAlreadyRegistered
                libertyNickname: "Alias2",
                austrianMentor: ethers.ZeroHash,
                praxeologicalNullifier: uniqueNullifier, // Use unique nullifier so we test the right error
                zkSovereigntyProof: ethers.AbiCoder.defaultAbiCoder().encode(
                    ["uint256[8]"],
                    [[
                        newProof.a[0],
                        newProof.a[1],
                        newProof.b[0][0],
                        newProof.b[0][1],
                        newProof.b[1][0],
                        newProof.b[1][1],
                        newProof.c[0],
                        newProof.c[1]
                    ]]
                )
            };
            
            await expect(
                leaderboard.registerSovereignIndividual(registration2)
            ).to.be.revertedWithCustomError(leaderboard, "SovereignAlreadyRegistered");
        });
    });
    
    describe("Praxeological Actions", function () {
        it("Should allow submitting praxeological activity with valid proof", async function () {
            const { leaderboard, verifierFactory } = await loadFixture(deployLeaderboardFixture);
            
            // First register a sovereign
            const mockProof = testHelpers.generateMockZKProof("contribution");
            const sovereignCommitment = mockProof.commitment;
            
            const leaderboardVerifier = await verifierFactory.verifiers("leaderboard");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", leaderboardVerifier);
            await mockVerifier.setShouldVerify(true);
            
            // Use unique nullifier to avoid conflicts
            const registrationNullifier = testHelpers.generateUniqueNullifier();
            const registration = {
                sovereignCommitment: sovereignCommitment,
                libertyNickname: "LibertySeeker",
                austrianMentor: ethers.ZeroHash,
                praxeologicalNullifier: registrationNullifier,
                zkSovereigntyProof: ethers.AbiCoder.defaultAbiCoder().encode(
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
            
            await leaderboard.registerSovereignIndividual(registration);
            
            // Advance time past cooldown period (1 hour) to avoid IndividualActionCooldownActive
            await time.increase(3600 + 1); // 1 hour + 1 second
            
            // Submit praxeological activity - use unique nullifier
            const actionProof = testHelpers.generateMockZKProof("contribution");
            const submissionTimestamp = await time.latest();
            const actionNullifier = testHelpers.generateUniqueNullifier();
            
            const praxeologicalSubmission = {
                sovereignCommitment: sovereignCommitment,
                voluntaryExchangeCount: 10,
                soundMoneyVolume: ethers.parseEther("1000"),
                sovereigntyScore: 500,
                actionNullifier: actionNullifier,
                submissionTimestamp: submissionTimestamp,
                zkFreedomProof: ethers.AbiCoder.defaultAbiCoder().encode(
                    ["uint256[8]"],
                    [[
                        actionProof.a[0],
                        actionProof.a[1],
                        actionProof.b[0][0],
                        actionProof.b[0][1],
                        actionProof.b[1][0],
                        actionProof.b[1][1],
                        actionProof.c[0],
                        actionProof.c[1]
                    ]]
                )
            };
            
            await expect(
                leaderboard.submitPraxeologicalActivity(praxeologicalSubmission)
            ).to.emit(leaderboard, "PraxeologicalActionRecorded");
        });
    });
    
    describe("Leaderboard Rankings", function () {
        it("Should track sovereign registry state", async function () {
            const { leaderboard, verifierFactory } = await loadFixture(deployLeaderboardFixture);
            
            // Register a sovereign first
            const mockProof = testHelpers.generateMockZKProof("contribution");
            const sovereignCommitment = mockProof.commitment;
            
            const leaderboardVerifier = await verifierFactory.verifiers("leaderboard");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", leaderboardVerifier);
            await mockVerifier.setShouldVerify(true);
            
            // Use unique nullifier for registration
            const rankerNullifier = testHelpers.generateUniqueNullifier();
            const registration = {
                sovereignCommitment: sovereignCommitment,
                libertyNickname: "Ranker",
                austrianMentor: ethers.ZeroHash,
                praxeologicalNullifier: rankerNullifier,
                zkSovereigntyProof: ethers.AbiCoder.defaultAbiCoder().encode(
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
            
            await leaderboard.registerSovereignIndividual(registration);
            
            // Check total registered sovereigns - sovereignRegistry is a struct
            const totalRegistered = await leaderboard.totalRegisteredSovereigns();
            expect(totalRegistered).to.equal(1);
        });
    });
    
    describe("Achievements", function () {
        it("Should track achievements for sovereigns", async function () {
            const { leaderboard, verifierFactory } = await loadFixture(deployLeaderboardFixture);
            
            // Register a sovereign first
            const mockProof = testHelpers.generateMockZKProof("contribution");
            const sovereignCommitment = mockProof.commitment;
            
            const leaderboardVerifier = await verifierFactory.verifiers("leaderboard");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", leaderboardVerifier);
            await mockVerifier.setShouldVerify(true);
            
            const registration = {
                sovereignCommitment: sovereignCommitment,
                libertyNickname: "Achiever",
                austrianMentor: ethers.ZeroHash,
                praxeologicalNullifier: mockProof.nullifier,
                zkSovereigntyProof: ethers.AbiCoder.defaultAbiCoder().encode(
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
            
            await leaderboard.registerSovereignIndividual(registration);
            
            // Check achievements
            const achievements = await leaderboard.getSovereignAchievements(sovereignCommitment);
            expect(achievements).to.be.an("array");
        });
    });
});

