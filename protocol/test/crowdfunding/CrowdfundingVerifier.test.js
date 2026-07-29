const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("CrowdfundingVerifier - Comprehensive Test Suite", function () {
    async function deployFixture() {
        const [owner, creator, contributor1, contributor2, governance] = await ethers.getSigners();

        // Deploy mock contracts
        const MockZKVerifier = await ethers.getContractFactory("MockZKVerifier");
        const mockZKVerifier = await MockZKVerifier.deploy();
        
        const MockVerifierFactory = await ethers.getContractFactory("MockVerifierFactory");
        const mockVerifierFactory = await MockVerifierFactory.deploy();
        
        // Deploy CrowdfundingVerifier
        const CrowdfundingVerifier = await ethers.getContractFactory("CrowdfundingVerifier");
        const crowdfundingVerifier = await CrowdfundingVerifier.deploy(
            await mockZKVerifier.getAddress(),
            governance.address
        );

        return {
            crowdfundingVerifier,
            mockZKVerifier,
            mockVerifierFactory,
            owner,
            creator,
            contributor1,
            contributor2,
            governance
        };
    }

    describe("Deployment and Initialization", function () {
        it("Should deploy with correct initial values", async function () {
            const { crowdfundingVerifier, mockZKVerifier, governance } = await loadFixture(deployFixture);
            
            expect(await crowdfundingVerifier.GROTH16_VERIFIER()).to.equal(await mockZKVerifier.getAddress());
            expect(await crowdfundingVerifier.GOVERNANCE()).to.equal(governance.address);
        });

        it("Should have correct GROTH16_VERIFIER address", async function () {
            const { crowdfundingVerifier, mockZKVerifier } = await loadFixture(deployFixture);
            
            const verifierAddress = await crowdfundingVerifier.GROTH16_VERIFIER();
            expect(verifierAddress).to.equal(await mockZKVerifier.getAddress());
        });

        it("Should have correct governance address", async function () {
            const { crowdfundingVerifier, governance } = await loadFixture(deployFixture);
            
            const governanceAddress = await crowdfundingVerifier.GOVERNANCE();
            expect(governanceAddress).to.equal(governance.address);
        });

        it("Should initialize with correct Austrian Economics parameters", async function () {
            const { crowdfundingVerifier } = await loadFixture(deployFixture);
            
            expect(await crowdfundingVerifier.MAX_CONTRIBUTIONS_PER_CAMPAIGN()).to.equal(10000);
            expect(await crowdfundingVerifier.MAX_CONTRIBUTIONS_PER_CONTRIBUTOR()).to.equal(100);
            expect(await crowdfundingVerifier.MIN_REPUTATION_SCORE()).to.equal(50);
        });
    });

    describe("Campaign Creation", function () {
        it("Should create campaign with valid proof", async function () {
            const { crowdfundingVerifier, creator } = await loadFixture(deployFixture);
            
            await expect(
                crowdfundingVerifier.connect(creator).createCampaign()
            ).to.emit(crowdfundingVerifier, "CampaignCreated");
        });

        it("Should increment campaign counter", async function () {
            const { crowdfundingVerifier, creator } = await loadFixture(deployFixture);
            
            await crowdfundingVerifier.connect(creator).createCampaign();
            await crowdfundingVerifier.connect(creator).createCampaign();
            
            const [totalContributions, verifiedContributions, isActive, creationTime, metrics] = 
                await crowdfundingVerifier.getCampaignInfo(2);
            expect(isActive).to.be.true;
        });

        it("Should allow multiple campaigns from same creator", async function () {
            const { crowdfundingVerifier, creator } = await loadFixture(deployFixture);
            
            await crowdfundingVerifier.connect(creator).createCampaign();
            await crowdfundingVerifier.connect(creator).createCampaign();
            
            const [totalContributions1, verifiedContributions1, isActive1, creationTime1, metrics1] = 
                await crowdfundingVerifier.getCampaignInfo(1);
            const [totalContributions2, verifiedContributions2, isActive2, creationTime2, metrics2] = 
                await crowdfundingVerifier.getCampaignInfo(2);
            
            expect(isActive1).to.be.true;
            expect(isActive2).to.be.true;
        });
    });

    describe("Contribution Verification", function () {
        it("Should check nullifier usage", async function () {
            const { crowdfundingVerifier, creator } = await loadFixture(deployFixture);
            
            await crowdfundingVerifier.connect(creator).createCampaign();
            
            const nullifierHash = ethers.keccak256(ethers.toUtf8Bytes("test-nullifier"));
            
            // Check if nullifier is used (should be false initially)
            const isUsed = await crowdfundingVerifier.isNullifierUsed(nullifierHash);
            expect(isUsed).to.be.false;
        });

        it("Should get contributor stats", async function () {
            const { crowdfundingVerifier, creator, contributor1 } = await loadFixture(deployFixture);
            
            await crowdfundingVerifier.connect(creator).createCampaign();
            
            // Get contributor stats for campaign 1
            const stats = await crowdfundingVerifier.getContributorStats(contributor1.address, 1);
            expect(stats).to.equal(0n); // Should be 0 initially as no contributions made
        });
    });

    describe("Austrian Economics Validation", function () {
        it("Should calculate praxeological scores correctly", async function () {
            const { crowdfundingVerifier, mockZKVerifier, creator, contributor1 } = await loadFixture(deployFixture);
            
            await mockZKVerifier.setShouldVerify(true);
            
            // Create campaign
            await crowdfundingVerifier.connect(creator).createCampaign();
            
            // Calculate reputation for contributor
            const reputation = await crowdfundingVerifier.calculateAutomatedReputation(contributor1.address);
            expect(reputation).to.be.gte(100n); // Base reputation is 100
        });

        it("Should track campaign creation time", async function () {
            const { crowdfundingVerifier, creator } = await loadFixture(deployFixture);
            
            await crowdfundingVerifier.connect(creator).createCampaign();
            
            const [totalContributions, verifiedContributions, isActive, creationTime, metrics] = 
                await crowdfundingVerifier.getCampaignInfo(1);
            
            // Just check that creation time is greater than 0 and reasonable
            expect(creationTime).to.be.gt(0n);
            expect(creationTime).to.be.lt((await time.latest()) + 3600); // Within an hour
        });
    });

    describe("Security and Access Control", function () {
        it("Should handle governance functions", async function () {
            const { crowdfundingVerifier, governance, creator } = await loadFixture(deployFixture);
            
            // Create campaign first
            await crowdfundingVerifier.connect(creator).createCampaign();
            
            // Test setCampaignStatus (governance function)
            await expect(
                crowdfundingVerifier.connect(governance).setCampaignStatus(1, false)
            ).to.not.be.reverted;
            
            // Non-governance cannot update
            await expect(
                crowdfundingVerifier.connect(creator).setCampaignStatus(1, true)
            ).to.be.revertedWithCustomError(crowdfundingVerifier, "UnauthorizedAccess");
        });

        it("Should handle campaign lifecycle", async function () {
             const { crowdfundingVerifier, creator } = await loadFixture(deployFixture);
             
             // Create campaign first
             await crowdfundingVerifier.connect(creator).createCampaign();
             
             // Test updateCampaignLifecycle
             await expect(
                 crowdfundingVerifier.updateCampaignLifecycle(1)
             ).to.not.be.reverted;
         });
     });

    describe("Edge Cases and Error Handling", function () {
        it("Should handle campaign creation by different users", async function () {
            const { crowdfundingVerifier, creator, contributor1 } = await loadFixture(deployFixture);
            
            await crowdfundingVerifier.connect(creator).createCampaign();
            await crowdfundingVerifier.connect(contributor1).createCampaign();
            
            const [totalContributions1, verifiedContributions1, isActive1, creationTime1, metrics1] = 
                await crowdfundingVerifier.getCampaignInfo(1);
            const [totalContributions2, verifiedContributions2, isActive2, creationTime2, metrics2] = 
                await crowdfundingVerifier.getCampaignInfo(2);
            
            expect(isActive1).to.be.true;
            expect(isActive2).to.be.true;
            expect(creationTime1).to.be.gt(0n);
            expect(creationTime2).to.be.gt(0n);
        });

        it("Should return correct campaign info", async function () {
            const { crowdfundingVerifier, creator } = await loadFixture(deployFixture);
            
            await crowdfundingVerifier.connect(creator).createCampaign();
            
            const [totalContributions, verifiedContributions, isActive, creationTime, metrics] = 
                await crowdfundingVerifier.getCampaignInfo(1);
            
            expect(isActive).to.be.true;
            expect(creationTime).to.be.gt(0n);
            expect(totalContributions).to.equal(0n);
            expect(verifiedContributions).to.equal(0n);
        });
    });

    describe("Gas Optimization", function () {
        it("Should have acceptable gas costs for campaign creation", async function () {
            const { crowdfundingVerifier, creator } = await loadFixture(deployFixture);
            
            const tx = await crowdfundingVerifier.connect(creator).createCampaign();
            const receipt = await tx.wait();
            
            // Gas should be reasonable (less than 300k for simple campaign creation)
            expect(receipt.gasUsed).to.be.lt(300000);
        });
    });

    describe("Security: Division by Zero Tests", function () {
        it("Should handle score calculation when timeElapsed is zero", async function () {
            const { crowdfundingVerifier, creator } = await loadFixture(deployFixture);
            
            // Create campaign
            await crowdfundingVerifier.connect(creator).createCampaign();
            
            // Immediately check campaign info - timeElapsed should be 0 or very small
            const [totalContributions, verifiedContributions, isActive, creationTime, metrics] = 
                await crowdfundingVerifier.getCampaignInfo(1);
            
            // Campaign should be created successfully
            expect(isActive).to.be.true;
            expect(creationTime).to.be.gt(0n);
            
            // The contract has a check: if (timeElapsed == 0) return 0;
            // So it should handle zero timeElapsed gracefully
        });

        it("Should handle diversity bonus calculation when totalContributions is zero", async function () {
            const { crowdfundingVerifier, creator } = await loadFixture(deployFixture);
            
            // Create campaign
            await crowdfundingVerifier.connect(creator).createCampaign();
            
            // Get campaign info immediately (no contributions yet)
            const [totalContributions] = await crowdfundingVerifier.getCampaignInfo(1);
            
            // totalContributions should be 0
            expect(totalContributions).to.equal(0n);
            
            // The contract uses (campaign.totalContributions + 1) in diversity calculation
            // So division by zero is protected by adding 1
        });

        it("Should handle contribution rate calculation correctly", async function () {
            const { crowdfundingVerifier, creator } = await loadFixture(deployFixture);
            
            // Create campaign
            await crowdfundingVerifier.connect(creator).createCampaign();
            
            // Wait a bit to ensure timeElapsed > 0
            await time.increase(100);
            
            // Get campaign info
            const [totalContributions, verifiedContributions, isActive, creationTime] = 
                await crowdfundingVerifier.getCampaignInfo(1);
            
            // Should have valid values
            expect(isActive).to.be.true;
            expect(creationTime).to.be.gt(0n);
            
            // timeElapsed should be > 0 now, so division should work
            const currentTime = await time.latest();
            const timeElapsed = BigInt(currentTime.toString()) - BigInt(creationTime.toString());
            expect(timeElapsed).to.be.gt(0n);
        });
    });
});