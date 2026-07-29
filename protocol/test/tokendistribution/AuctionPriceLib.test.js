const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("AuctionPriceLib (via harness)", function () {
    async function deployHarness() {
        const Factory = await ethers.getContractFactory("AuctionPriceLibHarness");
        const harness = await Factory.deploy();
        return { harness };
    }

    it("linearDutchPrice: mid-window interpolates linearly", async function () {
        const { harness } = await loadFixture(deployHarness);
        const startPrice = ethers.parseEther("100");
        const reserve = ethers.parseEther("10");
        const startTime = 1_000_000n;
        const endTime = startTime + 100n;
        const now = startTime + 50n;
        const p = await harness.linearDutchPrice(startPrice, reserve, startTime, endTime, now, false);
        const mid = (startPrice + reserve) / 2n;
        expect(p).to.equal(mid);
    });

    it("linearDutchPrice: at or after end returns reserve", async function () {
        const { harness } = await loadFixture(deployHarness);
        const startPrice = ethers.parseEther("100");
        const reserve = ethers.parseEther("10");
        const startTime = 2_000_000n;
        const endTime = startTime + 10n;
        expect(await harness.linearDutchPrice(startPrice, reserve, startTime, endTime, endTime, false)).to.equal(reserve);
        expect(await harness.linearDutchPrice(startPrice, reserve, startTime, endTime, endTime + 1n, false)).to.equal(
            reserve
        );
    });

    it("linearDutchPrice: saleCompleted forces reserve", async function () {
        const { harness } = await loadFixture(deployHarness);
        const startPrice = ethers.parseEther("100");
        const reserve = ethers.parseEther("10");
        const startTime = 3_000_000n;
        const endTime = startTime + 100n;
        const now = startTime + 10n;
        expect(await harness.linearDutchPrice(startPrice, reserve, startTime, endTime, now, true)).to.equal(reserve);
    });

    it("decayRatePerSecondWad matches hand calculation", async function () {
        const { harness } = await loadFixture(deployHarness);
        const WAD = 10n ** 18n;
        const startPrice = 200n;
        const reserve = 100n;
        const startTime = 0n;
        const endTime = 50n;
        const expected = ((startPrice - reserve) * WAD) / (endTime - startTime);
        expect(await harness.decayRatePerSecondWad(startPrice, reserve, startTime, endTime)).to.equal(expected);
    });

    it("reverts on invalid price range (start <= reserve)", async function () {
        const { harness } = await loadFixture(deployHarness);
        await expect(harness.linearDutchPrice(100n, 100n, 0n, 10n, 5n, false)).to.be.revertedWith(
            "AuctionPriceLib: invalid price range"
        );
        await expect(harness.decayRatePerSecondWad(50n, 100n, 0n, 10n)).to.be.revertedWith(
            "AuctionPriceLib: invalid price range"
        );
    });

    it("reverts on zero duration window (decay rate)", async function () {
        const { harness } = await loadFixture(deployHarness);
        const t = 5_000_000n;
        await expect(harness.decayRatePerSecondWad(200n, 100n, t, t)).to.be.revertedWith("AuctionPriceLib: zero duration");
    });

    it("tokensForEthAtPrice: ETH to token amount at spot", async function () {
        const { harness } = await loadFixture(deployHarness);
        const WAD = 10n ** 18n;
        const eth = ethers.parseEther("2");
        const pricePerToken = ethers.parseEther("0.5");
        expect(await harness.tokensForEthAtPrice(eth, pricePerToken)).to.equal((eth * WAD) / pricePerToken);
    });

    it("tokensForEthAtPrice reverts on zero price", async function () {
        const { harness } = await loadFixture(deployHarness);
        await expect(harness.tokensForEthAtPrice(1n, 0n)).to.be.revertedWith("AuctionPriceLib: zero price");
    });

    it("linearDutchPrice: at startTime returns startPrice", async function () {
        const { harness } = await loadFixture(deployHarness);
        const startPrice = ethers.parseEther("50");
        const reserve = ethers.parseEther("5");
        const startTime = 9_000_000n;
        const endTime = startTime + 100n;
        expect(await harness.linearDutchPrice(startPrice, reserve, startTime, endTime, startTime, false)).to.equal(
            startPrice
        );
    });

    it("linearDutchPrice: just before endTime approaches reserve", async function () {
        const { harness } = await loadFixture(deployHarness);
        const startPrice = 100n;
        const reserve = 0n;
        const startTime = 0n;
        const endTime = 100n;
        const now = 99n;
        const p = await harness.linearDutchPrice(startPrice, reserve, startTime, endTime, now, false);
        expect(p).to.equal(1n);
    });

    it("linearDutchPrice: one wei spread over long window leaves price at start until decay floors", async function () {
        const { harness } = await loadFixture(deployHarness);
        const startPrice = 1001n;
        const reserve = 1000n;
        const startTime = 0n;
        const endTime = 1000n;
        const now = 500n;
        const p = await harness.linearDutchPrice(startPrice, reserve, startTime, endTime, now, false);
        expect(p).to.equal(1001n);
    });

    it("decayRatePerSecondWad: large window still fits uint256", async function () {
        const { harness } = await loadFixture(deployHarness);
        const WAD = 10n ** 18n;
        const startPrice = 10n ** 18n;
        const reserve = 10n ** 18n - 1n;
        const startTime = 0n;
        const endTime = 10n ** 9n;
        const r = await harness.decayRatePerSecondWad(startPrice, reserve, startTime, endTime);
        expect(r).to.equal((WAD * (startPrice - reserve)) / endTime);
    });

    it("tokensForEthAtPrice: max precision when price is 1 wei", async function () {
        const { harness } = await loadFixture(deployHarness);
        const WAD = 10n ** 18n;
        const eth = 7n;
        expect(await harness.tokensForEthAtPrice(eth, 1n)).to.equal(eth * WAD);
    });

    it("linearDutchPrice: reverts when startPrice < reserve", async function () {
        const { harness } = await loadFixture(deployHarness);
        await expect(harness.linearDutchPrice(5n, 10n, 0n, 10n, 5n, false)).to.be.revertedWith(
            "AuctionPriceLib: invalid price range"
        );
    });

    it("linearDutchPrice: minimal positive duration (1 second window)", async function () {
        const { harness } = await loadFixture(deployHarness);
        const startPrice = 200n;
        const reserve = 100n;
        const startTime = 100n;
        const endTime = startTime + 1n;
        const p = await harness.linearDutchPrice(startPrice, reserve, startTime, endTime, startTime, false);
        expect(p).to.equal(startPrice);
        const p2 = await harness.linearDutchPrice(startPrice, reserve, startTime, endTime, startTime + 1n, false);
        expect(p2).to.equal(reserve);
    });

    it("linearDutchPrice: exactly at start+1 step of linear path", async function () {
        const { harness } = await loadFixture(deployHarness);
        const startPrice = 200n;
        const reserve = 100n;
        const startTime = 0n;
        const endTime = 100n;
        const p = await harness.linearDutchPrice(startPrice, reserve, startTime, endTime, 1n, false);
        expect(p).to.equal(199n);
    });
});
