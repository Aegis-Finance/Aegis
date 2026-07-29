const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("AegisPublicPoolRouter", function () {
  async function deployErc20PairFixture() {
    const [owner, alice] = await ethers.getSigners();
    const AGS = await ethers.getContractFactory("MintableTestToken");
    const ags = await AGS.deploy("AGS", "AGS");
    await ags.waitForDeployment();
    const Quote = await ethers.getContractFactory("MintableTestToken");
    const quote = await Quote.deploy("QUOTE", "Q");
    await quote.waitForDeployment();
    const agsAddr = await ags.getAddress();
    const quoteAddr = await quote.getAddress();

    const MockPool = await ethers.getContractFactory("MockPublicLiquidityPool");
    const pool1 = await MockPool.deploy(agsAddr, quoteAddr, false, ethers.parseEther("1000"), ethers.parseEther("100"));
    await pool1.waitForDeployment();
    const pool2 = await MockPool.deploy(agsAddr, quoteAddr, false, ethers.parseEther("1000"), ethers.parseEther("200"));
    await pool2.waitForDeployment();

    const Router = await ethers.getContractFactory("AegisPublicPoolRouter");
    const router = await Router.deploy(owner.address);
    await router.waitForDeployment();
    await router.addPool(await pool1.getAddress());
    await router.addPool(await pool2.getAddress());

    const big = ethers.parseEther("100000");
    await ags.mint(await pool1.getAddress(), big);
    await ags.mint(await pool2.getAddress(), big);
    await quote.mint(await pool1.getAddress(), big);
    await quote.mint(await pool2.getAddress(), big);

    return { owner, alice, ags, quote, pool1, pool2, router };
  }

  it("reverts bestQuote when no pools", async function () {
    const [owner] = await ethers.getSigners();
    const Router = await ethers.getContractFactory("AegisPublicPoolRouter");
    const router = await Router.deploy(owner.address);
    await router.waitForDeployment();
    await expect(router.bestQuote(true, ethers.parseEther("1"))).to.be.revertedWithCustomError(router, "NoPools");
  });

  it("bestQuote picks pool with higher output (ags -> quote)", async function () {
    const { pool1, pool2, router } = await loadFixture(deployErc20PairFixture);
    const amountIn = ethers.parseEther("10");
    const q1 = await pool1.quoteSwap(true, amountIn);
    const q2 = await pool2.quoteSwap(true, amountIn);
    expect(q2).to.be.gt(q1);
    const [bestPool, bestOut] = await router.bestQuote(true, amountIn);
    expect(bestPool).to.equal(await pool2.getAddress());
    expect(bestOut).to.equal(q2);
  });

  it("reverts addPool on pair mismatch", async function () {
    const { owner, ags, quote, pool1, router } = await loadFixture(deployErc20PairFixture);
    const AGS2 = await ethers.getContractFactory("MintableTestToken");
    const ags2 = await AGS2.deploy("AGS2", "A2");
    await ags2.waitForDeployment();
    const MockPool = await ethers.getContractFactory("MockPublicLiquidityPool");
    const badPool = await MockPool.deploy(
      await ags2.getAddress(),
      await quote.getAddress(),
      false,
      ethers.parseEther("1000"),
      ethers.parseEther("100")
    );
    await badPool.waitForDeployment();
    await expect(router.addPool(await badPool.getAddress())).to.be.revertedWithCustomError(router, "PairMismatch");
    await expect(router.addPool(await pool1.getAddress())).to.be.reverted; // duplicate set add returns false -> revert()
  });

  it("swapExactInputOnBest routes ags->quote through best pool", async function () {
    const { alice, ags, quote, pool1, pool2, router } = await loadFixture(deployErc20PairFixture);
    const amountIn = ethers.parseEther("10");
    const minOut = 0n;
    const rAddr = await router.getAddress();

    await ags.mint(alice.address, amountIn);
    await ags.connect(alice).approve(rAddr, amountIn);

    const quoteBefore = await quote.balanceOf(alice.address);
    const expectedOut = await pool2.quoteSwap(true, amountIn);
    await router.connect(alice).swapExactInputOnBest(true, amountIn, minOut, alice.address);
    const quoteAfter = await quote.balanceOf(alice.address);
    expect(quoteAfter - quoteBefore).to.equal(expectedOut);
    expect(await ags.balanceOf(await pool2.getAddress())).to.be.gt(ethers.parseEther("1000"));
  });

  it("swapExactInputOnBest quote->ags with ERC20 quote", async function () {
    const { alice, ags, quote, pool2, router } = await loadFixture(deployErc20PairFixture);
    const amountIn = ethers.parseEther("5");
    const minOut = 0n;
    const rAddr = await router.getAddress();

    await quote.mint(alice.address, amountIn);
    await quote.connect(alice).approve(rAddr, amountIn);

    const [, expectedOut] = await router.bestQuote(false, amountIn);
    const agsBefore = await ags.balanceOf(alice.address);
    await router.connect(alice).swapExactInputOnBest(false, amountIn, minOut, alice.address);
    expect((await ags.balanceOf(alice.address)) - agsBefore).to.equal(expectedOut);
  });

  it("ignores pools that revert on quote", async function () {
    const { owner, ags, quote, pool1, pool2, router } = await loadFixture(deployErc20PairFixture);
    await pool1.setFailQuote(true);
    const amountIn = ethers.parseEther("10");
    const [bestPool, bestOut] = await router.bestQuote(true, amountIn);
    expect(bestPool).to.equal(await pool2.getAddress());
    expect(bestOut).to.equal(await pool2.quoteSwap(true, amountIn));
  });

  it("removePool shrinks set", async function () {
    const { owner, pool1, router } = await loadFixture(deployErc20PairFixture);
    expect(await router.poolCount()).to.equal(2n);
    await router.removePool(await pool1.getAddress());
    expect(await router.poolCount()).to.equal(1n);
  });
});

describe("AegisPublicPoolRouter (native quote)", function () {
  async function deployNativeFixture() {
    const [owner, alice] = await ethers.getSigners();
    const AGS = await ethers.getContractFactory("MintableTestToken");
    const ags = await AGS.deploy("AGS", "AGS");
    await ags.waitForDeployment();
    const agsAddr = await ags.getAddress();
    const zero = ethers.ZeroAddress;

    const MockPool = await ethers.getContractFactory("MockPublicLiquidityPool");
    const pool = await MockPool.deploy(agsAddr, zero, true, ethers.parseEther("1000"), ethers.parseEther("50"));
    await pool.waitForDeployment();

    const Router = await ethers.getContractFactory("AegisPublicPoolRouter");
    const router = await Router.deploy(owner.address);
    await router.waitForDeployment();
    await router.addPool(await pool.getAddress());

    await owner.sendTransaction({ to: await pool.getAddress(), value: ethers.parseEther("100") });
    await ags.mint(await pool.getAddress(), ethers.parseEther("100000"));

    return { owner, alice, ags, pool, router };
  }

  it("swapExactInputOnBest forwards native value for quote->ags", async function () {
    const { alice, ags, pool, router } = await loadFixture(deployNativeFixture);
    const amountIn = ethers.parseEther("1");
    const minOut = 0n;
    const expectedOut = await pool.quoteSwap(false, amountIn);

    const agsBefore = await ags.balanceOf(alice.address);
    await router.connect(alice).swapExactInputOnBest(false, amountIn, minOut, alice.address, { value: amountIn });
    expect((await ags.balanceOf(alice.address)) - agsBefore).to.equal(expectedOut);
  });
});
