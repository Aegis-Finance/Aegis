const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

const describeLiquidity = process.env.RUN_LIQUIDITY_SUITE === "0" ? describe.skip : describe;

describeLiquidity("AutomatedBondingCurve", function () {
    // Test constants
    const BASE_PRICE = ethers.parseEther("0.5"); // $0.50
    const PRICE_MULTIPLIER = ethers.parseUnits("1", 12); // 1e12
    const MAX_SUPPLY = ethers.parseEther("5000000"); // 5M tokens
    const INITIAL_TOKEN_SUPPLY = ethers.parseEther("10000000"); // 10M tokens

    async function deployBondingCurveFixture() {
        const [owner, user1, user2, user3, treasury] = await ethers.getSigners();

        // Deploy mock AGS token
        const MockERC20 = await ethers.getContractFactory("contracts/test/TokenDistributionMocks.sol:MockERC20");
        const agsToken = await MockERC20.deploy("Aegis Token", "AGS", INITIAL_TOKEN_SUPPLY);

        // Deploy mock verifier factory
        const MockVerifierFactory = await ethers.getContractFactory("MockVerifierFactory");
        const verifierFactory = await MockVerifierFactory.deploy();

        // Deploy mock Dutch auction
        const MockDutchAuction = await ethers.getContractFactory("MockDutchAuction");
        const dutchAuction = await MockDutchAuction.deploy();
        
        // Set Dutch auction as completed to activate bonding curve
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

        // Explicitly activate the bonding curve
        await bondingCurve.activate();

        return {
            bondingCurve,
            agsToken,
            verifierFactory,
            dutchAuction,
            owner,
            user1,
            user2,
            user3,
            treasury
        };
    }

    async function deployInactiveBondingCurveFixture() {
        const [owner, user1, user2, user3, treasury] = await ethers.getSigners();

        // Deploy mock AGS token
        const MockERC20 = await ethers.getContractFactory("contracts/test/TokenDistributionMocks.sol:MockERC20");
        const agsToken = await MockERC20.deploy("Aegis Token", "AGS", INITIAL_TOKEN_SUPPLY);

        // Deploy mock verifier factory
        const MockVerifierFactory = await ethers.getContractFactory("MockVerifierFactory");
        const verifierFactory = await MockVerifierFactory.deploy();

        // Deploy mock Dutch auction
        const MockDutchAuction = await ethers.getContractFactory("MockDutchAuction");
        const dutchAuction = await MockDutchAuction.deploy();
        
        // Set Dutch auction as completed to allow activation
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

        // DO NOT activate the bonding curve - leave it inactive for activation tests

        return {
            bondingCurve,
            agsToken,
            verifierFactory,
            dutchAuction,
            owner,
            user1,
            user2,
            user3,
            treasury
        };
    }

    describe("Deployment", function () {
        it("Should deploy with correct parameters", async function () {
            const { bondingCurve, agsToken, dutchAuction } = await loadFixture(deployInactiveBondingCurveFixture);

            expect(await bondingCurve.agsToken()).to.equal(await agsToken.getAddress());
            expect(await bondingCurve.dutchAuction()).to.equal(await dutchAuction.getAddress());
            expect(await bondingCurve.basePrice()).to.equal(BASE_PRICE);
            expect(await bondingCurve.priceMultiplier()).to.equal(PRICE_MULTIPLIER);
            expect(await bondingCurve.maxSupply()).to.equal(MAX_SUPPLY);
            expect(await bondingCurve.totalSold()).to.equal(0);
            expect(await bondingCurve.isActive()).to.equal(false);
        });

        it("exposes CURVE_FAMILY_ID = 1 (supply-quadratic family)", async function () {
            const { bondingCurve } = await loadFixture(deployInactiveBondingCurveFixture);
            expect(await bondingCurve.CURVE_FAMILY_ID()).to.equal(1);
        });

        it("Should revert with invalid parameters", async function () {
            const [owner] = await ethers.getSigners();
            const MockERC20 = await ethers.getContractFactory("contracts/test/TokenDistributionMocks.sol:MockERC20");
            const agsToken = await MockERC20.deploy("Aegis Token", "AGS", INITIAL_TOKEN_SUPPLY);
            const MockVerifierFactory = await ethers.getContractFactory("MockVerifierFactory");
            const verifierFactory = await MockVerifierFactory.deploy();
            const MockDutchAuction = await ethers.getContractFactory("MockDutchAuction");
            const dutchAuction = await MockDutchAuction.deploy();
            const AutomatedBondingCurve = await ethers.getContractFactory("AutomatedBondingCurve");

            // Invalid token address
            await expect(
                AutomatedBondingCurve.deploy(
                    ethers.ZeroAddress,
                    await verifierFactory.getAddress(),
                    await dutchAuction.getAddress(),
                    BASE_PRICE,
                    PRICE_MULTIPLIER,
                    MAX_SUPPLY
                )
            ).to.be.revertedWith("Invalid token address");

            // Invalid verifier factory address
            await expect(
                AutomatedBondingCurve.deploy(
                    await agsToken.getAddress(),
                    ethers.ZeroAddress,
                    await dutchAuction.getAddress(),
                    BASE_PRICE,
                    PRICE_MULTIPLIER,
                    MAX_SUPPLY
                )
            ).to.be.revertedWith("Invalid verifier factory address");

            // Invalid auction address
            await expect(
                AutomatedBondingCurve.deploy(
                    await agsToken.getAddress(),
                    await verifierFactory.getAddress(),
                    ethers.ZeroAddress,
                    BASE_PRICE,
                    PRICE_MULTIPLIER,
                    MAX_SUPPLY
                )
            ).to.be.revertedWith("Invalid auction address");

            // Invalid base price
            await expect(
                AutomatedBondingCurve.deploy(
                    await agsToken.getAddress(),
                    await verifierFactory.getAddress(),
                    await dutchAuction.getAddress(),
                    0,
                    PRICE_MULTIPLIER,
                    MAX_SUPPLY
                )
            ).to.be.revertedWith("Base price must be > 0");

            // Invalid price multiplier
            await expect(
                AutomatedBondingCurve.deploy(
                    await agsToken.getAddress(),
                    await verifierFactory.getAddress(),
                    await dutchAuction.getAddress(),
                    BASE_PRICE,
                    0,
                    MAX_SUPPLY
                )
            ).to.be.revertedWith("Price multiplier must be > 0");

            // Invalid max supply
            await expect(
                AutomatedBondingCurve.deploy(
                    await agsToken.getAddress(),
                    await verifierFactory.getAddress(),
                    await dutchAuction.getAddress(),
                    BASE_PRICE,
                    PRICE_MULTIPLIER,
                    0
                )
            ).to.be.revertedWith("Max supply must be > 0");
        });
    });

    describe("Executed price impact coverage", function () {
        it("Includes executed price deviation on purchase", async function () {
            const { bondingCurve, dutchAuction, agsToken, user1 } = await loadFixture(deployBondingCurveFixture);
            await dutchAuction.setSaleCompleted(true);
            await bondingCurve.activate();

            const spend = ethers.parseEther("2");
            const balBefore = await agsToken.balanceOf(user1.address);
            await bondingCurve.connect(user1).purchaseTokens(0, { value: spend });
            const balAfter = await agsToken.balanceOf(user1.address);
            expect(balAfter).to.be.gt(balBefore);
        });

        it("Includes executed price deviation on sell", async function () {
            const { bondingCurve, dutchAuction, agsToken, user1 } = await loadFixture(deployBondingCurveFixture);
            await dutchAuction.setSaleCompleted(true);
            await bondingCurve.activate();

            await bondingCurve.connect(user1).purchaseTokens(0, { value: ethers.parseEther("2") });
            const bal = await agsToken.balanceOf(user1.address);
            const sellAmt = bal / 2n;
            await agsToken.connect(user1).approve(await bondingCurve.getAddress(), sellAmt);
            await expect(bondingCurve.connect(user1).sellTokens(sellAmt, 0)).to.emit(bondingCurve, "TokensSold");
        });
    });

    describe("Price Calculation", function () {
        it("Should return base price when no tokens sold", async function () {
            const { bondingCurve } = await loadFixture(deployBondingCurveFixture);
            expect(await bondingCurve.getCurrentPrice()).to.equal(BASE_PRICE);
        });

        it("Should calculate price correctly with quadratic curve", async function () {
            const { bondingCurve, dutchAuction, user1 } = await loadFixture(deployBondingCurveFixture);
            
            // Activate the curve
            await dutchAuction.setSaleCompleted(true);
            await bondingCurve.activate();

            // Actually purchase tokens to simulate tokens sold
            const ethAmount = ethers.parseEther("10"); // Purchase with 10 ETH
            await bondingCurve.connect(user1).purchaseTokens(0, { value: ethAmount });
            
            const tokensSold = await bondingCurve.totalSold();
            const currentPrice = await bondingCurve.getCurrentPrice();
            
            // Verify price increased from base price
            expect(currentPrice).to.be.greaterThan(BASE_PRICE);
            expect(tokensSold).to.be.greaterThan(0);
        });

        it("Should calculate sell price with 5% spread", async function () {
            const { bondingCurve, dutchAuction, user1 } = await loadFixture(deployBondingCurveFixture);
            
            // Activate the curve
            await dutchAuction.setSaleCompleted(true);
            await bondingCurve.activate();

            // Actually purchase tokens to have tokens sold
            const ethAmount = ethers.parseEther("5");
            await bondingCurve.connect(user1).purchaseTokens(0, { value: ethAmount });

            const sellPrice = await bondingCurve.getSellPrice();
            const buyPrice = await bondingCurve.getCurrentPrice();
            
            // Sell price should be less than buy price
            expect(sellPrice).to.be.lessThan(buyPrice);
            expect(sellPrice).to.be.greaterThan(0);
        });

        it("Should return 0 sell price when no tokens sold", async function () {
            const { bondingCurve } = await loadFixture(deployBondingCurveFixture);
            expect(await bondingCurve.getSellPrice()).to.equal(0);
        });
    });

    describe("Token Calculations", function () {
        it("Should calculate tokens for ETH correctly", async function () {
            const { bondingCurve } = await loadFixture(deployBondingCurveFixture);
            
            const ethAmount = ethers.parseEther("1"); // 1 ETH
            const expectedTokens = ethAmount * ethers.parseEther("1") / BASE_PRICE;
            
            expect(await bondingCurve.getTokensForEth(ethAmount)).to.equal(expectedTokens);
        });

        it("Should calculate ETH for tokens correctly", async function () {
            const { bondingCurve, dutchAuction, user1 } = await loadFixture(deployBondingCurveFixture);
            
            // Activate the curve
            await dutchAuction.setSaleCompleted(true);
            await bondingCurve.activate();

            // Actually purchase tokens to have tokens sold and get a sell price
            const ethAmount = ethers.parseEther("5");
            await bondingCurve.connect(user1).purchaseTokens(0, { value: ethAmount });

            const tokenAmount = ethers.parseEther("100"); // 100 tokens
            const sellPrice = await bondingCurve.getSellPrice();
            const expectedEth = tokenAmount * sellPrice / ethers.parseEther("1");
            
            expect(await bondingCurve.getEthForTokens(tokenAmount)).to.equal(expectedEth);
        });
    });

    describe("Activation", function () {
        it("Should activate when Dutch auction is completed", async function () {
            const { bondingCurve, dutchAuction } = await loadFixture(deployInactiveBondingCurveFixture);
            
            expect(await bondingCurve.isActive()).to.equal(false);
            
            // Complete the Dutch auction
            await dutchAuction.setSaleCompleted(true);
            
            // Activate the bonding curve
            await bondingCurve.activate();
            
            expect(await bondingCurve.isActive()).to.equal(true);
        });

        it("Should not activate when Dutch auction is not completed", async function () {
            const { bondingCurve, dutchAuction } = await loadFixture(deployInactiveBondingCurveFixture);
            
            // Ensure auction is not completed
            await dutchAuction.setSaleCompleted(false);
            
            // Try to activate
            await bondingCurve.activate();
            
            expect(await bondingCurve.isActive()).to.equal(false);
        });

        it("Should emit CurveActivated event", async function () {
            const { bondingCurve, dutchAuction } = await loadFixture(deployInactiveBondingCurveFixture);
            
            await dutchAuction.setSaleCompleted(true);
            
            await expect(bondingCurve.activate())
                .to.emit(bondingCurve, "CurveActivated")
                .withArgs(anyValue, BASE_PRICE);
        });
    });

    describe("Token Purchase", function () {
        it("Should purchase tokens successfully", async function () {
            const { bondingCurve, agsToken, dutchAuction, user1 } = await loadFixture(deployBondingCurveFixture);
            
            const ethAmount = ethers.parseEther("1");
            const initialBalance = await agsToken.balanceOf(user1.address);
            const expectedTokens = await bondingCurve.getTokensForEth(ethAmount);
            
            await expect(
                bondingCurve.connect(user1).purchaseTokens(0, { value: ethAmount })
            ).to.emit(bondingCurve, "TokensPurchased")
            .withArgs(user1.address, expectedTokens, await bondingCurve.getCurrentPrice(), ethAmount);
            
            const finalBalance = await agsToken.balanceOf(user1.address);
            expect(finalBalance - initialBalance).to.equal(expectedTokens);
        });

        it("Should update price after purchase", async function () {
            const { bondingCurve, user1 } = await loadFixture(deployBondingCurveFixture);
            
            const initialPrice = await bondingCurve.getCurrentPrice();
            const ethAmount = ethers.parseEther("1");
            
            await bondingCurve.connect(user1).purchaseTokens(0, { value: ethAmount });
            
            const finalPrice = await bondingCurve.getCurrentPrice();
            expect(finalPrice).to.be.greaterThan(initialPrice);
        });

        it("Should track total sold correctly", async function () {
            const { bondingCurve, user1, user2 } = await loadFixture(deployBondingCurveFixture);
            
            const ethAmount1 = ethers.parseEther("1");
            const ethAmount2 = ethers.parseEther("2");
            
            const expectedTokens1 = await bondingCurve.getTokensForEth(ethAmount1);
            await bondingCurve.connect(user1).purchaseTokens(0, { value: ethAmount1 });
            
            const expectedTokens2 = await bondingCurve.getTokensForEth(ethAmount2);
            await bondingCurve.connect(user2).purchaseTokens(0, { value: ethAmount2 });
            
            const totalSold = await bondingCurve.totalSold();
            expect(totalSold).to.equal(expectedTokens1 + expectedTokens2);
        });

        it("Should emit CurveActivated event on first purchase", async function () {
            const { bondingCurve, user1 } = await loadFixture(deployInactiveBondingCurveFixture);
            
            const ethAmount = ethers.parseEther("1");
            
            await expect(
                bondingCurve.connect(user1).purchaseTokens(0, { value: ethAmount })
            ).to.emit(bondingCurve, "CurveActivated");
        });

        it("Should allow manual activation", async function () {
            const { bondingCurve } = await loadFixture(deployInactiveBondingCurveFixture);
            
            await expect(bondingCurve.activate())
                .to.emit(bondingCurve, "CurveActivated");
        });

        it("Should return correct curve info", async function () {
            const { bondingCurve, user1 } = await loadFixture(deployBondingCurveFixture);
            
            const ethAmount = ethers.parseEther("1");
            await bondingCurve.connect(user1).purchaseTokens(0, { value: ethAmount });
            
            const [currentPrice, sellPrice, totalTokensSold, remainingSupply, active] = await bondingCurve.getCurveInfo();
            expect(active).to.equal(true);
            expect(totalTokensSold).to.be.greaterThan(0);
            expect(currentPrice).to.be.greaterThan(0);
        });

        it("Should revert when no ETH sent", async function () {
            const { bondingCurve, user1 } = await loadFixture(deployBondingCurveFixture);
            
            await expect(
                bondingCurve.connect(user1).purchaseTokens(0, { value: 0 })
            ).to.be.revertedWith("Below minimum purchase amount");
        });

        it("Should revert when exceeding max supply", async function () {
            // Deploy a bonding curve with a very small max supply for this test
            const [owner, user1, user2, user3, treasury] = await ethers.getSigners();

            // Deploy mock AGS token
            const MockERC20 = await ethers.getContractFactory("contracts/test/TokenDistributionMocks.sol:MockERC20");
            const agsToken = await MockERC20.deploy("Aegis Token", "AGS", INITIAL_TOKEN_SUPPLY);

            // Deploy mock verifier factory
            const MockVerifierFactory = await ethers.getContractFactory("MockVerifierFactory");
            const verifierFactory = await MockVerifierFactory.deploy();

            // Deploy mock Dutch auction
            const MockDutchAuction = await ethers.getContractFactory("MockDutchAuction");
            const dutchAuction = await MockDutchAuction.deploy();
            
            // Set Dutch auction as completed to activate bonding curve
            await dutchAuction.setSaleCompleted(true);

            // Deploy bonding curve with very small max supply (10 tokens)
            const AutomatedBondingCurve = await ethers.getContractFactory("AutomatedBondingCurve");
            const smallMaxSupply = ethers.parseEther("10"); // Only 10 tokens
            const bondingCurve = await AutomatedBondingCurve.deploy(
                await agsToken.getAddress(),
                await verifierFactory.getAddress(),
                await dutchAuction.getAddress(),
                BASE_PRICE,
                PRICE_MULTIPLIER,
                smallMaxSupply
            );

            // Transfer tokens to bonding curve
            await agsToken.transfer(await bondingCurve.getAddress(), smallMaxSupply);
            
            // Try to purchase more than max supply with a large ETH amount
            // With base price of 0.5 ETH per token, 10 tokens = 5 ETH at minimum
            // But with quadratic curve, it will be much more expensive
            await expect(
                bondingCurve.connect(user1).purchaseTokens(0, { value: ethers.parseEther("100") })
            ).to.be.revertedWith("Exceeds max supply");
        });

        it("Should handle multiple purchases correctly", async function () {
            const { bondingCurve, agsToken, user1, user2 } = await loadFixture(deployBondingCurveFixture);
            
            const ethAmount1 = ethers.parseEther("1");
            const ethAmount2 = ethers.parseEther("0.5");
            
            // First purchase
            const expectedTokens1 = await bondingCurve.getTokensForEth(ethAmount1);
            await bondingCurve.connect(user1).purchaseTokens(0, { value: ethAmount1 });
            
            // Second purchase (price should be higher)
            const expectedTokens2 = await bondingCurve.getTokensForEth(ethAmount2);
            await bondingCurve.connect(user2).purchaseTokens(0, { value: ethAmount2 });
            
            expect(await agsToken.balanceOf(user1.address)).to.equal(expectedTokens1);
            expect(await agsToken.balanceOf(user2.address)).to.equal(expectedTokens2);
        });

        it("Should calculate correct sell price", async function () {
            const { bondingCurve, user1 } = await loadFixture(deployBondingCurveFixture);
            
            // Make a purchase first
            const ethAmount = ethers.parseEther("1");
            await bondingCurve.connect(user1).purchaseTokens(0, { value: ethAmount });
            
            const sellPrice = await bondingCurve.getSellPrice();
            const buyPrice = await bondingCurve.getCurrentPrice();
            
            // Sell price should be lower than buy price (spread)
            expect(sellPrice).to.be.lessThan(buyPrice);
        });

        it("Should calculate tokens for ETH correctly", async function () {
            const { bondingCurve, user1 } = await loadFixture(deployBondingCurveFixture);
            
            const ethAmount = ethers.parseEther("1");
            const expectedTokens = await bondingCurve.getTokensForEth(ethAmount);
            
            await bondingCurve.connect(user1).purchaseTokens(0, { value: ethAmount });
            
            const actualTokens = await bondingCurve.totalSold();
            expect(actualTokens).to.equal(expectedTokens);
        });

        it("Should calculate ETH for tokens correctly", async function () {
            const { bondingCurve, user1 } = await loadFixture(deployBondingCurveFixture);
            
            // Make a purchase first
            const ethAmount = ethers.parseEther("1");
            const tokenAmount = await bondingCurve.getTokensForEth(ethAmount);
            await bondingCurve.connect(user1).purchaseTokens(0, { value: ethAmount });
            
            const ethForTokens = await bondingCurve.getEthForTokens(tokenAmount);
            expect(ethForTokens).to.be.greaterThan(0);
        });
    });

    describe("Token Sale", function () {
        it("Should sell tokens successfully", async function () {
            const { bondingCurve, agsToken, dutchAuction, user1 } = await loadFixture(deployBondingCurveFixture);
            
            // Activate and purchase tokens first
            await dutchAuction.setSaleCompleted(true);
            await bondingCurve.activate();
            
            const ethAmount = ethers.parseEther("2");
            await bondingCurve.connect(user1).purchaseTokens(0, { value: ethAmount });
            
            const tokenBalance = await agsToken.balanceOf(user1.address);
            const sellAmount = tokenBalance / 2n; // Sell half
            
            // Approve tokens for sale
            await agsToken.connect(user1).approve(await bondingCurve.getAddress(), sellAmount);
            
            const initialEthBalance = await ethers.provider.getBalance(user1.address);
            const expectedEth = await bondingCurve.getEthForTokens(sellAmount);
            
            await expect(bondingCurve.connect(user1).sellTokens(sellAmount, 0))
                .to.emit(bondingCurve, "TokensSold");
            
            expect(await agsToken.balanceOf(user1.address)).to.equal(tokenBalance - sellAmount);
        });

        it("Should revert when selling more than total sold", async function () {
            const { bondingCurve, dutchAuction, user1 } = await loadFixture(deployBondingCurveFixture);
            
            await dutchAuction.setSaleCompleted(true);
            await bondingCurve.activate();
            
            await expect(
                bondingCurve.connect(user1).sellTokens(ethers.parseEther("1"), 0)
            ).to.be.revertedWith("Cannot sell more than total sold");
        });

        it("Should revert when user has insufficient balance", async function () {
            const { bondingCurve, agsToken, dutchAuction, user1, user2 } = await loadFixture(deployBondingCurveFixture);
            
            await dutchAuction.setSaleCompleted(true);
            await bondingCurve.activate();
            
            // User1 buys tokens
            await bondingCurve.connect(user1).purchaseTokens(0, { value: ethers.parseEther("1") });
            
            // User2 tries to sell tokens they don't have
            await expect(
                bondingCurve.connect(user2).sellTokens(ethers.parseEther("1"), 0)
            ).to.be.revertedWith("Insufficient balance");
        });

        it("Should revert when no tokens specified", async function () {
            const { bondingCurve, dutchAuction, user1 } = await loadFixture(deployBondingCurveFixture);
            
            await dutchAuction.setSaleCompleted(true);
            await bondingCurve.activate();
            
            await expect(
                bondingCurve.connect(user1).sellTokens(0, 0)
            ).to.be.revertedWith("Must specify token amount");
        });
    });

    describe("View Functions", function () {
        it("Should return correct curve info", async function () {
            const { bondingCurve, dutchAuction } = await loadFixture(deployInactiveBondingCurveFixture);
            
            await dutchAuction.setSaleCompleted(true);
            await bondingCurve.activate();
            
            const curveInfo = await bondingCurve.getCurveInfo();
            
            expect(curveInfo.currentPrice).to.equal(BASE_PRICE);
            expect(curveInfo.sellPrice).to.equal(0);
            expect(curveInfo.totalTokensSold).to.equal(0);
            expect(curveInfo.remainingSupply).to.equal(MAX_SUPPLY);
            expect(curveInfo.active).to.equal(true);
        });

        it("Should calculate price impact correctly", async function () {
            const { bondingCurve, dutchAuction } = await loadFixture(deployBondingCurveFixture);
            
            await dutchAuction.setSaleCompleted(true);
            await bondingCurve.activate();
            
            const ethAmount = ethers.parseEther("10");
            const priceImpact = await bondingCurve.calculatePriceImpact(ethAmount);
            
            expect(priceImpact).to.be.greaterThan(0);
        });
    });

    describe("Receive Function", function () {
        it("Should revert when ETH is sent directly (slippage required)", async function () {
            const { bondingCurve, agsToken, user1 } = await loadFixture(deployBondingCurveFixture);
            
            const ethAmount = ethers.parseEther("1");
            
            await expect(
                user1.sendTransaction({
                    to: await bondingCurve.getAddress(),
                    value: ethAmount
                })
            ).to.be.revertedWith("Use purchaseTokens() with slippage protection");
        });
    });

    describe("Edge Cases", function () {
        it("Should handle very small purchases", async function () {
            const { bondingCurve, dutchAuction, user1 } = await loadFixture(deployBondingCurveFixture);
            
            await dutchAuction.setSaleCompleted(true);
            await bondingCurve.activate();
            
            const smallAmount = ethers.parseEther("0.001"); // equal to MIN_PURCHASE_AMOUNT
            await bondingCurve.connect(user1).purchaseTokens(0, { value: smallAmount });
            
            expect(await bondingCurve.totalSold()).to.be.greaterThan(0);
        });

        it("Should handle price calculations with large purchases", async function () {
            const { bondingCurve, dutchAuction, user1 } = await loadFixture(deployBondingCurveFixture);
            
            await dutchAuction.setSaleCompleted(true);
            await bondingCurve.activate();
            
            // Make a large purchase to test price scaling
            const largeEthAmount = ethers.parseEther("100");
            await bondingCurve.connect(user1).purchaseTokens(0, { value: largeEthAmount });
            
            const price = await bondingCurve.getCurrentPrice();
            const totalSold = await bondingCurve.totalSold();
            
            expect(price).to.be.greaterThan(BASE_PRICE);
            expect(totalSold).to.be.greaterThan(0);
        });

        it("Should handle reentrancy protection", async function () {
            const { bondingCurve, agsToken, dutchAuction, owner } = await loadFixture(deployBondingCurveFixture);
            
            // Activate the bonding curve first
            await dutchAuction.setSaleCompleted(true);
            await bondingCurve.activate();
            
            // Deploy a malicious contract that tries to reenter
            const MaliciousContract = await ethers.getContractFactory("MaliciousReentrancy");
            const malicious = await MaliciousContract.deploy(
                await bondingCurve.getAddress(),
                await agsToken.getAddress()
            );
            
            // First, let the malicious contract purchase some tokens
            await malicious.startAttack({ value: ethers.parseEther("2") });
            
            // Verify it has tokens
            const tokenBalance = await agsToken.balanceOf(await malicious.getAddress());
            expect(tokenBalance).to.be.greaterThan(0);
            
            // Fund the malicious contract with ETH for gas
            await owner.sendTransaction({
                to: await malicious.getAddress(),
                value: ethers.parseEther("0.1")
            });
            
            // ETH payout triggers `receive()` which attempts a nested `sellTokens`; OZ `nonReentrant`
            // reverts the whole transaction with `ReentrancyGuardReentrantCall`.
            await expect(malicious.sellAndTriggerReentrancy()).to.be.revertedWithCustomError(
                bondingCurve,
                "ReentrancyGuardReentrantCall"
            );
        });
    });

    describe("Gas Optimization", function () {
        it("Should have reasonable gas costs for purchases", async function () {
            const { bondingCurve, dutchAuction, user1 } = await loadFixture(deployBondingCurveFixture);
            
            await dutchAuction.setSaleCompleted(true);
            await bondingCurve.activate();
            
            const tx = await bondingCurve.connect(user1).purchaseTokens(0, { value: ethers.parseEther("1") });
            const receipt = await tx.wait();
            
            // Gas should be reasonable (less than 200k)
            expect(receipt.gasUsed).to.be.lessThan(200000);
        });
    });

    describe("Security: Integer Underflow Tests", function () {
        it("Should revert when selling more tokens than totalSold", async function () {
            const { bondingCurve, agsToken, dutchAuction, user1 } = await loadFixture(deployBondingCurveFixture);
            
            await dutchAuction.setSaleCompleted(true);
            await bondingCurve.activate();
            
            // Purchase some tokens first
            const purchaseAmount = ethers.parseEther("1");
            await bondingCurve.connect(user1).purchaseTokens(0, { value: purchaseAmount });
            
            const totalSold = await bondingCurve.totalSold();
            
            // Try to sell more than totalSold - should revert
            const excessiveAmount = totalSold + ethers.parseEther("1");
            
            // Approve tokens first
            await agsToken.connect(user1).approve(await bondingCurve.getAddress(), excessiveAmount);
            
            // Should revert with "Cannot sell more than total sold"
            await expect(
                bondingCurve.connect(user1).sellTokens(excessiveAmount, 0)
            ).to.be.revertedWith("Cannot sell more than total sold");
        });

        it("Should handle selling exactly totalSold without underflow", async function () {
            const { bondingCurve, agsToken, dutchAuction, user1 } = await loadFixture(deployBondingCurveFixture);
            
            await dutchAuction.setSaleCompleted(true);
            await bondingCurve.activate();
            
            // Purchase some tokens
            const purchaseAmount = ethers.parseEther("1");
            await bondingCurve.connect(user1).purchaseTokens(0, { value: purchaseAmount });
            
            const totalSoldBefore = await bondingCurve.totalSold();
            
            // Approve and sell exactly all tokens
            await agsToken.connect(user1).approve(await bondingCurve.getAddress(), totalSoldBefore);
            await bondingCurve.connect(user1).sellTokens(totalSoldBefore, 0);
            
            // Verify totalSold is now 0 (no underflow)
            const totalSoldAfter = await bondingCurve.totalSold();
            expect(totalSoldAfter).to.equal(0);
        });

        it("Should prevent underflow in getSellPrice when totalSold < 1e18", async function () {
            const { bondingCurve, dutchAuction, user1 } = await loadFixture(deployBondingCurveFixture);
            
            await dutchAuction.setSaleCompleted(true);
            await bondingCurve.activate();
            
            // Purchase a small amount less than 1e18
            const smallPurchase = ethers.parseEther("0.1");
            await bondingCurve.connect(user1).purchaseTokens(0, { value: smallPurchase });
            
            const totalSold = await bondingCurve.totalSold();
            expect(totalSold).to.be.lessThan(ethers.parseEther("1"));
            
            // getSellPrice has been fixed: when totalSold < 1e18, it returns basePrice * 95 / 100
            // This prevents underflow and provides a reasonable sell price
            const sellPrice = await bondingCurve.getSellPrice();
            if (totalSold < ethers.parseEther("1")) {
                // When totalSold < 1e18, should return basePrice * 95 / 100 (5% spread at base)
                const expectedPrice = BASE_PRICE * 95n / 100n;
                expect(sellPrice).to.equal(expectedPrice);
            } else {
                expect(sellPrice).to.be.gte(0);
            }
        });
    });

    describe("Security: Division by Zero Tests", function () {
        it("Should handle getTokensForEth with zero price gracefully", async function () {
            const { bondingCurve } = await loadFixture(deployBondingCurveFixture);
            
            // When bonding curve is not active, getCurrentPrice returns basePrice (not zero)
            // But we should test that division never causes issues
            const currentPrice = await bondingCurve.getCurrentPrice();
            
            // Price should never be zero (basePrice is set to 0.5 ETH in constructor)
            expect(currentPrice).to.be.gt(0);
            
            // Try to calculate tokens for ETH - should work
            const ethAmount = ethers.parseEther("1");
            const tokens = await bondingCurve.getTokensForEth(ethAmount);
            expect(tokens).to.be.gt(0);
        });

        it("Should prevent division by zero in getEthForTokens when sellPrice is zero", async function () {
            const { bondingCurve, dutchAuction } = await loadFixture(deployBondingCurveFixture);
            
            // When totalSold is 0, getSellPrice returns 0
            // getEthForTokens uses sellPrice / 1e18, which should be 0 when sellPrice is 0
            await dutchAuction.setSaleCompleted(true);
            await bondingCurve.activate();
            
            // Before any purchases, totalSold is 0, so sellPrice should be 0
            const sellPrice = await bondingCurve.getSellPrice();
            expect(sellPrice).to.equal(0);
            
            // getEthForTokens should return 0 (not revert) when sellPrice is 0
            const tokenAmount = ethers.parseEther("1");
            const ethAmount = await bondingCurve.getEthForTokens(tokenAmount);
            expect(ethAmount).to.equal(0);
        });

        it("Should handle price calculation when totalSold is zero", async function () {
            const { bondingCurve, dutchAuction } = await loadFixture(deployBondingCurveFixture);
            
            await dutchAuction.setSaleCompleted(true);
            await bondingCurve.activate();
            
            // When totalSold is 0, getCurrentPrice should return basePrice
            const currentPrice = await bondingCurve.getCurrentPrice();
            expect(currentPrice).to.equal(BASE_PRICE);
            
            // getSellPrice should return 0 when totalSold is 0
            const sellPrice = await bondingCurve.getSellPrice();
            expect(sellPrice).to.equal(0);
        });
    });
});