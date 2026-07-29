const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("SignedLimitOrderRegistry", function () {
    const types = {
        LimitOrder: [
            { name: "maker", type: "address" },
            { name: "sellToken", type: "address" },
            { name: "buyToken", type: "address" },
            { name: "sellAmount", type: "uint256" },
            { name: "minBuyAmount", type: "uint256" },
            { name: "expiry", type: "uint256" },
            { name: "salt", type: "uint256" },
        ],
    };

    async function domainOf(registry) {
        const d = await registry.eip712Domain();
        return {
            name: d.name,
            version: d.version,
            chainId: Number(d.chainId),
            verifyingContract: await registry.getAddress(),
        };
    }

    async function fixture() {
        const [owner, maker, filler] = await ethers.getSigners();
        const Reg = await ethers.getContractFactory("SignedLimitOrderRegistry");
        const registry = await Reg.deploy(owner.address);
        const Base = await ethers.getContractFactory("MintableTestToken");
        const sell = await Base.deploy("Sell", "SELL");
        const buy = await Base.deploy("Buy", "BUY");
        return { owner, maker, filler, registry, sell, buy };
    }

    it("place → fill moves tokens at limit", async function () {
        const { maker, filler, registry, sell, buy } = await loadFixture(fixture);
        const sellAmt = ethers.parseEther("10");
        const minBuy = ethers.parseEther("2");
        const expiry = BigInt((await time.latest()) + 3600);
        const salt = 1n;
        await sell.connect(maker).mint(maker.address, sellAmt);
        await sell.connect(maker).approve(await registry.getAddress(), sellAmt);
        await buy.connect(filler).mint(filler.address, minBuy);
        await buy.connect(filler).approve(await registry.getAddress(), minBuy);

        const order = {
            maker: maker.address,
            sellToken: await sell.getAddress(),
            buyToken: await buy.getAddress(),
            sellAmount: sellAmt,
            minBuyAmount: minBuy,
            expiry,
            salt,
        };
        const domain = await domainOf(registry);
        const sig = await maker.signTypedData(domain, types, order);

        const tx = await registry.place(order, sig);
        await tx.wait();
        const id = (await registry.nextOrderId()) - 1n;

        await registry.connect(filler).fill(id, order);
        expect(await sell.balanceOf(filler.address)).to.equal(sellAmt);
        expect(await buy.balanceOf(maker.address)).to.equal(minBuy);
    });

    it("reclaimExpired returns escrow to maker", async function () {
        const { maker, registry, sell, buy } = await loadFixture(fixture);
        const sellAmt = ethers.parseEther("1");
        const minBuy = 1n;
        const expiry = BigInt((await time.latest()) + 5);
        const salt = 2n;
        await sell.connect(maker).mint(maker.address, sellAmt);
        await sell.connect(maker).approve(await registry.getAddress(), sellAmt);
        const order = {
            maker: maker.address,
            sellToken: await sell.getAddress(),
            buyToken: await buy.getAddress(),
            sellAmount: sellAmt,
            minBuyAmount: minBuy,
            expiry,
            salt,
        };
        const domain = await domainOf(registry);
        const sig = await maker.signTypedData(domain, types, order);
        const tx = await registry.place(order, sig);
        await tx.wait();
        const id = (await registry.nextOrderId()) - 1n;

        await time.increaseTo(Number(expiry + 1n));
        await registry.connect(maker).reclaimExpired(id, order);
        expect(await sell.balanceOf(maker.address)).to.equal(sellAmt);
    });

    it("cancel returns escrow before expiry", async function () {
        const { maker, registry, sell, buy } = await loadFixture(fixture);
        const sellAmt = ethers.parseEther("3");
        const minBuy = 1n;
        const expiry = BigInt((await time.latest()) + 3600);
        const salt = 11n;
        await sell.connect(maker).mint(maker.address, sellAmt);
        await sell.connect(maker).approve(await registry.getAddress(), sellAmt);
        const order = {
            maker: maker.address,
            sellToken: await sell.getAddress(),
            buyToken: await buy.getAddress(),
            sellAmount: sellAmt,
            minBuyAmount: minBuy,
            expiry,
            salt,
        };
        const domain = await domainOf(registry);
        const sig = await maker.signTypedData(domain, types, order);
        await registry.place(order, sig);
        const id = (await registry.nextOrderId()) - 1n;
        await registry.connect(maker).cancel(id, order, sig);
        expect(await sell.balanceOf(maker.address)).to.equal(sellAmt);
        expect(await registry.orderActive(id)).to.equal(false);
    });

    it("fill reverts OrderExpired after expiry", async function () {
        const { maker, filler, registry, sell, buy } = await loadFixture(fixture);
        const sellAmt = ethers.parseEther("1");
        const minBuy = ethers.parseEther("1");
        const expiry = BigInt((await time.latest()) + 10);
        const salt = 12n;
        await sell.connect(maker).mint(maker.address, sellAmt);
        await sell.connect(maker).approve(await registry.getAddress(), sellAmt);
        await buy.connect(filler).mint(filler.address, minBuy);
        await buy.connect(filler).approve(await registry.getAddress(), minBuy);
        const order = {
            maker: maker.address,
            sellToken: await sell.getAddress(),
            buyToken: await buy.getAddress(),
            sellAmount: sellAmt,
            minBuyAmount: minBuy,
            expiry,
            salt,
        };
        const domain = await domainOf(registry);
        const sig = await maker.signTypedData(domain, types, order);
        await registry.place(order, sig);
        const id = (await registry.nextOrderId()) - 1n;
        await time.increaseTo(Number(expiry + 1n));
        await expect(registry.connect(filler).fill(id, order)).to.be.revertedWithCustomError(registry, "OrderExpired");
    });

    it("cancel reverts OrderExpired after expiry (use reclaimExpired)", async function () {
        const { maker, registry, sell, buy } = await loadFixture(fixture);
        const sellAmt = ethers.parseEther("1");
        const minBuy = 1n;
        const expiry = BigInt((await time.latest()) + 8);
        const salt = 13n;
        await sell.connect(maker).mint(maker.address, sellAmt);
        await sell.connect(maker).approve(await registry.getAddress(), sellAmt);
        const order = {
            maker: maker.address,
            sellToken: await sell.getAddress(),
            buyToken: await buy.getAddress(),
            sellAmount: sellAmt,
            minBuyAmount: minBuy,
            expiry,
            salt,
        };
        const domain = await domainOf(registry);
        const sig = await maker.signTypedData(domain, types, order);
        await registry.place(order, sig);
        const id = (await registry.nextOrderId()) - 1n;
        await time.increaseTo(Number(expiry + 1n));
        await expect(registry.connect(maker).cancel(id, order, sig)).to.be.revertedWithCustomError(registry, "OrderExpired");
    });

    it("reclaimExpired reverts NotExpired before expiry", async function () {
        const { maker, registry, sell, buy } = await loadFixture(fixture);
        const sellAmt = ethers.parseEther("1");
        const minBuy = 1n;
        const expiry = BigInt((await time.latest()) + 500);
        const salt = 14n;
        await sell.connect(maker).mint(maker.address, sellAmt);
        await sell.connect(maker).approve(await registry.getAddress(), sellAmt);
        const order = {
            maker: maker.address,
            sellToken: await sell.getAddress(),
            buyToken: await buy.getAddress(),
            sellAmount: sellAmt,
            minBuyAmount: minBuy,
            expiry,
            salt,
        };
        const domain = await domainOf(registry);
        const sig = await maker.signTypedData(domain, types, order);
        await registry.place(order, sig);
        const id = (await registry.nextOrderId()) - 1n;
        await expect(registry.connect(maker).reclaimExpired(id, order)).to.be.revertedWithCustomError(registry, "NotExpired");
    });

    it("reclaimExpired reverts NotMaker for non-maker", async function () {
        const { maker, filler, registry, sell, buy } = await loadFixture(fixture);
        const sellAmt = ethers.parseEther("1");
        const minBuy = 1n;
        const expiry = BigInt((await time.latest()) + 5);
        const salt = 15n;
        await sell.connect(maker).mint(maker.address, sellAmt);
        await sell.connect(maker).approve(await registry.getAddress(), sellAmt);
        const order = {
            maker: maker.address,
            sellToken: await sell.getAddress(),
            buyToken: await buy.getAddress(),
            sellAmount: sellAmt,
            minBuyAmount: minBuy,
            expiry,
            salt,
        };
        const domain = await domainOf(registry);
        const sig = await maker.signTypedData(domain, types, order);
        await registry.place(order, sig);
        const id = (await registry.nextOrderId()) - 1n;
        await time.increaseTo(Number(expiry + 1n));
        await expect(registry.connect(filler).reclaimExpired(id, order)).to.be.revertedWithCustomError(registry, "NotMaker");
    });

    it("place reverts DuplicateDigest when same signed order placed twice", async function () {
        const { maker, registry, sell, buy } = await loadFixture(fixture);
        const sellAmt = ethers.parseEther("1");
        const minBuy = 1n;
        const expiry = BigInt((await time.latest()) + 3600);
        const salt = 16n;
        await sell.connect(maker).mint(maker.address, sellAmt * 2n);
        await sell.connect(maker).approve(await registry.getAddress(), sellAmt * 2n);
        const order = {
            maker: maker.address,
            sellToken: await sell.getAddress(),
            buyToken: await buy.getAddress(),
            sellAmount: sellAmt,
            minBuyAmount: minBuy,
            expiry,
            salt,
        };
        const domain = await domainOf(registry);
        const sig = await maker.signTypedData(domain, types, order);
        await registry.place(order, sig);
        await expect(registry.place(order, sig)).to.be.revertedWithCustomError(registry, "DuplicateDigest");
    });

    it("place reverts BadSig when signer is not maker", async function () {
        const { maker, filler, registry, sell, buy } = await loadFixture(fixture);
        const sellAmt = ethers.parseEther("1");
        const minBuy = 1n;
        const expiry = BigInt((await time.latest()) + 3600);
        const salt = 17n;
        await sell.connect(maker).mint(maker.address, sellAmt);
        await sell.connect(maker).approve(await registry.getAddress(), sellAmt);
        const order = {
            maker: maker.address,
            sellToken: await sell.getAddress(),
            buyToken: await buy.getAddress(),
            sellAmount: sellAmt,
            minBuyAmount: minBuy,
            expiry,
            salt,
        };
        const domain = await domainOf(registry);
        const badSig = await filler.signTypedData(domain, types, order);
        await expect(registry.place(order, badSig)).to.be.revertedWithCustomError(registry, "BadSig");
    });

    it("fill reverts OrderMismatch when calldata does not match stored digest", async function () {
        const { maker, filler, registry, sell, buy } = await loadFixture(fixture);
        const sellAmt = ethers.parseEther("10");
        const minBuy = ethers.parseEther("2");
        const expiry = BigInt((await time.latest()) + 3600);
        const salt = 18n;
        await sell.connect(maker).mint(maker.address, sellAmt);
        await sell.connect(maker).approve(await registry.getAddress(), sellAmt);
        await buy.connect(filler).mint(filler.address, minBuy);
        await buy.connect(filler).approve(await registry.getAddress(), minBuy);
        const order = {
            maker: maker.address,
            sellToken: await sell.getAddress(),
            buyToken: await buy.getAddress(),
            sellAmount: sellAmt,
            minBuyAmount: minBuy,
            expiry,
            salt,
        };
        const domain = await domainOf(registry);
        const sig = await maker.signTypedData(domain, types, order);
        await registry.place(order, sig);
        const id = (await registry.nextOrderId()) - 1n;
        const tampered = { ...order, minBuyAmount: minBuy + 1n };
        await expect(registry.connect(filler).fill(id, tampered)).to.be.revertedWithCustomError(registry, "OrderMismatch");
    });

    it("place reverts Paused", async function () {
        const { owner, maker, registry, sell, buy } = await loadFixture(fixture);
        const sellAmt = ethers.parseEther("1");
        const minBuy = 1n;
        const expiry = BigInt((await time.latest()) + 3600);
        const salt = 19n;
        await sell.connect(maker).mint(maker.address, sellAmt);
        await sell.connect(maker).approve(await registry.getAddress(), sellAmt);
        const order = {
            maker: maker.address,
            sellToken: await sell.getAddress(),
            buyToken: await buy.getAddress(),
            sellAmount: sellAmt,
            minBuyAmount: minBuy,
            expiry,
            salt,
        };
        const domain = await domainOf(registry);
        const sig = await maker.signTypedData(domain, types, order);
        await registry.connect(owner).setPaused(true);
        await expect(registry.place(order, sig)).to.be.revertedWithCustomError(registry, "Paused");
    });
});
