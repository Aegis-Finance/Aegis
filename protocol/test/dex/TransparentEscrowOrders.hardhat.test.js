const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("TransparentEscrowOrders", function () {
  async function deployFixture() {
    const [owner, maker, filler] = await ethers.getSigners();
    const AGS = await ethers.getContractFactory("MintableTestToken");
    const ags = await AGS.deploy("AGS", "AGS");
    await ags.waitForDeployment();
    const Quote = await ethers.getContractFactory("MintableTestToken");
    const quote = await Quote.deploy("QUOTE", "Q");
    await quote.waitForDeployment();

    const Escrow = await ethers.getContractFactory("TransparentEscrowOrders");
    const escrow = await Escrow.deploy(owner.address, await ags.getAddress());
    await escrow.waitForDeployment();

    return { owner, maker, filler, ags, quote, escrow };
  }

  it("createSellOrder escrows AGS and increments id", async function () {
    const { maker, ags, quote, escrow } = await loadFixture(deployFixture);
    const amount = ethers.parseEther("100");
    const quoteTotal = ethers.parseEther("10");
    const expiry = (await time.latest()) + 86400;
    await ags.mint(maker.address, amount);
    await ags.connect(maker).approve(await escrow.getAddress(), amount);

    await expect(escrow.connect(maker).createSellOrder(amount, quoteTotal, await quote.getAddress(), false, expiry))
      .to.emit(escrow, "SellOrderCreated")
      .withArgs(0n, maker.address, amount, quoteTotal, await quote.getAddress(), false, expiry);

    expect(await escrow.nextOrderId()).to.equal(1n);
    const o = await escrow.orders(0);
    expect(o.maker).to.equal(maker.address);
    expect(o.amountAgs).to.equal(amount);
    expect(o.quoteTotal).to.equal(quoteTotal);
    expect(o.filled).to.equal(false);
    expect(await ags.balanceOf(await escrow.getAddress())).to.equal(amount);
  });

  it("fillSellOrder transfers quote to maker and AGS to filler", async function () {
    const { maker, filler, ags, quote, escrow } = await loadFixture(deployFixture);
    const amount = ethers.parseEther("100");
    const quoteTotal = ethers.parseEther("10");
    const expiry = (await time.latest()) + 86400;
    await ags.mint(maker.address, amount);
    await ags.connect(maker).approve(await escrow.getAddress(), amount);
    await escrow.connect(maker).createSellOrder(amount, quoteTotal, await quote.getAddress(), false, expiry);

    await quote.mint(filler.address, quoteTotal);
    await quote.connect(filler).approve(await escrow.getAddress(), quoteTotal);

    const makerQuoteBefore = await quote.balanceOf(maker.address);
    await escrow.connect(filler).fillSellOrder(0);
    expect((await quote.balanceOf(maker.address)) - makerQuoteBefore).to.equal(quoteTotal);
    expect(await ags.balanceOf(filler.address)).to.equal(amount);
    expect((await escrow.orders(0)).filled).to.equal(true);
  });

  it("cancelOrder returns AGS before expiry", async function () {
    const { maker, ags, quote, escrow } = await loadFixture(deployFixture);
    const amount = ethers.parseEther("50");
    const quoteTotal = ethers.parseEther("5");
    const expiry = (await time.latest()) + 86400;
    await ags.mint(maker.address, amount * 2n);
    await ags.connect(maker).approve(await escrow.getAddress(), amount * 2n);
    await escrow.connect(maker).createSellOrder(amount, quoteTotal, await quote.getAddress(), false, expiry);

    await escrow.connect(maker).cancelOrder(0);
    expect(await ags.balanceOf(maker.address)).to.equal(amount * 2n);
    expect((await escrow.orders(0)).cancelled).to.equal(true);
  });

  it("reclaimExpired after expiry", async function () {
    const { maker, ags, quote, escrow } = await loadFixture(deployFixture);
    const amount = ethers.parseEther("20");
    const quoteTotal = ethers.parseEther("2");
    const expiry = (await time.latest()) + 100;
    await ags.mint(maker.address, amount);
    await ags.connect(maker).approve(await escrow.getAddress(), amount);
    await escrow.connect(maker).createSellOrder(amount, quoteTotal, await quote.getAddress(), false, expiry);

    await time.increaseTo(expiry + 1);
    await escrow.connect(maker).reclaimExpired(0);
    expect(await ags.balanceOf(maker.address)).to.equal(amount);
  });

  it("fillSellOrder native sends ETH to maker", async function () {
    const { owner, maker, filler, ags, escrow } = await loadFixture(deployFixture);
    const amount = ethers.parseEther("10");
    const quoteTotal = ethers.parseEther("1");
    const expiry = (await time.latest()) + 86400;
    await ags.mint(maker.address, amount);
    await ags.connect(maker).approve(await escrow.getAddress(), amount);
    await escrow.connect(maker).createSellOrder(amount, quoteTotal, ethers.ZeroAddress, true, expiry);

    const makerEthBefore = await ethers.provider.getBalance(maker.address);
    await escrow.connect(filler).fillSellOrder(0, { value: quoteTotal });
    expect(await ethers.provider.getBalance(maker.address)).to.be.gt(makerEthBefore);
    expect(await ags.balanceOf(filler.address)).to.equal(amount);
  });

  it("setPaused blocks create and fill", async function () {
    const { owner, maker, filler, ags, quote, escrow } = await loadFixture(deployFixture);
    await escrow.connect(owner).setPaused(true);
    const amount = ethers.parseEther("1");
    const expiry = (await time.latest()) + 86400;
    await ags.mint(maker.address, amount);
    await ags.connect(maker).approve(await escrow.getAddress(), amount);
    await expect(
      escrow.connect(maker).createSellOrder(amount, 1n, await quote.getAddress(), false, expiry)
    ).to.be.revertedWithCustomError(escrow, "Paused");

    await escrow.connect(owner).setPaused(false);
    await escrow.connect(maker).createSellOrder(amount, 1n, await quote.getAddress(), false, expiry);
    await quote.mint(filler.address, 1n);
    await quote.connect(filler).approve(await escrow.getAddress(), 1n);
    await escrow.connect(owner).setPaused(true);
    await expect(escrow.connect(filler).fillSellOrder(1)).to.be.revertedWithCustomError(escrow, "Paused");
  });
});
