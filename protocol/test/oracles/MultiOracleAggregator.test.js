const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * Comprehensive Test Suite for MultiOracleAggregator
 * Tests the multi-oracle aggregation system with all supported providers
 */

describe("MultiOracleAggregator", function () {
    async function deployMultiOracleFixture() {
        const [admin, governance, user1] = await ethers.getSigners();

        // Deploy MultiOracleAggregator
        const MultiOracleAggregator = await ethers.getContractFactory("MultiOracleAggregator");
        const aggregator = await MultiOracleAggregator.deploy(admin.address);

        // Deploy mock oracle adapters
        const MockChainlinkAdapter = await ethers.getContractFactory("contracts/test/OracleMocks.sol:MockChainlinkAdapter");
        const chainlinkAdapter = await MockChainlinkAdapter.deploy();
        
        const MockPythAdapter = await ethers.getContractFactory("contracts/test/OracleMocks.sol:MockPythAdapter");
        const pythAdapter = await MockPythAdapter.deploy();

        return {
            aggregator,
            chainlinkAdapter,
            pythAdapter,
            admin,
            governance,
            user1
        };
    }

    describe("Deployment", function () {
        it("Should deploy with correct admin", async function () {
            const { aggregator, admin } = await loadFixture(deployMultiOracleFixture);
            expect(await aggregator.hasRole(await aggregator.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
            expect(await aggregator.hasRole(await aggregator.GOVERNANCE_ROLE(), admin.address)).to.be.true;
        });

        it("Should have correct constants", async function () {
            const { aggregator } = await loadFixture(deployMultiOracleFixture);
            expect(await aggregator.MAX_DEVIATION_BPS()).to.equal(500); // 5%
            expect(await aggregator.MAX_PRICE_STALENESS()).to.equal(3600); // 1 hour
            expect(await aggregator.MIN_ORACLE_CONFIRMATIONS()).to.equal(2);
        });
    });

    describe("Oracle Management", function () {
        it("Should add oracle adapter", async function () {
            const { aggregator, chainlinkAdapter, admin } = await loadFixture(deployMultiOracleFixture);
            
            const assetId = ethers.id("AGS/USD");
            await aggregator.connect(admin).addOracle(assetId, await chainlinkAdapter.getAddress());
            
            const config = await aggregator.getOracleConfig(assetId);
            expect(config.adapters.length).to.equal(1);
            expect(config.adapters[0]).to.equal(await chainlinkAdapter.getAddress());
            expect(config.count).to.equal(1);
            expect(config.enabled).to.be.true;
        });

        it("Should remove oracle adapter", async function () {
            const { aggregator, chainlinkAdapter, admin } = await loadFixture(deployMultiOracleFixture);
            
            const assetId = ethers.id("AGS/USD");
            await aggregator.connect(admin).addOracle(assetId, await chainlinkAdapter.getAddress());
            await aggregator.connect(admin).removeOracle(assetId, await chainlinkAdapter.getAddress());
            
            const config = await aggregator.getOracleConfig(assetId);
            expect(config.count).to.equal(0);
            expect(config.adapters.length).to.equal(0);
        });

        it("Should require governance role to add/remove oracles", async function () {
            const { aggregator, chainlinkAdapter, user1 } = await loadFixture(deployMultiOracleFixture);
            
            const assetId = ethers.id("AGS/USD");
            await expect(
                aggregator.connect(user1).addOracle(assetId, await chainlinkAdapter.getAddress())
            ).to.be.reverted;
        });
    });

    describe("Price Aggregation", function () {
        it("Should aggregate prices from multiple oracles", async function () {
            const { aggregator, chainlinkAdapter, pythAdapter, admin } = await loadFixture(deployMultiOracleFixture);
            
            const assetId = ethers.id("AGS/USD");
            const price = ethers.parseEther("1.5");
            
            // Set prices on mock adapters
            await chainlinkAdapter.setPrice(price, true);
            await pythAdapter.setPrice(price, true);
            
            // Add oracles
            await aggregator.connect(admin).addOracle(assetId, await chainlinkAdapter.getAddress());
            await aggregator.connect(admin).addOracle(assetId, await pythAdapter.getAddress());
            
            // Update price
            await aggregator.updatePrice(assetId);
            
            const priceData = await aggregator.priceData(assetId);
            expect(priceData.medianPrice).to.equal(price);
            expect(priceData.validOracles).to.equal(2);
            expect(priceData.isValid).to.be.true;
        });

        it("Should require minimum confirmations", async function () {
            const { aggregator, chainlinkAdapter, admin } = await loadFixture(deployMultiOracleFixture);
            
            const assetId = ethers.id("AGS/USD");
            await aggregator.connect(admin).addOracle(assetId, await chainlinkAdapter.getAddress());
            
            // Only 1 oracle, but need 2 confirmations
            await expect(aggregator.updatePrice(assetId)).to.be.revertedWithCustomError(
                aggregator,
                "InsufficientOracleConfirmations"
            );
        });

        it("Should validate price deviation", async function () {
            const { aggregator, chainlinkAdapter, pythAdapter, admin } = await loadFixture(deployMultiOracleFixture);
            
            const assetId = ethers.id("AGS/USD");
            
            // Set prices with high deviation (>5%)
            await chainlinkAdapter.setPrice(ethers.parseEther("1.0"), true);
            await pythAdapter.setPrice(ethers.parseEther("1.2"), true); // 20% deviation
            
            await aggregator.connect(admin).addOracle(assetId, await chainlinkAdapter.getAddress());
            await aggregator.connect(admin).addOracle(assetId, await pythAdapter.getAddress());
            
            // Should revert due to high deviation
            await expect(aggregator.updatePrice(assetId)).to.be.revertedWithCustomError(
                aggregator,
                "PriceDeviationTooHigh"
            );
        });

        it("Should check price staleness", async function () {
            const { aggregator, chainlinkAdapter, pythAdapter, admin } = await loadFixture(deployMultiOracleFixture);
            
            const assetId = ethers.id("AGS/USD");
            const price = ethers.parseEther("1.5");
            
            // Set stale price (2 hours old) on chainlink
            const staleTimestamp = (await time.latest()) - 7200;
            await chainlinkAdapter.setPriceWithTimestamp(price, staleTimestamp, true);
            // Set fresh price on pyth
            await pythAdapter.setPrice(price, true);
            
            // Add both oracles
            await aggregator.connect(admin).addOracle(assetId, await chainlinkAdapter.getAddress());
            await aggregator.connect(admin).addOracle(assetId, await pythAdapter.getAddress());
            
            // With only 1 fresh oracle, updatePrice should revert (need 2 confirmations minimum)
            // Since chainlink is stale, only pyth is fresh, so we have insufficient confirmations
            await expect(aggregator.updatePrice(assetId)).to.be.revertedWithCustomError(
                aggregator,
                "InsufficientOracleConfirmations"
            );
        });

        it("Should skip oracle with future timestamp (no global revert)", async function () {
            const { aggregator, chainlinkAdapter, pythAdapter, admin } = await loadFixture(deployMultiOracleFixture);

            const assetId = ethers.id("AGS/USD");
            const price = ethers.parseEther("1.5");
            const futureTs = (await time.latest()) + 10_000;

            await chainlinkAdapter.setPriceWithTimestamp(price, futureTs, true);
            await pythAdapter.setPrice(price, true);

            await aggregator.connect(admin).addOracle(assetId, await chainlinkAdapter.getAddress());
            await aggregator.connect(admin).addOracle(assetId, await pythAdapter.getAddress());

            // Future-ts oracle must be ignored; only one valid feed → below required confirmations
            await expect(aggregator.updatePrice(assetId)).to.be.revertedWithCustomError(
                aggregator,
                "InsufficientOracleConfirmations"
            );
        });

        it("Should compute median of three oracles", async function () {
            const { aggregator, admin } = await loadFixture(deployMultiOracleFixture);
            const MockAdapter = await ethers.getContractFactory("contracts/test/OracleMocks.sol:MockChainlinkAdapter");
            const a1 = await MockAdapter.deploy();
            const a2 = await MockAdapter.deploy();
            const a3 = await MockAdapter.deploy();

            const p1 = ethers.parseEther("1");
            const p2 = ethers.parseEther("1.01");
            const p3 = ethers.parseEther("1.02");
            await a1.setPrice(p1, true);
            await a2.setPrice(p2, true);
            await a3.setPrice(p3, true);

            const assetId = ethers.id("TRI/USD");
            await aggregator.connect(admin).addOracle(assetId, await a1.getAddress());
            await aggregator.connect(admin).addOracle(assetId, await a2.getAddress());
            await aggregator.connect(admin).addOracle(assetId, await a3.getAddress());
            await aggregator.connect(admin).setRequiredConfirmations(assetId, 3);

            await aggregator.updatePrice(assetId);
            const priceData = await aggregator.priceData(assetId);
            expect(priceData.medianPrice).to.equal(p2);
            expect(priceData.validOracles).to.equal(3);
            expect(priceData.isValid).to.be.true;
        });

        it("Should ignore zero price feeds when aggregating", async function () {
            const { aggregator, admin } = await loadFixture(deployMultiOracleFixture);
            const MockAdapter = await ethers.getContractFactory("contracts/test/OracleMocks.sol:MockChainlinkAdapter");
            const goodA = await MockAdapter.deploy();
            const zeroA = await MockAdapter.deploy();
            const p = ethers.parseEther("2");
            await goodA.setPrice(p, true);
            await zeroA.setPrice(0n, true);

            const assetId = ethers.id("ZERO/USD");
            await aggregator.connect(admin).addOracle(assetId, await goodA.getAddress());
            await aggregator.connect(admin).addOracle(assetId, await zeroA.getAddress());

            await expect(aggregator.updatePrice(assetId)).to.be.revertedWithCustomError(
                aggregator,
                "InsufficientOracleConfirmations"
            );
        });
    });

    describe("Configuration", function () {
        it("Should set required confirmations", async function () {
            const { aggregator, chainlinkAdapter, pythAdapter, admin } = await loadFixture(deployMultiOracleFixture);
            
            const assetId = ethers.id("AGS/USD");
            await aggregator.connect(admin).addOracle(assetId, await chainlinkAdapter.getAddress());
            await aggregator.connect(admin).addOracle(assetId, await pythAdapter.getAddress());
            
            await aggregator.connect(admin).setRequiredConfirmations(assetId, 2);
            
            const config = await aggregator.getOracleConfig(assetId);
            expect(config.requiredConfirmations).to.equal(2);
        });

        it("Should enable/disable asset", async function () {
            const { aggregator, chainlinkAdapter, admin } = await loadFixture(deployMultiOracleFixture);
            
            const assetId = ethers.id("AGS/USD");
            await aggregator.connect(admin).addOracle(assetId, await chainlinkAdapter.getAddress());
            
            await aggregator.connect(admin).setEnabled(assetId, false);
            
            const config = await aggregator.getOracleConfig(assetId);
            expect(config.enabled).to.be.false;
            
            // Should revert when disabled
            await expect(aggregator.updatePrice(assetId)).to.be.revertedWithCustomError(
                aggregator,
                "OracleNotConfigured"
            );
        });
    });
});

