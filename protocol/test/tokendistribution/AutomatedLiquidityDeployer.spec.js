const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

describe('AutomatedLiquidityDeployer', function () {
  const poolFee = 3000;
  // Full-range ticks aligned to spacing 60 (0.3% tier on canonical Uniswap v3).
  const tickLower = -887220;
  const tickUpper = 887220;
  // Valid interior sqrt price (Uniswap TickMath bounds exclusive).
  const sqrtPriceX96 = 79228162514264337593543950336n;

  async function deployFixture() {
    const [owner, sink, recipient, user] = await ethers.getSigners();
    const MockERC20 = await ethers.getContractFactory('contracts/test/MockERC20.sol:MockERC20');
    const ags = await MockERC20.deploy('AGS', 'AGS');
    await ags.mint(owner.address, ethers.parseEther('2000000'));
    const MockWETH = await ethers.getContractFactory('contracts/test/TokenDistributionMocks.sol:MockWETH');
    const weth = await MockWETH.deploy();
    const MockNpm = await ethers.getContractFactory('contracts/test/TokenDistributionMocks.sol:MockNonfungiblePositionManager');
    const npm = await MockNpm.deploy();

    const Deployer = await ethers.getContractFactory('AutomatedLiquidityDeployer');
    const ld = await Deployer.deploy(
      await ags.getAddress(),
      await weth.getAddress(),
      await npm.getAddress(),
      poolFee,
      owner.address,
      sink.address,
      recipient.address
    );

    await ags.transfer(await ld.getAddress(), ethers.parseEther('1000000'));
    await user.sendTransaction({ to: await ld.getAddress(), value: ethers.parseEther('50') });

    return { owner, sink, recipient, user, ags, weth, npm, ld };
  }

  it('mints via NPM after wrapping native and emits event', async function () {
    const { owner, recipient, ld, npm } = await deployFixture();
    const deadline = BigInt(await time.latest()) + 3600n;
    await expect(ld.connect(owner).mintInitialLiquidity(sqrtPriceX96, tickLower, tickUpper, 0, 0, deadline)).to.emit(
      ld,
      'InitialLiquidityMinted'
    );

    const t1 = await npm.positions(1n);
    expect(t1.operator).to.equal(recipient.address);
  });

  it('previewProportionalPairing scales when native is binding', async function () {
    const { ld } = await deployFixture();
    const meanPriceWad = ethers.parseEther('0.0001'); // quote per 1 AGS (WAD)
    const maxAgsToUse = ethers.parseEther('1000');
    const native = ethers.parseEther('0.05');
    const [agsToPair, nativeToPair] = await ld.previewProportionalPairing(meanPriceWad, maxAgsToUse, native);
    expect(nativeToPair).to.equal(native);
    expect(agsToPair).to.equal(ethers.parseEther('500'));
  });
});
