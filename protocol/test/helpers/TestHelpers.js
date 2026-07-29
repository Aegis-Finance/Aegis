const { ethers } = require("hardhat");
const { expect } = require("chai");

/**
 * Comprehensive Test Helpers for Aegis Contracts
 * Provides utilities for ZK proof testing, Austrian economics validation,
 * and security-focused test patterns
 */

class TestHelpers {
    constructor() {
        this.accounts = {};
        this.contracts = {};
        this.zkProofs = {};
    }

    /**
     * Initialize test environment with accounts and basic setup
     */
    async initialize() {
        const signers = await ethers.getSigners();
        this.accounts = {
            deployer: signers[0],
            governance: signers[1],
            contributor1: signers[2],
            contributor2: signers[3],
            contributor3: signers[4],
            reviewer1: signers[5],
            reviewer2: signers[6],
            malicious: signers[7],
            treasury: signers[8],
            operator: signers[9]
        };
        return this.accounts;
    }

    /**
     * Deploy ProofLib library and return its address
     * @returns {Promise<string>} Address of deployed ProofLib library
     */
    async deployProofLib() {
        const ProofLib = await ethers.getContractFactory("ProofLib");
        const proofLib = await ProofLib.deploy();
        await proofLib.waitForDeployment();
        return await proofLib.getAddress();
    }

    /**
     * Get contract factory with ProofLib linked
     * @param {string} contractName - Name of the contract
     * @param {string} proofLibAddress - Address of deployed ProofLib
     * @returns {Promise} Contract factory with linked library
     */
    async getContractFactoryWithProofLib(contractName, proofLibAddress) {
        return await ethers.getContractFactory(contractName, {
            libraries: {
                ProofLib: proofLibAddress
            }
        });
    }

    async deployContract(contractName, constructorArgs = [], initArgs = []) {
        const ContractFactory = await ethers.getContractFactory(contractName);
        
        if (initArgs.length > 0) {
            // Deploy with proxy
            const { upgrades } = require("hardhat");
            const contract = await upgrades.deployProxy(
                ContractFactory,
                initArgs,
                { initializer: 'initialize' }
            );
            await contract.waitForDeployment();
            return contract;
        } else {
            // Deploy without proxy
            const contract = await ContractFactory.deploy(...constructorArgs);
            await contract.waitForDeployment();
            return contract;
        }
    }

    /**
     * Generate properly formatted ZK proof bytes for PrivateGovernance
     * Format: 8 uint256 (256 bytes) + public inputs (5-10 uint256, 160-320 bytes)
     * Total: 416-1024 bytes
     * Contract expects raw bytes: first 256 bytes are proof, rest are public inputs
     */
    generateGovernanceProofBytes(proofData, publicInputs) {
        const { ethers } = require("hardhat");
        
        // Convert values to hex strings (64 hex chars = 32 bytes)
        const toHex = (val) => {
            if (typeof val === 'string' && val.startsWith('0x')) {
                return val.slice(2).padStart(64, '0');
            }
            // Handle BigInt and regular numbers
            const num = typeof val === 'bigint' ? val : BigInt(val.toString());
            return num.toString(16).padStart(64, '0');
        };
        
        // Build proof part (8 uint256 = 256 bytes = 512 hex chars)
        let proofHex = '';
        proofHex += toHex(proofData.a[0]);
        proofHex += toHex(proofData.a[1]);
        proofHex += toHex(proofData.b[0][0]);
        proofHex += toHex(proofData.b[0][1]);
        proofHex += toHex(proofData.b[1][0]);
        proofHex += toHex(proofData.b[1][1]);
        proofHex += toHex(proofData.c[0]);
        proofHex += toHex(proofData.c[1]);
        
        // Build public inputs part (each uint256 = 32 bytes = 64 hex chars)
        let inputsHex = '';
        for (const input of publicInputs) {
            inputsHex += toHex(input);
        }
        
        // Combine: proof (256 bytes = 512 hex chars) + public inputs
        // Total length should be: 2 (for "0x") + 512 + (publicInputs.length * 64)
        const totalHex = "0x" + proofHex + inputsHex;
        
        // Verify length is between 416-1024 bytes (832-2048 hex chars + 2 for "0x")
        const byteLength = (totalHex.length - 2) / 2;
        if (byteLength < 416 || byteLength > 1024) {
            throw new Error(`Proof length ${byteLength} bytes is outside valid range [416, 1024]`);
        }
        
        return totalHex;
    }

