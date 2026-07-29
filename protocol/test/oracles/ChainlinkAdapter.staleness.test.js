const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("ChainlinkAdapter staleness & timestamp safety", function () {
    async function deployFixture() {
        const [admin] = await ethers.getSigners();
        const price8 = 50_000_000_000n; // 500e8
        const MockOracle = await ethers.getContractFactory("MockChainlinkOracle");
        const mock = await MockOracle.deploy(price8);
        const Adapter = await ethers.getContractFactory("ChainlinkAdapter");
        const adapter = await Adapter.deploy(await mock.getAddress());
        return { admin, mock, adapter, price8 };
    }

    it("getLatestPrice: fresh round returns scaled 18-dec price and isValid", async function () {
        const { mock, adapter, price8 } = await loadFixture(deployFixture);
        await mock.updateAnswer(price8);
        const [price, ts, , isValid] = await adapter.getLatestPrice();
        expect(isValid).to.be.true;
        const expectedPrice = price8 * 10n ** 10n;
        expect(price).to.equal(expectedPrice);
        const latest = BigInt(await time.latest());
        expect(ts).to.equal(latest);
    });

    it("getLatestPrice: stale updatedAt returns invalid (no panic)", async function () {
        const { mock, adapter, price8 } = await loadFixture(deployFixture);
        const staleTs = BigInt(await time.latest()) - 7200n;
        await mock.setAnswerWithUpdatedAt(price8, staleTs);
        const [price, , , isValid] = await adapter.getLatestPrice();
        expect(isValid).to.be.false;
        expect(price).to.equal(0n);
    });

    it("getLatestPrice: future updatedAt returns invalid (no underflow)", async function () {
        const { mock, adapter, price8 } = await loadFixture(deployFixture);
        const futureTs = BigInt(await time.latest()) + 50_000n;
        await mock.setAnswerWithUpdatedAt(price8, futureTs);
        const [price, , , isValid] = await adapter.getLatestPrice();
        expect(isValid).to.be.false;
        expect(price).to.equal(0n);
    });

    it("isAvailable matches getLatestPrice validity for fresh feed", async function () {
        const { mock, adapter, price8 } = await loadFixture(deployFixture);
        await mock.updateAnswer(price8);
        expect(await adapter.isAvailable()).to.be.true;
    });

    it("isAvailable is false when updatedAt is in the future", async function () {
        const { mock, adapter, price8 } = await loadFixture(deployFixture);
        const futureTs = BigInt(await time.latest()) + 1_000_000n;
        await mock.setAnswerWithUpdatedAt(price8, futureTs);
        expect(await adapter.isAvailable()).to.be.false;
    });
});
