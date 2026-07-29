const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("TokenDistributionSale", function () {
    function zeroProof() {
        return [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n];
    }

    async function deployFixture() {
        const [owner, buyer] = await ethers.getSigners();
        const MockVF = await ethers.getContractFactory("MockVerifierFactory");
        const factory = await MockVF.deploy();
        const Token = await ethers.getContractFactory("MintableTestToken");
        const token = await Token.deploy("Sale", "SALE");
        const Sale = await ethers.getContractFactory("TokenDistributionSale");
        const sale = await Sale.deploy(
            owner.address,
            await factory.getAddress(),
            await token.getAddress(),
            owner.address
        );
        const now = BigInt(await time.latest());
        const start = now + 100n;
        const end = start + 10_000n;
        const startPrice = ethers.parseEther("100");
        const reserve = ethers.parseEther("10");
        await sale.connect(owner).setSaleWindow(startPrice, reserve, start, end, true);
        const root = ethers.hexlify(ethers.randomBytes(32));
        const cap = 5000n;
        const supply = 1_000_000n;
        await sale.connect(owner).setMerkleRoot(root);
        await sale.connect(owner).setSaleParameters(cap, supply);
        return { owner, buyer, factory, token, sale, start, end, startPrice, reserve, root, cap, supply };
    }

    async function inWindow(f) {
        await time.setNextBlockTimestamp(Number(f.start + 500n));
    }

    it("mints when proof verifies and public inputs bind to sale state", async function () {
        const f = await loadFixture(deployFixture);
        await inWindow(f);
        const amount = 1000n;
        const spot = await f.sale.spotAuctionPrice();
        const cost = await f.sale.ethForPurchaseAmount(amount, spot);
        const commitment = ethers.hexlify(ethers.randomBytes(32));
        const nullifier = ethers.hexlify(ethers.randomBytes(32));
        const pub = [
            1n,
            commitment,
            nullifier,
            spot,
            f.cap,
            f.supply,
            f.root,
            amount,
        ];
        await expect(f.sale.connect(f.buyer).purchase(zeroProof(), pub, { value: cost })).to.emit(
            f.sale,
            "Purchased"
        );
        expect(await f.token.balanceOf(f.buyer.address)).to.equal(amount);
        expect(await f.sale.supplyRemaining()).to.equal(f.supply - amount);
        expect(await f.sale.nullifierSpent(nullifier)).to.equal(true);
    });

    it("reverts when nullifier is reused", async function () {
        const f = await loadFixture(deployFixture);
        await inWindow(f);
        const amount = 100n;
        const spot = await f.sale.spotAuctionPrice();
        const cost = await f.sale.ethForPurchaseAmount(amount, spot);
        const commitment = ethers.hexlify(ethers.randomBytes(32));
        const nullifier = ethers.hexlify(ethers.randomBytes(32));
        const pub = [1n, commitment, nullifier, spot, f.cap, f.supply, f.root, amount];
        await f.sale.connect(f.buyer).purchase(zeroProof(), pub, { value: cost });
        const pub2 = [1n, ethers.hexlify(ethers.randomBytes(32)), nullifier, spot, f.cap, f.supply - amount, f.root, amount];
        const spot2 = await f.sale.spotAuctionPrice();
        pub2[3] = spot2;
        await expect(
            f.sale.connect(f.buyer).purchase(zeroProof(), pub2, { value: await f.sale.ethForPurchaseAmount(amount, spot2) })
        ).to.be.revertedWithCustomError(f.sale, "TDSale_NullifierReplay");
    });

    it("reverts when merkle root in proof does not match sale", async function () {
        const f = await loadFixture(deployFixture);
        await inWindow(f);
        const amount = 50n;
        const spot = await f.sale.spotAuctionPrice();
        const cost = await f.sale.ethForPurchaseAmount(amount, spot);
        const wrongRoot = ethers.hexlify(ethers.randomBytes(32));
        const pub = [
            1n,
            ethers.hexlify(ethers.randomBytes(32)),
            ethers.hexlify(ethers.randomBytes(32)),
            spot,
            f.cap,
            f.supply,
            wrongRoot,
            amount,
        ];
        await expect(f.sale.connect(f.buyer).purchase(zeroProof(), pub, { value: cost })).to.be.revertedWithCustomError(
            f.sale,
            "TDSale_InvalidMerkle"
        );
    });

    it("reverts when auction price in proof does not match spot", async function () {
        const f = await loadFixture(deployFixture);
        await inWindow(f);
        const amount = 50n;
        const spot = await f.sale.spotAuctionPrice();
        const cost = await f.sale.ethForPurchaseAmount(amount, spot);
        const pub = [
            1n,
            ethers.hexlify(ethers.randomBytes(32)),
            ethers.hexlify(ethers.randomBytes(32)),
            spot + 1n,
            f.cap,
            f.supply,
            f.root,
            amount,
        ];
        await expect(f.sale.connect(f.buyer).purchase(zeroProof(), pub, { value: cost })).to.be.revertedWithCustomError(
            f.sale,
            "TDSale_InvalidAuctionBinding"
        );
    });

    it("reverts when verifier returns false", async function () {
        const f = await loadFixture(deployFixture);
        await inWindow(f);
        const v = await ethers.getContractAt("MockZKVerifier", await f.factory.defaultVerifier());
        await v.setShouldVerify(false);
        const amount = 10n;
        const spot = await f.sale.spotAuctionPrice();
        const cost = await f.sale.ethForPurchaseAmount(amount, spot);
        const pub = [
            1n,
            ethers.hexlify(ethers.randomBytes(32)),
            ethers.hexlify(ethers.randomBytes(32)),
            spot,
            f.cap,
            f.supply,
            f.root,
            amount,
        ];
        await expect(f.sale.connect(f.buyer).purchase(zeroProof(), pub, { value: cost })).to.be.revertedWithCustomError(
            f.sale,
            "TDSale_InvalidProof"
        );
        await v.setShouldVerify(true);
    });

    it("reverts when valid flag is not 1", async function () {
        const f = await loadFixture(deployFixture);
        await inWindow(f);
        const amount = 10n;
        const spot = await f.sale.spotAuctionPrice();
        const cost = await f.sale.ethForPurchaseAmount(amount, spot);
        const pub = [
            0n,
            ethers.hexlify(ethers.randomBytes(32)),
            ethers.hexlify(ethers.randomBytes(32)),
            spot,
            f.cap,
            f.supply,
            f.root,
            amount,
        ];
        await expect(f.sale.connect(f.buyer).purchase(zeroProof(), pub, { value: cost })).to.be.revertedWithCustomError(
            f.sale,
            "TD_InvalidValidFlag"
        );
    });

    it("reverts when ETH is insufficient", async function () {
        const f = await loadFixture(deployFixture);
        await inWindow(f);
        const amount = 1000n;
        const spot = await f.sale.spotAuctionPrice();
        const cost = await f.sale.ethForPurchaseAmount(amount, spot);
        const pub = [
            1n,
            ethers.hexlify(ethers.randomBytes(32)),
            ethers.hexlify(ethers.randomBytes(32)),
            spot,
            f.cap,
            f.supply,
            f.root,
            amount,
        ];
        await expect(
            f.sale.connect(f.buyer).purchase(zeroProof(), pub, { value: cost - 1n })
        ).to.be.revertedWithCustomError(f.sale, "TDSale_InsufficientEth");
    });

    it("refunds excess ETH (sale holds no wei after purchase)", async function () {
        const f = await loadFixture(deployFixture);
        await inWindow(f);
        const amount = 100n;
        const spot = await f.sale.spotAuctionPrice();
        const cost = await f.sale.ethForPurchaseAmount(amount, spot);
        const overpay = cost + ethers.parseEther("1");
        const pub = [
            1n,
            ethers.hexlify(ethers.randomBytes(32)),
            ethers.hexlify(ethers.randomBytes(32)),
            spot,
            f.cap,
            f.supply,
            f.root,
            amount,
        ];
        await f.sale.connect(f.buyer).purchase(zeroProof(), pub, { value: overpay });
        expect(await ethers.provider.getBalance(await f.sale.getAddress())).to.equal(0n);
        expect(await f.token.balanceOf(f.buyer.address)).to.equal(amount);
    });
});
