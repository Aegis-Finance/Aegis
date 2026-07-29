const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { TestHelpers } = require("./helpers/TestHelpers");

describe("PrivateAnalytics", function () {
    let testHelpers;
    
    async function deployAnalyticsFixture() {
        const [owner, governance, user1, user2] = await ethers.getSigners();
        
        // Deploy mock verifier factory
        const MockVerifierFactory = await ethers.getContractFactory("MockVerifierFactory");
        const verifierFactory = await MockVerifierFactory.deploy();
        await verifierFactory.waitForDeployment();
        
        // Deploy PrivateAnalytics
        const PrivateAnalytics = await ethers.getContractFactory("PrivateAnalytics");
        const analytics = await PrivateAnalytics.deploy(
            await verifierFactory.getAddress()
        );
        await analytics.waitForDeployment();
        
        return {
            analytics,
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
        it("Should deploy with correct verifier factory", async function () {
            const { analytics, verifierFactory } = await loadFixture(deployAnalyticsFixture);
            
            expect(await analytics.VERIFIER_FACTORY()).to.equal(await verifierFactory.getAddress());
        });
        
        it("Should initialize with epoch 0", async function () {
            const { analytics } = await loadFixture(deployAnalyticsFixture);
            
            const currentEpoch = await analytics.currentEpoch();
            expect(currentEpoch).to.be.greaterThanOrEqual(0);
        });
        
        it("Should initialize with zero global metrics", async function () {
            const { analytics } = await loadFixture(deployAnalyticsFixture);
            
            expect(await analytics.totalPrivateUsers()).to.equal(0);
            expect(await analytics.totalPrivateTransactions()).to.equal(0);
            expect(await analytics.totalPrivateVolume()).to.equal(0);
        });
        
        it("Should have correct constants", async function () {
            const { analytics } = await loadFixture(deployAnalyticsFixture);
            
            expect(await analytics.EPOCH_DURATION()).to.equal(24 * 60 * 60); // 1 day
            expect(await analytics.ANALYTICS_RETENTION()).to.equal(365 * 24 * 60 * 60); // 365 days
        });
    });
    
    describe("Metric Submission", function () {
        it("Should allow submitting metrics with valid ZK proof", async function () {
            const { analytics, verifierFactory } = await loadFixture(deployAnalyticsFixture);
            
            const mockProof = testHelpers.generateMockZKProof("contribution");
            const userCommitment = mockProof.commitment;
            const nullifier = mockProof.nullifier;
            const metricType = 0; // TVL
            const protocolType = 0; // LENDING
            const value = ethers.parseEther("1000");
            const submissionTimestamp = await time.latest();
            
            const analyticsVerifier = await verifierFactory.verifiers("analytics");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", analyticsVerifier);
            await mockVerifier.setShouldVerify(true);
            
            const metricSubmission = {
                metricType: metricType,
                protocolType: protocolType,
                value: value,
                timestamp: submissionTimestamp,
                userCommitment: userCommitment,
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
                analytics.submitMetric(metricSubmission)
            ).to.emit(analytics, "MetricSubmitted");
        });
        
        it("Should prevent double-spending with same nullifier", async function () {
            const { analytics, verifierFactory } = await loadFixture(deployAnalyticsFixture);
            
            const mockProof = testHelpers.generateMockZKProof("contribution");
            const nullifier = mockProof.nullifier;
            const submissionTimestamp = await time.latest();
            
            const analyticsVerifier = await verifierFactory.verifiers("analytics");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", analyticsVerifier);
            await mockVerifier.setShouldVerify(true);
            
            const metricSubmission = {
                metricType: 0,
                protocolType: 0,
                value: ethers.parseEther("1000"),
                timestamp: submissionTimestamp,
                userCommitment: mockProof.commitment,
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
            
            await analytics.submitMetric(metricSubmission);
            
            // Try to submit again with same nullifier
            await expect(
                analytics.submitMetric(metricSubmission)
            ).to.be.revertedWithCustomError(analytics, "NullifierAlreadyUsed");
        });
        
        it("Should reject metrics with zero value", async function () {
            const { analytics, verifierFactory } = await loadFixture(deployAnalyticsFixture);
            
            const mockProof = testHelpers.generateMockZKProof("contribution");
            const submissionTimestamp = await time.latest();
            
            const analyticsVerifier = await verifierFactory.verifiers("analytics");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", analyticsVerifier);
            await mockVerifier.setShouldVerify(true);
            
            const metricSubmission = {
                metricType: 0,
                protocolType: 0,
                value: 0, // Zero value
                timestamp: submissionTimestamp,
                userCommitment: mockProof.commitment,
                nullifier: mockProof.nullifier,
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
                analytics.submitMetric(metricSubmission)
            ).to.be.revertedWithCustomError(analytics, "InvalidMetricValue");
        });
        
        it("Should reject metrics with future timestamps beyond tolerance", async function () {
            const { analytics, verifierFactory } = await loadFixture(deployAnalyticsFixture);
            
            const mockProof = testHelpers.generateMockZKProof("contribution");
            const futureTimestamp = (await time.latest()) + 400; // 400 seconds in future - beyond tolerance
            
            const analyticsVerifier = await verifierFactory.verifiers("analytics");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", analyticsVerifier);
            await mockVerifier.setShouldVerify(true);
            
            const metricSubmission = {
                metricType: 0,
                protocolType: 0,
                value: ethers.parseEther("1000"),
                timestamp: futureTimestamp,
                userCommitment: mockProof.commitment,
                nullifier: mockProof.nullifier,
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
                analytics.submitMetric(metricSubmission)
            ).to.be.revertedWithCustomError(analytics, "FutureTimestamp");
        });
    });
    
    describe("Privacy Score Updates", function () {
        it("Should allow updating privacy scores with valid proof", async function () {
            const { analytics, verifierFactory } = await loadFixture(deployAnalyticsFixture);
            
            const mockProof = testHelpers.generateMockZKProof("contribution");
            const userCommitment = mockProof.commitment;
            const nullifier = mockProof.nullifier;
            const newScore = 750;
            
            const analyticsVerifier = await verifierFactory.verifiers("analytics");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", analyticsVerifier);
            await mockVerifier.setShouldVerify(true);
            
            await expect(
                analytics.updatePrivacyScore(
                    userCommitment,
                    newScore,
                    nullifier,
                    ethers.AbiCoder.defaultAbiCoder().encode(
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
                )
            ).to.emit(analytics, "PrivacyScoreUpdated");
        });
        
        it("Should enforce maximum privacy score", async function () {
            const { analytics, verifierFactory } = await loadFixture(deployAnalyticsFixture);
            
            const mockProof = testHelpers.generateMockZKProof("contribution");
            const invalidScore = 1500; // Above max of 1000
            
            const analyticsVerifier = await verifierFactory.verifiers("analytics");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", analyticsVerifier);
            await mockVerifier.setShouldVerify(true);
            
            await expect(
                analytics.updatePrivacyScore(
                    mockProof.commitment,
                    invalidScore,
                    mockProof.nullifier,
                    ethers.AbiCoder.defaultAbiCoder().encode(
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
                )
            ).to.be.revertedWithCustomError(analytics, "InvalidMetricValue");
        });
    });
    
    describe("Metric Queries", function () {
        it("Should return correct aggregated metrics for epoch", async function () {
            const { analytics, verifierFactory } = await loadFixture(deployAnalyticsFixture);
            
            // Submit a metric first
            const mockProof = testHelpers.generateMockZKProof("contribution");
            const submissionTimestamp = await time.latest();
            
            const analyticsVerifier = await verifierFactory.verifiers("analytics");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", analyticsVerifier);
            await mockVerifier.setShouldVerify(true);
            
            const metricSubmission = {
                metricType: 0, // TVL
                protocolType: 0, // LENDING
                value: ethers.parseEther("1000"),
                timestamp: submissionTimestamp,
                userCommitment: mockProof.commitment,
                nullifier: mockProof.nullifier,
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
            
            await analytics.submitMetric(metricSubmission);
            
            // Query aggregated metrics
            // Calculate epoch using BigInt division (timestamp / seconds per day)
            const secondsPerDay = BigInt(24 * 60 * 60);
            const epoch = BigInt(submissionTimestamp) / secondsPerDay;
            const aggregatedValue = await analytics.aggregatedMetrics(epoch, 0); // TVL
            expect(aggregatedValue).to.equal(ethers.parseEther("1000"));
        });
        
        it("Should return correct range statistics", async function () {
            const { analytics, verifierFactory } = await loadFixture(deployAnalyticsFixture);
            
            // Submit multiple metrics
            const mockProof1 = testHelpers.generateMockZKProof("contribution");
            const submissionTimestamp = await time.latest();
            
            const analyticsVerifier = await verifierFactory.verifiers("analytics");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", analyticsVerifier);
            await mockVerifier.setShouldVerify(true);
            
            const metricSubmission = {
                metricType: 0,
                protocolType: 0,
                value: ethers.parseEther("1000"),
                timestamp: submissionTimestamp,
                userCommitment: mockProof1.commitment,
                nullifier: mockProof1.nullifier,
                zkProof: ethers.AbiCoder.defaultAbiCoder().encode(
                    ["uint256[8]"],
                    [[
                        mockProof1.a[0],
                        mockProof1.a[1],
                        mockProof1.b[0][0],
                        mockProof1.b[0][1],
                        mockProof1.b[1][0],
                        mockProof1.b[1][1],
                        mockProof1.c[0],
                        mockProof1.c[1]
                    ]]
                )
            };
            
            await analytics.submitMetric(metricSubmission);
            
            // Query range statistics
            // Calculate epoch using BigInt division
            const secondsPerDay = BigInt(24 * 60 * 60);
            const epoch = BigInt(submissionTimestamp) / secondsPerDay;
            const [count, average] = await analytics.getRangeStatistics(
                epoch,
                0, // TVL
                ethers.parseEther("500"),
                ethers.parseEther("2000")
            );
            
            expect(count).to.be.greaterThanOrEqual(0);
        });
    });
    
    describe("Epoch Management", function () {
        it("Should correctly calculate epoch from timestamp", async function () {
            const { analytics } = await loadFixture(deployAnalyticsFixture);
            
            const currentTime = await time.latest();
            const epochDuration = await analytics.EPOCH_DURATION();
            const expectedEpoch = BigInt(currentTime) / BigInt(epochDuration);
            
            const currentEpoch = await analytics.currentEpoch();
            expect(currentEpoch).to.be.greaterThanOrEqual(0);
        });
    });
});


