const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("CeremonyVerifier", function () {
    async function deployCeremonyVerifierFixture() {
        const [owner, governance, participant1, participant2, participant3] = await ethers.getSigners();
        
        // Deploy CeremonyVerifier
        const CeremonyVerifier = await ethers.getContractFactory("CeremonyVerifier");
        const ceremonyVerifier = await CeremonyVerifier.deploy(governance.address);
        await ceremonyVerifier.waitForDeployment();
        
        return {
            ceremonyVerifier,
            owner,
            governance,
            participant1,
            participant2,
            participant3
        };
    }
    
    describe("Deployment", function () {
        it("Should deploy with correct governance address", async function () {
            const { ceremonyVerifier, governance } = await loadFixture(deployCeremonyVerifierFixture);
            
            expect(await ceremonyVerifier.governance()).to.equal(governance.address);
        });
        
        it("Should revert if governance is zero address", async function () {
            const CeremonyVerifier = await ethers.getContractFactory("CeremonyVerifier");
            
            await expect(
                CeremonyVerifier.deploy(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(CeremonyVerifier, "ZeroAddress");
        });
    });
    
    describe("Ceremony Management", function () {
        it("Should allow governance to start a ceremony", async function () {
            const { ceremonyVerifier, governance } = await loadFixture(deployCeremonyVerifierFixture);
            
            const ceremonyId = ethers.keccak256(ethers.toUtf8Bytes("test-ceremony"));
            const circuitName = "test-circuit";
            const powersOfTauHash = ethers.keccak256(ethers.toUtf8Bytes("initial-transcript"));
            const isProduction = true;
            
            const tx = await ceremonyVerifier.connect(governance).startCeremony(
                ceremonyId,
                circuitName,
                powersOfTauHash,
                isProduction
            );
            const receipt = await tx.wait();
            const block = await ethers.provider.getBlock(receipt.blockNumber);
            
            await expect(tx)
                .to.emit(ceremonyVerifier, "CeremonyStarted")
                .withArgs(ceremonyId, circuitName, isProduction, block.timestamp);
            
            const ceremony = await ceremonyVerifier.ceremonies(ceremonyId);
            expect(ceremony.circuitName).to.equal(circuitName);
            expect(ceremony.isFinalized).to.be.false;
            expect(ceremony.isProduction).to.be.true;
        });
        
        it("Should prevent non-governance from starting ceremony", async function () {
            const { ceremonyVerifier, participant1 } = await loadFixture(deployCeremonyVerifierFixture);
            
            const ceremonyId = ethers.keccak256(ethers.toUtf8Bytes("test-ceremony"));
            
            await expect(
                ceremonyVerifier.connect(participant1).startCeremony(
                    ceremonyId,
                    "test-circuit",
                    ethers.keccak256(ethers.toUtf8Bytes("initial-transcript")),
                    true
                )
            ).to.be.revertedWithCustomError(ceremonyVerifier, "UnauthorizedAccess");
        });
        
        it("Should prevent starting ceremony with duplicate ID", async function () {
            const { ceremonyVerifier, governance } = await loadFixture(deployCeremonyVerifierFixture);
            
            const ceremonyId = ethers.keccak256(ethers.toUtf8Bytes("test-ceremony"));
            
            await ceremonyVerifier.connect(governance).startCeremony(
                ceremonyId,
                "test-circuit",
                ethers.keccak256(ethers.toUtf8Bytes("initial-transcript")),
                true
            );
            
            // Try to start again with same ID
            await expect(
                ceremonyVerifier.connect(governance).startCeremony(
                    ceremonyId,
                    "test-circuit-2",
                    ethers.keccak256(ethers.toUtf8Bytes("initial-transcript-2")),
                    true
                )
            ).to.be.revertedWithCustomError(ceremonyVerifier, "CeremonyAlreadyExists");
        });
    });
    
    describe("Participant Management", function () {
        it("Should allow recording participant contributions", async function () {
            const { ceremonyVerifier, governance, participant1 } = await loadFixture(deployCeremonyVerifierFixture);
            
            const ceremonyId = ethers.keccak256(ethers.toUtf8Bytes("test-ceremony"));
            
            await ceremonyVerifier.connect(governance).startCeremony(
                ceremonyId,
                "test-circuit",
                ethers.keccak256(ethers.toUtf8Bytes("initial-transcript")),
                true
            );
            
            const contributionHash = ethers.keccak256(ethers.toUtf8Bytes("contribution"));
            const attestation = "test-attestation";
            
            const tx = await ceremonyVerifier.connect(governance).recordContribution(
                ceremonyId,
                participant1.address,
                contributionHash,
                attestation
            );
            const receipt = await tx.wait();
            const block = await ethers.provider.getBlock(receipt.blockNumber);
            
            await expect(tx)
                .to.emit(ceremonyVerifier, "ParticipantContributed")
                .withArgs(ceremonyId, participant1.address, contributionHash, block.timestamp);
            
            const ceremony = await ceremonyVerifier.ceremonies(ceremonyId);
            expect(ceremony.participantCount).to.equal(1);
        });
        
        it("Should prevent duplicate participant contributions", async function () {
            const { ceremonyVerifier, governance, participant1 } = await loadFixture(deployCeremonyVerifierFixture);
            
            const ceremonyId = ethers.keccak256(ethers.toUtf8Bytes("test-ceremony"));
            
            await ceremonyVerifier.connect(governance).startCeremony(
                ceremonyId,
                "test-circuit",
                ethers.keccak256(ethers.toUtf8Bytes("initial-transcript")),
                true
            );
            
            const contributionHash = ethers.keccak256(ethers.toUtf8Bytes("contribution"));
            
            await ceremonyVerifier.connect(governance).recordContribution(
                ceremonyId,
                participant1.address,
                contributionHash,
                "attestation"
            );
            
            // Try to add again
            await expect(
                ceremonyVerifier.connect(governance).recordContribution(
                    ceremonyId,
                    participant1.address,
                    ethers.keccak256(ethers.toUtf8Bytes("contribution-2")),
                    "attestation-2"
                )
            ).to.be.revertedWithCustomError(ceremonyVerifier, "ParticipantAlreadyContributed");
        });
        
        it("Should prevent recording contributions to non-existent ceremony", async function () {
            const { ceremonyVerifier, governance, participant1 } = await loadFixture(deployCeremonyVerifierFixture);
            
            const ceremonyId = ethers.keccak256(ethers.toUtf8Bytes("non-existent"));
            
            await expect(
                ceremonyVerifier.connect(governance).recordContribution(
                    ceremonyId,
                    participant1.address,
                    ethers.keccak256(ethers.toUtf8Bytes("contribution")),
                    "attestation"
                )
            ).to.be.revertedWithCustomError(ceremonyVerifier, "CeremonyNotFound");
        });
    });
    
    describe("Contribution Verification", function () {
        it("Should allow verifying participant contributions", async function () {
            const { ceremonyVerifier, governance, participant1 } = await loadFixture(deployCeremonyVerifierFixture);
            
            const ceremonyId = ethers.keccak256(ethers.toUtf8Bytes("test-ceremony"));
            
            await ceremonyVerifier.connect(governance).startCeremony(
                ceremonyId,
                "test-circuit",
                ethers.keccak256(ethers.toUtf8Bytes("initial-transcript")),
                true
            );
            
            const contributionHash = ethers.keccak256(ethers.toUtf8Bytes("contribution"));
            
            await ceremonyVerifier.connect(governance).recordContribution(
                ceremonyId,
                participant1.address,
                contributionHash,
                "attestation"
            );
            
            const isValid = true;
            
            await expect(
                ceremonyVerifier.connect(governance).verifyContribution(
                    ceremonyId,
                    participant1.address,
                    isValid
                )
            ).to.emit(ceremonyVerifier, "ContributionVerified")
                .withArgs(ceremonyId, participant1.address, isValid);
        });
        
        it("Should handle invalid contribution verification", async function () {
            const { ceremonyVerifier, governance, participant1 } = await loadFixture(deployCeremonyVerifierFixture);
            
            const ceremonyId = ethers.keccak256(ethers.toUtf8Bytes("test-ceremony"));
            
            await ceremonyVerifier.connect(governance).startCeremony(
                ceremonyId,
                "test-circuit",
                ethers.keccak256(ethers.toUtf8Bytes("initial-transcript")),
                true
            );
            
            const contributionHash = ethers.keccak256(ethers.toUtf8Bytes("contribution"));
            
            await ceremonyVerifier.connect(governance).recordContribution(
                ceremonyId,
                participant1.address,
                contributionHash,
                "attestation"
            );
            
            const isValid = false;
            
            await expect(
                ceremonyVerifier.connect(governance).verifyContribution(
                    ceremonyId,
                    participant1.address,
                    isValid
                )
            ).to.emit(ceremonyVerifier, "ContributionVerified")
                .withArgs(ceremonyId, participant1.address, isValid);
        });
    });
    
    describe("Ceremony Finalization", function () {
        it("Should allow governance to finalize ceremony", async function () {
            const { ceremonyVerifier, governance, participant1, participant2, participant3 } = await loadFixture(deployCeremonyVerifierFixture);
            
            const ceremonyId = ethers.keccak256(ethers.toUtf8Bytes("test-ceremony"));
            
            await ceremonyVerifier.connect(governance).startCeremony(
                ceremonyId,
                "test-circuit",
                ethers.keccak256(ethers.toUtf8Bytes("initial-transcript")),
                false // non-production: production requires MIN_PRODUCTION_PARTICIPANTS verified contributors
            );
            
            // Add and verify 3 participants (sufficient for non-production finalization)
            const contributionHash1 = ethers.keccak256(ethers.toUtf8Bytes("contribution1"));
            await ceremonyVerifier.connect(governance).recordContribution(
                ceremonyId,
                participant1.address,
                contributionHash1,
                "attestation1"
            );
            await ceremonyVerifier.connect(governance).verifyContribution(
                ceremonyId,
                participant1.address,
                true
            );
            
            const contributionHash2 = ethers.keccak256(ethers.toUtf8Bytes("contribution2"));
            await ceremonyVerifier.connect(governance).recordContribution(
                ceremonyId,
                participant2.address,
                contributionHash2,
                "attestation2"
            );
            await ceremonyVerifier.connect(governance).verifyContribution(
                ceremonyId,
                participant2.address,
                true
            );
            
            const contributionHash3 = ethers.keccak256(ethers.toUtf8Bytes("contribution3"));
            await ceremonyVerifier.connect(governance).recordContribution(
                ceremonyId,
                participant3.address,
                contributionHash3,
                "attestation3"
            );
            await ceremonyVerifier.connect(governance).verifyContribution(
                ceremonyId,
                participant3.address,
                true
            );
            
            const finalTranscript = ethers.keccak256(ethers.toUtf8Bytes("final-transcript"));
            
            const tx = await ceremonyVerifier.connect(governance).finalizeCeremony(
                ceremonyId,
                finalTranscript
            );
            const receipt = await tx.wait();
            const block = await ethers.provider.getBlock(receipt.blockNumber);
            
            await expect(tx)
                .to.emit(ceremonyVerifier, "CeremonyFinalized")
                .withArgs(ceremonyId, finalTranscript, 3, block.timestamp);
            
            const ceremony = await ceremonyVerifier.ceremonies(ceremonyId);
            expect(ceremony.isFinalized).to.be.true;
            expect(ceremony.isProduction).to.be.false;
        });

        it("Should revert finalizing a production ceremony before minimum participants", async function () {
            const { ceremonyVerifier, governance, participant1, participant2, participant3 } =
                await loadFixture(deployCeremonyVerifierFixture);

            const ceremonyId = ethers.keccak256(ethers.toUtf8Bytes("prod-too-few"));

            await ceremonyVerifier.connect(governance).startCeremony(
                ceremonyId,
                "test-circuit",
                ethers.keccak256(ethers.toUtf8Bytes("initial-transcript")),
                true
            );

            const contributionHash1 = ethers.keccak256(ethers.toUtf8Bytes("contribution1"));
            await ceremonyVerifier.connect(governance).recordContribution(
                ceremonyId,
                participant1.address,
                contributionHash1,
                "attestation1"
            );
            await ceremonyVerifier.connect(governance).verifyContribution(
                ceremonyId,
                participant1.address,
                true
            );

            const contributionHash2 = ethers.keccak256(ethers.toUtf8Bytes("contribution2"));
            await ceremonyVerifier.connect(governance).recordContribution(
                ceremonyId,
                participant2.address,
                contributionHash2,
                "attestation2"
            );
            await ceremonyVerifier.connect(governance).verifyContribution(
                ceremonyId,
                participant2.address,
                true
            );

            const contributionHash3 = ethers.keccak256(ethers.toUtf8Bytes("contribution3"));
            await ceremonyVerifier.connect(governance).recordContribution(
                ceremonyId,
                participant3.address,
                contributionHash3,
                "attestation3"
            );
            await ceremonyVerifier.connect(governance).verifyContribution(
                ceremonyId,
                participant3.address,
                true
            );

            await expect(
                ceremonyVerifier.connect(governance).finalizeCeremony(
                    ceremonyId,
                    ethers.keccak256(ethers.toUtf8Bytes("final-transcript"))
                )
            ).to.be.revertedWithCustomError(ceremonyVerifier, "InsufficientParticipants");
        });

        it("Should allow governance to finalize a production ceremony at participant minimum", async function () {
            const { ceremonyVerifier, governance } = await loadFixture(deployCeremonyVerifierFixture);
            const signers = await ethers.getSigners();
            const minProd = Number(await ceremonyVerifier.MIN_PRODUCTION_PARTICIPANTS());

            const ceremonyId = ethers.keccak256(ethers.toUtf8Bytes("prod-full"));

            await ceremonyVerifier.connect(governance).startCeremony(
                ceremonyId,
                "test-circuit",
                ethers.keccak256(ethers.toUtf8Bytes("initial-transcript")),
                true
            );

            for (let i = 0; i < minProd; i++) {
                const participant = signers[5 + i];
                const contributionHash = ethers.keccak256(ethers.toUtf8Bytes(`contribution-${i}`));
                await ceremonyVerifier.connect(governance).recordContribution(
                    ceremonyId,
                    participant.address,
                    contributionHash,
                    `attestation-${i}`
                );
                await ceremonyVerifier.connect(governance).verifyContribution(
                    ceremonyId,
                    participant.address,
                    true
                );
            }

            const finalTranscript = ethers.keccak256(ethers.toUtf8Bytes("final-transcript-prod"));
            const tx = await ceremonyVerifier.connect(governance).finalizeCeremony(ceremonyId, finalTranscript);
            const receipt = await tx.wait();
            const block = await ethers.provider.getBlock(receipt.blockNumber);

            await expect(tx)
                .to.emit(ceremonyVerifier, "CeremonyFinalized")
                .withArgs(ceremonyId, finalTranscript, minProd, block.timestamp);

            const ceremony = await ceremonyVerifier.ceremonies(ceremonyId);
            expect(ceremony.isFinalized).to.be.true;
            expect(ceremony.isProduction).to.be.true;
        });
        
        it("Should prevent finalizing non-existent ceremony", async function () {
            const { ceremonyVerifier, governance } = await loadFixture(deployCeremonyVerifierFixture);
            
            const ceremonyId = ethers.keccak256(ethers.toUtf8Bytes("non-existent"));
            
            await expect(
                ceremonyVerifier.connect(governance).finalizeCeremony(
                    ceremonyId,
                    ethers.keccak256(ethers.toUtf8Bytes("final-transcript"))
                )
            ).to.be.revertedWithCustomError(ceremonyVerifier, "CeremonyNotFound");
        });
        
        it("Should prevent finalizing already finalized ceremony", async function () {
            const { ceremonyVerifier, governance, participant1, participant2, participant3 } = await loadFixture(deployCeremonyVerifierFixture);
            
            const ceremonyId = ethers.keccak256(ethers.toUtf8Bytes("test-ceremony"));
            
            await ceremonyVerifier.connect(governance).startCeremony(
                ceremonyId,
                "test-circuit",
                ethers.keccak256(ethers.toUtf8Bytes("initial-transcript")),
                false // non-production: production requires MIN_PRODUCTION_PARTICIPANTS verified contributors
            );
            
            // Add and verify 3 participants (sufficient for non-production finalization)
            const contributionHash1 = ethers.keccak256(ethers.toUtf8Bytes("contribution1"));
            await ceremonyVerifier.connect(governance).recordContribution(
                ceremonyId,
                participant1.address,
                contributionHash1,
                "attestation1"
            );
            await ceremonyVerifier.connect(governance).verifyContribution(
                ceremonyId,
                participant1.address,
                true
            );
            
            const contributionHash2 = ethers.keccak256(ethers.toUtf8Bytes("contribution2"));
            await ceremonyVerifier.connect(governance).recordContribution(
                ceremonyId,
                participant2.address,
                contributionHash2,
                "attestation2"
            );
            await ceremonyVerifier.connect(governance).verifyContribution(
                ceremonyId,
                participant2.address,
                true
            );
            
            const contributionHash3 = ethers.keccak256(ethers.toUtf8Bytes("contribution3"));
            await ceremonyVerifier.connect(governance).recordContribution(
                ceremonyId,
                participant3.address,
                contributionHash3,
                "attestation3"
            );
            await ceremonyVerifier.connect(governance).verifyContribution(
                ceremonyId,
                participant3.address,
                true
            );
            
            // Finalize first time
            await ceremonyVerifier.connect(governance).finalizeCeremony(
                ceremonyId,
                ethers.keccak256(ethers.toUtf8Bytes("final-transcript"))
            );
            
            // Try to finalize again
            await expect(
                ceremonyVerifier.connect(governance).finalizeCeremony(
                    ceremonyId,
                    ethers.keccak256(ethers.toUtf8Bytes("final-transcript-2"))
                )
            ).to.be.revertedWithCustomError(ceremonyVerifier, "CeremonyAlreadyFinalized");
        });
    });
    
    describe("Ceremony Queries", function () {
        it("Should return correct ceremony information", async function () {
            const { ceremonyVerifier, governance } = await loadFixture(deployCeremonyVerifierFixture);
            
            const ceremonyId = ethers.keccak256(ethers.toUtf8Bytes("test-ceremony"));
            const circuitName = "test-circuit";
            const initialTranscript = ethers.keccak256(ethers.toUtf8Bytes("initial-transcript"));
            
            await ceremonyVerifier.connect(governance).startCeremony(
                ceremonyId,
                circuitName,
                initialTranscript,
                true
            );
            
            const ceremony = await ceremonyVerifier.ceremonies(ceremonyId);
            expect(ceremony.circuitName).to.equal(circuitName);
            expect(ceremony.isFinalized).to.be.false;
        });
        
        it("Should return correct participant count", async function () {
            const { ceremonyVerifier, governance, participant1, participant2 } = await loadFixture(deployCeremonyVerifierFixture);
            
            const ceremonyId = ethers.keccak256(ethers.toUtf8Bytes("test-ceremony"));
            
            await ceremonyVerifier.connect(governance).startCeremony(
                ceremonyId,
                "test-circuit",
                ethers.keccak256(ethers.toUtf8Bytes("initial-transcript")),
                true
            );
            
            await ceremonyVerifier.connect(governance).recordContribution(
                ceremonyId,
                participant1.address,
                ethers.keccak256(ethers.toUtf8Bytes("contribution1")),
                "attestation1"
            );
            
            await ceremonyVerifier.connect(governance).recordContribution(
                ceremonyId,
                participant2.address,
                ethers.keccak256(ethers.toUtf8Bytes("contribution2")),
                "attestation2"
            );
            
            const ceremony = await ceremonyVerifier.ceremonies(ceremonyId);
            expect(ceremony.participantCount).to.equal(2);
        });
    });
    
    describe("Access Control", function () {
        it("Should allow governance to update governance contract", async function () {
            const { ceremonyVerifier, governance, participant1 } = await loadFixture(deployCeremonyVerifierFixture);
            
            // Deploy MockPrivateGovernance for the new governance
            const MockPrivateGovernance = await ethers.getContractFactory("MockPrivateGovernance");
            const mockGovernance = await MockPrivateGovernance.deploy();
            await mockGovernance.waitForDeployment();
            
            // Set the caller to governance so it can call setGovernance
            await mockGovernance.setCaller(governance.address);
            
            await ceremonyVerifier.connect(governance).setGovernance(await mockGovernance.getAddress());
            
            expect(await ceremonyVerifier.governance()).to.equal(await mockGovernance.getAddress());
        });
        
        it("Should prevent non-governance from updating governance", async function () {
            const { ceremonyVerifier, participant1, participant2 } = await loadFixture(deployCeremonyVerifierFixture);
            
            await expect(
                ceremonyVerifier.connect(participant1).setGovernance(participant2.address)
            ).to.be.revertedWithCustomError(ceremonyVerifier, "UnauthorizedAccess");
        });
    });
});

