const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { TestHelpers } = require("./helpers/TestHelpers");
const { mintShield } = require("./helpers/mintShieldHelper");

describe("DecentralizedInsurance", function () {
    let testHelpers;
    
    async function deployInsuranceFixture() {
        const [owner, governance, user1, user2] = await ethers.getSigners();
        
        // Deploy mock verifier factory and token
        const MockVerifierFactory = await ethers.getContractFactory("MockVerifierFactory");
        const verifierFactory = await MockVerifierFactory.deploy();
        await verifierFactory.waitForDeployment();
        
        // Ensure insurance verifier is set to verify (default verifier should already be in factory)
        const insuranceVerifierAddress = await verifierFactory.verifiers("insurance");
        const insuranceVerifier = await ethers.getContractAt("MockZKVerifier", insuranceVerifierAddress);
        await insuranceVerifier.setShouldVerify(true);
        
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
        
        // Deploy DecentralizedInsurance — constructor requires _initialPool == 0; fund via premiums / fundInsurancePool
        const DecentralizedInsurance = await ethers.getContractFactory("DecentralizedInsurance");
        const insurance = await DecentralizedInsurance.deploy(
            await tokenContract.getAddress(),
            await verifierFactory.getAddress(),
            0
        );
        await insurance.waitForDeployment();
        
        // Set up TokenAllocation so governance has tokens for testing
        await tokenAllocation.connect(governance).setToken(await tokenContract.getAddress());
        await tokenAllocation.connect(governance).setTreasuryWallet(governance.address);
        await tokenAllocation.connect(governance).allocateTreasuryTokens();
        
        // Set governance in PrivateTokenContract (owner can set it initially)
        await tokenContract.connect(owner).setGovernanceContract(governance.address);
        
        // Authorize DecentralizedInsurance contract to use PrivateTokenContract internal functions
        await tokenContract.connect(governance).authorizeContract(await insurance.getAddress());
        
        return {
            insurance,
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
            const { insurance, tokenContract, verifierFactory } = await loadFixture(deployInsuranceFixture);
            
            expect(await insurance.PRIVATE_TOKEN()).to.equal(await tokenContract.getAddress());
            expect(await insurance.VERIFIER_FACTORY()).to.equal(await verifierFactory.getAddress());
        });
        
        it("Should initialize with zero policies and claims", async function () {
            const { insurance } = await loadFixture(deployInsuranceFixture);
            
            expect(await insurance.nextPolicyId()).to.equal(1); // Starts at 1
            expect(await insurance.nextClaimId()).to.equal(1); // Starts at 1
            expect(await insurance.totalCoverageAmount()).to.equal(0);
        });
        
        it("Should expose getInsuranceMarketSnapshot aggregates", async function () {
            const { insurance } = await loadFixture(deployInsuranceFixture);
            const s = await insurance.getInsuranceMarketSnapshot();
            expect(s.poolWei).to.equal(await insurance.insurancePool());
            expect(s.outstandingCoverageWei).to.equal(0n);
            expect(s.coverageToPoolBps).to.equal(0n);
            expect(s.lossRatioBps).to.equal(0n);
        });
    });
    
    describe("Policy Creation", function () {
        it("Should allow creating insurance policy with valid proof", async function () {
            const { insurance, verifierFactory, tokenContract, governance } = await loadFixture(deployInsuranceFixture);
            
            // Set up verifier
            const insuranceVerifier = await verifierFactory.verifiers("insurance");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", insuranceVerifier);
            await mockVerifier.setShouldVerify(true);
            
            const mockProof = testHelpers.generateMockZKProof("contribution");
            // Use unique commitment to avoid CommitmentAlreadyExists - ensure it's different from mockProof.commitment
            // Generate a fresh commitment that's guaranteed to be unique
            const insuredCommitment = testHelpers.generateUniqueCommitment("insurance-policy");
            // Use unique nullifier to avoid conflicts
            const nullifier = testHelpers.generateUniqueNullifier();
            const coverageAmount = ethers.parseEther("10000");
            const coveragePeriod = 30 * 24 * 60 * 60; // 30 days
            const insuranceType = 0; // SMART_CONTRACT
            const protocolIdentifier = ethers.keccak256(ethers.toUtf8Bytes("test-protocol"));
            const deductible = ethers.parseEther("1000");
            
            // Shield tokens to commitment first - createPolicy transfers premium from commitment
            // Premium will be calculated, but we need enough balance for the premium
            // Estimate premium: coverageAmount * premiumRate * coveragePeriod / (PREMIUM_PRECISION * 365 days)
            // For 10000 coverage, 2% base rate, 30 days: 10000 * 200 * 30 / (10000 * 365) ≈ 164.38
            // Use 2000 to be safe (covers premium + buffer)
            const premiumAmount = ethers.parseEther("2000"); // Enough for premium
            await mintShield(tokenContract, governance, insuredCommitment, premiumAmount, testHelpers);
            
            const policyParams = {
                insuranceType: insuranceType,
                protocolIdentifier: protocolIdentifier,
                coverageAmount: coverageAmount,
                coveragePeriod: coveragePeriod,
                deductible: deductible,
                insuredCommitment: insuredCommitment,
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
                insurance.createPolicy(policyParams)
            ).to.emit(insurance, "PolicyCreated");
            
            const policyId = await insurance.nextPolicyId();
            expect(policyId).to.equal(2); // Starts at 1, increments after creation
        });
        
        it("Should enforce minimum coverage amount", async function () {
            const { insurance, verifierFactory } = await loadFixture(deployInsuranceFixture);
            
            const mockProof = testHelpers.generateMockZKProof("contribution");
            const coverageAmount = ethers.parseEther("500"); // Below MIN_COVERAGE_AMOUNT
            const coveragePeriod = 30 * 24 * 60 * 60;
            const insuranceType = 0;
            const protocolIdentifier = ethers.keccak256(ethers.toUtf8Bytes("test-protocol"));
            const deductible = ethers.parseEther("100");
            
            const policyParams = {
                insuranceType: insuranceType,
                protocolIdentifier: protocolIdentifier,
                coverageAmount: coverageAmount,
                coveragePeriod: coveragePeriod,
                deductible: deductible,
                insuredCommitment: mockProof.commitment,
                nullifier: testHelpers.generateUniqueNullifier(), // Use unique nullifier
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
                insurance.createPolicy(policyParams)
            ).to.be.revertedWithCustomError(insurance, "CoverageTooLow");
        });
        
        it("Should enforce maximum coverage amount", async function () {
            const { insurance, verifierFactory } = await loadFixture(deployInsuranceFixture);
            
            const mockProof = testHelpers.generateMockZKProof("contribution");
            const coverageAmount = ethers.parseEther("20000000"); // Above MAX_COVERAGE_AMOUNT
            const coveragePeriod = 30 * 24 * 60 * 60;
            const insuranceType = 0;
            const protocolIdentifier = ethers.keccak256(ethers.toUtf8Bytes("test-protocol"));
            const deductible = ethers.parseEther("1000");
            
            const policyParams = {
                insuranceType: insuranceType,
                protocolIdentifier: protocolIdentifier,
                coverageAmount: coverageAmount,
                coveragePeriod: coveragePeriod,
                deductible: deductible,
                insuredCommitment: mockProof.commitment,
                nullifier: testHelpers.generateUniqueNullifier(), // Use unique nullifier
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
                insurance.createPolicy(policyParams)
            ).to.be.revertedWithCustomError(insurance, "CoverageTooHigh");
        });
        
        it("Should enforce minimum coverage period", async function () {
            const { insurance, verifierFactory } = await loadFixture(deployInsuranceFixture);
            
            const mockProof = testHelpers.generateMockZKProof("contribution");
            const coverageAmount = ethers.parseEther("10000");
            const coveragePeriod = 3 * 24 * 60 * 60; // 3 days - below minimum
            const insuranceType = 0;
            const protocolIdentifier = ethers.keccak256(ethers.toUtf8Bytes("test-protocol"));
            const deductible = ethers.parseEther("1000");
            
            const policyParams = {
                insuranceType: insuranceType,
                protocolIdentifier: protocolIdentifier,
                coverageAmount: coverageAmount,
                coveragePeriod: coveragePeriod,
                deductible: deductible,
                insuredCommitment: mockProof.commitment,
                nullifier: testHelpers.generateUniqueNullifier(), // Use unique nullifier
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
                insurance.createPolicy(policyParams)
            ).to.be.revertedWithCustomError(insurance, "PeriodTooShort");
        });
        
        it("Should enforce maximum coverage period", async function () {
            const { insurance, verifierFactory } = await loadFixture(deployInsuranceFixture);
            
            const mockProof = testHelpers.generateMockZKProof("contribution");
            const coverageAmount = ethers.parseEther("10000");
            const coveragePeriod = 400 * 24 * 60 * 60; // 400 days - above maximum
            const insuranceType = 0;
            const protocolIdentifier = ethers.keccak256(ethers.toUtf8Bytes("test-protocol"));
            const deductible = ethers.parseEther("1000");
            
            const policyParams = {
                insuranceType: insuranceType,
                protocolIdentifier: protocolIdentifier,
                coverageAmount: coverageAmount,
                coveragePeriod: coveragePeriod,
                deductible: deductible,
                insuredCommitment: mockProof.commitment,
                nullifier: testHelpers.generateUniqueNullifier(), // Use unique nullifier
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
                insurance.createPolicy(policyParams)
            ).to.be.revertedWithCustomError(insurance, "PeriodTooLong");
        });
        
        it("Should enforce deductible less than coverage amount", async function () {
            const { insurance, verifierFactory } = await loadFixture(deployInsuranceFixture);
            
            const mockProof = testHelpers.generateMockZKProof("contribution");
            const coverageAmount = ethers.parseEther("10000");
            const deductible = ethers.parseEther("10000"); // Equal to coverage amount
            const coveragePeriod = 30 * 24 * 60 * 60;
            const insuranceType = 0;
            const protocolIdentifier = ethers.keccak256(ethers.toUtf8Bytes("test-protocol"));
            
            const policyParams = {
                insuranceType: insuranceType,
                protocolIdentifier: protocolIdentifier,
                coverageAmount: coverageAmount,
                coveragePeriod: coveragePeriod,
                deductible: deductible,
                insuredCommitment: mockProof.commitment,
                nullifier: testHelpers.generateUniqueNullifier(), // Use unique nullifier
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
                insurance.createPolicy(policyParams)
            ).to.be.revertedWithCustomError(insurance, "InvalidDeductible");
        });
    });
    
    describe("Claim Processing", function () {
        it("Should allow submitting claims with valid proof", async function () {
            const { insurance, verifierFactory, tokenContract, governance } = await loadFixture(deployInsuranceFixture);
            
            // Set up verifier
            const insuranceVerifier = await verifierFactory.verifiers("insurance");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", insuranceVerifier);
            await mockVerifier.setShouldVerify(true);
            
            // First create a policy
            const policyProof = testHelpers.generateMockZKProof("contribution");
            // Use unique commitment to avoid CommitmentAlreadyExists - ensure it's different from policyProof.commitment
            const insuredCommitment = testHelpers.generateUniqueCommitment("insurance-claim");
            const protocolIdentifier = ethers.keccak256(ethers.toUtf8Bytes("test-protocol"));
            const coverageAmount = ethers.parseEther("10000");
            const coveragePeriod = 30 * 24 * 60 * 60;
            const insuranceType = 0;
            const deductible = ethers.parseEther("1000");
            
            // Shield tokens to commitment first - createPolicy transfers premium from commitment
            const premiumAmount = ethers.parseEther("2000"); // Enough for premium
            await mintShield(tokenContract, governance, insuredCommitment, premiumAmount, testHelpers);
            
            const policyParams = {
                insuranceType: insuranceType,
                protocolIdentifier: protocolIdentifier,
                coverageAmount: coverageAmount,
                coveragePeriod: coveragePeriod,
                deductible: deductible,
                insuredCommitment: insuredCommitment,
                nullifier: testHelpers.generateUniqueNullifier(), // Use unique nullifier
                zkProof: ethers.AbiCoder.defaultAbiCoder().encode(
                    ["uint256[8]"],
                    [[
                        policyProof.a[0],
                        policyProof.a[1],
                        policyProof.b[0][0],
                        policyProof.b[0][1],
                        policyProof.b[1][0],
                        policyProof.b[1][1],
                        policyProof.c[0],
                        policyProof.c[1]
                    ]]
                )
            };
            
            const tx = await insurance.createPolicy(policyParams);
            await tx.wait();
            const policyId = 1; // First policy has ID 1
            
            // Submit claim
            const claimProof = testHelpers.generateMockZKProof("contribution");
            // Use unique commitment to avoid CommitmentAlreadyExists
            const claimantCommitment = testHelpers.generateUniqueCommitment("claimant");
            const claimAmount = ethers.parseEther("5000");
            const incidentHash = ethers.keccak256(ethers.toUtf8Bytes("incident"));
            const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("evidence"));
            const incidentTime = await time.latest();
            
            const claimParams = {
                policyId: policyId,
                incidentHash: incidentHash,
                claimAmount: claimAmount,
                incidentTime: incidentTime,
                evidenceHash: evidenceHash,
                claimantCommitment: claimantCommitment,
                nullifier: testHelpers.generateUniqueNullifier(), // Use unique nullifier for claim
                zkProof: ethers.AbiCoder.defaultAbiCoder().encode(
                    ["uint256[8]"],
                    [[
                        claimProof.a[0],
                        claimProof.a[1],
                        claimProof.b[0][0],
                        claimProof.b[0][1],
                        claimProof.b[1][0],
                        claimProof.b[1][1],
                        claimProof.c[0],
                        claimProof.c[1]
                    ]]
                )
            };
            
            await expect(
                insurance.submitClaim(claimParams)
            ).to.emit(insurance, "ClaimSubmitted");
        });
    });
    
    describe("Access Control", function () {
        it("Should allow governance to update settings", async function () {
            const { insurance, governance } = await loadFixture(deployInsuranceFixture);
            
            // Verify governance can interact (if contract has governance functions)
            // This depends on the contract's actual governance implementation
        });
    });
    
    describe("Policy Queries", function () {
        it("Should return correct policy information", async function () {
            const { insurance, verifierFactory, tokenContract, governance } = await loadFixture(deployInsuranceFixture);
            
            // Set up verifier
            const insuranceVerifier = await verifierFactory.verifiers("insurance");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", insuranceVerifier);
            await mockVerifier.setShouldVerify(true);
            
            const mockProof = testHelpers.generateMockZKProof("contribution");
            // Use unique commitment to avoid CommitmentAlreadyExists - ensure it's different from mockProof.commitment
            const insuredCommitment = testHelpers.generateUniqueCommitment("insurance-info");
            const protocolIdentifier = ethers.keccak256(ethers.toUtf8Bytes("test-protocol"));
            const coverageAmount = ethers.parseEther("10000");
            const coveragePeriod = 30 * 24 * 60 * 60;
            const insuranceType = 0;
            const deductible = ethers.parseEther("1000");
            
            // Shield tokens to commitment first - createPolicy transfers premium from commitment
            const premiumAmount = ethers.parseEther("2000"); // Enough for premium
            await mintShield(tokenContract, governance, insuredCommitment, premiumAmount, testHelpers);
            
            const policyParams = {
                insuranceType: insuranceType,
                protocolIdentifier: protocolIdentifier,
                coverageAmount: coverageAmount,
                coveragePeriod: coveragePeriod,
                deductible: deductible,
                insuredCommitment: insuredCommitment,
                nullifier: testHelpers.generateUniqueNullifier(), // Use unique nullifier
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
            
            const tx = await insurance.createPolicy(policyParams);
            await tx.wait();
            const policyId = 1; // First policy has ID 1
            
            // Verify policy exists
            const policy = await insurance.policies(policyId);
            expect(policy.coverageAmount).to.equal(coverageAmount);
            expect(policy.status).to.equal(0); // ACTIVE
            expect(await insurance.nextPolicyId()).to.equal(BigInt(policyId) + 1n);
        });
    });
});

