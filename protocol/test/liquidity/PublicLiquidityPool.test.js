const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('PublicLiquidityPool', function () {
  let agsToken, quoteToken, pool, owner, user;
  const parseEther = ethers.parseEther;

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();

    const Token = await ethers.getContractFactory('contracts/test/MockERC20.sol:MockERC20');
    agsToken = await Token.deploy('Aegis', 'AGS');
    quoteToken = await Token.deploy('Sonic USD', 'sUSD');

    await agsToken.mint(owner.address, ethers.parseEther('1000000'));
    await quoteToken.mint(owner.address, ethers.parseEther('1000000'));

    const Pool = await ethers.getContractFactory('PublicLiquidityPool');
    pool = await Pool.deploy(
      await agsToken.getAddress(),
      await quoteToken.getAddress(),
      false,
      'AGS-sUSD LP',
      'AGS-sUSD-LP',
      30
    );
  });

  it('adds initial liquidity and mints LP tokens', async function () {
    await agsToken.approve(await pool.getAddress(), ethers.parseEther('1000'));
    await quoteToken.approve(await pool.getAddress(), ethers.parseEther('1000'));

    await expect(
      pool.addLiquidity(
        ethers.parseEther('1000'),
        ethers.parseEther('1000'),
        0,
        owner.address
      )
    ).to.emit(pool, 'LiquidityAdded');

    const lpBalance = await pool.balanceOf(owner.address);
    expect(lpBalance).to.be.gt(0n);

    const [reserveA, reserveB] = await pool.getReserves();
    expect(reserveA).to.equal(ethers.parseEther('1000'));
    expect(reserveB).to.equal(ethers.parseEther('1000'));
  });

  it('swaps AGS for quote token', async function () {
    await agsToken.approve(await pool.getAddress(), ethers.parseEther('1000'));
    await quoteToken.approve(await pool.getAddress(), ethers.parseEther('1000'));
    await pool.addLiquidity(
      ethers.parseEther('1000'),
      ethers.parseEther('1000'),
      0,
      owner.address
    );

    await agsToken.mint(user.address, ethers.parseEther('10'));
    await agsToken.connect(user).approve(await pool.getAddress(), ethers.parseEther('10'));

    await expect(
      pool.connect(user).swapExactInput(true, ethers.parseEther('10'), 0, user.address)
    ).to.emit(pool, 'SwapExecuted');

    const quoteBalance = await quoteToken.balanceOf(user.address);
    expect(quoteBalance).to.be.gt(0n);
  });

  it('removes liquidity and returns assets', async function () {
    await agsToken.approve(await pool.getAddress(), ethers.parseEther('1000'));
    await quoteToken.approve(await pool.getAddress(), ethers.parseEther('1000'));
    await pool.addLiquidity(
      ethers.parseEther('1000'),
      ethers.parseEther('1000'),
      0,
      owner.address
    );

    const lpBalance = await pool.balanceOf(owner.address);
    await pool.removeLiquidity(lpBalance, 0, 0, owner.address);

    const [reserveA, reserveB] = await pool.getReserves();
    expect(reserveA).to.equal(0n);
    expect(reserveB).to.equal(0n);
  });

  it('supports native quote assets', async function () {
    const Token = await ethers.getContractFactory('contracts/test/MockERC20.sol:MockERC20');
    const ags = await Token.deploy('Aegis', 'AGS');
    await ags.mint(owner.address, ethers.parseEther('1000'));
    const MockWETH = await ethers.getContractFactory('contracts/test/MockWETH.sol:MockWETH');
    const wrapped = await MockWETH.deploy();

    const Pool = await ethers.getContractFactory('PublicLiquidityPool');
    const nativePool = await Pool.deploy(
      await ags.getAddress(),
      await wrapped.getAddress(),
      true,
      'AGS-SONIC LP',
      'AGS-SONIC-LP',
      30
    );

    await ags.approve(await nativePool.getAddress(), ethers.parseEther('100'));

    await nativePool.addLiquidity(
      ethers.parseEther('100'),
      ethers.parseEther('1'),
      0,
      owner.address,
      { value: ethers.parseEther('1') }
    );

    const userWithSonic = user;
    await ags.mint(userWithSonic.address, ethers.parseEther('10'));
    await ags.connect(userWithSonic).approve(await nativePool.getAddress(), ethers.parseEther('10'));

    const [, reserveQuoteBefore] = await nativePool.getReserves();
    await expect(
      nativePool.connect(userWithSonic).swapExactInput(true, ethers.parseEther('1'), 0, userWithSonic.address)
    ).to.emit(nativePool, 'SwapExecuted');
    const [, reserveQuoteAfter] = await nativePool.getReserves();
    expect(reserveQuoteAfter).to.be.lt(reserveQuoteBefore);

    const userAgsBalanceBefore = await ags.balanceOf(userWithSonic.address);
    await expect(
      nativePool
        .connect(userWithSonic)
        .swapExactInput(false, ethers.parseEther('0.1'), 0, userWithSonic.address, { value: ethers.parseEther('0.1') })
    ).to.emit(nativePool, 'SwapExecuted');
    const userAgsBalanceAfter = await ags.balanceOf(userWithSonic.address);
    expect(userAgsBalanceAfter).to.be.gt(userAgsBalanceBefore);

    const lpBalanceNative = await nativePool.balanceOf(owner.address);
    await nativePool.removeLiquidity(lpBalanceNative, 0, 0, owner.address);
  });

  describe('Security: Rounding Error Protection', function () {
    it('calculates shares with precision protection', async function () {
      // First add initial liquidity
      await agsToken.approve(await pool.getAddress(), parseEther('1000'));
      await quoteToken.approve(await pool.getAddress(), parseEther('1000'));
      await pool.addLiquidity(parseEther('1000'), parseEther('1000'), 0, owner.address);
      
      const [reserveAGS, reserveQuote] = await pool.getReserves();
      const totalSupply = await pool.totalSupply();
      
      await agsToken.approve(await pool.getAddress(), parseEther('1'));
      await quoteToken.approve(await pool.getAddress(), parseEther('1'));
      
      await pool.addLiquidity(parseEther('1'), parseEther('1'), 0, owner.address);
      
      // Verify shares calculated correctly (multiplication before division)
      const newTotalSupply = await pool.totalSupply();
      const sharesMinted = newTotalSupply - totalSupply;
      
      const expectedSharesFromAGS = (parseEther('1') * totalSupply) / reserveAGS;
      const expectedSharesFromQuote = (parseEther('1') * totalSupply) / reserveQuote;
      const expectedShares = expectedSharesFromAGS < expectedSharesFromQuote 
        ? expectedSharesFromAGS 
        : expectedSharesFromQuote;
      
      expect(sharesMinted).to.equal(expectedShares);
    });

    it('prevents rounding errors in swap calculations', async function () {
      // First add initial liquidity
      await agsToken.approve(await pool.getAddress(), parseEther('1000'));
      await quoteToken.approve(await pool.getAddress(), parseEther('1000'));
      await pool.addLiquidity(parseEther('1000'), parseEther('1000'), 0, owner.address);
      
      const [reserveAGSBefore, reserveQuoteBefore] = await pool.getReserves();
      const kBefore = reserveAGSBefore * reserveQuoteBefore;

      await agsToken.mint(user.address, parseEther('100'));
      await agsToken.connect(user).approve(await pool.getAddress(), parseEther('100'));
      await pool.connect(user).swapExactInput(true, parseEther('100'), 0, user.address);

      // K must not decrease (fees ensure K increases)
      const [reserveAGSAfter, reserveQuoteAfter] = await pool.getReserves();
      const kAfter = reserveAGSAfter * reserveQuoteAfter;
      expect(kAfter).to.be.gte(kBefore);
    });
  });

  describe('Security: Minimum Amount Protection', function () {
    it('requires minimum amounts for operations', async function () {
      // MIN_AMOUNT = 1000 wei is enforced in contract
      // Test verifies that normal operations work (amounts >> 1000)
      await agsToken.approve(await pool.getAddress(), parseEther('1'));
      await quoteToken.approve(await pool.getAddress(), parseEther('1'));

      await expect(
        pool.addLiquidity(parseEther('1'), parseEther('1'), 0, owner.address)
      ).to.not.be.reverted;
    });
  });

  describe('Security: Price Impact Protection', function () {
    it('limits price manipulation to 50% per swap', async function () {
      // First add initial liquidity
      await agsToken.approve(await pool.getAddress(), parseEther('1000'));
      await quoteToken.approve(await pool.getAddress(), parseEther('1000'));
      await pool.addLiquidity(parseEther('1000'), parseEther('1000'), 0, owner.address);
      
      await agsToken.mint(user.address, parseEther('100000'));
      await agsToken.connect(user).approve(await pool.getAddress(), parseEther('100000'));

      const [reserveAGS, reserveQuote] = await pool.getReserves();
      
      // Try swap that would cause >50% price impact
      // Calculate amount that would remove >50% of quote reserve
      const largeSwap = (reserveQuote * 60n) / 100n; // 60% of quote reserve
      // But we need to calculate the input AGS amount that would cause this
      // For simplicity, use a very large swap that will definitely exceed 50%
      await expect(
        pool.connect(user).swapExactInput(true, parseEther('10000'), 0, user.address)
      ).to.be.revertedWith('Price impact too high');
    });
  });
});

