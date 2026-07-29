const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("HyperOptimizedAggregator", function () {
    async function deployAggregatorFixture() {
        const [owner, governance, user1, user2] = await ethers.getSigners();
        
        // Deploy mock verifier factory
        const MockVerifierFactory = await ethers.getContractFactory("MockVerifierFactory");
        const verifierFactory = await MockVerifierFactory.deploy();
        await verifierFactory.waitForDeployment();
        
        // Deploy HyperOptimizedAggregator
        const HyperOptimizedAggregator = await ethers.getContractFactory("HyperOptimizedAggregator");
        const aggregator = await HyperOptimizedAggregator.deploy(
            await verifierFactory.getAddress()
        );
        await aggregator.waitForDeployment();
        
        // Set governance
        await aggregator.setGovernanceContract(governance.address);
        
        return {
            aggregator,
            verifierFactory,
            owner,
            governance,
            user1,
            user2
        };
    }
    
    describe("Deployment", function () {
        it("Should deploy with correct verifier factory", async function () {
            const { aggregator, verifierFactory } = await loadFixture(deployAggregatorFixture);
            
            expect(await aggregator.VERIFIER_FACTORY()).to.equal(await verifierFactory.getAddress());
        });
        
        it("Should initialize with zero batches", async function () {
            const { aggregator } = await loadFixture(deployAggregatorFixture);
            
            const counters = await aggregator.counters();
            expect(counters.nextBatchId).to.equal(0);
            expect(counters.activeBatches).to.equal(0);
        });
        
        it("Should have correct constants", async function () {
            const { aggregator } = await loadFixture(deployAggregatorFixture);
            
            expect(await aggregator.MAX_BATCH_SIZE()).to.equal(1000);
            expect(await aggregator.MIN_BATCH_SIZE()).to.equal(10);
            expect(await aggregator.OPTIMIZATION_WINDOW()).to.equal(1 * 60 * 60); // 1 hour
            expect(await aggregator.MAX_COMPRESSION_RATIO()).to.equal(90);
            expect(await aggregator.PARALLEL_THRESHOLD()).to.equal(50);
        });
    });
    
    describe("Batch Submission", function () {
        it("Should allow submitting proof batches", async function () {
            const { aggregator } = await loadFixture(deployAggregatorFixture);
            
            // Create array of proof data (encoded as bytes) - minimum 10 for MIN_BATCH_SIZE
            const proofs = Array(10).fill(0).map((_, i) => 
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["uint256[8]"],
                    [[i, i, i, i, i, i, i, i]] // Different proof for each index
                )
            );
            
            // Create proof hashes from the proof data (must match keccak256 of proof)
            const proofHashes = proofs.map(proof => ethers.keccak256(proof));
            
            const submission = {
                proofHashes: proofHashes,
                proofs: proofs,
                preferredCompression: 0, // NONE
                enableParallel: false,
                maxWaitTime: 0
            };
            
            await expect(
                aggregator.submitBatch(submission)
            ).to.emit(aggregator, "BatchCreated");
            
            const counters = await aggregator.counters();
            expect(counters.nextBatchId).to.equal(1);
        });
        
        it("Should enforce minimum batch size", async function () {
            const { aggregator } = await loadFixture(deployAggregatorFixture);
            
            // Create array with only 9 proofs (below MIN_BATCH_SIZE)
            const proofs = Array(9).fill(0).map((_, i) => 
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["uint256[8]"],
                    [[i, i, i, i, i, i, i, i]]
                )
            );
            
            // Create proof hashes from the proof data
            const proofHashes = proofs.map(proof => ethers.keccak256(proof));
            
            const submission = {
                proofHashes: proofHashes,
                proofs: proofs,
                preferredCompression: 0,
                enableParallel: false,
                maxWaitTime: 0
            };
            
            await expect(
                aggregator.submitBatch(submission)
            ).to.be.revertedWithCustomError(aggregator, "BatchTooSmall");
        });
        
        it("Should enforce maximum batch size", async function () {
            const { aggregator } = await loadFixture(deployAggregatorFixture);
            
            // Create array with 1001 proofs (above MAX_BATCH_SIZE)
            const proofs = Array(1001).fill(0).map((_, i) => 
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["uint256[8]"],
                    [[i, i, i, i, i, i, i, i]]
                )
            );
            
            // Create proof hashes from the proof data
            const proofHashes = proofs.map(proof => ethers.keccak256(proof));
            
            const submission = {
                proofHashes: proofHashes,
                proofs: proofs,
                preferredCompression: 0,
                enableParallel: false,
                maxWaitTime: 0
            };
            
            await expect(
                aggregator.submitBatch(submission)
            ).to.be.revertedWithCustomError(aggregator, "BatchTooLarge");
        });
    });
    
    describe("Access Control", function () {
        it("Should allow owner to set governance contract", async function () {
            const { aggregator, owner, governance } = await loadFixture(deployAggregatorFixture);
            
            await aggregator.connect(owner).setGovernanceContract(governance.address);
            expect(await aggregator.governanceContract()).to.equal(governance.address);
        });
        
        it("Should prevent non-owner from setting governance", async function () {
            const { aggregator, user1 } = await loadFixture(deployAggregatorFixture);
            
            await expect(
                aggregator.connect(user1).setGovernanceContract(user1.address)
            ).to.be.revertedWithCustomError(aggregator, "NotOwner");
        });
    });
    
    describe("Optimization Configuration", function () {
        it("Should allow governance to update optimization config", async function () {
            const { aggregator, governance } = await loadFixture(deployAggregatorFixture);
            
            const newConfig = {
                targetBatchSize: 100,
                maxWaitTime: 30 * 60, // 30 minutes
                compressionThreshold: 50,
                parallelThreshold: 50,
                adaptiveCompressionEnabled: true,
                parallelProcessingEnabled: true,
                gasOptimizationTarget: 50,
                throughputTarget: 1000,
                latencyTarget: 60
            };
            
            // updateOptimizationConfig doesn't emit an event, just verify it succeeds
            await aggregator.connect(governance).updateOptimizationConfig(newConfig);
            
            // Verify config was updated
            const updatedConfig = await aggregator.config();
            expect(updatedConfig.targetBatchSize).to.equal(newConfig.targetBatchSize);
            
            const config = await aggregator.config();
            expect(config.targetBatchSize).to.equal(100);
            expect(config.adaptiveCompressionEnabled).to.be.true;
        });
    });
    
    describe("Batch Processing", function () {
        it("Should allow processing batches", async function () {
            const { aggregator } = await loadFixture(deployAggregatorFixture);
            
            // Generate proofs first, then calculate their hashes (contract validates: keccak256(proof) == proofHash)
            const proofs = Array(10).fill(0).map(() => 
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["uint256[8]"],
                    [[0, 0, 0, 0, 0, 0, 0, 0]]
                )
            );
            
            // Calculate proof hashes from actual proofs
            const proofHashes = proofs.map(proof => ethers.keccak256(proof));
            
            const submission = {
                proofHashes: proofHashes,
                proofs: proofs,
                preferredCompression: 0,
                enableParallel: false,
                maxWaitTime: 0
            };
            
            const tx = await aggregator.submitBatch(submission);
            const receipt = await tx.wait();
            const batchCreatedEvent = receipt.logs.find(log => {
                try {
                    const parsed = aggregator.interface.parseLog(log);
                    return parsed && parsed.name === "BatchCreated";
                } catch {
                    return false;
                }
            });
            
            if (batchCreatedEvent) {
                const parsed = aggregator.interface.parseLog(batchCreatedEvent);
                const batchId = parsed.args.batchId;
                
                // Process the batch (requires proof data)
                // Contract emits BatchProcessed, not BatchCompressed
                await expect(
                    aggregator.processBatch(batchId, proofs)
                ).to.emit(aggregator, "BatchProcessed");
            }
        });
    });
});

