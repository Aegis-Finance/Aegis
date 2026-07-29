const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("AegisCanonicalSwapRouter", function () {
  async function deployFixture() {
    const [owner, alice] = await ethers.getSigners();

    const AGS = await ethers.getContractFactory("MintableTestToken");
    const ags = await AGS.deploy("AGS", "AGS");
    await ags.waitForDeployment();
    const WETH = await ethers.getContractFactory("MintableTestToken");
    const weth = await WETH.deploy("wS", "wS");
    await weth.waitForDeployment();
    const USDC = await ethers.getContractFactory("MintableTestToken");
    const usdc = await USDC.deploy("USDC", "USDC");
    await usdc.waitForDeployment();

    const agsAddr = await ags.getAddress();
    const wethAddr = await weth.getAddress();
    const usdcAddr = await usdc.getAddress();

    const MockDeployer = await ethers.getContractFactory("contracts/test/TokenDistributionMocks.sol:MockLiquidityDeployer");
    const deployer = await MockDeployer.deploy();
    await deployer.waitForDeployment();

    const MockFactory = await ethers.getContractFactory("contracts/test/MockUniswapV3Pool.sol:MockUniswapV3Factory");
    const factory = await MockFactory.deploy();
    await factory.waitForDeployment();

    const MockPool = await ethers.getContractFactory("contracts/test/MockUniswapV3Pool.sol:MockUniswapV3Pool");
    const v3Pool = await MockPool.deploy(wethAddr, agsAddr);
    await v3Pool.waitForDeployment();
    await factory.setPool(wethAddr, agsAddr, 3000, await v3Pool.getAddress());

  const sqrtPriceX96 = 3543191142285914205922034n;
    await v3Pool.setSlot0(sqrtPriceX96);

    const MockUniRouter = await ethers.getContractFactory("CanonicalTestSwapRouter02");
    const uniRouter = await MockUniRouter.deploy();
    await uniRouter.waitForDeployment();
    await uniRouter.setAmountOut(ethers.parseEther("100"));
    await ags.mint(await uniRouter.getAddress(), ethers.parseEther("1000000"));

    const MockPoolAmm = await ethers.getContractFactory("MockPublicLiquidityPool");
    const nativePool = await MockPoolAmm.deploy(agsAddr, wethAddr, true, ethers.parseEther("50000"), ethers.parseEther("10"));
    await nativePool.waitForDeployment();
    const usdcPool = await MockPoolAmm.deploy(agsAddr, usdcAddr, false, ethers.parseEther("10000"), ethers.parseUnits("1000", 6));
    await usdcPool.waitForDeployment();

    const Router = await ethers.getContractFactory("AegisCanonicalSwapRouter");
    const router = await Router.deploy(
      agsAddr,
      wethAddr,
      await uniRouter.getAddress(),
      await factory.getAddress(),
      await deployer.getAddress(),
      3000,
      owner.address
    );
    await router.waitForDeployment();

    await router.setNativeQuotePool(await nativePool.getAddress());
    await router.setErc20QuotePool(await usdcPool.getAddress());

    const big = ethers.parseEther("1000000");
    await ags.mint(alice.address, big);
    await weth.mint(alice.address, big);
    await usdc.mint(alice.address, ethers.parseUnits("1000000", 6));
    await ags.mint(await nativePool.getAddress(), big);
    await ags.mint(await usdcPool.getAddress(), big);
    await weth.mint(await nativePool.getAddress(), big);
    await usdc.mint(await usdcPool.getAddress(), ethers.parseUnits("1000000", 6));

    return { owner, alice, ags, weth, usdc, deployer, router, nativePool, usdcPool, uniRouter, v3Pool };
  }

  it("routes native S through public pool before v3 seed", async function () {
    const { router, nativePool } = await loadFixture(deployFixture);
    const amountIn = ethers.parseEther("1");
    const [route, out] = await router.quote(false, ethers.ZeroAddress, true, amountIn);
    expect(route).to.equal(2);
    const poolOut = await nativePool.quoteSwap(false, amountIn);
    expect(out).to.equal(poolOut);
  });

  it("routes native S through v3 after seed", async function () {
    const { deployer, router } = await loadFixture(deployFixture);
    await deployer.setSeeded(true);
    const amountIn = ethers.parseEther("1");
    const [route] = await router.quote(false, ethers.ZeroAddress, true, amountIn);
    expect(route).to.equal(1);
    expect(await router.usesCanonicalV3(ethers.ZeroAddress, true)).to.equal(true);
  });

  it("rejects wS public pool registration", async function () {
    const { owner, ags, weth, router } = await loadFixture(deployFixture);
    const MockPoolAmm = await ethers.getContractFactory("MockPublicLiquidityPool");
    const wsPool = await MockPoolAmm.deploy(
      await ags.getAddress(),
      await weth.getAddress(),
      false,
      ethers.parseEther("1000"),
      ethers.parseEther("100")
    );
    await wsPool.waitForDeployment();
    await expect(router.setErc20QuotePool(await wsPool.getAddress())).to.be.revertedWithCustomError(
      router,
      "WsPoolNotAllowed"
    );
  });

  it("executes v3 swap for wS -> AGS when seeded", async function () {
    const { alice, ags, weth, deployer, router, uniRouter } = await loadFixture(deployFixture);
    await deployer.setSeeded(true);
    const amountIn = ethers.parseEther("1");
    const rAddr = await router.getAddress();
    await weth.connect(alice).approve(rAddr, amountIn);
    await router.connect(alice).swapExactInput(false, await weth.getAddress(), false, amountIn, 0, alice.address);
    expect(await uniRouter.lastAmountIn()).to.equal(amountIn);
    expect(await ags.balanceOf(alice.address)).to.be.gt(0);
  });
});
