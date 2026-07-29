const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("TreasuryBondAuction", function () {
    async function fixture() {
        const [owner, gov, buyer] = await ethers.getSigners();
        const Token = await ethers.getContractFactory("MintableTestToken");
        const ags = await Token.deploy("AGS", "AGS");
        const quote = await Token.deploy("QUOTE", "Q");
        const Auction = await ethers.getContractFactory("TreasuryBondAuction");
        const auction = await Auction.deploy(owner.address, await ags.getAddress(), await quote.getAddress());
        await auction.setGovernance(gov.address);
        return { owner, gov, buyer, ags, quote, auction };
    }

    it("opens auction, purchase, redeem after maturity", async function () {
        const { gov, buyer, ags, quote, auction } = await loadFixture(fixture);
        const cap = ethers.parseEther("1000");
        await ags.mint(await auction.getAddress(), cap);

        const now = BigInt(await time.latest());
        const start = now + 10n;
        const end = start + 100n;
        const mat = end + 50n;
        const startPrice = ethers.parseEther("2");
        const reserve = ethers.parseEther("1");

        await auction.connect(gov).openAuction(cap, startPrice, reserve, start, end, mat);

        await time.setNextBlockTimestamp(Number(start + 20n));
        await quote.mint(buyer.address, ethers.parseEther("10000"));
        await quote.connect(buyer).approve(await auction.getAddress(), ethers.parseEther("10000"));

        const tx = await auction.connect(buyer).purchase(ethers.parseEther("500"), 1n);
        await tx.wait();
        const noteId = (await auction.nextNoteId()) - 1n;

        await time.increaseTo(Number(mat + 1n));
        const before = await ags.balanceOf(buyer.address);
        await auction.connect(buyer).redeem(noteId);
        const after = await ags.balanceOf(buyer.address);
        expect(after > before).to.equal(true);
    });

    it("purchaseTo assigns note to holder while payer supplies quote", async function () {
        const { gov, buyer, ags, quote, auction } = await loadFixture(fixture);
        const [, , , holder] = await ethers.getSigners();
        const cap = ethers.parseEther("1000");
        await ags.mint(await auction.getAddress(), cap);

        const now = BigInt(await time.latest());
        const start = now + 10n;
        const end = start + 100n;
        const mat = end + 50n;
        await auction.connect(gov).openAuction(cap, ethers.parseEther("2"), ethers.parseEther("1"), start, end, mat);

        await time.setNextBlockTimestamp(Number(start + 20n));
        await quote.mint(buyer.address, ethers.parseEther("10000"));
        await quote.connect(buyer).approve(await auction.getAddress(), ethers.parseEther("10000"));

        const tx = await auction.connect(buyer).purchaseTo(holder.address, ethers.parseEther("500"), 1n);
        await tx.wait();
        const noteId = (await auction.nextNoteId()) - 1n;
        expect(await auction.noteOwner(noteId)).to.equal(holder.address);

        await time.increaseTo(Number(mat + 1n));
        const before = await ags.balanceOf(holder.address);
        await auction.connect(holder).redeem(noteId);
        expect((await ags.balanceOf(holder.address)) > before).to.equal(true);
    });

    it("reverts redeem for wrong account", async function () {
        const { gov, buyer, ags, quote, auction } = await loadFixture(fixture);
        const [, , , stranger] = await ethers.getSigners();
        const cap = ethers.parseEther("100");
        await ags.mint(await auction.getAddress(), cap);
        const now = BigInt(await time.latest());
        const start = now + 5n;
        const end = start + 20n;
        const mat = end + 10n;
        await auction.connect(gov).openAuction(cap, ethers.parseEther("2"), ethers.parseEther("1"), start, end, mat);
        await time.setNextBlockTimestamp(Number(start + 2n));
        await quote.mint(buyer.address, ethers.parseEther("1000"));
        await quote.connect(buyer).approve(await auction.getAddress(), ethers.parseEther("1000"));
        const tx = await auction.connect(buyer).purchase(ethers.parseEther("50"), 1n);
        await tx.wait();
        const noteId = (await auction.nextNoteId()) - 1n;
        await time.increaseTo(Number(mat + 1n));
        await expect(auction.connect(stranger).redeem(noteId)).to.be.revertedWithCustomError(auction, "UnauthorizedAccess");
    });
});
