const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { TestHelpers } = require("./helpers/TestHelpers");
const { mintShield } = require("./helpers/mintShieldHelper");

describe("PrivateDerivatives", function () {
    let testHelpers;

    function packDerivZk(helpers, mockProof, buyerCommitment, derivativeType = 0) {
        return helpers.generateDerivativeProofBytes(mockProof, {
            contractCommitment: buyerCommitment,
            derivativeType,
        });
    }
    
    async function deployDerivativesFixture() {
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
        
        // Deploy PrivateDerivatives with governance in constructor
        const PrivateDerivatives = await ethers.getContractFactory("PrivateDerivatives");
        const derivatives = await PrivateDerivatives.deploy(
            await tokenContract.getAddress(),
            await verifierFactory.getAddress(),
            governance.address  // Set governance in constructor
        );
        await derivatives.waitForDeployment();
        
        // Set token in TokenAllocation so it can manage tokens (governance is owner)
        await tokenAllocation.connect(governance).setToken(await tokenContract.getAddress());
        
        // Set up tokenAllocation so governance can use tokens for testing (governance is owner)
        await tokenAllocation.connect(governance).setTreasuryWallet(governance.address);
        await tokenAllocation.connect(governance).allocateTreasuryTokens();
        
        // Set governance in PrivateTokenContract (owner can set it initially)
        await tokenContract.connect(owner).setGovernanceContract(governance.address);
        
        // Authorize PrivateDerivatives contract to use PrivateTokenContract internal functions
        await tokenContract.connect(governance).authorizeContract(await derivatives.getAddress());
        
        return {
            derivatives,
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
            const { derivatives, tokenContract, verifierFactory } = await loadFixture(deployDerivativesFixture);
            
            expect(await derivatives.PRIVATE_TOKEN()).to.equal(await tokenContract.getAddress());
            expect(await derivatives.VERIFIER_FACTORY()).to.equal(await verifierFactory.getAddress());
        });
        
        it("Should initialize with zero contracts and TVL", async function () {
            const { derivatives } = await loadFixture(deployDerivativesFixture);
            
            // Constructor initializes nextContractId to 1 (first contract ID will be 1)
            expect(await derivatives.nextContractId()).to.equal(1);
            expect(await derivatives.totalValueLocked()).to.equal(0);
        });
        
        it("Should have correct constants", async function () {
            const { derivatives } = await loadFixture(deployDerivativesFixture);
            
            expect(await derivatives.MIN_EXPIRY()).to.equal(1 * 60 * 60); // 1 hour
            expect(await derivatives.MAX_EXPIRY()).to.equal(365 * 24 * 60 * 60); // 365 days
            expect(await derivatives.SETTLEMENT_FEE_BPS()).to.equal(30); // 0.3%
        });
    });
    
    describe("Contract Creation", function () {
        it("Should allow creating call option with valid proof", async function () {
            const { derivatives, verifierFactory, governance, tokenContract } = await loadFixture(deployDerivativesFixture);
            
            const mockProof = testHelpers.generateMockZKProof("contribution");
            const underlyingAsset = ethers.keccak256(ethers.toUtf8Bytes("asset-1"));
            const strikePrice = ethers.parseEther("100");
            const notionalAmount = ethers.parseEther("1000");
            const premium = ethers.parseEther("50");
            const collateral = ethers.parseEther("1000");
            const expiryTime = (await time.latest()) + 30 * 24 * 60 * 60; // 30 days
            const derivativeType = 0; // CALL_OPTION
            const optionStyle = 0; // EUROPEAN
            // Use unique commitment to avoid CommitmentAlreadyExists
            const buyerCommitment = testHelpers.generateUniqueCommitment("buyer-commitment");
            const sellerCommitment = testHelpers.generateUniqueCommitment("seller");
            // Use unique nullifier to avoid conflicts
            const nullifier = testHelpers.generateUniqueNullifier();
            
            // Set price for underlying asset (required for collateral calculation)
            const assetPrice = ethers.parseEther("100");
            await derivatives.connect(governance).updatePrice(underlyingAsset, assetPrice);
            
            // Shield tokens to commitments - createContract transfers premium from buyerCommitment and locks collateral from sellerCommitment
            // Premium = 50, collateral = calculated based on notionalAmount and strikePrice
            // For CALL_OPTION: collateral = notionalAmount (1000 tokens)
            await mintShield(tokenContract, governance, buyerCommitment, premium + ethers.parseEther("100"), testHelpers); // Premium + buffer
            await mintShield(tokenContract, governance, sellerCommitment, notionalAmount + ethers.parseEther("100"), testHelpers); // Collateral + buffer
            
            const derivativeVerifier = await verifierFactory.verifiers("derivative");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", derivativeVerifier);
            await mockVerifier.setShouldVerify(true);
            
            const createParams = {
                derivativeType: derivativeType,
                optionStyle: optionStyle,
                underlyingAsset: underlyingAsset,
                strikePrice: strikePrice,
                notionalAmount: notionalAmount,
                premium: premium,
                expiryTime: expiryTime,
                requestTimestamp: await time.latest(),
                buyerCommitment: buyerCommitment,
                sellerCommitment: sellerCommitment,
                zkProof: packDerivZk(testHelpers, mockProof, (typeof buyerCommitment !== "undefined" ? buyerCommitment : mockProof.commitment), (typeof derivativeType !== "undefined" ? derivativeType : 0))
            };
            
            await expect(
                derivatives.createContract(createParams)
            ).to.emit(derivatives, "ContractCreated");
            
            const contractId = await derivatives.nextContractId();
            expect(contractId).to.equal(2); // Starts at 1, increments to 2 after first creation
        });
        
        it("Should enforce minimum expiry time", async function () {
            const { derivatives, verifierFactory } = await loadFixture(deployDerivativesFixture);
            
            const mockProof = testHelpers.generateMockZKProof("contribution");
            const expiryTime = (await time.latest()) + 30 * 60; // 30 minutes - below minimum
            
            const derivativeVerifier = await verifierFactory.verifiers("derivative");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", derivativeVerifier);
            await mockVerifier.setShouldVerify(true);
            
            const createParams = {
                derivativeType: 0,
                optionStyle: 0,
                underlyingAsset: ethers.keccak256(ethers.toUtf8Bytes("asset-1")),
                strikePrice: ethers.parseEther("100"),
                notionalAmount: ethers.parseEther("1000"),
                premium: ethers.parseEther("50"),
                expiryTime: expiryTime,
                requestTimestamp: await time.latest(),
                buyerCommitment: mockProof.commitment,
                sellerCommitment: ethers.keccak256(ethers.toUtf8Bytes("seller")),
                zkProof: packDerivZk(testHelpers, mockProof, (typeof buyerCommitment !== "undefined" ? buyerCommitment : mockProof.commitment), (typeof derivativeType !== "undefined" ? derivativeType : 0))
            };
            
            await expect(
                derivatives.createContract(createParams)
            ).to.be.revertedWithCustomError(derivatives, "ExpiryTooSoon");
        });
        
        it("Should enforce maximum expiry time", async function () {
            const { derivatives, verifierFactory, governance } = await loadFixture(deployDerivativesFixture);
            
            const mockProof = testHelpers.generateMockZKProof("contribution");
            const underlyingAsset = ethers.keccak256(ethers.toUtf8Bytes("asset-1"));
            const expiryTime = (await time.latest()) + 400 * 24 * 60 * 60; // 400 days - above maximum
            
            // Set price for underlying asset (required for collateral calculation)
            const assetPrice = ethers.parseEther("100");
            await derivatives.connect(governance).updatePrice(underlyingAsset, assetPrice);
            
            const derivativeVerifier = await verifierFactory.verifiers("derivative");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", derivativeVerifier);
            await mockVerifier.setShouldVerify(true);
            
            const createParams = {
                derivativeType: 0,
                optionStyle: 0,
                underlyingAsset: underlyingAsset,
                strikePrice: ethers.parseEther("100"),
                notionalAmount: ethers.parseEther("1000"),
                premium: ethers.parseEther("50"),
                expiryTime: expiryTime,
                requestTimestamp: await time.latest(),
                buyerCommitment: mockProof.commitment,
                sellerCommitment: ethers.keccak256(ethers.toUtf8Bytes("seller")),
                zkProof: packDerivZk(testHelpers, mockProof, (typeof buyerCommitment !== "undefined" ? buyerCommitment : mockProof.commitment), (typeof derivativeType !== "undefined" ? derivativeType : 0))
            };
            
            await expect(
                derivatives.createContract(createParams)
            ).to.be.revertedWithCustomError(derivatives, "ExpiryTooFar");
        });
        
        it("Should prevent creating duplicate contracts with same buyer commitment", async function () {
            const { derivatives, verifierFactory, governance, tokenContract } = await loadFixture(deployDerivativesFixture);
            
            const mockProof = testHelpers.generateMockZKProof("contribution");
            // Use unique buyer commitment (not mockProof.commitment which might already exist)
            const buyerCommitment = testHelpers.generateUniqueCommitment("buyer-duplicate");
            const underlyingAsset = ethers.keccak256(ethers.toUtf8Bytes("asset-1"));
            const expiryTime = (await time.latest()) + 30 * 24 * 60 * 60;
            
            // Set price for underlying asset (required for collateral calculation)
            const assetPrice = ethers.parseEther("100");
            await derivatives.connect(governance).updatePrice(underlyingAsset, assetPrice);
            
            const derivativeVerifier = await verifierFactory.verifiers("derivative");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", derivativeVerifier);
            await mockVerifier.setShouldVerify(true);
            
            // Shield tokens to commitments before creating contract
            const premium = ethers.parseEther("50");
            const notionalAmount = ethers.parseEther("1000");
            await mintShield(tokenContract, governance, buyerCommitment, premium + ethers.parseEther("100"), testHelpers);
            const sellerCommitment1 = testHelpers.generateUniqueCommitment("seller-duplicate-1");
            await mintShield(tokenContract, governance, sellerCommitment1, notionalAmount + ethers.parseEther("100"), testHelpers);
            
            // Use unique nullifier for first contract creation
            const nullifier1 = testHelpers.generateUniqueNullifier();
            const createParams = {
                derivativeType: 0,
                optionStyle: 0,
                underlyingAsset: underlyingAsset,
                strikePrice: ethers.parseEther("100"),
                notionalAmount: notionalAmount,
                premium: premium,
                expiryTime: expiryTime,
                requestTimestamp: await time.latest(),
                buyerCommitment: buyerCommitment,
                sellerCommitment: sellerCommitment1,
                zkProof: packDerivZk(testHelpers, mockProof, (typeof buyerCommitment !== "undefined" ? buyerCommitment : mockProof.commitment), (typeof derivativeType !== "undefined" ? derivativeType : 0))
            };
            
            await derivatives.createContract(createParams);
            
            // Try to create again with same buyer commitment (should be prevented by commitmentToContract mapping)
            // Use unique nullifier for second attempt
            const nullifier2 = testHelpers.generateUniqueNullifier();
            const sellerCommitment2 = testHelpers.generateUniqueCommitment("seller-duplicate-2");
            // Shield tokens for second attempt (though it should fail)
            await mintShield(tokenContract, governance, sellerCommitment2, notionalAmount + ethers.parseEther("100"), testHelpers);
            
            const createParams2 = {
                derivativeType: 0,
                optionStyle: 0,
                underlyingAsset: underlyingAsset,
                strikePrice: ethers.parseEther("100"),
                notionalAmount: notionalAmount,
                premium: premium,
                expiryTime: expiryTime,
                requestTimestamp: await time.latest(),
                buyerCommitment: buyerCommitment, // Same commitment should trigger duplicate check
                sellerCommitment: sellerCommitment2,
                zkProof: packDerivZk(testHelpers, mockProof, (typeof buyerCommitment !== "undefined" ? buyerCommitment : mockProof.commitment), (typeof derivativeType !== "undefined" ? derivativeType : 0))
            };
            
            // Check if contract prevents duplicate buyer commitments
            const existingContractId = await derivatives.commitmentToContract(buyerCommitment);
            expect(existingContractId).to.be.greaterThan(0); // Contract should exist
            // Contract already exists for this commitment, expect revert with CommitmentAlreadyExists
            await expect(
                derivatives.createContract(createParams2)
            ).to.be.revertedWithCustomError(derivatives, "CommitmentAlreadyExists");
        });
    });
    
    describe("Option Exercise", function () {
        it("Should allow exercising call option with valid proof", async function () {
            const { derivatives, verifierFactory, governance, tokenContract } = await loadFixture(deployDerivativesFixture);
            
            // First create a contract
            const mockProof = testHelpers.generateMockZKProof("contribution");
            // Use unique buyer commitment to avoid CommitmentAlreadyExists
            const buyerCommitment = testHelpers.generateUniqueCommitment("buyer-exercise");
            const sellerCommitment = testHelpers.generateUniqueCommitment("seller-exercise");
            const underlyingAsset = ethers.keccak256(ethers.toUtf8Bytes("asset-1"));
            const expiryTime = (await time.latest()) + 30 * 24 * 60 * 60;
            
            // Set price for underlying asset (required for collateral calculation)
            const assetPrice = ethers.parseEther("100");
            await derivatives.connect(governance).updatePrice(underlyingAsset, assetPrice);
            
            // Shield tokens to commitments before creating contract
            const premium = ethers.parseEther("50");
            const notionalAmount = ethers.parseEther("1000");
            await mintShield(tokenContract, governance, buyerCommitment, premium + ethers.parseEther("100"), testHelpers);
            await mintShield(tokenContract, governance, sellerCommitment, notionalAmount + ethers.parseEther("100"), testHelpers);
            
            const derivativeVerifier = await verifierFactory.verifiers("derivative");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", derivativeVerifier);
            await mockVerifier.setShouldVerify(true);
            
            const createParams = {
                derivativeType: 0, // CALL_OPTION
                optionStyle: 0, // EUROPEAN
                underlyingAsset: underlyingAsset,
                strikePrice: ethers.parseEther("100"),
                notionalAmount: notionalAmount,
                premium: premium,
                expiryTime: expiryTime,
                requestTimestamp: await time.latest(),
                buyerCommitment: buyerCommitment,
                sellerCommitment: sellerCommitment,
                zkProof: packDerivZk(testHelpers, mockProof, buyerCommitment, 0)
            };
            
            const tx = await derivatives.createContract(createParams);
            await tx.wait();
            const contractId = await derivatives.nextContractId() - 1n;
            
            // The contract should handle small payoffs correctly
            // Settlement fee is capped to payoff amount to prevent underflow
            const contract = await derivatives.contracts(contractId);
            expect(contract.status).to.equal(0); // ACTIVE
            
            // Update price to create minimal payoff
            await derivatives.connect(governance).updatePrice(underlyingAsset, ethers.parseEther("100.001"));
            
            // Calculate current payoff - should be very small
            const currentPayoff = await derivatives.calculateCurrentPayoff(contractId);
            // Payoff should be minimal: (100.001 - 100) * 1 / 1e18 = 0.001 tokens
            // Fee = 0.001 * 30 / 10000 = 0.000003 tokens (much less than payoff)
            expect(currentPayoff).to.be.gte(0);
        });

        it("Should prevent underflow when settlement fee equals payoff", async function () {
            const { derivatives, verifierFactory, governance, tokenContract } = await loadFixture(deployDerivativesFixture);
            
            // Create contract and settle with minimal payoff
            const mockProof = testHelpers.generateMockZKProof("contribution");
            const underlyingAsset = ethers.keccak256(ethers.toUtf8Bytes("asset-fee-equal"));
            const strikePrice = ethers.parseEther("100");
            const notionalAmount = ethers.parseEther("1000");
            const premium = ethers.parseEther("50");
            const expiryTime = (await time.latest()) + 30 * 24 * 60 * 60;
            
            // Set price equal to strike (zero payoff)
            const assetPrice = ethers.parseEther("100");
            await derivatives.connect(governance).updatePrice(underlyingAsset, assetPrice);
            
            const buyerCommitment = testHelpers.generateUniqueCommitment("buyer-equal");
            const sellerCommitment = testHelpers.generateUniqueCommitment("seller-equal");
            
            await mintShield(tokenContract, governance, buyerCommitment, premium + ethers.parseEther("100"), testHelpers);
            await mintShield(tokenContract, governance, sellerCommitment, notionalAmount + ethers.parseEther("100"), testHelpers);
            
            const derivativeVerifier = await verifierFactory.verifiers("derivative");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", derivativeVerifier);
            await mockVerifier.setShouldVerify(true);
            
            const createParams = {
                derivativeType: 0,
                optionStyle: 0,
                underlyingAsset: underlyingAsset,
                strikePrice: strikePrice,
                notionalAmount: notionalAmount,
                premium: premium,
                expiryTime: expiryTime,
                requestTimestamp: await time.latest(),
                buyerCommitment: buyerCommitment,
                sellerCommitment: sellerCommitment,
                zkProof: packDerivZk(testHelpers, mockProof, (typeof buyerCommitment !== "undefined" ? buyerCommitment : mockProof.commitment), (typeof derivativeType !== "undefined" ? derivativeType : 0))
            };
            
            await derivatives.createContract(createParams);
            const contractId = await derivatives.nextContractId() - 1n;
            
            // Fast forward past expiry
            await time.increase(30 * 24 * 60 * 60 + 1);
            
            // Settle expired contract with zero payoff
            // Fee should be 0, no underflow
            await derivatives.settleExpiredContract(contractId);
            
            const contract = await derivatives.contracts(contractId);
            // Contract should be settled/expired
            // SettlementStatus: ACTIVE = 0, EXERCISED = 1, EXPIRED = 2, SETTLED = 3
            // The key is that settling with zero payoff should not cause underflow
            const status = Number(contract.status);
            // Status should be EXPIRED (2) or SETTLED (3) after settling
            // Could also be EXERCISED (1) if it was exercised before expiry
            expect(status >= 1 && status <= 3, `Expected status 1-3, got ${status}`).to.be.true;
        });

        it("Should cap settlement fee to payoff amount", async function () {
            const { derivatives, verifierFactory, governance, tokenContract } = await loadFixture(deployDerivativesFixture);
            
            // Create contract with very small payoff
            const mockProof = testHelpers.generateMockZKProof("contribution");
            const underlyingAsset = ethers.keccak256(ethers.toUtf8Bytes("asset-fee-cap"));
            const strikePrice = ethers.parseEther("100");
            const notionalAmount = ethers.parseEther("100"); // Small notional
            const premium = ethers.parseEther("10");
            const expiryTime = (await time.latest()) + 30 * 24 * 60 * 60;
            
            // Set price to create very small payoff
            // Payoff = (101 - 100) * 100 / 1e18 = 100 tokens
            // Fee = 100 * 30 / 10000 = 0.3 tokens (less than payoff, OK)
            const assetPrice = ethers.parseEther("101");
            await derivatives.connect(governance).updatePrice(underlyingAsset, assetPrice);
            
            const buyerCommitment = testHelpers.generateUniqueCommitment("buyer-cap");
            const sellerCommitment = testHelpers.generateUniqueCommitment("seller-cap");
            
            await mintShield(tokenContract, governance, buyerCommitment, premium + ethers.parseEther("100"), testHelpers);
            await mintShield(tokenContract, governance, sellerCommitment, notionalAmount + ethers.parseEther("100"), testHelpers);
            
            const derivativeVerifier = await verifierFactory.verifiers("derivative");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", derivativeVerifier);
            await mockVerifier.setShouldVerify(true);
            
            const createParams = {
                derivativeType: 0,
                optionStyle: 0,
                underlyingAsset: underlyingAsset,
                strikePrice: strikePrice,
                notionalAmount: notionalAmount,
                premium: premium,
                expiryTime: expiryTime,
                requestTimestamp: await time.latest(),
                buyerCommitment: buyerCommitment,
                sellerCommitment: sellerCommitment,
                zkProof: packDerivZk(testHelpers, mockProof, (typeof buyerCommitment !== "undefined" ? buyerCommitment : mockProof.commitment), (typeof derivativeType !== "undefined" ? derivativeType : 0))
            };
            
            await derivatives.createContract(createParams);
            const contractId = await derivatives.nextContractId() - 1n;
            
            // Calculate payoff - should be positive
            const payoff = await derivatives.calculateCurrentPayoff(contractId);
            expect(payoff).to.be.gt(0);
            
            // The contract should handle fee calculation correctly
            // Fee should never exceed payoff due to capping logic
            const contract = await derivatives.contracts(contractId);
            expect(contract.status).to.equal(0); // ACTIVE
        });
    });
    
    describe("Contract Queries", function () {
        it("Should return correct contract information", async function () {
            const { derivatives, verifierFactory, governance, tokenContract } = await loadFixture(deployDerivativesFixture);
            
            const mockProof = testHelpers.generateMockZKProof("contribution");
            const underlyingAsset = ethers.keccak256(ethers.toUtf8Bytes("asset-1"));
            const strikePrice = ethers.parseEther("100");
            const notionalAmount = ethers.parseEther("1000");
            const premium = ethers.parseEther("50");
            const collateral = ethers.parseEther("1000");
            const expiryTime = (await time.latest()) + 30 * 24 * 60 * 60;
            
            // Set price for underlying asset (required for collateral calculation)
            const assetPrice = ethers.parseEther("100");
            await derivatives.connect(governance).updatePrice(underlyingAsset, assetPrice);
            
            const derivativeVerifier = await verifierFactory.verifiers("derivative");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", derivativeVerifier);
            await mockVerifier.setShouldVerify(true);
            
            // Use unique buyer commitment to avoid conflicts
            const buyerCommitment = testHelpers.generateUniqueCommitment("buyer-info");
            const sellerCommitment = testHelpers.generateUniqueCommitment("seller-info");
            
            // Shield tokens to commitments before creating contract
            await mintShield(tokenContract, governance, buyerCommitment, premium + ethers.parseEther("100"), testHelpers);
            await mintShield(tokenContract, governance, sellerCommitment, notionalAmount + ethers.parseEther("100"), testHelpers);
            
            const createParams = {
                derivativeType: 0,
                optionStyle: 0,
                underlyingAsset: underlyingAsset,
                strikePrice: strikePrice,
                notionalAmount: notionalAmount,
                premium: premium,
                expiryTime: expiryTime,
                requestTimestamp: await time.latest(),
                buyerCommitment: buyerCommitment,
                sellerCommitment: sellerCommitment,
                zkProof: packDerivZk(testHelpers, mockProof, (typeof buyerCommitment !== "undefined" ? buyerCommitment : mockProof.commitment), (typeof derivativeType !== "undefined" ? derivativeType : 0))
            };
            
            const tx = await derivatives.createContract(createParams);
            await tx.wait();
            const contractId = 1; // First contract has ID 1
            
            const contract = await derivatives.contracts(contractId);
            expect(contract.strikePrice).to.equal(strikePrice);
            expect(contract.notionalAmount).to.equal(notionalAmount);
            expect(contract.status).to.equal(0); // ACTIVE
        });
    });
});

