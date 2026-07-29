const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("RFQIntentSettlement", function () {
    const types = {
        RFQOrder: [
            { name: "maker", type: "address" },
            { name: "sellToken", type: "address" },
            { name: "buyToken", type: "address" },
            { name: "sellAmount", type: "uint256" },
            { name: "minBuyAmount", type: "uint256" },
            { name: "deadline", type: "uint256" },
            { name: "salt", type: "uint256" },
        ],
    };

    async function domainOf(rfq) {
        const d = await rfq.eip712Domain();
        return {
            name: d.name,
            version: d.version,
            chainId: Number(d.chainId),
            verifyingContract: await rfq.getAddress(),
        };
    }

    async function fixture() {
        const [owner, maker, filler] = await ethers.getSigners();
        const Rfq = await ethers.getContractFactory("RFQIntentSettlement");
        const rfq = await Rfq.deploy(owner.address);
        const Base = await ethers.getContractFactory("MintableTestToken");
        const sell = await Base.deploy("Sell", "SELL");
        const buy = await Base.deploy("Buy", "BUY");
        return { owner, maker, filler, rfq, sell, buy };
    }

    it("fill settles atomically with maker allowance", async function () {
        const { maker, filler, rfq, sell, buy } = await loadFixture(fixture);
        const sellAmt = ethers.parseEther("5");
        const minBuy = ethers.parseEther("1");
        const deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp + 3600);
        const order = {
            maker: maker.address,
            sellToken: await sell.getAddress(),
            buyToken: await buy.getAddress(),
            sellAmount: sellAmt,
            minBuyAmount: minBuy,
            deadline,
            salt: 7n,
        };
        await sell.connect(maker).mint(maker.address, sellAmt);
        await sell.connect(maker).approve(await rfq.getAddress(), sellAmt);
        await buy.connect(filler).mint(filler.address, minBuy);
        await buy.connect(filler).approve(await rfq.getAddress(), minBuy);

        const domain = await domainOf(rfq);
        const sig = await maker.signTypedData(domain, types, order);

        await rfq.connect(filler).fill(order, sig);
        expect(await sell.balanceOf(filler.address)).to.equal(sellAmt);
        expect(await buy.balanceOf(maker.address)).to.equal(minBuy);
    });

    it("reverts on double fill", async function () {
        const { maker, filler, rfq, sell, buy } = await loadFixture(fixture);
        const sellAmt = ethers.parseEther("1");
        const minBuy = 1n;
        const deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp + 3600);
        const order = {
            maker: maker.address,
            sellToken: await sell.getAddress(),
            buyToken: await buy.getAddress(),
            sellAmount: sellAmt,
            minBuyAmount: minBuy,
            deadline,
            salt: 8n,
        };
        await sell.connect(maker).mint(maker.address, sellAmt);
        await sell.connect(maker).approve(await rfq.getAddress(), sellAmt);
        await buy.connect(filler).mint(filler.address, minBuy);
        await buy.connect(filler).approve(await rfq.getAddress(), minBuy * 2n);

        const domain = await domainOf(rfq);
        const sig = await maker.signTypedData(domain, types, order);
        await rfq.connect(filler).fill(order, sig);
        await expect(rfq.connect(filler).fill(order, sig)).to.be.revertedWithCustomError(rfq, "AlreadyFilled");
    });

    it("reverts BadDeadline when deadline is in the past", async function () {
        const { maker, filler, rfq, sell, buy } = await loadFixture(fixture);
        const sellAmt = ethers.parseEther("1");
        const minBuy = 1n;
        const deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp - 1);
        const order = {
            maker: maker.address,
            sellToken: await sell.getAddress(),
            buyToken: await buy.getAddress(),
            sellAmount: sellAmt,
            minBuyAmount: minBuy,
            deadline,
            salt: 20n,
        };
        await sell.connect(maker).mint(maker.address, sellAmt);
        await sell.connect(maker).approve(await rfq.getAddress(), sellAmt);
        const domain = await domainOf(rfq);
        const sig = await maker.signTypedData(domain, types, order);
        await expect(rfq.connect(filler).fill(order, sig)).to.be.revertedWithCustomError(rfq, "BadDeadline");
    });

    it("reverts BadSig when signer is not maker", async function () {
        const { maker, filler, rfq, sell, buy } = await loadFixture(fixture);
        const sellAmt = ethers.parseEther("1");
        const minBuy = 1n;
        const deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp + 3600);
        const order = {
            maker: maker.address,
            sellToken: await sell.getAddress(),
            buyToken: await buy.getAddress(),
            sellAmount: sellAmt,
            minBuyAmount: minBuy,
            deadline,
            salt: 21n,
        };
        await sell.connect(maker).mint(maker.address, sellAmt);
        await sell.connect(maker).approve(await rfq.getAddress(), sellAmt);
        const domain = await domainOf(rfq);
        const badSig = await filler.signTypedData(domain, types, order);
        await expect(rfq.connect(filler).fill(order, badSig)).to.be.revertedWithCustomError(rfq, "BadSig");
    });

    it("reverts BadAmount for zero sellAmount", async function () {
        const { maker, filler, rfq, sell, buy } = await loadFixture(fixture);
        const deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp + 3600);
        const order = {
            maker: maker.address,
            sellToken: await sell.getAddress(),
            buyToken: await buy.getAddress(),
            sellAmount: 0n,
            minBuyAmount: 1n,
            deadline,
            salt: 22n,
        };
        const domain = await domainOf(rfq);
        const sig = await maker.signTypedData(domain, types, order);
        await expect(rfq.connect(filler).fill(order, sig)).to.be.revertedWithCustomError(rfq, "BadAmount");
    });

    it("reverts Paused", async function () {
        const { owner, maker, filler, rfq, sell, buy } = await loadFixture(fixture);
        const sellAmt = ethers.parseEther("1");
        const minBuy = 1n;
        const deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp + 3600);
        const order = {
            maker: maker.address,
            sellToken: await sell.getAddress(),
            buyToken: await buy.getAddress(),
            sellAmount: sellAmt,
            minBuyAmount: minBuy,
            deadline,
            salt: 23n,
        };
        await sell.connect(maker).mint(maker.address, sellAmt);
        await sell.connect(maker).approve(await rfq.getAddress(), sellAmt);
        const domain = await domainOf(rfq);
        const sig = await maker.signTypedData(domain, types, order);
        await rfq.connect(owner).setPaused(true);
        await expect(rfq.connect(filler).fill(order, sig)).to.be.revertedWithCustomError(rfq, "Paused");
    });
});
