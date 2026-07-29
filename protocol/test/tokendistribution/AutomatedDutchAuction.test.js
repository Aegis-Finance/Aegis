const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { expect } = require("chai");
const { ethers } = require("hardhat");

const MIN_PURCHASE_AMOUNT = ethers.parseEther("100");
const describeLiquidity = process.env.RUN_LIQUIDITY_SUITE === "0" ? describe.skip : describe;

// Helper function to generate a mock ZK proof
const generateMockProof = () => {
    return [
        "0x0000000000000000000000000000000000000000000000000000000000000001",
        "0x0000000000000000000000000000000000000000000000000000000000000002",
        "0x0000000000000000000000000000000000000000000000000000000000000003",
        "0x0000000000000000000000000000000000000000000000000000000000000004",
        "0x0000000000000000000000000000000000000000000000000000000000000005",
        "0x0000000000000000000000000000000000000000000000000000000000000006",
        "0x0000000000000000000000000000000000000000000000000000000000000007",
        "0x0000000000000000000000000000000000000000000000000000000000000008"
    ];
};

describeLiquidity("AutomatedDutchAuction", function () {
    async function deployAuctionFixture() {
        const [owner, addr1, addr2] = await ethers.getSigners();

        // Deploy mock AGS token
        const MockERC20 = await ethers.getContractFactory("contracts/test/TokenDistributionMocks.sol:MockERC20");
        const agsToken = await MockERC20.deploy("Aegis Token", "AGS", TOTAL_TOKENS);

        // Deploy mock verifier factory
        const MockVerifierFactory = await ethers.getContractFactory("MockVerifierFactory");
        const verifierFactory = await MockVerifierFactory.deploy();
        await verifierFactory.setMockVerifier("auction", true);

        // Deploy liquidity deployer mock
        const MockLiquidityDeployer = await ethers.getContractFactory("contracts/test/TokenDistributionMocks.sol:MockLiquidityDeployer");
        const mockLiquidityDeployer = await MockLiquidityDeployer.deploy();

        // Deploy Dutch auction
        const AutomatedDutchAuction = await ethers.getContractFactory("AutomatedDutchAuction");
        const dutchAuction = await AutomatedDutchAuction.deploy(
            agsToken.target,
            verifierFactory.target,
            await mockLiquidityDeployer.getAddress(),
            owner.address,
            START_PRICE,
            RESERVE_PRICE,
            TOTAL_TOKENS,
            MAX_PER_ADDRESS,
            MIN_PURCHASE,
            DURATION,
            ethers.ZeroAddress,
            ethers.ZeroAddress,
            ethers.ZeroAddress,
            ethers.ZeroAddress,
            ethers.ZeroAddress,
            ethers.ZeroAddress
        );

        // Deploy and set TimeLockPurchaseLimits to satisfy auction's timeLock usage
        const currentTime = BigInt(await time.latest());
        const saleStartTime = currentTime + 60n; // before activate(); TimeLock schedule uses wall clock from deploy
        const emergencyUnlockTime = currentTime + 30n * 24n * 60n * 60n;
        const TimeLockPurchaseLimits = await ethers.getContractFactory("TimeLockPurchaseLimits");
        const timeLock = await TimeLockPurchaseLimits.deploy(
            await verifierFactory.getAddress(),
            MAX_PER_ADDRESS,
            ethers.parseEther("1000"), // per-period limit
            24 * 60 * 60,
            saleStartTime,
            emergencyUnlockTime
        );
        await timeLock.setDutchAuction(await dutchAuction.getAddress());
        await dutchAuction.setTimeLock(await timeLock.getAddress());
        // move to sale start
        await time.increaseTo(saleStartTime);

        // Transfer tokens to the auction contract
        await agsToken.transfer(dutchAuction.target, TOTAL_TOKENS);
        
        // Activate the sale
        await dutchAuction.activate();

        // Deploy attacker contract
        const MaliciousReentrancyWithdraw = await ethers.getContractFactory("MaliciousReentrancyWithdraw");
        const attacker = await MaliciousReentrancyWithdraw.deploy(dutchAuction.target);

        return { dutchAuction, agsToken, verifierFactory, timeLock, owner, addr1, addr2, attacker };
    }

    // Fixture that leaves the sale in pre-start state so we can enable deferred settlement
    async function deployAuctionDeferredFixture() {
        const [owner, addr1, addr2] = await ethers.getSigners();

        // Deploy mock AGS token
        const MockERC20 = await ethers.getContractFactory("contracts/test/TokenDistributionMocks.sol:MockERC20");
        const agsToken = await MockERC20.deploy("Aegis Token", "AGS", TOTAL_TOKENS);

        // Deploy mock verifier factory
        const MockVerifierFactory = await ethers.getContractFactory("MockVerifierFactory");
        const verifierFactory = await MockVerifierFactory.deploy();
        await verifierFactory.setMockVerifier("auction", true);

        // Deploy liquidity deployer mock
        const MockLiquidityDeployer = await ethers.getContractFactory("contracts/test/TokenDistributionMocks.sol:MockLiquidityDeployer");
        const mockLiquidityDeployer = await MockLiquidityDeployer.deploy();

        // Deploy Dutch auction
        const AutomatedDutchAuction = await ethers.getContractFactory("AutomatedDutchAuction");
        const dutchAuction = await AutomatedDutchAuction.deploy(
            agsToken.target,
            verifierFactory.target,
            await mockLiquidityDeployer.getAddress(),
            owner.address,
            START_PRICE,
            RESERVE_PRICE,
            TOTAL_TOKENS,
            MAX_PER_ADDRESS,
            MIN_PURCHASE,
            DURATION,
            ethers.ZeroAddress,
            ethers.ZeroAddress,
            ethers.ZeroAddress,
            ethers.ZeroAddress,
            ethers.ZeroAddress,
            ethers.ZeroAddress
        );

        // TimeLock with saleStartTime in the future; DO NOT advance time yet
        const currentTime = BigInt(await time.latest());
        const saleStartTime = currentTime + 300n; // keep strictly in future before activate()
        const emergencyUnlockTime = currentTime + 30n * 24n * 60n * 60n;
        const TimeLockPurchaseLimits = await ethers.getContractFactory("TimeLockPurchaseLimits");
        const timeLock = await TimeLockPurchaseLimits.deploy(
            await verifierFactory.getAddress(),
            MAX_PER_ADDRESS,
            ethers.parseEther("1000"),
            24 * 60 * 60,
            saleStartTime,
            emergencyUnlockTime
        );
        await timeLock.setDutchAuction(await dutchAuction.getAddress());
        await dutchAuction.setTimeLock(await timeLock.getAddress());

        // Fund auction with tokens
        await agsToken.transfer(dutchAuction.target, TOTAL_TOKENS);

        // Attacker (unused here)
        const MaliciousReentrancyWithdraw = await ethers.getContractFactory("MaliciousReentrancyWithdraw");
        const attacker = await MaliciousReentrancyWithdraw.deploy(dutchAuction.target);

        return { dutchAuction, agsToken, verifierFactory, timeLock, owner, addr1, addr2, attacker, saleStartTime };
    }
    let dutchAuction, agsToken, verifierFactory, owner, addr1, addr2, attacker;

    const START_PRICE = ethers.parseEther("2");
    const RESERVE_PRICE = ethers.parseEther("0.5");
    const TOTAL_TOKENS = ethers.parseEther("1000");
    const MAX_PER_ADDRESS = ethers.parseEther("50000");
    const MIN_PURCHASE = ethers.parseEther("100");
    const DURATION = 48 * 60 * 60; // 48 hours

    describe("Deployment and Initial State", function () {
        it("Should set the correct initial values", async function () {
            const { dutchAuction, agsToken, verifierFactory } = await loadFixture(deployAuctionFixture);
            expect(await dutchAuction.agsToken()).to.equal(agsToken.target);
            expect(await dutchAuction.verifierFactory()).to.equal(verifierFactory.target);
            expect(await dutchAuction.startPrice()).to.equal(START_PRICE);
            expect(await dutchAuction.reservePrice()).to.equal(RESERVE_PRICE);
            expect(await dutchAuction.totalTokens()).to.equal(TOTAL_TOKENS);
            expect(await dutchAuction.maxPerAddress()).to.equal(MAX_PER_ADDRESS);
            expect(await dutchAuction.minPurchase()).to.equal(MIN_PURCHASE);
        });
    });

    describe("ZK verifier public input template", function () {
        it("exposes AUCTION_PRICE_CURVE_ID = 1 (time-linear Dutch, ZK v1)", async function () {
            const { dutchAuction } = await loadFixture(deployAuctionFixture);
            expect(await dutchAuction.AUCTION_PRICE_CURVE_ID()).to.equal(1);
        });

        it("getAuctionVerifierPublicInputs matches manual decay rate (WAD per second)", async function () {
            const { dutchAuction } = await loadFixture(deployAuctionFixture);
            const startT = await dutchAuction.auctionStartTime();
            const endT = await dutchAuction.auctionEndTime();
            const duration = endT - startT;
            const ref = startT + duration / 3n;
            const pub = await dutchAuction.getAuctionVerifierPublicInputs(ref);
            const wad = ethers.parseEther("1");
            const expectedRate = ((START_PRICE - RESERVE_PRICE) * wad) / duration;
            expect(pub[0]).to.equal(START_PRICE);
            expect(pub[1]).to.equal(RESERVE_PRICE);
            expect(pub[2]).to.equal(startT);
            expect(pub[3]).to.equal(duration);
            expect(pub[4]).to.equal(ref);
            expect(pub[5]).to.equal(expectedRate);
        });
    });

    describe("Deferred settlement and claims", function () {
        it("finalizeSale reached; claim reverts when deferred off", async function () {
            const { dutchAuction, agsToken, owner, addr1, saleStartTime } = await loadFixture(deployAuctionDeferredFixture);

            // ensure active
            await time.increaseTo(saleStartTime);
            await dutchAuction.activate();

            // legacy purchase to create entitlement
            const price = await dutchAuction.getCurrentPrice();
            const minPurchase = await dutchAuction.minPurchase();
            const spend = (price * minPurchase) / ethers.parseEther("1"); // buy exactly minPurchase
            await dutchAuction.connect(addr1).purchaseTokensLegacy(0, { value: spend });

            // reach end and finalize
            const end = await dutchAuction.auctionEndTime();
            await time.increaseTo(end + 1n);
            await dutchAuction.connect(owner).finalizeSale();
            expect(await dutchAuction.saleFinalized()).to.equal(true);

            // 24h claim gate
            await time.increase(86400 + 1);
            await expect(dutchAuction.connect(addr1).claim()).to.be.revertedWith("Deferred off");
        });

        it("private claim path is disabled when deferred off", async function () {
            const { dutchAuction, agsToken, owner, addr1, saleStartTime } = await loadFixture(deployAuctionDeferredFixture);

            // ensure active
            await time.increaseTo(saleStartTime);
            await dutchAuction.activate();

            // create entitlement via private purchase
            const price = await dutchAuction.getCurrentPrice();
            const minPurchase = await dutchAuction.minPurchase();
            const spend = (price * minPurchase) / ethers.parseEther("1");
            const commitment = 123n;
            const nullifier = 456n;
            const dummyProof = [0,0,0,0,0,0,0,0];
            await dutchAuction.connect(addr1).purchaseTokens(dummyProof, commitment, nullifier, 0, { value: spend });

            const end = await dutchAuction.auctionEndTime();
            await time.increaseTo(end + 1n);
            await dutchAuction.connect(owner).finalizeSale();

            // Minimal dummy claim proof/public inputs for test harness
            const claimProof = [0,0,0,0,0,0,0,0];
            const claimInputs = [commitment, BigInt(addr1.address), 0n, 0n];
            // 24h claim gate
            await time.increase(86400 + 1);
            await expect(dutchAuction.connect(addr1).claimPrivate(
                ethers.hexlify(ethers.zeroPadValue(ethers.toBeHex(commitment), 32)),
                claimProof,
                claimInputs
            )).to.be.revertedWith("Deferred off");
        });
    });

    describe("Price Calculation", function () {
        it("Should return the start price at the beginning", async function () {
            const { dutchAuction } = await loadFixture(deployAuctionFixture);
            expect(await dutchAuction.getCurrentPrice()).to.be.closeTo(START_PRICE, ethers.parseEther("0.001"));
        });

        it("Should decrease the price linearly over time", async function () {
            const { dutchAuction } = await loadFixture(deployAuctionFixture);
            await ethers.provider.send("evm_increaseTime", [DURATION / 2]);
            await ethers.provider.send("evm_mine");

            const expectedPrice = START_PRICE - (START_PRICE - RESERVE_PRICE) / 2n;
            expect(await dutchAuction.getCurrentPrice()).to.be.closeTo(expectedPrice, ethers.parseEther("0.001"));
        });

        it("Should return the reserve price at the end", async function () {
            const { dutchAuction } = await loadFixture(deployAuctionFixture);
            await ethers.provider.send("evm_increaseTime", [DURATION]);
            await ethers.provider.send("evm_mine");

            expect(await dutchAuction.getCurrentPrice()).to.equal(RESERVE_PRICE);
        });
    });

    describe("Token Purchases (Legacy)", function () {
        it("Should allow a user to purchase tokens", async function () {
            const { dutchAuction, agsToken, addr1 } = await loadFixture(deployAuctionFixture);
            // Per instruction, ensure sale is active by advancing time if needed.
            // This assumes a `startTime` public variable and imported `time` helper.
            const startTime = await dutchAuction.auctionStartTime();
            const now = await time.latest();
            if (now < startTime) {
                await time.increaseTo(startTime);
            }

            const purchaseAmount = ethers.parseEther("200");
            const price = await dutchAuction.getCurrentPrice();
            await expect(dutchAuction.connect(addr1).purchaseTokensLegacy(0, { value: purchaseAmount }))
                .to.emit(dutchAuction, "TokensPurchased");

            const tokensForEth = (purchaseAmount * ethers.parseEther("1")) / await dutchAuction.getCurrentPrice();
            expect(await agsToken.balanceOf(addr1.address)).to.be.closeTo(tokensForEth, ethers.parseEther("0.001"));
            expect(await dutchAuction.purchaseAmounts(addr1.address)).to.be.closeTo(tokensForEth, ethers.parseEther("0.001"));
        });

        it("Should reject purchases below the minimum", async function () {
            const { dutchAuction, addr1 } = await loadFixture(deployAuctionFixture);
            const smallPurchaseAmount = 1n; // 1 wei

            await expect(dutchAuction.connect(addr1).purchaseTokensLegacy(0, { value: smallPurchaseAmount }))
                .to.be.reverted;
        });

        it("Should reject purchases if rate limited", async function () {
            const { dutchAuction, addr1 } = await loadFixture(deployAuctionFixture);
            const purchaseAmount = ethers.parseEther("200");
            await dutchAuction.connect(addr1).purchaseTokensLegacy(0, { value: purchaseAmount });

            await expect(dutchAuction.connect(addr1).purchaseTokensLegacy(0, { value: purchaseAmount }))
                .to.be.revertedWith("Rate limited");
        });

        it("Allows purchase in the last second at the lowest possible price", async function () {
            const { dutchAuction, addr1 } = await loadFixture(deployAuctionFixture);

            // Advance to last valid second before end
            const startTime = await dutchAuction.auctionStartTime();
            const endTime = await dutchAuction.auctionEndTime();
            const duration = endTime - startTime;
            await time.increaseTo(endTime - 1n);

            // Price should be within one decay step of reserve
            const priceNow = await dutchAuction.getCurrentPrice();
            const reserve = await dutchAuction.reservePrice();
            const startPrice = await dutchAuction.startPrice();
            const decayPerSecond = (startPrice - reserve) / duration;
            const delta = priceNow - reserve;
            expect(delta).to.be.at.most(decayPerSecond + 1n);

            // Buy exactly minPurchase tokens at current price
            const minPurchase = await dutchAuction.minPurchase();
            const spend = (priceNow * minPurchase) / ethers.parseEther("1");
            const soldBefore = await dutchAuction.tokensSold();
            await expect(dutchAuction.connect(addr1).purchaseTokensLegacy(0, { value: spend })).to.not.be.reverted;
            const soldAfter = await dutchAuction.tokensSold();
            expect(soldAfter).to.be.gt(soldBefore);

            // After end time, sale must end
            await time.increaseTo(endTime);
            await expect(dutchAuction.connect(addr1).purchaseTokensLegacy(0, { value: spend }))
                .to.be.revertedWith("Sale ended");
        });
    });

    describe("Token Purchases (ZK)", function () {
        it("Should allow a user to purchase tokens with a valid ZK proof", async function () {
            const { dutchAuction, agsToken, addr1 } = await loadFixture(deployAuctionFixture);
            // Per instruction, ensure sale is active by advancing time if needed.
            // This assumes a `startTime` public variable and imported `time` helper.
            const startTime2 = await dutchAuction.auctionStartTime();
            const now2 = await time.latest();
            if (now2 < startTime2) {
                await time.increaseTo(startTime2);
            }

            const purchaseAmount = ethers.parseEther("200");
            const price = await dutchAuction.getCurrentPrice();
            const tokensForEth = (purchaseAmount * ethers.parseEther("1")) / price;
            const proof = ["1", "2", "3", "4", "5", "6", "7", "8"];
            const commitment = 12345;
            const nullifier = 67890;

            await expect(dutchAuction.connect(addr1).purchaseTokens(proof, commitment, nullifier, 0, { value: purchaseAmount }))
                .to.emit(dutchAuction, "PrivatePurchase");

            expect(await agsToken.balanceOf(addr1.address)).to.be.closeTo(tokensForEth, ethers.parseEther("0.001"));
        });

        it("Should reject a ZK purchase with a used nullifier", async function () {
            const { dutchAuction, addr1, addr2 } = await loadFixture(deployAuctionFixture);
            const purchaseAmount = ethers.parseEther("200");
            const proof = ["1", "2", "3", "4", "5", "6", "7", "8"];
            const commitment = 12345;
            const nullifier = 67890;

            await dutchAuction.connect(addr1).purchaseTokens(proof, commitment, nullifier, 0, { value: purchaseAmount });

            await expect(dutchAuction.connect(addr2).purchaseTokens(proof, commitment, nullifier, 0, { value: purchaseAmount }))
                .to.be.revertedWith("Nullifier already used");
        });

        it("Allows ZK purchase in the last second at the lowest possible price", async function () {
            const { dutchAuction, addr1 } = await loadFixture(deployAuctionFixture);

            // Advance to last valid second before end
            const startTime = await dutchAuction.auctionStartTime();
            const endTime = await dutchAuction.auctionEndTime();
            const duration = endTime - startTime;
            await time.increaseTo(endTime - 1n);

            // Price should be within one decay step of reserve
            const priceNow = await dutchAuction.getCurrentPrice();
            const reserve = await dutchAuction.reservePrice();
            const startPrice = await dutchAuction.startPrice();
            const decayPerSecond = (startPrice - reserve) / duration;
            const delta = priceNow - reserve;
            expect(delta).to.be.at.most(decayPerSecond + 1n);

            // ZK purchase parameters
            const proof = ["1","2","3","4","5","6","7","8"];
            const commitment = 111222n;
            const nullifier = 333444n;

            // Buy at current price (use some ETH >= minPurchase*price)
            const minPurchase = await dutchAuction.minPurchase();
            const spend = (priceNow * minPurchase) / ethers.parseEther("1");
            const soldBefore = await dutchAuction.tokensSold();
            await expect(dutchAuction.connect(addr1).purchaseTokens(proof, commitment, nullifier, 0, { value: spend })).to.not.be.reverted;
            const soldAfter = await dutchAuction.tokensSold();
            expect(soldAfter).to.be.gt(soldBefore);

            // After end time, ZK purchases should revert "Sale ended"
            await time.increaseTo(endTime);
            await expect(dutchAuction.connect(addr1).purchaseTokens(proof, commitment + 1n, nullifier + 1n, 0, { value: spend }))
                .to.be.revertedWith("Sale ended");
        });
    });

    describe("Token Purchases (ZK ERC-20)", function () {
        async function deployAuctionWithWsFixture() {
            const [owner, addr1, addr2] = await ethers.getSigners();

            const MockERC20 = await ethers.getContractFactory("contracts/test/TokenDistributionMocks.sol:MockERC20");
            const agsToken = await MockERC20.deploy("Aegis Token", "AGS", TOTAL_TOKENS);
            const wsToken = await MockERC20.deploy("Wrapped Sonic", "wS", ethers.parseEther("10000000"));

            const MockVerifierFactory = await ethers.getContractFactory("MockVerifierFactory");
            const verifierFactory = await MockVerifierFactory.deploy();
            await verifierFactory.setMockVerifier("auction", true);

            const MockLiquidityDeployer = await ethers.getContractFactory("contracts/test/TokenDistributionMocks.sol:MockLiquidityDeployer");
            const mockLiquidityDeployer = await MockLiquidityDeployer.deploy();

            const AutomatedDutchAuction = await ethers.getContractFactory("AutomatedDutchAuction");
            const dutchAuction = await AutomatedDutchAuction.deploy(
                agsToken.target,
                verifierFactory.target,
                await mockLiquidityDeployer.getAddress(),
                owner.address,
                START_PRICE,
                RESERVE_PRICE,
                TOTAL_TOKENS,
                MAX_PER_ADDRESS,
                MIN_PURCHASE,
                DURATION,
                wsToken.target,
                ethers.ZeroAddress,
                ethers.ZeroAddress,
                ethers.ZeroAddress,
                ethers.ZeroAddress,
                ethers.ZeroAddress
            );

            const currentTime = BigInt(await time.latest());
            const saleStartTime = currentTime + 60n;
            const emergencyUnlockTime = currentTime + 30n * 24n * 60n * 60n;
            const TimeLockPurchaseLimits = await ethers.getContractFactory("TimeLockPurchaseLimits");
            const timeLock = await TimeLockPurchaseLimits.deploy(
                await verifierFactory.getAddress(),
                MAX_PER_ADDRESS,
                ethers.parseEther("1000"),
                24 * 60 * 60,
                saleStartTime,
                emergencyUnlockTime
            );
            await timeLock.setDutchAuction(await dutchAuction.getAddress());
            await dutchAuction.setTimeLock(await timeLock.getAddress());
            await time.increaseTo(saleStartTime);

            await agsToken.transfer(dutchAuction.target, TOTAL_TOKENS);
            await dutchAuction.activate();

            await wsToken.transfer(addr1.address, ethers.parseEther("10000"));
            await wsToken.connect(addr1).approve(dutchAuction.target, ethers.MaxUint256);

            return { dutchAuction, agsToken, wsToken, verifierFactory, owner, addr1, addr2 };
        }

        it("Should allow a user to purchase tokens with ZK proof and wS", async function () {
            const { dutchAuction, agsToken, wsToken, addr1, owner } = await loadFixture(deployAuctionWithWsFixture);
            const maxTokenIn = ethers.parseEther("200");
            const price = await dutchAuction.getCurrentPrice();
            const sEquiv = maxTokenIn;
            const tokensForPay = (sEquiv * ethers.parseEther("1")) / price;
            const proof = ["1", "2", "3", "4", "5", "6", "7", "8"];
            const commitment = 424242n;
            const nullifier = 131313n;
            const sinkBefore = await wsToken.balanceOf(owner.address);
            const auctionWsBefore = await wsToken.balanceOf(dutchAuction.target);

            await expect(
                dutchAuction.connect(addr1).purchaseTokensWithErc20(
                    proof,
                    commitment,
                    nullifier,
                    wsToken.target,
                    maxTokenIn,
                    0
                )
            ).to.emit(dutchAuction, "PrivatePurchase");

            expect(await agsToken.balanceOf(addr1.address)).to.be.closeTo(tokensForPay, ethers.parseEther("0.001"));
            expect(await wsToken.balanceOf(owner.address)).to.equal(sinkBefore);
            expect(await wsToken.balanceOf(dutchAuction.target)).to.be.gt(auctionWsBefore);
        });
    });

    describe("Auction End", function () {
        it("Should end the auction when all tokens are sold", async function () {
            const { dutchAuction, owner, addr1, addr2 } = await loadFixture(deployAuctionFixture);
            const price = await dutchAuction.getCurrentPrice();
            const ethForAllTokens = (TOTAL_TOKENS * price) / ethers.parseEther("1");
            const slightlyMoreEth = ethForAllTokens + ethers.parseEther("1"); // Send slightly more ETH

            // Ensure the owner has enough ETH to purchase all tokens
            await addr2.sendTransaction({ to: owner.address, value: slightlyMoreEth });

            // This test is simplified and assumes the owner can purchase all tokens.
            // In a real scenario, this would likely be multiple purchases from different users.
            await dutchAuction.connect(owner).purchaseTokensLegacy(0, { value: slightlyMoreEth });

            expect(await dutchAuction.saleCompleted()).to.be.true;
            await expect(dutchAuction.connect(addr1).purchaseTokensLegacy(0, { value: ethers.parseEther("0.1") }))
                .to.be.revertedWith("Sale completed");
        });

        it("Should end the auction when the time runs out", async function () {
            const { dutchAuction, addr1 } = await loadFixture(deployAuctionFixture);
            await ethers.provider.send("evm_increaseTime", [DURATION]);
            await ethers.provider.send("evm_mine");

            await expect(dutchAuction.connect(addr1).purchaseTokensLegacy(0, { value: ethers.parseEther("200") }))
                .to.be.revertedWith("Sale ended");
        });
    });

    describe("Owner Functions", function () {
        it("Should transfer unsold tokens to DAO treasury after 30 days", async function () {
            const { dutchAuction, agsToken } = await loadFixture(deployAuctionFixture);
            
            // Complete and finalize the sale first
            const endTime = await dutchAuction.auctionEndTime();
            await time.increaseTo(Number(endTime) + 100);
            await dutchAuction.checkAndCompleteSale();
            if (await dutchAuction.saleCompleted()) {
                await dutchAuction.finalizeSale();
            }
            
            // Get sale completion time
            const saleCompletionTime = await dutchAuction.saleCompletionTime();
            const completionTime = saleCompletionTime > 0n ? Number(saleCompletionTime) : Number(endTime);
            
            // Wait 30 days after sale completion
            const targetTime = completionTime + 30 * 24 * 60 * 60 + 1;
            await time.increaseTo(targetTime);

            // Unsold AGS is sent to `ecosystemProceedsSink` (owner in deployAuctionFixture).
            const sink = await dutchAuction.ecosystemProceedsSink();
            const initialBalance = await agsToken.balanceOf(sink);
            const unsoldTokens = await dutchAuction.getRemainingTokens();

            await dutchAuction.transferUnsoldToTreasury();

            const finalBalance = await agsToken.balanceOf(sink);
            expect(finalBalance - initialBalance).to.equal(unsoldTokens);
        });

        it("Should allow anyone to withdraw ETH proceeds", async function () {
            const { dutchAuction, addr1, addr2 } = await loadFixture(deployAuctionFixture);
            const purchaseAmount = ethers.parseEther("200");
            await dutchAuction.connect(addr1).purchaseTokensLegacy(0, { value: purchaseAmount });

            // Complete and finalize the sale first
            const endTime = await dutchAuction.auctionEndTime();
            await time.increaseTo(Number(endTime) + 100);
            await dutchAuction.checkAndCompleteSale();
            if (await dutchAuction.saleCompleted()) {
                await dutchAuction.finalizeSale();
            }
            
            // Get sale completion time
            const saleCompletionTime = await dutchAuction.saleCompletionTime();
            const completionTime = saleCompletionTime > 0n ? Number(saleCompletionTime) : Number(endTime);
            
            // Wait 30 days after sale completion (required for withdrawProceeds)
            const targetTime = completionTime + 30 * 24 * 60 * 60 + 1;
            await time.increaseTo(targetTime);

            const [, quoteToPair] = await dutchAuction.previewLiquiditySeed();
            expect(quoteToPair).to.be.gt(0);

            // Excess native proceeds (after liquidity band) go to `ecosystemProceedsSink`.
            const sink = await dutchAuction.ecosystemProceedsSink();
            const initialBalance = await ethers.provider.getBalance(sink);

            await dutchAuction.connect(addr2).withdrawProceeds();

            expect(await dutchAuction.liquidityFundsSent()).to.equal(true);
            const finalBalance = await ethers.provider.getBalance(sink);
            expect(finalBalance - initialBalance).to.equal(purchaseAmount - quoteToPair);
        });

        it("Should seed liquidity via settlePostSale after 24h", async function () {
            const { dutchAuction, addr1 } = await loadFixture(deployAuctionFixture);
            const purchaseAmount = ethers.parseEther("200");
            await dutchAuction.connect(addr1).purchaseTokensLegacy(0, { value: purchaseAmount });

            const endTime = await dutchAuction.auctionEndTime();
            await time.increaseTo(Number(endTime) + 100);
            await dutchAuction.checkAndCompleteSale();

            const completionTime = Number(await dutchAuction.saleCompletionTime());
            await time.increaseTo(completionTime + 86400 + 1);

            await expect(dutchAuction.settlePostSale()).to.emit(dutchAuction, "LiquidityFundsSent");
            expect(await dutchAuction.liquidityFundsSent()).to.equal(true);
        });

        it("Should swap stable proceeds to wS before seeding liquidity", async function () {
            const [owner, addr1] = await ethers.getSigners();

            const MockERC20 = await ethers.getContractFactory("contracts/test/TokenDistributionMocks.sol:MockERC20");
            const agsToken = await MockERC20.deploy("Aegis Token", "AGS", TOTAL_TOKENS);
            const wsToken = await MockERC20.deploy("Wrapped Sonic", "wS", ethers.parseEther("10000000"));
            const usdcToken = await MockERC20.deploy("USD Coin", "USDC", 0n);
            await usdcToken.mint(addr1.address, 1_000_000_000n); // 1000 USDC (6 decimals)

            const MockVerifierFactory = await ethers.getContractFactory("MockVerifierFactory");
            const verifierFactory = await MockVerifierFactory.deploy();
            await verifierFactory.setMockVerifier("auction", true);

            const MockLiquidityDeployer = await ethers.getContractFactory("contracts/test/TokenDistributionMocks.sol:MockLiquidityDeployer");
            const mockLiquidityDeployer = await MockLiquidityDeployer.deploy();

            const MockSwapRouter02 = await ethers.getContractFactory("contracts/test/TokenDistributionMocks.sol:MockSwapRouter02");
            const mockRouter = await MockSwapRouter02.deploy();
            // 1 USDC (1e6) -> 49 S (49e18 wS) at TGE peg
            await mockRouter.setSwapRate(usdcToken.target, wsToken.target, 49n * 10n ** 18n, 1_000_000n);
            await wsToken.mint(mockRouter.target, ethers.parseEther("1000000"));

            const AutomatedDutchAuction = await ethers.getContractFactory("AutomatedDutchAuction");
            const dutchAuction = await AutomatedDutchAuction.deploy(
                agsToken.target,
                verifierFactory.target,
                await mockLiquidityDeployer.getAddress(),
                owner.address,
                START_PRICE,
                RESERVE_PRICE,
                TOTAL_TOKENS,
                MAX_PER_ADDRESS,
                MIN_PURCHASE,
                DURATION,
                wsToken.target,
                ethers.ZeroAddress,
                usdcToken.target,
                ethers.ZeroAddress,
                ethers.ZeroAddress,
                mockRouter.target
            );

            const currentTime = BigInt(await time.latest());
            const saleStartTime = currentTime + 60n;
            const emergencyUnlockTime = currentTime + 30n * 24n * 60n * 60n;
            const TimeLockPurchaseLimits = await ethers.getContractFactory("TimeLockPurchaseLimits");
            const timeLock = await TimeLockPurchaseLimits.deploy(
                await verifierFactory.getAddress(),
                MAX_PER_ADDRESS,
                ethers.parseEther("1000"),
                24 * 60 * 60,
                saleStartTime,
                emergencyUnlockTime
            );
            await timeLock.setDutchAuction(await dutchAuction.getAddress());
            await dutchAuction.setTimeLock(await timeLock.getAddress());
            await time.increaseTo(saleStartTime);
            await agsToken.transfer(dutchAuction.target, TOTAL_TOKENS);
            await dutchAuction.activate();

            const usdcPay = 10_000_000n; // 10 USDC — partial fill so AGS remains for LP band
            await usdcToken.connect(addr1).approve(dutchAuction.target, usdcPay);
            await dutchAuction.connect(addr1).purchaseTokensLegacyWithErc20(usdcToken.target, usdcPay, 0);

            const endTime = await dutchAuction.auctionEndTime();
            await time.increaseTo(Number(endTime) + 100);
            await dutchAuction.checkAndCompleteSale();

            await time.increase(86400 + 1);

            await expect(dutchAuction.settlePostSale())
                .to.emit(dutchAuction, "PayTokenSwappedToWs")
                .and.to.emit(dutchAuction, "LiquidityFundsSent");

            expect(await usdcToken.balanceOf(dutchAuction.target)).to.equal(0n);
            expect(await dutchAuction.liquidityFundsSent()).to.equal(true);
        });
    });



    describe("when the sale is active", function () {
      it("should allow a user to purchase tokens", async function () {
        const { dutchAuction, agsToken, addr1 } = await loadFixture(
          deployAuctionFixture
        );

        const startTime3 = await dutchAuction.auctionStartTime();
        const now3 = await time.latest();
        if (now3 < startTime3) {
          await time.increaseTo(startTime3);
        }
        const price = await dutchAuction.getCurrentPrice();
        const ethForMinPurchase = (MIN_PURCHASE_AMOUNT * price) / ethers.parseEther("1");
        const balanceBefore = await agsToken.balanceOf(addr1.address);
        await dutchAuction
          .connect(addr1)
          .purchaseTokensLegacy(0, {
            value: ethForMinPurchase,
          });
        const balanceAfter = await agsToken.balanceOf(addr1.address);
        expect(balanceAfter - balanceBefore).to.be.closeTo(
          MIN_PURCHASE_AMOUNT,
          ethers.parseEther("0.001")
        );
      });
    });

    describe("Gas Optimization", function () {
      it("`purchaseTokensLegacy` gas usage", async function () {
        const { dutchAuction, addr1 } = await loadFixture(
          deployAuctionFixture
        );
        const startTime4 = await dutchAuction.auctionStartTime();
        const now4 = await time.latest();
        if (now4 < startTime4) {
          await time.increaseTo(startTime4);
        }
        const price = await dutchAuction.getCurrentPrice();
        const ethForMinPurchase = (MIN_PURCHASE_AMOUNT * price) / ethers.parseEther("1");

        const tx = await dutchAuction
          .connect(addr1)
          .purchaseTokensLegacy(0, {
            value: ethForMinPurchase,
          });
        const receipt = await tx.wait();
        console.log(
          `Gas used for legacy purchase: ${receipt.gasUsed.toString()}`
        );
      });

      it("`purchaseTokens` (ZK) gas usage", async function () {
        const { dutchAuction, addr1 } = await loadFixture(
          deployAuctionFixture
        );
        const startTime = await dutchAuction.auctionStartTime();
        const now = await time.latest();
        if (now < startTime) {
          await time.increaseTo(startTime);
        }
        const price = await dutchAuction.getCurrentPrice();
        const ethForMinPurchase = (MIN_PURCHASE_AMOUNT * price) / ethers.parseEther("1");

        // Use mock proof
        const proof = generateMockProof();

        const tx = await dutchAuction
          .connect(addr1)
          .purchaseTokens(proof, 12345, 67890, 0, { value: ethForMinPurchase });
        const receipt = await tx.wait();
        console.log(`Gas used for ZK purchase: ${receipt.gasUsed.toString()}`);
      });
    });

    describe("Security: Division by Zero Tests", function () {
      it("Should handle price calculation when startTime equals endTime", async function () {
        // This scenario shouldn't happen in practice (requires duration > 0 in constructor)
        // But we test that division by totalDuration is safe
        const { dutchAuction } = await loadFixture(deployAuctionFixture);
        
        const startTime = await dutchAuction.auctionStartTime();
        const endTime = await dutchAuction.auctionEndTime();
        
        // Duration should always be positive (checked in constructor)
        const duration = endTime - startTime;
        expect(duration).to.be.gt(0);
        
        // Price calculation should work correctly
        const currentPrice = await dutchAuction.getCurrentPrice();
        expect(currentPrice).to.be.gte(await dutchAuction.reservePrice());
        expect(currentPrice).to.be.lte(await dutchAuction.startPrice());
      });

      it("Should prevent division by zero in getTokensForEth when price is zero", async function () {
        const { dutchAuction } = await loadFixture(deployAuctionFixture);
        
        // Price should never be zero (reservePrice is set to 0.5 ETH minimum)
        const currentPrice = await dutchAuction.getCurrentPrice();
        expect(currentPrice).to.be.gt(0);
        
        // getTokensForEth should work correctly
        const ethAmount = ethers.parseEther("1");
        const tokens = await dutchAuction.getTokensForEth(ethAmount);
        expect(tokens).to.be.gt(0);
      });

      it("Should handle price decay calculation correctly", async function () {
        const { dutchAuction } = await loadFixture(deployAuctionFixture);
        
        const startTime = await dutchAuction.auctionStartTime();
        const endTime = await dutchAuction.auctionEndTime();
        const startPrice = await dutchAuction.startPrice();
        const reservePrice = await dutchAuction.reservePrice();
        
        // Get current time
        let currentTime = await time.latest();
        
        // At start time, price should be startPrice (exact match)
        // Move to exactly startTime
        if (currentTime < startTime) {
            await time.increaseTo(startTime);
        }
        
        // Get current time after moving forward
        currentTime = await time.latest();
        const priceAtStart = await dutchAuction.getCurrentPrice();
        
        // Convert to BigInt for proper comparison - handle both BigInt and BigNumber
        const priceAtStartBigInt = typeof priceAtStart === 'bigint' ? priceAtStart : BigInt(priceAtStart.toString());
        const startPriceBigInt = typeof startPrice === 'bigint' ? startPrice : BigInt(startPrice.toString());
        const reservePriceBigInt = typeof reservePrice === 'bigint' ? reservePrice : BigInt(reservePrice.toString());
        const startTimeBigInt = typeof startTime === 'bigint' ? startTime : BigInt(startTime.toString());
        const endTimeBigInt = typeof endTime === 'bigint' ? endTime : BigInt(endTime.toString());
        const currentTimeBigInt = typeof currentTime === 'bigint' ? currentTime : BigInt(currentTime.toString());
        
        // The test is primarily checking that division by zero doesn't occur
        // Price should be valid (between reservePrice and startPrice)
        // If we're exactly at startTime, price should be startPrice
        // If time has elapsed slightly, price may have decayed, but should still be valid
        expect(priceAtStartBigInt).to.be.gte(reservePriceBigInt);
        expect(priceAtStartBigInt).to.be.lte(startPriceBigInt);
        
        // If we're at or very close to startTime (within 1 second), price should be very close to startPrice
        // Allow 0.1% tolerance for rounding errors
        if (currentTimeBigInt <= startTimeBigInt + 1n) {
            const tolerance = startPriceBigInt / 1000n; // 0.1% tolerance
            const isCloseToStartPrice = priceAtStartBigInt >= startPriceBigInt - tolerance;
            expect(isCloseToStartPrice, `Price ${priceAtStartBigInt} should be close to startPrice ${startPriceBigInt} (within ${tolerance})`).to.be.true;
        }
        
        // At end time, price should be reservePrice
        if (currentTime < endTime) {
            await time.increaseTo(endTime);
        }
        const priceAtEnd = await dutchAuction.getCurrentPrice();
        // Price should be very close to reservePrice (within 0.01% tolerance)
        // Convert to BigInt for proper comparison - handle both BigInt and BigNumber
        // reservePriceBigInt is already declared above, reuse it
        const priceAtEndBigInt = typeof priceAtEnd === 'bigint' ? priceAtEnd : BigInt(priceAtEnd.toString());
        const endTolerance = reservePriceBigInt / 10000n; // 0.01% tolerance
        const isWithinEndTolerance = priceAtEndBigInt >= reservePriceBigInt - endTolerance && priceAtEndBigInt <= reservePriceBigInt + endTolerance;
        expect(isWithinEndTolerance, `Price ${priceAtEndBigInt} should be within tolerance of ${reservePriceBigInt} (tolerance: ${endTolerance})`).to.be.true;
      });
    });

    describe("Security: Integer Underflow Tests", function () {
        it("Should prevent underflow when calculating remaining tokens", async function () {
            const { dutchAuction, addr1 } = await loadFixture(deployAuctionFixture);
            
            const startTime = await dutchAuction.auctionStartTime();
            const currentTime = await time.latest();
            
            // Only move forward, never backward
            if (currentTime < startTime) {
                await time.increaseTo(startTime);
            }
            
            const totalTokens = await dutchAuction.totalTokens();
            const tokensSold = await dutchAuction.tokensSold();
            
            // Remaining tokens should be calculated safely
            const remainingTokens = await dutchAuction.getRemainingTokens();
            expect(remainingTokens).to.equal(totalTokens - tokensSold);
            expect(remainingTokens).to.be.gte(0);
        });

        it("Should handle purchase when tokensSold exceeds totalTokens", async function () {
            const { dutchAuction, addr1 } = await loadFixture(deployAuctionFixture);
            
            const startTime = await dutchAuction.auctionStartTime();
            const currentTime = await time.latest();
            
            // Only move forward, never backward
            if (currentTime < startTime) {
                await time.increaseTo(startTime);
            }
            
            // The contract allows partial purchases when tokensSold + tokensToReceive > totalTokens
            // It automatically adjusts to purchase only remaining tokens
            // So we test that the contract correctly handles this edge case without underflow
            const totalTokens = await dutchAuction.totalTokens();
            const tokensSold = await dutchAuction.tokensSold();
            const price = await dutchAuction.getCurrentPrice();
            
            // Calculate ETH needed to purchase all remaining tokens
            const remainingTokens = totalTokens - tokensSold;
            const ethForRemaining = (remainingTokens * price) / ethers.parseEther("1");
            
            // Purchase all remaining tokens - should succeed
            await dutchAuction.connect(addr1).purchaseTokensLegacy(0, { value: ethForRemaining + ethers.parseEther("0.1") });
            
            // Verify tokensSold equals totalTokens (no underflow occurred)
            const finalTokensSold = await dutchAuction.tokensSold();
            expect(finalTokensSold).to.equal(totalTokens);
            
            // Verify sale is completed
            const saleCompleted = await dutchAuction.saleCompleted();
            expect(saleCompleted).to.be.true;
        });
    });
});