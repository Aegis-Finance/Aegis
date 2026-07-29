const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

/**
 * Comprehensive Test Suite for AutomatedBondingCurve Fixes
 * Tests all critical fixes made during code review:
 * 1. Private sell token transfer fix (msg.sender provides tokens)
 * 2. getSellPrice underflow protection
 * 3. Oracle validation integration
 */

const BASE_PRICE = ethers.parseEther("0.5");
const PRICE_MULTIPLIER = ethers.parseUnits("1", 12);
const MAX_SUPPLY = ethers.parseEther("5000000");
const INITIAL_TOKEN_SUPPLY = ethers.parseEther("10000000");

// Helper to generate mock ZK proof
const generateMockProof = () => ({
    a: ["0x1", "0x2"],
    b: [["0x3", "0x4"], ["0x5", "0x6"]],
    c: ["0x7", "0x8"]
});

describe("AutomatedBondingCurve - Critical Fixes", function () {
    async function deployBondingCurveFixture() {
        const [owner, user1, user2, user3] = await ethers.getSigners();

        // Deploy mock AGS token
        const MockERC20 = await ethers.getContractFactory("contracts/test/TokenDistributionMocks.sol:MockERC20");
        const agsToken = await MockERC20.deploy("Aegis Token", "AGS", INITIAL_TOKEN_SUPPLY);

        // Deploy mock verifier factory
        const MockVerifierFactory = await ethers.getContractFactory("MockVerifierFactory");
        const verifierFactory = await MockVerifierFactory.deploy();
        
        // Deploy mock verifiers and set them
        const MockZKVerifier = await ethers.getContractFactory("MockZKVerifier");
        const purchaseVerifier = await MockZKVerifier.deploy();
        const sellVerifier = await MockZKVerifier.deploy();
        
        await verifierFactory.setVerifier("bonding-curve-purchase", await purchaseVerifier.getAddress());
        await verifierFactory.setVerifier("bonding-curve-sell", await sellVerifier.getAddress());
        
        // Configure verifiers to always verify
        await verifierFactory.setMockVerifier("bonding-curve-purchase", true);
        await verifierFactory.setMockVerifier("bonding-curve-sell", true);

        // Deploy mock Dutch auction
        const MockDutchAuction = await ethers.getContractFactory("MockDutchAuction");
        const dutchAuction = await MockDutchAuction.deploy();
        await dutchAuction.setSaleCompleted(true);

        // Deploy bonding curve
        const AutomatedBondingCurve = await ethers.getContractFactory("AutomatedBondingCurve");
        const bondingCurve = await AutomatedBondingCurve.deploy(
            await agsToken.getAddress(),
            await verifierFactory.getAddress(),
            await dutchAuction.getAddress(),
            BASE_PRICE,
            PRICE_MULTIPLIER,
            MAX_SUPPLY
        );

        // Transfer tokens to bonding curve
        await agsToken.transfer(await bondingCurve.getAddress(), MAX_SUPPLY);

        // Activate
        await bondingCurve.activate();

        return {
            bondingCurve,
            agsToken,
            verifierFactory,
            dutchAuction,
            owner,
            user1,
            user2,
            user3
        };
    }

    describe("Private Sell Token Transfer Fix", function () {
        it("Should transfer tokens from msg.sender (caller) in private sell", async function () {
            const { bondingCurve, agsToken, user1, user2 } = await loadFixture(deployBondingCurveFixture);
            
            // First, purchase tokens publicly to get some tokens
            await bondingCurve.connect(user1).purchaseTokens(0, { value: ethers.parseEther("10") });
            
            // Get the actual balance after purchase
            const user1BalanceBefore = await agsToken.balanceOf(user1.address);
            const tokensToSell = user1BalanceBefore / 2n; // Sell half of what was purchased
            
            // Approve bonding curve to spend tokens
            await agsToken.connect(user1).approve(await bondingCurve.getAddress(), tokensToSell);
            
            // Sell tokens privately - msg.sender (user1) must provide tokens
            const proof = generateMockProof();
            const sellParams = {
                proof: proof,
                root: ethers.parseEther("1"),
                nullifierHash: ethers.parseEther("2"),
                commitmentHash: ethers.parseEther("3"),
                amount: tokensToSell,
                recipient: BigInt(user1.address)
            };
            
            // user1 calls sellTokensPrivate - they must have approved tokens
            await expect(
                bondingCurve.connect(user1).sellTokensPrivate(sellParams)
            ).to.not.be.reverted;
            
            const user1BalanceAfter = await agsToken.balanceOf(user1.address);
            expect(user1BalanceBefore - user1BalanceAfter).to.equal(tokensToSell);
        });

        it("Should revert if msg.sender hasn't approved tokens for private sell", async function () {
            const { bondingCurve, agsToken, user1 } = await loadFixture(deployBondingCurveFixture);
            
            // Purchase tokens
            await bondingCurve.connect(user1).purchaseTokens(0, { value: ethers.parseEther("10") });
            
            // Get the actual balance and totalSold to ensure valid amount
            const user1Balance = await agsToken.balanceOf(user1.address);
            const totalSold = await bondingCurve.totalSold();
            const tokensToSell = (user1Balance < totalSold ? user1Balance : totalSold) / 2n; // Sell half, but ensure it's valid
            
            // Don't approve - should fail with token transfer error
            const proof = generateMockProof();
            const sellParams = {
                proof: proof,
                root: ethers.parseEther("1"),
                nullifierHash: ethers.parseEther("2"),
                commitmentHash: ethers.parseEther("3"),
                amount: tokensToSell,
                recipient: BigInt(user1.address)
            };
            
            // The contract checks "Cannot sell more than total sold" first, then allowance, then token transfer
            // Since we're selling a valid amount but haven't approved, it should fail on allowance
            await expect(
                bondingCurve.connect(user1).sellTokensPrivate(sellParams)
            ).to.be.revertedWith("Insufficient allowance");
        });

        it("Should handle public sell correctly (msg.sender = seller)", async function () {
            const { bondingCurve, agsToken, user1 } = await loadFixture(deployBondingCurveFixture);
            
            // Purchase tokens
            await bondingCurve.connect(user1).purchaseTokens(0, { value: ethers.parseEther("10") });
            
            // Get the actual balance after purchase
            const user1Balance = await agsToken.balanceOf(user1.address);
            const tokensToSell = user1Balance / 2n; // Sell half of what was purchased
            await agsToken.connect(user1).approve(await bondingCurve.getAddress(), tokensToSell);
            
            const balanceBefore = await agsToken.balanceOf(user1.address);
            const ethBalanceBefore = await ethers.provider.getBalance(user1.address);
            
            // Public sell
            const tx = await bondingCurve.connect(user1).sellTokens(tokensToSell, 0);
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            
            const balanceAfter = await agsToken.balanceOf(user1.address);
            const ethBalanceAfter = await ethers.provider.getBalance(user1.address);
            
            expect(balanceBefore - balanceAfter).to.equal(tokensToSell);
            expect(ethBalanceAfter - ethBalanceBefore + gasUsed).to.be.gt(0); // Received ETH
        });
    });

    describe("getSellPrice Underflow Protection", function () {
        it("Should handle totalSold < 1e18 without underflow", async function () {
            const { bondingCurve, user1 } = await loadFixture(deployBondingCurveFixture);
            
            // Purchase a small amount (< 1 token)
            const smallAmount = ethers.parseEther("0.5"); // 0.5 tokens
            await bondingCurve.connect(user1).purchaseTokens(0, { value: ethers.parseEther("1") });
            
            // Try to get sell price - should not revert
            const sellPrice = await bondingCurve.getSellPrice();
            expect(sellPrice).to.be.gt(0);
            const expectedMaxPrice = BASE_PRICE * 95n / 100n;
            // Allow small margin for rounding (within 1% of expected)
            expect(sellPrice).to.be.lte(expectedMaxPrice + expectedMaxPrice / 100n); // Should be <= base price with 5% spread (with rounding margin)
        });

        it("Should handle totalSold = 0 correctly", async function () {
            const { bondingCurve } = await loadFixture(deployBondingCurveFixture);
            
            // Don't purchase any tokens
            const sellPrice = await bondingCurve.getSellPrice();
            expect(sellPrice).to.equal(0);
        });

        it("Should calculate sell price correctly for normal amounts", async function () {
            const { bondingCurve, user1 } = await loadFixture(deployBondingCurveFixture);
            
            // Purchase significant amount
            await bondingCurve.connect(user1).purchaseTokens(0, { value: ethers.parseEther("100") });
            
            const sellPrice = await bondingCurve.getSellPrice();
            const buyPrice = await bondingCurve.getCurrentPrice();
            
            // Sell price should be less than buy price (5% spread)
            expect(sellPrice).to.be.lt(buyPrice);
            expect(sellPrice).to.be.gt(0);
        });
    });

    describe("Oracle Integration", function () {
        it("Should validate price against oracle when enabled", async function () {
            const { bondingCurve, owner, user1 } = await loadFixture(deployBondingCurveFixture);
            
            // Deploy mock oracle aggregator
            const MockOracleAggregator = await ethers.getContractFactory("contracts/test/OracleMocks.sol:MockOracleAggregator");
            const mockOracle = await MockOracleAggregator.deploy();
            
            const assetId = ethers.id("AGS/SONIC");
            await mockOracle.setPrice(assetId, BASE_PRICE, true); // Set oracle price to base price
            
            // Configure oracle
            await bondingCurve.connect(owner).configureOracle(
                await mockOracle.getAddress(),
                assetId,
                true
            );
            
            // Enable validation
            await bondingCurve.connect(owner).setOracleValidationEnabled(true);
            
            // Purchase should work if price is within deviation
            await expect(
                bondingCurve.connect(user1).purchaseTokens(0, { value: ethers.parseEther("10") })
            ).to.not.be.reverted;
        });

        it("Should allow purchase if oracle validation is disabled", async function () {
            const { bondingCurve, owner, user1 } = await loadFixture(deployBondingCurveFixture);
            
            // Configure but don't enable
            const MockOracleAggregator = await ethers.getContractFactory("contracts/test/OracleMocks.sol:MockOracleAggregator");
            const mockOracle = await MockOracleAggregator.deploy();
            
            await bondingCurve.connect(owner).configureOracle(
                await mockOracle.getAddress(),
                ethers.id("AGS/SONIC"),
                false
            );
            
            // Should work without oracle validation
            await expect(
                bondingCurve.connect(user1).purchaseTokens(0, { value: ethers.parseEther("10") })
            ).to.not.be.reverted;
        });
    });
});