    /**
     * Pack derivative.circom proof: 8 limbs + 6 public inputs (448 bytes).
     * Public: nullifierHash, merkleRoot, contractCommitment, collateralCommitment, derivativeType, valid
     */
    generateDerivativeProofBytes(proofData, { nullifierHash, merkleRoot, contractCommitment, collateralCommitment, derivativeType }) {
        return this.generateGovernanceProofBytes(proofData, [
            nullifierHash ?? 1n,
            merkleRoot ?? 1n,
            BigInt(contractCommitment),
            collateralCommitment ?? 1n,
            BigInt(derivativeType ?? 0),
            1n,
        ]);
    }

    /**
     * Generate mock ZK proof for testing
     */
    generateMockZKProof(type = 'refund') {
        const mockProofs = {
            refund: {
                a: ["0x1234567890123456789012345678901234567890123456789012345678901234", "0x1234567890123456789012345678901234567890123456789012345678901234"],
                b: [["0x1234567890123456789012345678901234567890123456789012345678901234", "0x1234567890123456789012345678901234567890123456789012345678901234"], ["0x1234567890123456789012345678901234567890123456789012345678901234", "0x1234567890123456789012345678901234567890123456789012345678901234"]],
                c: ["0x1234567890123456789012345678901234567890123456789012345678901234", "0x1234567890123456789012345678901234567890123456789012345678901234"],
                nullifier: "0x" + "1".repeat(64),
                commitment: "0x" + "2".repeat(64),
                campaignId: 1,
                amount: ethers.parseEther("1.0"),
                reason: 0 // RefundReason.VOLUNTARY_EXIT
            },
            contribution: {
                a: ["0x2345678901234567890123456789012345678901234567890123456789012345", "0x2345678901234567890123456789012345678901234567890123456789012345"],
                b: [["0x2345678901234567890123456789012345678901234567890123456789012345", "0x2345678901234567890123456789012345678901234567890123456789012345"], ["0x2345678901234567890123456789012345678901234567890123456789012345", "0x2345678901234567890123456789012345678901234567890123456789012345"]],
                c: ["0x2345678901234567890123456789012345678901234567890123456789012345", "0x2345678901234567890123456789012345678901234567890123456789012345"],
                nullifier: "0x" + "3".repeat(64),
                commitment: "0x" + "4".repeat(64),
                campaignId: 1,
                amount: ethers.parseEther("1.0")
            },
            milestone: {
                a: ["0x3456789012345678901234567890123456789012345678901234567890123456", "0x3456789012345678901234567890123456789012345678901234567890123456"],
                b: [["0x3456789012345678901234567890123456789012345678901234567890123456", "0x3456789012345678901234567890123456789012345678901234567890123456"], ["0x3456789012345678901234567890123456789012345678901234567890123456", "0x3456789012345678901234567890123456789012345678901234567890123456"]],
                c: ["0x3456789012345678901234567890123456789012345678901234567890123456", "0x3456789012345678901234567890123456789012345678901234567890123456"],
                nullifier: "0x" + "5".repeat(64),
                campaignId: 1,
                milestoneId: 1,
                approved: true,
                reviewerWeight: 100
            }
        };
        return mockProofs[type] || mockProofs.refund;
    }

    /**
     * Generate unique nullifier for testing
     */
    generateUniqueNullifier(seed = Date.now()) {
        return ethers.keccak256(ethers.toUtf8Bytes(`nullifier_${seed}_${Math.random()}_${process.hrtime.bigint()}`));
    }
    
    /**
     * Generate a unique commitment for testing
     * Uses timestamp, random, and high-resolution time to ensure uniqueness
     */
    generateUniqueCommitment(prefix = 'commitment') {
        return ethers.keccak256(ethers.toUtf8Bytes(`${prefix}_${Date.now()}_${Math.random()}_${process.hrtime.bigint()}`));
    }

    /**
     * Generate campaign data for testing
     */
    generateCampaignData(overrides = {}) {
        const defaults = {
            id: 1,
            totalRefundPool: ethers.parseEther("100"),
            refundDeadline: Math.floor(Date.now() / 1000) + 86400 * 30, // 30 days
            creator: this.accounts.contributor1?.address || ethers.ZeroAddress,
            target: ethers.parseEther("1000"),
            deadline: Math.floor(Date.now() / 1000) + 86400 * 60 // 60 days
        };
        return { ...defaults, ...overrides };
    }

    /**
     * Advance blockchain time for testing time-dependent functions
     */
    async advanceTime(seconds) {
        await ethers.provider.send("evm_increaseTime", [seconds]);
        await ethers.provider.send("evm_mine", []);
    }

    /**
     * Advance to specific block number
     */
    async advanceToBlock(blockNumber) {
        const currentBlock = await ethers.provider.getBlockNumber();
        const blocksToAdvance = blockNumber - currentBlock;
        
        if (blocksToAdvance > 0) {
            for (let i = 0; i < blocksToAdvance; i++) {
                await ethers.provider.send("evm_mine", []);
            }
        }
    }

