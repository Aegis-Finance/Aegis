const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("MilestoneVerifier - Comprehensive Test Suite", function () {
    async function deployFixture() {
        const [deployer, governance, creator, reviewer1, reviewer2] = await ethers.getSigners();

        // Deploy MockZKVerifier
        const MockZKVerifier = await ethers.getContractFactory("MockZKVerifier");
        const mockZKVerifier = await MockZKVerifier.deploy();

        // Deploy MilestoneVerifier
        const MilestoneVerifier = await ethers.getContractFactory("MilestoneVerifier");
        const milestoneVerifier = await MilestoneVerifier.deploy(
            await mockZKVerifier.getAddress(),
            await governance.getAddress()
        );

        return {
            milestoneVerifier,
            mockZKVerifier,
            deployer,
            governance,
            creator,
            reviewer1,
            reviewer2
        };
    }

    describe("Deployment", function () {
        it("Should deploy with correct parameters", async function () {
            const { milestoneVerifier, mockZKVerifier, governance } = await loadFixture(deployFixture);
            
            expect(await milestoneVerifier.GROTH16_VERIFIER()).to.equal(await mockZKVerifier.getAddress());
        });
    });

    describe("Campaign Management", function () {
        it("Should create campaign", async function () {
            const { milestoneVerifier, governance } = await loadFixture(deployFixture);
            
            await expect(
                milestoneVerifier.connect(governance).createCampaign()
            ).to.emit(milestoneVerifier, "CampaignCreated");
        });
    });

    describe("Milestone Creation", function () {
        it("Should create milestone with valid parameters", async function () {
            const { milestoneVerifier, governance } = await loadFixture(deployFixture);
            
            // First create a campaign
            await milestoneVerifier.connect(governance).createCampaign();
            
            await expect(
                milestoneVerifier.connect(governance).createMilestone(
                    1, // campaignId
                    1, // milestoneId
                    3, // requiredReviews
                    80 // minimumScore
                )
            ).to.emit(milestoneVerifier, "MilestoneCreated");
        });

        it("Should reject milestone creation from non-governance", async function () {
            const { milestoneVerifier, creator } = await loadFixture(deployFixture);
            
            await expect(
                milestoneVerifier.connect(creator).createMilestone(
                    1, // campaignId
                    1, // milestoneId
                    3, // requiredReviews
                    80 // minimumScore
                )
            ).to.be.revertedWithCustomError(milestoneVerifier, "UnauthorizedAccess");
        });
    });

    describe("Milestone Review Verification", function () {
        it("Should verify milestone review with valid proof", async function () {
            const { milestoneVerifier, mockZKVerifier, governance, reviewer1 } = await loadFixture(deployFixture);
            
            // Setup: Create campaign and milestone
            await milestoneVerifier.connect(governance).createCampaign();
            await milestoneVerifier.connect(governance).createMilestone(1, 1, 3, 80);
            
            // Set mock verifier to return true
            await mockZKVerifier.setShouldVerify(true);
            
            // Set reviewer reputation to meet minimum requirements
            await milestoneVerifier.connect(governance).setReviewerReputation(reviewer1.address, 100);
            
            const proof = [1, 2, 3, 4, 5, 6, 7, 8];
            const publicInputs = [1, 1, 85, reviewer1.address, 12345, 67890, 11111, 22222, 33333, 44444]; // Need 10+ elements
            
            await expect(
                milestoneVerifier.connect(reviewer1).verifyMilestoneReview(
                    1, // campaignId
                    1, // milestoneId
                    proof,
                    publicInputs
                )
            ).to.emit(milestoneVerifier, "MilestoneReviewVerified");
        });
    });

    describe("Access Control", function () {
        it("Should only allow governance to update parameters", async function () {
            const { milestoneVerifier, governance, creator } = await loadFixture(deployFixture);
            
            // Governance can update reviewer reputation
            await expect(
                milestoneVerifier.connect(governance).setReviewerReputation(creator.address, 100)
            ).to.not.be.reverted;
            
            // Non-governance cannot update reviewer reputation
            await expect(
                milestoneVerifier.connect(creator).setReviewerReputation(creator.address, 100)
            ).to.be.revertedWithCustomError(milestoneVerifier, "UnauthorizedAccess");
        });

        it("Should allow governance to set reviewer weights", async function () {
            const { milestoneVerifier, governance, reviewer1 } = await loadFixture(deployFixture);
            
            await expect(
                milestoneVerifier.connect(governance).setReviewerWeight(reviewer1.address, 150)
            ).to.not.be.reverted;
        });
    });

    describe("Information Retrieval", function () {
        it("Should get milestone info", async function () {
            const { milestoneVerifier, governance } = await loadFixture(deployFixture);
            
            // Create campaign and milestone
            await milestoneVerifier.connect(governance).createCampaign();
            await milestoneVerifier.connect(governance).createMilestone(1, 1, 3, 80);
            
            const milestoneInfo = await milestoneVerifier.getMilestoneInfo(1, 1);
            
            // getMilestoneInfo returns: totalReviews, verifiedReviews, averageScore, isComplete, isActive, creationTime, completionTime, metrics
            expect(milestoneInfo[0]).to.equal(0); // totalReviews
            expect(milestoneInfo[1]).to.equal(0); // verifiedReviews
            expect(milestoneInfo[2]).to.equal(0); // averageScore
            expect(milestoneInfo[3]).to.equal(false); // isComplete
            expect(milestoneInfo[4]).to.equal(true); // isActive
        });

        it("Should get campaign summary", async function () {
            const { milestoneVerifier, governance } = await loadFixture(deployFixture);
            
            // Create campaign with milestones
            await milestoneVerifier.connect(governance).createCampaign();
            await milestoneVerifier.connect(governance).createMilestone(1, 1, 3, 80);
            await milestoneVerifier.connect(governance).createMilestone(1, 2, 3, 80);
            
            const summary = await milestoneVerifier.getCampaignSummary(1);
            
            // getCampaignSummary returns: totalMilestones, completedMilestones, totalReviews, averageScore
            expect(summary[0]).to.equal(2); // totalMilestones
            expect(summary[1]).to.equal(0); // completedMilestones
        });
    });

    describe("Governance", function () {
        it("Should allow governance to update governance address", async function () {
            const { milestoneVerifier, governance, creator } = await loadFixture(deployFixture);
            
            await expect(
                milestoneVerifier.connect(governance).setGovernance(creator.address)
            ).to.not.be.reverted;
        });

        it("Should reject governance update from non-governance", async function () {
            const { milestoneVerifier, creator } = await loadFixture(deployFixture);
            
            await expect(
                milestoneVerifier.connect(creator).setGovernance(creator.address)
            ).to.be.revertedWithCustomError(milestoneVerifier, "UnauthorizedAccess");
        });
    });

    // Note: MilestoneVerifier doesn't have pause functionality
    // Pause functionality is available in AegisCrowdShield contract
});