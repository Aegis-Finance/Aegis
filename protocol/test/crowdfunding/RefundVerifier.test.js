const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("RefundVerifier - Comprehensive Test Suite", function () {
    async function deployFixture() {
        const [owner, creator, contributor1, contributor2, governance] = await ethers.getSigners();

        // Deploy mock contracts
        const MockZKVerifier = await ethers.getContractFactory("MockZKVerifier");
        const mockZKVerifier = await MockZKVerifier.deploy();
        await mockZKVerifier.waitForDeployment();
        
        const MockCrowdShield = await ethers.getContractFactory("MockCrowdShield");
        const mockCrowdShield = await MockCrowdShield.deploy();
        await mockCrowdShield.waitForDeployment();
        
        // Deploy RefundVerifier
        const RefundVerifier = await ethers.getContractFactory("RefundVerifier");
        const refundVerifier = await RefundVerifier.deploy(
            await mockZKVerifier.getAddress(),
            await mockCrowdShield.getAddress(),
            governance.address
        );
        await refundVerifier.waitForDeployment();

        return {
            refundVerifier,
            mockZKVerifier,
            mockCrowdShield,
            owner,
            creator,
            contributor1,
            contributor2,
            governance
        };
    }

    // Helper function to create proper publicInputs array
    async function createPublicInputs(campaignId = 1, nullifierHash = 12345, refundAmount = ethers.parseEther("10"), refundReason = 0, contributor = null, originalContribution = null) {
        const nullifierBytes32 = ethers.keccak256(ethers.toUtf8Bytes(nullifierHash.toString()));
        // Convert bytes32 to uint256 for contract compatibility
        const nullifierUint256 = ethers.toBigInt(nullifierBytes32);
        return [
            campaignId, // campaign ID
            nullifierUint256.toString(), // nullifier hash as uint256 (convert BigInt to string)
            refundAmount.toString(), // refund amount (convert BigInt to string)
            refundReason, // refund reason (0 = CAMPAIGN_FAILED)
            contributor || "0x1234567890123456789012345678901234567890", // contributor address as uint256
            (await time.latest()).toString(), // timestamp
            1, // reputation score
            0, // additional field 1
            0, // additional field 2
            (originalContribution || refundAmount).toString() // original contribution amount (convert BigInt to string)
        ];
    }

    describe("Deployment and Initialization", function () {
        it("Should deploy with correct parameters", async function () {
            const { refundVerifier, mockZKVerifier, mockCrowdShield, governance } = await loadFixture(deployFixture);
            
            expect(await refundVerifier.GROTH16_VERIFIER()).to.equal(await mockZKVerifier.getAddress());
            expect(await refundVerifier.CROWD_SHIELD()).to.equal(await mockCrowdShield.getAddress());
            expect(await refundVerifier.governance()).to.equal(governance.address);
        });

        it("Should initialize with correct Austrian Economics parameters", async function () {
            const { refundVerifier } = await loadFixture(deployFixture);
            
            // Check Austrian Economics constants
            expect(await refundVerifier.DEFAULT_REFUND_DEADLINE()).to.equal(30 * 24 * 60 * 60); // 30 days in seconds
            expect(await refundVerifier.MIN_REFUND_AMOUNT()).to.equal(ethers.parseEther("0.001"));
        });
    });

    describe("Refund Request Processing", function () {
        it("Should process refund request with valid proof", async function () {
            const { refundVerifier, mockZKVerifier, mockCrowdShield, creator, contributor1, governance } = await loadFixture(deployFixture);
            
            await mockZKVerifier.setShouldVerify(true);
            
            // Create mock failed campaign
            await mockCrowdShield.createMockCampaign(
                creator.address,
                ethers.parseEther("100"), // target
                ethers.parseEther("50"),  // raised (failed to reach target)
                (await time.latest()) - 86400, // deadline passed
                2 // Failed status
            );
            
            // Enable refunds for the campaign
            await refundVerifier.connect(governance).enableCampaignRefunds(
                1,
                ethers.parseEther("50"),
                (await time.latest()) + 86400
            );
            
            // Set contributor reputation to meet minimum requirement
            await refundVerifier.connect(governance).setContributorReputation(contributor1.address, 100);
            
            await mockCrowdShield.createMockContribution(
                1, // campaign ID
                contributor1.address,
                ethers.parseEther("10"),
                false // not yet refunded
            );
            
            const refundProof = {
                proof: [1, 2, 3, 4, 5, 6, 7, 8],
                publicInputs: await createPublicInputs(1, 12345, ethers.parseEther("10"), 0, contributor1.address, ethers.parseEther("10"))
            };
            
            await expect(
                refundVerifier.connect(contributor1).verifyRefundRequest(1, 
                    refundProof.proof,
                    refundProof.publicInputs
                )
            ).to.emit(refundVerifier, "RefundRequestVerified");
        });

        it("Should reject refund request with invalid proof", async function () {
            const { refundVerifier, mockZKVerifier, mockCrowdShield, creator, contributor1, governance } = await loadFixture(deployFixture);
            
            await mockZKVerifier.setShouldVerify(false);
            
            // Create mock failed campaign
            await mockCrowdShield.createMockCampaign(
                creator.address,
                ethers.parseEther("100"),
                ethers.parseEther("50"),
                (await time.latest()) - 86400,
                2 // Failed
            );
            
            // Enable refunds for the campaign
            await refundVerifier.connect(governance).enableCampaignRefunds(
                1,
                ethers.parseEther("50"),
                (await time.latest()) + 86400
            );
            
            // Set contributor reputation to meet minimum requirement
            await refundVerifier.connect(governance).setContributorReputation(contributor1.address, 100);
            
            await mockCrowdShield.createMockContribution(
                1,
                contributor1.address,
                ethers.parseEther("10"),
                false
            );
            
            const refundProof = {
                proof: [1, 2, 3, 4, 5, 6, 7, 8],
                publicInputs: await createPublicInputs(1, 12345, ethers.parseEther("10"))
            };
            
            await expect(
                refundVerifier.connect(contributor1).verifyRefundRequest(1, 
                    refundProof.proof,
                    refundProof.publicInputs
                )
            ).to.be.revertedWithCustomError(refundVerifier, "InvalidProof");
        });

        it("Should prevent double refund requests with nullifier tracking", async function () {
            const { refundVerifier, mockZKVerifier, mockCrowdShield, creator, contributor1, governance } = await loadFixture(deployFixture);
            
            await mockZKVerifier.setShouldVerify(true);
            
            // Setup mock campaign and contribution
            await mockCrowdShield.createMockCampaign(
                creator.address,
                ethers.parseEther("100"),
                ethers.parseEther("50"),
                (await time.latest()) - 86400,
                2 // Failed
            );
            
            // Enable refunds for the campaign
            await refundVerifier.connect(governance).enableCampaignRefunds(
                1,
                ethers.parseEther("50"),
                (await time.latest()) + 86400
            );
            
            // Set contributor reputation to meet minimum requirement
            await refundVerifier.connect(governance).setContributorReputation(contributor1.address, 100);
            
            await mockCrowdShield.createMockContribution(
                1,
                contributor1.address,
                ethers.parseEther("10"),
                false
            );
            
            const refundProof = {
                proof: [1, 2, 3, 4, 5, 6, 7, 8],
                publicInputs: await createPublicInputs(1, 54321, ethers.parseEther("10"))
            };
            
            // First refund request
            await refundVerifier.connect(contributor1).verifyRefundRequest(1, 
                refundProof.proof,
                refundProof.publicInputs
            );
            
            // Attempt duplicate refund
            await expect(
                refundVerifier.connect(contributor1).verifyRefundRequest(1, 
                    refundProof.proof,
                    refundProof.publicInputs
                )
            ).to.be.revertedWithCustomError(refundVerifier, "NullifierAlreadyUsed");
        });

        it("Should reject refund for successful campaigns", async function () {
            const { refundVerifier, mockZKVerifier, mockCrowdShield, creator, contributor1, governance } = await loadFixture(deployFixture);
            
            await mockZKVerifier.setShouldVerify(true);
            
            // Create mock successful campaign
            await mockCrowdShield.createMockCampaign(
                creator.address,
                ethers.parseEther("100"),
                ethers.parseEther("120"), // exceeded target
                (await time.latest()) - 86400,
                1 // Successful status
            );
            
            // Enable refunds for the campaign (this should be allowed by governance)
            await refundVerifier.connect(governance).enableCampaignRefunds(
                1,
                ethers.parseEther("50"),
                (await time.latest()) + 86400
            );
            
            // Set contributor reputation to meet minimum requirement
            await refundVerifier.connect(governance).setContributorReputation(contributor1.address, 100);
            
            await mockCrowdShield.createMockContribution(
                1,
                contributor1.address,
                ethers.parseEther("10"),
                false
            );
            
            const refundProof = {
                proof: [1, 2, 3, 4, 5, 6, 7, 8],
                publicInputs: await createPublicInputs(1, 12345, ethers.parseEther("10"))
            };
            
            await expect(
                refundVerifier.connect(contributor1).verifyRefundRequest(1, 
                    refundProof.proof,
                    refundProof.publicInputs
                )
            ).to.be.revertedWithCustomError(refundVerifier, "RefundsNotEnabled");
        });
    });

    describe("Refund Processing and Approval", function () {
        it("Should process approved refunds correctly", async function () {
            const { refundVerifier, mockZKVerifier, mockCrowdShield, creator, contributor1, governance } = await loadFixture(deployFixture);
            
            await mockZKVerifier.setShouldVerify(true);
            
            // Setup failed campaign
            await mockCrowdShield.createMockCampaign(
                creator.address,
                ethers.parseEther("100"),
                ethers.parseEther("50"),
                (await time.latest()) - 86400,
                2 // Failed
            );
            
            // Enable refunds for the campaign
            await refundVerifier.connect(governance).enableCampaignRefunds(
                1,
                ethers.parseEther("50"),
                (await time.latest()) + 86400
            );
            
            // Set contributor reputation to meet minimum requirement
            await refundVerifier.connect(governance).setContributorReputation(contributor1.address, 100);
            
            await mockCrowdShield.createMockContribution(
                1,
                contributor1.address,
                ethers.parseEther("10"),
                false
            );
            
            // Request refund
            const publicInputs = await createPublicInputs();
            const nullifierHash = "0x" + BigInt(publicInputs[1]).toString(16).padStart(64, '0'); // Convert BigInt to bytes32 hex string
            const refundProof = {
                proof: [1, 2, 3, 4, 5, 6, 7, 8],
                publicInputs: publicInputs
            };
            
            await refundVerifier.connect(contributor1).verifyRefundRequest(1, 
                refundProof.proof,
                refundProof.publicInputs
            );
            
            // Approve refund (governance action) - use the actual nullifier hash
            await expect(
                refundVerifier.connect(governance).approveRefund(1, nullifierHash)
            ).to.emit(refundVerifier, "RefundApproved");
        });

        it("Should calculate refund amounts correctly with Austrian Economics principles", async function () {
            const { refundVerifier, mockZKVerifier, mockCrowdShield, creator, contributor1, governance } = await loadFixture(deployFixture);
            
            await mockZKVerifier.setShouldVerify(true);
            
            // Setup failed campaign
            await mockCrowdShield.createMockCampaign(
                creator.address,
                ethers.parseEther("100"),
                ethers.parseEther("75"), // 75% funded but failed
                (await time.latest()) - 86400,
                2 // Failed
            );
            
            // Enable refunds for the campaign
            await refundVerifier.connect(governance).enableCampaignRefunds(
                1,
                ethers.parseEther("75"),
                (await time.latest()) + 86400
            );
            
            // Set contributor reputation to meet minimum requirement
            await refundVerifier.connect(governance).setContributorReputation(contributor1.address, 100);
            
            await mockCrowdShield.createMockContribution(
                1,
                contributor1.address,
                ethers.parseEther("15"), // 15 ETH contribution
                false
            );
            
            const refundProof = {
                proof: [1, 2, 3, 4, 5, 6, 7, 8],
                publicInputs: await createPublicInputs(1, 12345, ethers.parseEther("15"))
            };
            
            await refundVerifier.connect(contributor1).verifyRefundRequest(1, 
                refundProof.proof,
                refundProof.publicInputs
            );
            
            // Check refund calculation
            const refundInfo = await refundVerifier.getCampaignRefundInfo(1);
            expect(refundInfo.totalRefundRequests).to.equal(1);
            // CAMPAIGN_FAILURE (90%) + 5% time bonus = 95% of 15 ETH = 14.25 ETH
            // Minus 1% processing fee = 14.25 * 0.99 = 14.1075 ETH
            expect(refundInfo.totalRefundAmount).to.equal(ethers.parseEther("14.1075"));
        });
    });

    describe("Austrian Economics Validation", function () {
        it("Should enforce temporal coordination in refund processing", async function () {
            const { refundVerifier, mockZKVerifier, mockCrowdShield, creator, contributor1, governance } = await loadFixture(deployFixture);
            
            await mockZKVerifier.setShouldVerify(true);
            
            // Create campaign that just failed (within grace period)
            const recentDeadline = (await time.latest()) - 3600; // 1 hour ago
            
            await mockCrowdShield.createMockCampaign(
                creator.address,
                ethers.parseEther("100"),
                ethers.parseEther("50"),
                recentDeadline,
                2 // Failed
            );
            
            // Enable refunds for the campaign
            await refundVerifier.connect(governance).enableCampaignRefunds(
                1,
                ethers.parseEther("50"),
                (await time.latest()) + 86400
            );
            
            // Set contributor reputation to meet minimum requirement
            await refundVerifier.connect(governance).setContributorReputation(contributor1.address, 100);
            
            await mockCrowdShield.createMockContribution(
                1,
                contributor1.address,
                ethers.parseEther("10"),
                false
            );
            
            const refundProof = {
                proof: [1, 2, 3, 4, 5, 6, 7, 8],
                publicInputs: await createPublicInputs(1, 12345, ethers.parseEther("10"))
            };
            
            // Should allow refund within grace period
            await expect(
                refundVerifier.connect(contributor1).verifyRefundRequest(1, 
                    refundProof.proof,
                    refundProof.publicInputs
                )
            ).to.not.be.reverted;
        });

        it("Should enforce minimum refund thresholds", async function () {
            const { refundVerifier, mockZKVerifier, mockCrowdShield, creator, contributor1, governance } = await loadFixture(deployFixture);
            
            await mockZKVerifier.setShouldVerify(true);
            
            // Setup failed campaign
            await mockCrowdShield.createMockCampaign(
                creator.address,
                ethers.parseEther("100"),
                ethers.parseEther("50"),
                (await time.latest()) - 86400,
                2 // Failed
            );
            
            // Enable refunds for the campaign
            await refundVerifier.connect(governance).enableCampaignRefunds(
                1,
                ethers.parseEther("50"),
                (await time.latest()) + 86400
            );
            
            // Set contributor reputation to meet minimum requirement
            await refundVerifier.connect(governance).setContributorReputation(contributor1.address, 100);
            
            await mockCrowdShield.createMockContribution(
                1,
                contributor1.address,
                ethers.parseEther("0.0005"), // Below minimum threshold of 0.001 ETH
                false
            );
            
            const refundProof = {
                proof: [1, 2, 3, 4, 5, 6, 7, 8],
                publicInputs: await createPublicInputs(1, 12345, ethers.parseEther("0.0005"), 0, contributor1.address, ethers.parseEther("0.0005"))
            };
            
            await expect(
                refundVerifier.connect(contributor1).verifyRefundRequest(1, 
                    refundProof.proof,
                    refundProof.publicInputs
                )
            ).to.be.revertedWithCustomError(refundVerifier, "InvalidRefundAmount");
        });
    });

    describe("Security and Access Control", function () {
        it("Should only allow governance to approve refunds", async function () {
            const { refundVerifier, mockZKVerifier, mockCrowdShield, creator, contributor1, governance } = await loadFixture(deployFixture);
            
            await mockZKVerifier.setShouldVerify(true);
            
            // Setup and request refund
            await mockCrowdShield.createMockCampaign(
                creator.address,
                ethers.parseEther("100"),
                ethers.parseEther("50"),
                (await time.latest()) - 86400,
                2 // Failed
            );
            
            // Enable refunds for the campaign
            await refundVerifier.connect(governance).enableCampaignRefunds(
                1,
                ethers.parseEther("50"),
                (await time.latest()) + 86400
            );
            
            // Set contributor reputation to meet minimum requirement
            await refundVerifier.connect(governance).setContributorReputation(contributor1.address, 100);
            
            await mockCrowdShield.createMockContribution(
                1,
                contributor1.address,
                ethers.parseEther("10"),
                false
            );
            
            const refundProof = {
                proof: [1, 2, 3, 4, 5, 6, 7, 8],
                publicInputs: await createPublicInputs(1, 12345, ethers.parseEther("10"))
            };

            await refundVerifier.connect(contributor1).verifyRefundRequest(1, 
                refundProof.proof,
                refundProof.publicInputs
            );

            // Get the nullifier hash from public inputs (index 1)
            const nullifierHash = ethers.zeroPadValue(ethers.toBeHex(refundProof.publicInputs[1]), 32);

            // Non-governance cannot approve
            await expect(
                refundVerifier.connect(contributor1).approveRefund(1, nullifierHash)
            ).to.be.revertedWithCustomError(refundVerifier, "UnauthorizedAccess");

            // Governance can approve
            await expect(
                refundVerifier.connect(governance).approveRefund(1, nullifierHash)
            ).to.not.be.reverted;
        });
    });

    describe("Edge Cases and Error Handling", function () {
        it("Should handle zero refund amounts correctly", async function () {
            const { refundVerifier, mockZKVerifier, mockCrowdShield, creator, contributor1, governance } = await loadFixture(deployFixture);
            
            await mockZKVerifier.setShouldVerify(true);
            
            await mockCrowdShield.createMockCampaign(
                creator.address,
                ethers.parseEther("100"),
                ethers.parseEther("50"),
                (await time.latest()) - 86400,
                2 // Failed
            );
            
            // Enable refunds for the campaign
            await refundVerifier.connect(governance).enableCampaignRefunds(
                1,
                ethers.parseEther("50"),
                (await time.latest()) + 86400
            );
            
            // Set contributor reputation to meet minimum requirement
            await refundVerifier.connect(governance).setContributorReputation(contributor1.address, 100);
            
            const refundProof = {
                proof: [1, 2, 3, 4, 5, 6, 7, 8],
                publicInputs: await createPublicInputs(1, 12345, 0)
            };
            
            await expect(
                refundVerifier.connect(contributor1).verifyRefundRequest(1, 
                    refundProof.proof,
                    refundProof.publicInputs
                )
            ).to.be.revertedWithCustomError(refundVerifier, "InvalidRefundAmount");
        });

        it("Should handle non-existent campaigns correctly", async function () {
            const { refundVerifier, mockZKVerifier, contributor1 } = await loadFixture(deployFixture);
            
            await mockZKVerifier.setShouldVerify(true);
            
            const refundProof = {
                proof: [1, 2, 3, 4, 5, 6, 7, 8],
                publicInputs: await createPublicInputs(999, 12345, ethers.parseEther("10"))
            };
            
            await expect(
                refundVerifier.connect(contributor1).verifyRefundRequest(999, 
                    refundProof.proof,
                    refundProof.publicInputs
                )
            ).to.be.revertedWithCustomError(refundVerifier, "CampaignNotFound");
        });
    });

    describe("Gas Optimization", function () {
        it("Should have acceptable gas costs for refund operations", async function () {
            const { refundVerifier, mockZKVerifier, mockCrowdShield, creator, contributor1, governance } = await loadFixture(deployFixture);
            
            await mockZKVerifier.setShouldVerify(true);
            
            // Setup failed campaign
            await mockCrowdShield.createMockCampaign(
                creator.address,
                ethers.parseEther("100"),
                ethers.parseEther("50"),
                (await time.latest()) - 86400,
                2 // Failed
            );
            
            // Enable refunds for the campaign
            await refundVerifier.connect(governance).enableCampaignRefunds(
                1,
                ethers.parseEther("50"),
                (await time.latest()) + 86400
            );
            
            // Set contributor reputation to meet minimum requirement
            await refundVerifier.connect(governance).setContributorReputation(contributor1.address, 100);
            
            await mockCrowdShield.createMockContribution(
                1,
                contributor1.address,
                ethers.parseEther("10"),
                false
            );
            
            const refundProof = {
                proof: [1, 2, 3, 4, 5, 6, 7, 8],
                publicInputs: await createPublicInputs(1, 12345, ethers.parseEther("10"))
            };
            
            const tx = await refundVerifier.connect(contributor1).verifyRefundRequest(1, 
                refundProof.proof,
                refundProof.publicInputs
            );
            
            const receipt = await tx.wait();
            
            // Gas should be reasonable for ZK proof verification + Austrian Economics calculations
            // ZK proof verification: ~200-400k gas
            // Austrian metrics calculations: ~300-500k gas
            // Total reasonable expectation: ~1M gas
            expect(receipt.gasUsed).to.be.lt(1000000);
        });
    });
});