    /**
     * Create snapshot for test isolation
     */
    async takeSnapshot() {
        return await ethers.provider.send("evm_snapshot", []);
    }

    /**
     * Restore from snapshot
     */
    async restoreSnapshot(snapshotId) {
        await ethers.provider.send("evm_revert", [snapshotId]);
    }

    /**
     * Expect transaction to revert with specific error
     */
    async expectRevert(transaction, errorMessage) {
        await expect(transaction).to.be.revertedWith(errorMessage);
    }

    /**
     * Expect custom error to be thrown
     */
    async expectCustomError(transaction, contract, errorName, args = []) {
        if (args.length > 0) {
            await expect(transaction).to.be.revertedWithCustomError(contract, errorName).withArgs(...args);
        } else {
            await expect(transaction).to.be.revertedWithCustomError(contract, errorName);
        }
    }

    /**
     * Validate Austrian Economics metrics
     */
    validateAustrianMetrics(metrics, expectedRanges = {}) {
        const defaults = {
            voluntaryExits: { min: 0, max: 100 },
            individualSovereignty: { min: 0, max: 100 },
            contractualBasis: { min: 0, max: 100 },
            marketJustification: { min: 0, max: 100 },
            soundMoneyPreservation: { min: 0, max: 100 },
            decentralizedApproval: { min: 0, max: 100 },
            emergentJustice: { min: 0, max: 100 }
        };
        
        const ranges = { ...defaults, ...expectedRanges };
        
        for (const [metric, range] of Object.entries(ranges)) {
            if (metrics[metric] !== undefined) {
                expect(Number(metrics[metric])).to.be.within(range.min, range.max, 
                    `Austrian metric ${metric} should be within range [${range.min}, ${range.max}]`);
            }
        }
    }

    /**
     * Validate ZK proof structure
     */
    validateZKProofStructure(proof) {
        expect(proof).to.have.property('a');
        expect(proof).to.have.property('b');
        expect(proof).to.have.property('c');
        expect(proof.a).to.be.an('array').with.length(2);
        expect(proof.b).to.be.an('array').with.length(2);
        expect(proof.b[0]).to.be.an('array').with.length(2);
        expect(proof.b[1]).to.be.an('array').with.length(2);
        expect(proof.c).to.be.an('array').with.length(2);
    }

    /**
     * Generate test data for stress testing
     */
    generateStressTestData(count = 100) {
        const data = [];
        for (let i = 0; i < count; i++) {
            data.push({
                nullifier: this.generateUniqueNullifier(i),
                amount: ethers.parseEther((Math.random() * 10).toFixed(2)),
                campaignId: Math.floor(Math.random() * 10) + 1,
                timestamp: Math.floor(Date.now() / 1000) + i
            });
        }
        return data;
    }

    /**
     * Validate gas usage is within acceptable limits
     */
    async validateGasUsage(transaction, maxGas = 500000) {
        const receipt = await transaction.wait();
        expect(Number(receipt.gasUsed)).to.be.below(maxGas, 
            `Gas usage ${receipt.gasUsed} exceeds maximum ${maxGas}`);
        return receipt.gasUsed;
    }

    /**
     * Setup mock verifier for testing
     */
    async setupMockVerifier() {
        const MockVerifier = await ethers.getContractFactory("MockVerifier");
        const mockVerifier = await MockVerifier.deploy();
        await mockVerifier.waitForDeployment();
        return mockVerifier;
    }

    /**
     * Validate event emission with specific parameters
     */
    async expectEvent(transaction, contract, eventName, expectedArgs = {}) {
        const receipt = await transaction.wait();
        const event = receipt.logs.find(log => {
            try {
                const parsed = contract.interface.parseLog(log);
                return parsed && parsed.name === eventName;
            } catch {
                return false;
            }
        });
        
        expect(event).to.not.be.undefined, `Event ${eventName} was not emitted`;
        
        if (Object.keys(expectedArgs).length > 0) {
            const parsedEvent = contract.interface.parseLog(event);
            for (const [key, value] of Object.entries(expectedArgs)) {
                expect(parsedEvent.args[key]).to.equal(value, 
                    `Event ${eventName} argument ${key} mismatch`);
            }
        }
        
        return event;
    }

    /**
     * Create multiple accounts for testing scenarios
     */
    async createTestAccounts(count = 10) {
        const accounts = [];
        for (let i = 0; i < count; i++) {
            const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
            // Fund the account
            await this.accounts.deployer.sendTransaction({
                to: wallet.address,
                value: ethers.parseEther("10")
            });
            accounts.push(wallet);
        }
        return accounts;
    }
}

module.exports = { TestHelpers };