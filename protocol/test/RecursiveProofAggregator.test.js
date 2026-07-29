const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { TestHelpers } = require("./helpers/TestHelpers");

describe("RecursiveProofAggregator", function () {
    async function deployAggregatorFixture() {
        const [owner, governance, user1, user2] = await ethers.getSigners();
        
        // Initialize test helpers
        const testHelpersInstance = new TestHelpers();
        await testHelpersInstance.initialize();
        
        // Deploy ProofLib library first
        const proofLibAddress = await testHelpersInstance.deployProofLib();
        
        // Deploy mock verifiers
        const MockZKVerifier = await ethers.getContractFactory("MockZKVerifier");
        const recursiveVerifier = await MockZKVerifier.deploy();
        await recursiveVerifier.waitForDeployment();
        
        const batchVerifier = await MockZKVerifier.deploy();
        await batchVerifier.waitForDeployment();
        
        // Deploy RecursiveProofAggregator with linked library
        const RecursiveProofAggregator = await testHelpersInstance.getContractFactoryWithProofLib("RecursiveProofAggregator", proofLibAddress);
        const aggregator = await RecursiveProofAggregator.deploy(
            await recursiveVerifier.getAddress(),
            await batchVerifier.getAddress()
        );
        await aggregator.waitForDeployment();
        
        // Set governance - owner can set it initially (using onlyOwnerOrGovernance modifier)
        await aggregator.connect(owner).setGovernanceContract(governance.address);
        
        return {
            aggregator,
            recursiveVerifier,
            batchVerifier,
            owner,
            governance,
            user1,
            user2
        };
    }
    
    describe("Deployment", function () {
        it("Should deploy with correct verifiers", async function () {
            const { aggregator, recursiveVerifier, batchVerifier } = await loadFixture(deployAggregatorFixture);
            
            expect(await aggregator.recursiveVerifier()).to.equal(await recursiveVerifier.getAddress());
            expect(await aggregator.batchVerifier()).to.equal(await batchVerifier.getAddress());
        });
        
        it("Should revert if verifiers are zero address", async function () {
            const testHelpersInstance = new TestHelpers();
            await testHelpersInstance.initialize();
            const proofLibAddress = await testHelpersInstance.deployProofLib();
            const RecursiveProofAggregator = await testHelpersInstance.getContractFactoryWithProofLib("RecursiveProofAggregator", proofLibAddress);
            
            await expect(
                RecursiveProofAggregator.deploy(
                    ethers.ZeroAddress,
                    ethers.ZeroAddress
                )
            ).to.be.revertedWithCustomError(RecursiveProofAggregator, "InvalidVerifierAddress");
        });
        
        it("Should initialize with zero batches and gas saved", async function () {
            const { aggregator } = await loadFixture(deployAggregatorFixture);
            
            expect(await aggregator.totalBatchesProcessed()).to.equal(0);
            expect(await aggregator.totalGasSaved()).to.equal(0);
        });
        
        it("Should have correct constants", async function () {
            const { aggregator } = await loadFixture(deployAggregatorFixture);
            
            expect(await aggregator.MAX_BATCH_SIZE()).to.equal(32);
            expect(await aggregator.MIN_BATCH_SIZE()).to.equal(2);
            expect(await aggregator.MAX_RECURSION_DEPTH()).to.equal(8);
            expect(await aggregator.PROOF_VALIDITY_PERIOD()).to.equal(1 * 60 * 60); // 1 hour
        });
    });
    
    describe("Proof Batch Creation", function () {
        it("Should allow creating proof batches", async function () {
            const { aggregator, batchVerifier, governance } = await loadFixture(deployAggregatorFixture);
            
            // Deploy a verifier for proof type 0
            const MockZKVerifier = await ethers.getContractFactory("MockZKVerifier");
            const proofTypeVerifier = await MockZKVerifier.deploy();
            await proofTypeVerifier.waitForDeployment();
            await proofTypeVerifier.setShouldVerify(true);
            
            // Register verifier for proof type 0 (requires governance)
            await aggregator.connect(governance).registerProofTypeVerifier(0, await proofTypeVerifier.getAddress());
            
            const proofHashes = [
                ethers.keccak256(ethers.toUtf8Bytes("proof1")),
                ethers.keccak256(ethers.toUtf8Bytes("proof2"))
            ];
            const proofTypes = [0, 0];
            const proofs = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0]
            ];
            const publicInputsArray = [
                [ethers.keccak256(ethers.toUtf8Bytes("commitment1")), ethers.keccak256(ethers.toUtf8Bytes("nullifier1"))],
                [ethers.keccak256(ethers.toUtf8Bytes("commitment2")), ethers.keccak256(ethers.toUtf8Bytes("nullifier2"))]
            ];
            
            // Set mock verifier to return true
            await batchVerifier.setShouldVerify(true);
            
            // totalBatchesProcessed is only incremented when batches are verified, not when created
            // So we check that the batch was created by getting the batchId from the transaction
            const tx = await aggregator.createProofBatch(
                proofHashes,
                proofTypes,
                proofs,
                publicInputsArray
            );
            const receipt = await tx.wait();
            // Extract batchId from event
            const event = receipt.logs.find(log => {
                try {
                    const parsed = aggregator.interface.parseLog(log);
                    return parsed && parsed.name === "ProofBatchCreated";
                } catch {
                    return false;
                }
            });
            expect(event).to.not.be.undefined;
            const parsedEvent = aggregator.interface.parseLog(event);
            const batchId = parsedEvent.args[0];
            const batch = await aggregator.proofBatches(batchId);
            expect(batch.batchId).to.equal(batchId);
        });
        
        it("Should enforce minimum batch size", async function () {
            const { aggregator } = await loadFixture(deployAggregatorFixture);
            
            const proofHashes = [ethers.keccak256(ethers.toUtf8Bytes("proof1"))]; // Only 1 proof
            const proofTypes = [0];
            const proofs = [[0, 0, 0, 0, 0, 0, 0, 0]];
            const publicInputsArray = [[ethers.keccak256(ethers.toUtf8Bytes("commitment1"))]];
            
            await expect(
                aggregator.createProofBatch(
                    proofHashes,
                    proofTypes,
                    proofs,
                    publicInputsArray
                )
            ).to.be.revertedWithCustomError(aggregator, "InvalidBatchSize");
        });
        
        it("Should enforce maximum batch size", async function () {
            const { aggregator } = await loadFixture(deployAggregatorFixture);
            
            const proofHashes = Array(33).fill(0).map((_, i) => ethers.keccak256(ethers.toUtf8Bytes(`proof${i}`)));
            const proofTypes = Array(33).fill(0);
            const proofs = Array(33).fill([0, 0, 0, 0, 0, 0, 0, 0]);
            const publicInputsArray = Array(33).fill([ethers.keccak256(ethers.toUtf8Bytes("commitment"))]);
            
            await expect(
                aggregator.createProofBatch(
                    proofHashes,
                    proofTypes,
                    proofs,
                    publicInputsArray
                )
            ).to.be.revertedWithCustomError(aggregator, "InvalidBatchSize");
        });
        
        it("Should enforce array length matching", async function () {
            const { aggregator } = await loadFixture(deployAggregatorFixture);
            
            const proofHashes = [
                ethers.keccak256(ethers.toUtf8Bytes("proof1")),
                ethers.keccak256(ethers.toUtf8Bytes("proof2"))
            ];
            const proofTypes = [0]; // Mismatched length
            const proofs = [[0, 0, 0, 0, 0, 0, 0, 0]];
            const publicInputsArray = [[ethers.keccak256(ethers.toUtf8Bytes("commitment1"))]];
            
            await expect(
                aggregator.createProofBatch(
                    proofHashes,
                    proofTypes,
                    proofs,
                    publicInputsArray
                )
            ).to.be.revertedWithCustomError(aggregator, "ArrayLengthMismatch");
        });
    });
    
    describe("Proof Aggregation", function () {
        it("Should allow aggregating verified proofs", async function () {
            const { aggregator, batchVerifier, recursiveVerifier, governance } = await loadFixture(deployAggregatorFixture);
            
            // Deploy and register verifier for proof type 0
            const MockZKVerifier = await ethers.getContractFactory("MockZKVerifier");
            const proofTypeVerifier = await MockZKVerifier.deploy();
            await proofTypeVerifier.waitForDeployment();
            await proofTypeVerifier.setShouldVerify(true);
            
            // Register verifier for proof type 0 (requires governance)
            await aggregator.connect(governance).registerProofTypeVerifier(0, await proofTypeVerifier.getAddress());
            
            await batchVerifier.setShouldVerify(true);
            
            // First create a batch
            const proofHashes = [
                ethers.keccak256(ethers.toUtf8Bytes("proof1")),
                ethers.keccak256(ethers.toUtf8Bytes("proof2"))
            ];
            const proofTypes = [0, 0];
            const proofs = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0]
            ];
            const publicInputsArray = [
                [ethers.keccak256(ethers.toUtf8Bytes("commitment1")), ethers.keccak256(ethers.toUtf8Bytes("nullifier1"))],
                [ethers.keccak256(ethers.toUtf8Bytes("commitment2")), ethers.keccak256(ethers.toUtf8Bytes("nullifier2"))]
            ];
            
            const tx = await aggregator.createProofBatch(
                proofHashes,
                proofTypes,
                proofs,
                publicInputsArray
            );
            const receipt = await tx.wait();
            // Extract batchId from event
            const event = receipt.logs.find(log => {
                try {
                    const parsed = aggregator.interface.parseLog(log);
                    return parsed && parsed.name === "ProofBatchCreated";
                } catch {
                    return false;
                }
            });
            expect(event).to.not.be.undefined;
            const parsedEvent = aggregator.interface.parseLog(event);
            const batchId = parsedEvent.args[0];
            
            // Verify the batch
            await aggregator.verifyProofBatch(
                batchId,
                [0, 0, 0, 0, 0, 0, 0, 0],
                []
            );
            
            // Note: Full aggregation would require actual recursive proof data
        });
    });
    
    describe("Access Control", function () {
        it("Should allow governance to pause contract", async function () {
            const { aggregator, governance } = await loadFixture(deployAggregatorFixture);
            
            await aggregator.connect(governance).pause();
            expect(await aggregator.paused()).to.be.true;
        });
        
        it("Should prevent operations when paused", async function () {
            const { aggregator, governance } = await loadFixture(deployAggregatorFixture);
            
            await aggregator.connect(governance).pause();
            
            const proofHashes = [
                ethers.keccak256(ethers.toUtf8Bytes("proof1")),
                ethers.keccak256(ethers.toUtf8Bytes("proof2"))
            ];
            const proofTypes = [0, 1];
            
            // createProofBatch expects: proofHashes, proofTypes, proofs, publicInputsArray
            const proofs = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0]
            ];
            const publicInputsArray = [
                [ethers.keccak256(ethers.toUtf8Bytes("commitment1")), ethers.keccak256(ethers.toUtf8Bytes("nullifier1"))],
                [ethers.keccak256(ethers.toUtf8Bytes("commitment2")), ethers.keccak256(ethers.toUtf8Bytes("nullifier2"))]
            ];
            
            await expect(
                aggregator.createProofBatch(
                    proofHashes,
                    proofTypes,
                    proofs,
                    publicInputsArray
                )
            ).to.be.revertedWithCustomError(aggregator, "EnforcedPause");
        });
        
        it("Should allow governance to update recursive verifier", async function () {
            const { aggregator, governance } = await loadFixture(deployAggregatorFixture);
            
            const MockZKVerifier = await ethers.getContractFactory("MockZKVerifier");
            const newVerifier = await MockZKVerifier.deploy();
            await newVerifier.waitForDeployment();
            
            await expect(
                aggregator.connect(governance).updateRecursiveVerifier(await newVerifier.getAddress())
            ).to.emit(aggregator, "VerifierUpdated")
                .withArgs("recursive", await newVerifier.getAddress());
            
            expect(await aggregator.recursiveVerifier()).to.equal(await newVerifier.getAddress());
        });
        
        it("Should allow governance to update batch verifier", async function () {
            const { aggregator, governance } = await loadFixture(deployAggregatorFixture);
            
            const MockZKVerifier = await ethers.getContractFactory("MockZKVerifier");
            const newVerifier = await MockZKVerifier.deploy();
            await newVerifier.waitForDeployment();
            
            await expect(
                aggregator.connect(governance).updateBatchVerifier(await newVerifier.getAddress())
            ).to.emit(aggregator, "VerifierUpdated")
                .withArgs("batch", await newVerifier.getAddress());
            
            expect(await aggregator.batchVerifier()).to.equal(await newVerifier.getAddress());
        });
        
        it("Should prevent non-governance from updating verifiers", async function () {
            const { aggregator, user1 } = await loadFixture(deployAggregatorFixture);
            
            const MockZKVerifier = await ethers.getContractFactory("MockZKVerifier");
            const newVerifier = await MockZKVerifier.deploy();
            await newVerifier.waitForDeployment();
            
            await expect(
                aggregator.connect(user1).updateRecursiveVerifier(await newVerifier.getAddress())
            ).to.be.revertedWithCustomError(aggregator, "UnauthorizedAccess");
        });
    });
    
    describe("Gas Optimization Tracking", function () {
        it("Should track gas savings correctly", async function () {
            const { aggregator } = await loadFixture(deployAggregatorFixture);
            
            // Initial state
            expect(await aggregator.totalGasSaved()).to.equal(0);
            expect(await aggregator.averageGasSavings()).to.equal(0);
        });
    });
});

