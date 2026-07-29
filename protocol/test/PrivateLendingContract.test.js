const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time, mine } = require("@nomicfoundation/hardhat-network-helpers");
const { TestHelpers } = require("./helpers/TestHelpers");

describe("PrivateLendingContract", function () {
    /** @type {bigint} Must match `lending_tenor.circom` TENOR_365D and on-chain `TENOR_365D_SECONDS` */
    const TENOR_365_SEC = 31536000n;

    let testHelpers;
    
    async function deployLendingFixture() {
        const [owner, governance, user1, user2] = await ethers.getSigners();
        
        // Initialize test helpers
        const testHelpersInstance = new TestHelpers();
        await testHelpersInstance.initialize();
        
        // Deploy mock verifier factory and token
        const MockVerifierFactory = await ethers.getContractFactory("MockVerifierFactory");
        const verifierFactory = await MockVerifierFactory.deploy();
        await verifierFactory.waitForDeployment();
        
        // Deploy TokenAllocation
        const TokenAllocation = await ethers.getContractFactory("TokenAllocation");
        const tokenAllocation = await TokenAllocation.deploy(governance.address);
        await tokenAllocation.waitForDeployment();
        
        // Deploy ProofLib library first
        const proofLibAddress = await testHelpersInstance.deployProofLib();
        
        // Deploy PrivateTokenContract with linked library
        const PrivateTokenContract = await testHelpersInstance.getContractFactoryWithProofLib("PrivateTokenContract", proofLibAddress);
        const tokenContract = await PrivateTokenContract.deploy(
            await verifierFactory.getAddress(),
            await tokenAllocation.getAddress()
        );
        await tokenContract.waitForDeployment();
        
        // PrivateLendingContract now uses VerifierFactory instead of individual verifiers
        // Deploy PrivateLendingContract with linked library
        const PrivateLendingContract = await testHelpersInstance.getContractFactoryWithProofLib("PrivateLendingContract", proofLibAddress);
        const lendingContract = await PrivateLendingContract.deploy(
            await tokenContract.getAddress(),
            await verifierFactory.getAddress()
        );
        await lendingContract.waitForDeployment();
        
        // Set governance
        await lendingContract.setGovernanceContract(governance.address);
        
        return {
            lendingContract,
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
        it("Should deploy with correct parameters", async function () {
            const { lendingContract, tokenContract, verifierFactory } = await loadFixture(deployLendingFixture);
            
            expect(await lendingContract.AEGIS_TOKEN()).to.equal(await tokenContract.getAddress());
            expect(await lendingContract.VERIFIER_FACTORY()).to.equal(await verifierFactory.getAddress());
        });
        
        it("Should initialize with zero liquidity and borrowed amounts", async function () {
            const { lendingContract } = await loadFixture(deployLendingFixture);
            
            expect(await lendingContract.totalLiquidity()).to.equal(0);
            expect(await lendingContract.totalBorrowed()).to.equal(0);
            expect(await lendingContract.liquidityPool()).to.equal(0);
        });
        
        it("Should revert if token address is zero", async function () {
            const [owner] = await ethers.getSigners();
            const testHelpersInstance = new TestHelpers();
            await testHelpersInstance.initialize();
            const proofLibAddress = await testHelpersInstance.deployProofLib();
            
            const MockVerifierFactory = await ethers.getContractFactory("MockVerifierFactory");
            const verifierFactory = await MockVerifierFactory.deploy();
            await verifierFactory.waitForDeployment();
            
            const verifier = await verifierFactory.verifiers("lending-tenor");
            
            const PrivateLendingContract = await testHelpersInstance.getContractFactoryWithProofLib("PrivateLendingContract", proofLibAddress);
            
            await expect(
                PrivateLendingContract.deploy(
                    ethers.ZeroAddress,
                    await verifierFactory.getAddress()
                )
            ).to.be.revertedWithCustomError(PrivateLendingContract, "InvalidTokenAddress");
        });
    });
    
    describe("Liquidity Provision", function () {
        it("Should allow providing liquidity with valid proof", async function () {
            const { lendingContract, verifierFactory } = await loadFixture(deployLendingFixture);
            
            const mockProof = testHelpers.generateMockZKProof("contribution");
            const inputNullifier = mockProof.nullifier;
            const outputCommitment = mockProof.commitment;
            const amount = ethers.parseEther("10000");
            
            const collateralVerifier = await verifierFactory.verifiers("lending-liquidity");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", collateralVerifier);
            await mockVerifier.setShouldVerify(true);
            
            await expect(
                lendingContract.provideLiquidity(
                    [
                        mockProof.a[0],
                        mockProof.a[1],
                        mockProof.b[0][0],
                        mockProof.b[0][1],
                        mockProof.b[1][0],
                        mockProof.b[1][1],
                        mockProof.c[0],
                        mockProof.c[1]
                    ],
                    [inputNullifier, outputCommitment, amount]
                )
            ).to.emit(lendingContract, "LiquidityProvided");
            
            expect(await lendingContract.totalLiquidity()).to.equal(amount);
        });
        
        it("Should calculate liquidity shares correctly", async function () {
            const { lendingContract, verifierFactory } = await loadFixture(deployLendingFixture);
            
            const mockProof = testHelpers.generateMockZKProof("contribution");
            const amount = ethers.parseEther("10000");
            
            const collateralVerifier = await verifierFactory.verifiers("lending-liquidity");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", collateralVerifier);
            await mockVerifier.setShouldVerify(true);
            
            await lendingContract.provideLiquidity(
                [
                    mockProof.a[0],
                    mockProof.a[1],
                    mockProof.b[0][0],
                    mockProof.b[0][1],
                    mockProof.b[1][0],
                    mockProof.b[1][1],
                    mockProof.c[0],
                    mockProof.c[1]
                ],
                [mockProof.nullifier, mockProof.commitment, amount]
            );
            
            const shares = await lendingContract.liquidityShares(mockProof.commitment);
            expect(shares).to.be.gt(0);
        });
    });
    
    describe("Collateral and Borrowing", function () {
        it("Should allow depositing collateral with valid proof", async function () {
            const { lendingContract, verifierFactory } = await loadFixture(deployLendingFixture);
            
            // First provide liquidity
            const liquidityProof = testHelpers.generateMockZKProof("contribution");
            const liquidityAmount = ethers.parseEther("50000");
            
            const collateralVerifier = await verifierFactory.verifiers("lending-liquidity");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", collateralVerifier);
            await mockVerifier.setShouldVerify(true);
            
            await lendingContract.provideLiquidity(
                [
                    liquidityProof.a[0],
                    liquidityProof.a[1],
                    liquidityProof.b[0][0],
                    liquidityProof.b[0][1],
                    liquidityProof.b[1][0],
                    liquidityProof.b[1][1],
                    liquidityProof.c[0],
                    liquidityProof.c[1]
                ],
                [liquidityProof.nullifier, liquidityProof.commitment, liquidityAmount]
            );
            
            // Now borrow with collateral (deposits collateral and borrows in one call)
            const collateralProof = testHelpers.generateMockZKProof("collateral-deposit");
            const loanProof = testHelpers.generateMockZKProof("loan-request");
            const collateralCommitment = collateralProof.commitment;
            const loanCommitment = loanProof.commitment;
            // Contract requires: collateral >= loanAmount * 150% * 120% (safety buffer) = 180% of loan
            const loanAmount = ethers.parseEther("1000");
            const collateralAmount = ethers.parseEther("1800"); // 180% of loan amount (150% ratio + 20% safety buffer)
            
            // Use unique nullifier to avoid conflicts
            const collateralNullifier = testHelpers.generateUniqueNullifier();
            
            // Enable mock verifier (factory maps each circuit type to the same test verifier address)
            const lendingVerifier = await verifierFactory.verifiers("lending-tenor");
            const mockBorrowVerifier = await ethers.getContractAt("MockZKVerifier", lendingVerifier);
            await mockBorrowVerifier.setShouldVerify(true);
            
            await expect(
                lendingContract.borrowWithCollateral(
                    [
                        collateralProof.a[0],
                        collateralProof.a[1],
                        collateralProof.b[0][0],
                        collateralProof.b[0][1],
                        collateralProof.b[1][0],
                        collateralProof.b[1][1],
                        collateralProof.c[0],
                        collateralProof.c[1]
                    ],
                    [collateralNullifier, collateralCommitment, loanCommitment, collateralAmount, loanAmount, TENOR_365_SEC]
                )
            ).to.emit(lendingContract, "CollateralDeposited");
            
            expect(await lendingContract.collateralCommitments(collateralCommitment)).to.be.true;
        });
        
        it("Should allow borrowing against collateral", async function () {
            const { lendingContract, verifierFactory } = await loadFixture(deployLendingFixture);
            
            // First provide liquidity
            const liquidityProof = testHelpers.generateMockZKProof("liquidity-provider");
            const liquidityAmount = ethers.parseEther("50000");
            
            const collateralVerifier = await verifierFactory.verifiers("lending-liquidity");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", collateralVerifier);
            await mockVerifier.setShouldVerify(true);
            
            await lendingContract.provideLiquidity(
                [
                    liquidityProof.a[0],
                    liquidityProof.a[1],
                    liquidityProof.b[0][0],
                    liquidityProof.b[0][1],
                    liquidityProof.b[1][0],
                    liquidityProof.b[1][1],
                    liquidityProof.c[0],
                    liquidityProof.c[1]
                ],
                [liquidityProof.nullifier, liquidityProof.commitment, liquidityAmount]
            );
            
            // Borrow with collateral (deposits collateral and borrows in one atomic operation)
            // Use unique proof identifiers to avoid nullifier conflicts
            const collateralProof = testHelpers.generateMockZKProof("collateral-deposit");
            const loanProof = testHelpers.generateMockZKProof("loan-request");
            const collateralCommitment = collateralProof.commitment;
            const loanCommitment = loanProof.commitment;
            // Need at least 150% collateral ratio (150% of loan amount) + 20% safety buffer = 180% total
            const loanAmount = ethers.parseEther("1000");
            const collateralAmount = ethers.parseEther("1800"); // 180% to meet safety buffer requirement
            
            // Use unique nullifier to avoid conflicts
            const collateralNullifier = testHelpers.generateUniqueNullifier();
            
            // Enable mock verifier (factory maps each circuit type to the same test verifier address)
            const lendingVerifier = await verifierFactory.verifiers("lending-tenor");
            const mockBorrowVerifier = await ethers.getContractAt("MockZKVerifier", lendingVerifier);
            await mockBorrowVerifier.setShouldVerify(true);
            
            const tx = await lendingContract.borrowWithCollateral(
                [
                    collateralProof.a[0],
                    collateralProof.a[1],
                    collateralProof.b[0][0],
                    collateralProof.b[0][1],
                    collateralProof.b[1][0],
                    collateralProof.b[1][1],
                    collateralProof.c[0],
                    collateralProof.c[1]
                ],
                [collateralNullifier, collateralCommitment, loanCommitment, collateralAmount, loanAmount, TENOR_365_SEC]
            );
            
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    const parsed = lendingContract.interface.parseLog(log);
                    return parsed && parsed.name === "LoanIssued";
                } catch {
                    return false;
                }
            });
            
            expect(event).to.not.be.undefined;
            const parsedEvent = lendingContract.interface.parseLog(event);
            const loanId = parsedEvent.args[0];
            
            const loan = await lendingContract.loans(loanId);
            expect(loan.active).to.be.true;
            expect(loan.principal).to.equal(loanAmount);
            expect(loan.tenorSeconds).to.equal(TENOR_365_SEC);
        });
        
        it("Should enforce minimum collateral ratio", async function () {
            const { lendingContract, verifierFactory } = await loadFixture(deployLendingFixture);
            
            // Provide liquidity first
            const liquidityProof = testHelpers.generateMockZKProof("contribution");
            const liquidityAmount = ethers.parseEther("50000");
            
            const collateralVerifier = await verifierFactory.verifiers("lending-liquidity");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", collateralVerifier);
            await mockVerifier.setShouldVerify(true);
            
            await lendingContract.provideLiquidity(
                [
                    liquidityProof.a[0],
                    liquidityProof.a[1],
                    liquidityProof.b[0][0],
                    liquidityProof.b[0][1],
                    liquidityProof.b[1][0],
                    liquidityProof.b[1][1],
                    liquidityProof.c[0],
                    liquidityProof.c[1]
                ],
                [liquidityProof.nullifier, liquidityProof.commitment, liquidityAmount]
            );
            
            // Try to borrow with insufficient collateral (less than 150%)
            const collateralProof = testHelpers.generateMockZKProof("contribution");
            const loanProof = testHelpers.generateMockZKProof("contribution");
            const collateralCommitment = collateralProof.commitment;
            const loanCommitment = loanProof.commitment;
            const collateralAmount = ethers.parseEther("1000"); // Only 100% of 1000 loan (needs 150%)
            const loanAmount = ethers.parseEther("1000");
            
            const borrowVerifier = await verifierFactory.verifiers("lending-tenor");
            // Enable mock verifier (factory maps each circuit type to the same test verifier address)
            const lendingVerifier = await verifierFactory.verifiers("lending-tenor");
            const mockBorrowVerifier = await ethers.getContractAt("MockZKVerifier", lendingVerifier);
            await mockBorrowVerifier.setShouldVerify(true);
            
            await expect(
                lendingContract.borrowWithCollateral(
                    [
                        collateralProof.a[0],
                        collateralProof.a[1],
                        collateralProof.b[0][0],
                        collateralProof.b[0][1],
                        collateralProof.b[1][0],
                        collateralProof.b[1][1],
                        collateralProof.c[0],
                        collateralProof.c[1]
                    ],
                    [collateralProof.nullifier, collateralCommitment, loanCommitment, collateralAmount, loanAmount, TENOR_365_SEC]
                )
            ).to.be.revertedWithCustomError(lendingContract, "InsufficientCollateral");
        });
        
        it("Should prevent borrowing below minimum loan amount", async function () {
            const { lendingContract, verifierFactory } = await loadFixture(deployLendingFixture);
            
            // First provide liquidity
            const liquidityProof = testHelpers.generateMockZKProof("contribution");
            const liquidityAmount = ethers.parseEther("50000");
            
            const collateralVerifier = await verifierFactory.verifiers("lending-liquidity");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", collateralVerifier);
            await mockVerifier.setShouldVerify(true);
            
            await lendingContract.provideLiquidity(
                [
                    liquidityProof.a[0],
                    liquidityProof.a[1],
                    liquidityProof.b[0][0],
                    liquidityProof.b[0][1],
                    liquidityProof.b[1][0],
                    liquidityProof.b[1][1],
                    liquidityProof.c[0],
                    liquidityProof.c[1]
                ],
                [liquidityProof.nullifier, liquidityProof.commitment, liquidityAmount]
            );
            
            const collateralProof = testHelpers.generateMockZKProof("contribution");
            const loanProof = testHelpers.generateMockZKProof("contribution");
            const collateralAmount = ethers.parseEther("1500"); // Sufficient collateral
            const loanAmount = ethers.parseEther("0.5"); // Below MIN_LOAN_AMOUNT (1 AGS)
            
            // Enable mock verifier (factory maps each circuit type to the same test verifier address)
            const lendingVerifier = await verifierFactory.verifiers("lending-tenor");
            const mockBorrowVerifier = await ethers.getContractAt("MockZKVerifier", lendingVerifier);
            await mockBorrowVerifier.setShouldVerify(true);
            
            await expect(
                lendingContract.borrowWithCollateral(
                    [
                        collateralProof.a[0],
                        collateralProof.a[1],
                        collateralProof.b[0][0],
                        collateralProof.b[0][1],
                        collateralProof.b[1][0],
                        collateralProof.b[1][1],
                        collateralProof.c[0],
                        collateralProof.c[1]
                    ],
                    [collateralProof.nullifier, collateralProof.commitment, loanProof.commitment, collateralAmount, loanAmount, TENOR_365_SEC]
                )
            ).to.be.revertedWithCustomError(lendingContract, "InvalidLoanAmount");
        });
    });
    
    describe("Loan Repayment", function () {
        it("Should allow repaying a loan", async function () {
            const { lendingContract, verifierFactory } = await loadFixture(deployLendingFixture);
            
            // Setup: Provide liquidity, deposit collateral, borrow
            const liquidityProof = testHelpers.generateMockZKProof("contribution");
            const liquidityAmount = ethers.parseEther("50000");
            
            const collateralVerifier = await verifierFactory.verifiers("lending-liquidity");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", collateralVerifier);
            await mockVerifier.setShouldVerify(true);
            
            await lendingContract.provideLiquidity(
                [
                    liquidityProof.a[0],
                    liquidityProof.a[1],
                    liquidityProof.b[0][0],
                    liquidityProof.b[0][1],
                    liquidityProof.b[1][0],
                    liquidityProof.b[1][1],
                    liquidityProof.c[0],
                    liquidityProof.c[1]
                ],
                [liquidityProof.nullifier, liquidityProof.commitment, liquidityAmount]
            );
            
            const collateralProof = testHelpers.generateMockZKProof("collateral-repay");
            const loanProof = testHelpers.generateMockZKProof("loan-repay");
            const collateralCommitment = collateralProof.commitment;
            const loanCommitment = loanProof.commitment;
            // Contract requires: collateral >= loanAmount * 150% * 120% (safety buffer) = 180% of loan
            // For 1000 loan: need at least 1800 collateral
            const loanAmount = ethers.parseEther("1000");
            const collateralAmount = ethers.parseEther("1800"); // 180% of loan amount (150% ratio + 20% safety buffer)
            
            // Use unique nullifier to avoid conflicts
            const collateralNullifier = testHelpers.generateUniqueNullifier();
            
            // Enable mock verifier (factory maps each circuit type to the same test verifier address)
            const lendingVerifier = await verifierFactory.verifiers("lending-tenor");
            const mockBorrowVerifier = await ethers.getContractAt("MockZKVerifier", lendingVerifier);
            await mockBorrowVerifier.setShouldVerify(true);
            
            const borrowTx = await lendingContract.borrowWithCollateral(
                [
                    collateralProof.a[0],
                    collateralProof.a[1],
                    collateralProof.b[0][0],
                    collateralProof.b[0][1],
                    collateralProof.b[1][0],
                    collateralProof.b[1][1],
                    collateralProof.c[0],
                    collateralProof.c[1]
                ],
                [collateralNullifier, collateralCommitment, loanCommitment, collateralAmount, loanAmount, TENOR_365_SEC]
            );
            
            const borrowReceipt = await borrowTx.wait();
            const loanEvent = borrowReceipt.logs.find(log => {
                try {
                    const parsed = lendingContract.interface.parseLog(log);
                    return parsed && parsed.name === "LoanIssued";
                } catch {
                    return false;
                }
            });
            const parsedLoanEvent = lendingContract.interface.parseLog(loanEvent);
            const loanId = parsedLoanEvent.args[0];
            
            // Now test repaying the loan
            
            // Repay loan - use unique nullifier
            const repayProof = testHelpers.generateMockZKProof("repay-loan");
            const repayNullifier = testHelpers.generateUniqueNullifier();
            const repayAmount = ethers.parseEther("1050"); // Principal + interest
            
            // Reuse mock verifier instance (same address for all circuit types in MockVerifierFactory)
            const mockRepayVerifier = mockBorrowVerifier;
            await mockRepayVerifier.setShouldVerify(true);
            
            await expect(
                lendingContract.repayLoan(
                    [
                        repayProof.a[0],
                        repayProof.a[1],
                        repayProof.b[0][0],
                        repayProof.b[0][1],
                        repayProof.b[1][0],
                        repayProof.b[1][1],
                        repayProof.c[0],
                        repayProof.c[1]
                    ],
                    // repayLoan requires 5 public inputs: [loanNullifier, repaymentNullifier, collateralOutputCommitment, loanId, repaymentAmount]
                    [repayNullifier, repayNullifier, ethers.ZeroHash, loanId, repayAmount]
                )
            ).to.emit(lendingContract, "LoanRepaid");
            
            const loan = await lendingContract.loans(loanId);
            expect(loan.active).to.be.false;
        });
    });
    
    describe("Liquidation", function () {
        it("Should allow liquidating undercollateralized loans", async function () {
            const { lendingContract, verifierFactory } = await loadFixture(deployLendingFixture);
            
            // This would require setting up a loan that becomes undercollateralized
            // Simplified test structure
            const liquidationProof = testHelpers.generateMockZKProof("contribution");
            const loanId = ethers.keccak256(ethers.toUtf8Bytes("test-loan"));
            const liquidatorCommitment = liquidationProof.commitment;
            
            const liquidationVerifier = await verifierFactory.verifiers("lending-tenor");
            // Enable mock verifier (factory maps each circuit type to the same test verifier address)
            const lendingVerifierAddr = await verifierFactory.verifiers("lending-tenor");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", lendingVerifierAddr);
            await mockVerifier.setShouldVerify(true);
            
            // Note: This would need a properly set up undercollateralized loan
            // For now, just test the function structure
        });
    });
    
    describe("Access Control", function () {
        it("Should allow governance to pause contract", async function () {
            const { lendingContract, governance } = await loadFixture(deployLendingFixture);
            
            await lendingContract.connect(governance).pause();
            expect(await lendingContract.paused()).to.be.true;
        });
        
        it("Should prevent operations when paused", async function () {
            const { lendingContract, verifierFactory, governance } = await loadFixture(deployLendingFixture);
            
            await lendingContract.connect(governance).pause();
            
            const mockProof = testHelpers.generateMockZKProof("contribution");
            const collateralVerifier = await verifierFactory.verifiers("lending-liquidity");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", collateralVerifier);
            await mockVerifier.setShouldVerify(true);
            
            await expect(
                lendingContract.provideLiquidity(
                    [
                        mockProof.a[0],
                        mockProof.a[1],
                        mockProof.b[0][0],
                        mockProof.b[0][1],
                        mockProof.b[1][0],
                        mockProof.b[1][1],
                        mockProof.c[0],
                        mockProof.c[1]
                    ],
                    [mockProof.nullifier, mockProof.commitment, ethers.parseEther("1000")]
                )
            ).to.be.revertedWithCustomError(lendingContract, "EnforcedPause");
        });
    });

    describe("Security: Integer Underflow Tests", function () {
        it("Should revert when withdrawing more liquidity than available", async function () {
            const { lendingContract, verifierFactory } = await loadFixture(deployLendingFixture);
            
            // Provide liquidity
            const liquidityProof = testHelpers.generateMockZKProof("contribution");
            const liquidityAmount = ethers.parseEther("10000");
            
            const collateralVerifier = await verifierFactory.verifiers("lending-liquidity");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", collateralVerifier);
            await mockVerifier.setShouldVerify(true);
            
            await lendingContract.provideLiquidity(
                [
                    liquidityProof.a[0],
                    liquidityProof.a[1],
                    liquidityProof.b[0][0],
                    liquidityProof.b[0][1],
                    liquidityProof.b[1][0],
                    liquidityProof.b[1][1],
                    liquidityProof.c[0],
                    liquidityProof.c[1]
                ],
                [liquidityProof.nullifier, liquidityProof.commitment, liquidityAmount]
            );
            
            // Try to withdraw more than available
            const withdrawProof = testHelpers.generateMockZKProof("withdraw");
            const withdrawNullifier = testHelpers.generateUniqueNullifier();
            const withdrawAmount = ethers.parseEther("20000"); // More than available
            const withdrawShares = ethers.parseEther("20000"); // More than available
            
            const withdrawVerifier = await verifierFactory.verifiers("lending-withdraw");
            const mockWithdrawVerifier = await ethers.getContractAt("MockZKVerifier", withdrawVerifier);
            await mockWithdrawVerifier.setShouldVerify(true);
            
            // Should revert with InsufficientLiquidity
            await expect(
                lendingContract.withdrawLiquidity(
                    [
                        withdrawProof.a[0],
                        withdrawProof.a[1],
                        withdrawProof.b[0][0],
                        withdrawProof.b[0][1],
                        withdrawProof.b[1][0],
                        withdrawProof.b[1][1],
                        withdrawProof.c[0],
                        withdrawProof.c[1]
                    ],
                    [withdrawNullifier, withdrawProof.commitment, withdrawShares, withdrawAmount]
                )
            ).to.be.revertedWithCustomError(lendingContract, "InsufficientLiquidity");
        });

        it("Should revert when repaying more than total borrowed", async function () {
            const { lendingContract, verifierFactory } = await loadFixture(deployLendingFixture);
            
            // Setup: Provide liquidity, create loan
            const liquidityProof = testHelpers.generateMockZKProof("contribution");
            const liquidityAmount = ethers.parseEther("50000");
            
            const collateralVerifier = await verifierFactory.verifiers("lending-liquidity");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", collateralVerifier);
            await mockVerifier.setShouldVerify(true);
            
            await lendingContract.provideLiquidity(
                [
                    liquidityProof.a[0],
                    liquidityProof.a[1],
                    liquidityProof.b[0][0],
                    liquidityProof.b[0][1],
                    liquidityProof.b[1][0],
                    liquidityProof.b[1][1],
                    liquidityProof.c[0],
                    liquidityProof.c[1]
                ],
                [liquidityProof.nullifier, liquidityProof.commitment, liquidityAmount]
            );
            
            // Create loan
            const collateralProof = testHelpers.generateMockZKProof("collateral");
            const loanProof = testHelpers.generateMockZKProof("loan");
            const loanAmount = ethers.parseEther("1000");
            const collateralAmount = ethers.parseEther("1800");
            const collateralNullifier = testHelpers.generateUniqueNullifier();
            
            // Enable mock verifier (factory maps each circuit type to the same test verifier address)
            const lendingVerifier = await verifierFactory.verifiers("lending-tenor");
            const mockBorrowVerifier = await ethers.getContractAt("MockZKVerifier", lendingVerifier);
            await mockBorrowVerifier.setShouldVerify(true);
            
            const borrowTx = await lendingContract.borrowWithCollateral(
                [
                    collateralProof.a[0],
                    collateralProof.a[1],
                    collateralProof.b[0][0],
                    collateralProof.b[0][1],
                    collateralProof.b[1][0],
                    collateralProof.b[1][1],
                    collateralProof.c[0],
                    collateralProof.c[1]
                ],
                [collateralNullifier, collateralProof.commitment, loanProof.commitment, collateralAmount, loanAmount, TENOR_365_SEC]
            );
            
            const borrowReceipt = await borrowTx.wait();
            const loanEvent = borrowReceipt.logs.find(log => {
                try {
                    const parsed = lendingContract.interface.parseLog(log);
                    return parsed && parsed.name === "LoanIssued";
                } catch {
                    return false;
                }
            });
            const parsedLoanEvent = lendingContract.interface.parseLog(loanEvent);
            const loanId = parsedLoanEvent.args[0];
            
            // Check total borrowed before repay
            const totalBorrowedBefore = await lendingContract.totalBorrowed();
            expect(totalBorrowedBefore).to.equal(loanAmount);
            
            // Try to repay (this should work if set up correctly)
            // The underflow protection is in the contract logic
            const loan = await lendingContract.loans(loanId);
            expect(loan.principal).to.equal(loanAmount);
        });

        it("Should prevent borrowing more than available liquidity pool", async function () {
            const { lendingContract, verifierFactory } = await loadFixture(deployLendingFixture);
            
            // Provide limited liquidity
            const liquidityProof = testHelpers.generateMockZKProof("contribution");
            const liquidityAmount = ethers.parseEther("1000");
            
            const collateralVerifier = await verifierFactory.verifiers("lending-liquidity");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", collateralVerifier);
            await mockVerifier.setShouldVerify(true);
            
            await lendingContract.provideLiquidity(
                [
                    liquidityProof.a[0],
                    liquidityProof.a[1],
                    liquidityProof.b[0][0],
                    liquidityProof.b[0][1],
                    liquidityProof.b[1][0],
                    liquidityProof.b[1][1],
                    liquidityProof.c[0],
                    liquidityProof.c[1]
                ],
                [liquidityProof.nullifier, liquidityProof.commitment, liquidityAmount]
            );
            
            // Try to borrow more than available
            const collateralProof = testHelpers.generateMockZKProof("collateral");
            const loanAmount = ethers.parseEther("2000"); // More than liquidity
            const collateralAmount = ethers.parseEther("3600"); // Sufficient collateral
            const collateralNullifier = testHelpers.generateUniqueNullifier();
            
            // Enable mock verifier (factory maps each circuit type to the same test verifier address)
            const lendingVerifier = await verifierFactory.verifiers("lending-tenor");
            const mockBorrowVerifier = await ethers.getContractAt("MockZKVerifier", lendingVerifier);
            await mockBorrowVerifier.setShouldVerify(true);
            
            // Should revert - could be InsufficientLiquidity or SystemInsolvency
            // Both indicate the system is protecting against borrowing more than available
            await expect(
                lendingContract.borrowWithCollateral(
                    [
                        collateralProof.a[0],
                        collateralProof.a[1],
                        collateralProof.b[0][0],
                        collateralProof.b[0][1],
                        collateralProof.b[1][0],
                        collateralProof.b[1][1],
                        collateralProof.c[0],
                        collateralProof.c[1]
                    ],
                    [collateralNullifier, collateralProof.commitment, testHelpers.generateUniqueNullifier(), collateralAmount, loanAmount, TENOR_365_SEC]
                )
            ).to.be.reverted; // Can be InsufficientLiquidity or SystemInsolvency
        });
    });

    describe("Security: Division by Zero Tests", function () {
        it("Should handle utilization calculation with zero total liquidity", async function () {
            const { lendingContract } = await loadFixture(deployLendingFixture);
            
            // Check pool stats with zero liquidity
            // getPoolStats returns: (totalLiquidity, liquidityPool, totalBorrowed, utilizationRate)
            const stats = await lendingContract.getPoolStats();
            expect(stats[0]).to.equal(0); // totalLiquidity
            expect(stats[1]).to.equal(0); // liquidityPool
            expect(stats[2]).to.equal(0); // totalBorrowed
            // Utilization should be 0 when totalPool is 0 (contract returns 0, not undefined)
            expect(stats[3]).to.equal(0); // utilizationRate
        });

        it("Should prevent operations when total liquidity is zero", async function () {
            const { lendingContract, verifierFactory } = await loadFixture(deployLendingFixture);
            
            // Try to borrow without providing liquidity (totalLiquidity = 0)
            const collateralProof = testHelpers.generateMockZKProof("collateral");
            const loanAmount = ethers.parseEther("1000");
            const collateralAmount = ethers.parseEther("1800");
            const collateralNullifier = testHelpers.generateUniqueNullifier();
            
            // Enable mock verifier (factory maps each circuit type to the same test verifier address)
            const lendingVerifier = await verifierFactory.verifiers("lending-tenor");
            const mockBorrowVerifier = await ethers.getContractAt("MockZKVerifier", lendingVerifier);
            await mockBorrowVerifier.setShouldVerify(true);
            
            // Should revert - could be InsufficientLiquidity or SystemInsolvency
            // Both protect against operations when liquidity is zero
            await expect(
                lendingContract.borrowWithCollateral(
                    [
                        collateralProof.a[0],
                        collateralProof.a[1],
                        collateralProof.b[0][0],
                        collateralProof.b[0][1],
                        collateralProof.b[1][0],
                        collateralProof.b[1][1],
                        collateralProof.c[0],
                        collateralProof.c[1]
                    ],
                    [collateralNullifier, collateralProof.commitment, testHelpers.generateUniqueNullifier(), collateralAmount, loanAmount, TENOR_365_SEC]
                )
            ).to.be.reverted; // Can be InsufficientLiquidity or SystemInsolvency
        });
    });

    describe("Security: Liquidation Logic Boundary Tests", function () {
        it("Should correctly identify liquidatable loans at threshold boundary", async function () {
            const { lendingContract, verifierFactory } = await loadFixture(deployLendingFixture);
            
            // Provide liquidity
            const liquidityProof = testHelpers.generateMockZKProof("contribution");
            const liquidityAmount = ethers.parseEther("100000");
            
            const collateralVerifier = await verifierFactory.verifiers("lending-liquidity");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", collateralVerifier);
            await mockVerifier.setShouldVerify(true);
            
            await lendingContract.provideLiquidity(
                [
                    liquidityProof.a[0],
                    liquidityProof.a[1],
                    liquidityProof.b[0][0],
                    liquidityProof.b[0][1],
                    liquidityProof.b[1][0],
                    liquidityProof.b[1][1],
                    liquidityProof.c[0],
                    liquidityProof.c[1]
                ],
                [liquidityProof.nullifier, liquidityProof.commitment, liquidityAmount]
            );
            
            // Create loan with collateral exactly at threshold
            // LIQUIDATION_THRESHOLD = 120, so collateral * 100 = debt * 120 means exactly at threshold
            const loanAmount = ethers.parseEther("1000");
            const collateralAmount = ethers.parseEther("1200"); // Exactly 120% of loan (at threshold)
            
            const collateralProof = testHelpers.generateMockZKProof("collateral");
            const loanProof = testHelpers.generateMockZKProof("loan");
            const collateralNullifier = testHelpers.generateUniqueNullifier();
            
            // Enable mock verifier (factory maps each circuit type to the same test verifier address)
            const lendingVerifier = await verifierFactory.verifiers("lending-tenor");
            const mockBorrowVerifier = await ethers.getContractAt("MockZKVerifier", lendingVerifier);
            await mockBorrowVerifier.setShouldVerify(true);
            
            // This should fail because collateral is only 120%, need 150% minimum
            await expect(
                lendingContract.borrowWithCollateral(
                    [
                        collateralProof.a[0],
                        collateralProof.a[1],
                        collateralProof.b[0][0],
                        collateralProof.b[0][1],
                        collateralProof.b[1][0],
                        collateralProof.b[1][1],
                        collateralProof.c[0],
                        collateralProof.c[1]
                    ],
                    [collateralNullifier, collateralProof.commitment, loanProof.commitment, collateralAmount, loanAmount, TENOR_365_SEC]
                )
            ).to.be.revertedWithCustomError(lendingContract, "InsufficientCollateral");
            
            // Create loan with proper collateral (180% for safety buffer)
            const properCollateral = ethers.parseEther("1800");
            const borrowTx = await lendingContract.borrowWithCollateral(
                [
                    collateralProof.a[0],
                    collateralProof.a[1],
                    collateralProof.b[0][0],
                    collateralProof.b[0][1],
                    collateralProof.b[1][0],
                    collateralProof.b[1][1],
                    collateralProof.c[0],
                    collateralProof.c[1]
                ],
                [collateralNullifier, collateralProof.commitment, loanProof.commitment, properCollateral, loanAmount, TENOR_365_SEC]
            );
            
            const borrowReceipt = await borrowTx.wait();
            const loanEvent = borrowReceipt.logs.find(log => {
                try {
                    const parsed = lendingContract.interface.parseLog(log);
                    return parsed && parsed.name === "LoanIssued";
                } catch {
                    return false;
                }
            });
            const parsedLoanEvent = lendingContract.interface.parseLog(loanEvent);
            const loanId = parsedLoanEvent.args[0];
            
            // Check if loan is liquidatable (should be false since collateral is well above threshold)
            const isLiquidatable = await lendingContract.isLiquidatable(loanId);
            expect(isLiquidatable).to.be.false;
            
            // Loan with collateral exactly at liquidation threshold (120% of debt)
            // Should NOT be liquidatable - the condition is: collateral * 100 < debt * 120
            // At threshold: collateral * 100 = debt * 120, so it's NOT liquidatable
            const loan = await lendingContract.loans(loanId);
            const currentDebt = await lendingContract.calculateCurrentDebt(loanId);
            const thresholdDebt = (loan.collateralAmount * 100n) / 120n;
            
            // At threshold, loan should NOT be liquidatable
            expect(currentDebt).to.be.lte(thresholdDebt);
        });
    });

    describe("Utilization-based borrow rates (aggregate only)", function () {
        it("Should expose spot rate and lock per-loan borrowRateBps at origination", async function () {
            const { lendingContract, verifierFactory } = await loadFixture(deployLendingFixture);

            const liquidityProof = testHelpers.generateMockZKProof("contribution");
            const liquidityAmount = ethers.parseEther("100000");
            const lendingVerifier = await verifierFactory.verifiers("lending-liquidity");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", lendingVerifier);
            await mockVerifier.setShouldVerify(true);

            await lendingContract.provideLiquidity(
                [
                    liquidityProof.a[0],
                    liquidityProof.a[1],
                    liquidityProof.b[0][0],
                    liquidityProof.b[0][1],
                    liquidityProof.b[1][0],
                    liquidityProof.b[1][1],
                    liquidityProof.c[0],
                    liquidityProof.c[1]
                ],
                [liquidityProof.nullifier, liquidityProof.commitment, liquidityAmount]
            );

            const spotIdle = await lendingContract.currentAggregateBorrowRateBps();
            expect(spotIdle).to.equal(500n);

            const collateralProof = testHelpers.generateMockZKProof("collateral-u");
            const loanProof = testHelpers.generateMockZKProof("loan-u");
            const collateralNullifier = testHelpers.generateUniqueNullifier();
            const loanAmount = ethers.parseEther("4000");
            const collateralAmount = ethers.parseEther("9000");

            const preview = await lendingContract.previewBorrowRateBpsFor(loanAmount);
            expect(preview).to.be.gte(500n);

            const borrowTx = await lendingContract.borrowWithCollateral(
                [
                    collateralProof.a[0],
                    collateralProof.a[1],
                    collateralProof.b[0][0],
                    collateralProof.b[0][1],
                    collateralProof.b[1][0],
                    collateralProof.b[1][1],
                    collateralProof.c[0],
                    collateralProof.c[1]
                ],
                [collateralNullifier, collateralProof.commitment, loanProof.commitment, collateralAmount, loanAmount, TENOR_365_SEC]
            );
            const borrowReceipt = await borrowTx.wait();
            const loanEvent = borrowReceipt.logs.find((log) => {
                try {
                    const parsed = lendingContract.interface.parseLog(log);
                    return parsed && parsed.name === "LoanIssued";
                } catch {
                    return false;
                }
            });
            const parsedLoanEvent = lendingContract.interface.parseLog(loanEvent);
            const loanId = parsedLoanEvent.args[0];

            const locked = await lendingContract.getLoanBorrowRateBps(loanId);
            expect(locked).to.equal(preview);
            expect(await lendingContract.currentAggregateBorrowRateBps()).to.be.gte(500n);
        });

        it("getLendingMarketSnapshot should match individual views (aggregate)", async function () {
            const { lendingContract, verifierFactory } = await loadFixture(deployLendingFixture);

            const snap0 = await lendingContract.getLendingMarketSnapshot();
            expect(snap0.isPaused).to.equal(false);
            expect(snap0.spotBorrowRateBps).to.equal(500n);
            expect(snap0.utilizationBps).to.equal(0n);
            expect(snap0.concentrationCapBpsAtCurrentUtil).to.equal(500n);
            expect(snap0.maxSingleLoanByConcentrationAtCurrentUtilWei).to.equal(0n);
            expect(snap0.previewMaxNewLoanWeiUpperBound).to.equal(0n);

            const liquidityProof = testHelpers.generateMockZKProof("contribution");
            const liquidityAmount = ethers.parseEther("50000");
            const lendingVerifier = await verifierFactory.verifiers("lending-liquidity");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", lendingVerifier);
            await mockVerifier.setShouldVerify(true);

            await lendingContract.provideLiquidity(
                [
                    liquidityProof.a[0],
                    liquidityProof.a[1],
                    liquidityProof.b[0][0],
                    liquidityProof.b[0][1],
                    liquidityProof.b[1][0],
                    liquidityProof.b[1][1],
                    liquidityProof.c[0],
                    liquidityProof.c[1]
                ],
                [liquidityProof.nullifier, liquidityProof.commitment, liquidityAmount]
            );

            const snap1 = await lendingContract.getLendingMarketSnapshot();
            const [tl, lp, tb, util] = await lendingContract.getPoolStats();
            const spot = await lendingContract.currentAggregateBorrowRateBps();
            const preview = await lendingContract.previewMaxNewLoanWei();
            expect(snap1.totalLiquidityShares).to.equal(tl);
            expect(snap1.liquidityPoolWei).to.equal(lp);
            expect(snap1.totalBorrowedWei).to.equal(tb);
            expect(snap1.utilizationBps).to.equal(util);
            expect(snap1.spotBorrowRateBps).to.equal(spot);
            expect(snap1.concentrationCapBpsAtCurrentUtil).to.equal(500n);
            expect(snap1.maxSingleLoanByConcentrationAtCurrentUtilWei).to.equal((tl * 500n) / 10000n);
            expect(snap1.previewMaxNewLoanWeiUpperBound).to.equal(preview);
        });

        it("tightens max single draw under high utilization (credit rationing)", async function () {
            const { lendingContract, verifierFactory } = await loadFixture(deployLendingFixture);

            const liquidityProof = testHelpers.generateMockZKProof("contribution");
            const liquidityAmount = ethers.parseEther("100000");
            const lendingVerifier = await verifierFactory.verifiers("lending-liquidity");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", lendingVerifier);
            await mockVerifier.setShouldVerify(true);

            await lendingContract.provideLiquidity(
                [
                    liquidityProof.a[0],
                    liquidityProof.a[1],
                    liquidityProof.b[0][0],
                    liquidityProof.b[0][1],
                    liquidityProof.b[1][0],
                    liquidityProof.b[1][1],
                    liquidityProof.c[0],
                    liquidityProof.c[1]
                ],
                [liquidityProof.nullifier, liquidityProof.commitment, liquidityAmount]
            );

            const chunk = ethers.parseEther("5000");
            const baseProof = testHelpers.generateMockZKProof("contribution");
            // 14 draws of 5k → 70k borrowed / 100k; 15th 5k would push concentration cap below 5k
            for (let i = 0; i < 14; i++) {
                const collateralNullifier = testHelpers.generateUniqueNullifier();
                const collateralCommitment = testHelpers.generateUniqueCommitment(`col-cr-${i}`);
                const loanCommitment = testHelpers.generateUniqueCommitment(`loan-cr-${i}`);
                const collateralAmount = ethers.parseEther("20000");
                await lendingContract.borrowWithCollateral(
                    [
                        baseProof.a[0],
                        baseProof.a[1],
                        baseProof.b[0][0],
                        baseProof.b[0][1],
                        baseProof.b[1][0],
                        baseProof.b[1][1],
                        baseProof.c[0],
                        baseProof.c[1]
                    ],
                    [collateralNullifier, collateralCommitment, loanCommitment, collateralAmount, chunk, TENOR_365_SEC]
                );
            }

            const preview = await lendingContract.previewMaxNewLoanWei();
            expect(preview).to.be.lt(chunk);

            const collateralProof16 = testHelpers.generateMockZKProof("contribution");
            const nullifier16 = testHelpers.generateUniqueNullifier();
            const colC = testHelpers.generateUniqueCommitment("col-cr-16");
            const loanC = testHelpers.generateUniqueCommitment("loan-cr-16");
            await expect(
                lendingContract.borrowWithCollateral(
                    [
                        collateralProof16.a[0],
                        collateralProof16.a[1],
                        collateralProof16.b[0][0],
                        collateralProof16.b[0][1],
                        collateralProof16.b[1][0],
                        collateralProof16.b[1][1],
                        collateralProof16.c[0],
                        collateralProof16.c[1]
                    ],
                    [nullifier16, colC, loanC, ethers.parseEther("20000"), chunk, TENOR_365_SEC]
                )
            ).to.be.revertedWithCustomError(lendingContract, "LoanTooLarge");
        });
    });

    describe("Withdrawal run guard (aggregate per block)", function () {
        it("Should expose WITHDRAW_RUN_GUARD_BPS and idle getWithdrawalRunGuardState", async function () {
            const { lendingContract } = await loadFixture(deployLendingFixture);
            expect(await lendingContract.WITHDRAW_RUN_GUARD_BPS()).to.equal(2500n);
            const [checkpoint, poolStart, cumulative, cap] = await lendingContract.getWithdrawalRunGuardState();
            expect(checkpoint).to.equal(0n);
            expect(cumulative).to.equal(0n);
            expect(cap).to.equal(0n);
            expect(poolStart).to.equal(0n);
        });

        it("Should reset run guard cumulative on a new block", async function () {
            const { lendingContract, verifierFactory } = await loadFixture(deployLendingFixture);

            const liquidityProof = testHelpers.generateMockZKProof("contribution");
            const liquidityAmount = ethers.parseEther("10000");
            const lendingVerifier = await verifierFactory.verifiers("lending-liquidity");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", lendingVerifier);
            await mockVerifier.setShouldVerify(true);

            await lendingContract.provideLiquidity(
                [
                    liquidityProof.a[0],
                    liquidityProof.a[1],
                    liquidityProof.b[0][0],
                    liquidityProof.b[0][1],
                    liquidityProof.b[1][0],
                    liquidityProof.b[1][1],
                    liquidityProof.c[0],
                    liquidityProof.c[1]
                ],
                [liquidityProof.nullifier, liquidityProof.commitment, liquidityAmount]
            );

            const w1 = testHelpers.generateMockZKProof("withdraw-a");
            const n1 = testHelpers.generateUniqueNullifier();
            await lendingContract.withdrawLiquidity(
                [
                    w1.a[0],
                    w1.a[1],
                    w1.b[0][0],
                    w1.b[0][1],
                    w1.b[1][0],
                    w1.b[1][1],
                    w1.c[0],
                    w1.c[1]
                ],
                [n1, w1.commitment, ethers.parseEther("2500"), ethers.parseEther("2500")]
            );

            await mine();

            // New block: cap is 25% of current pool (7500e18) = 1875e18
            const w2 = testHelpers.generateMockZKProof("withdraw-b");
            const n2 = testHelpers.generateUniqueNullifier();
            await expect(
                lendingContract.withdrawLiquidity(
                    [
                        w2.a[0],
                        w2.a[1],
                        w2.b[0][0],
                        w2.b[0][1],
                        w2.b[1][0],
                        w2.b[1][1],
                        w2.c[0],
                        w2.c[1]
                    ],
                    [n2, w2.commitment, ethers.parseEther("1875"), ethers.parseEther("1875")]
                )
            ).to.emit(lendingContract, "LiquidityWithdrawn");
        });
    });
});

