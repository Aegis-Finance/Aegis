const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

describe('PoolPriceValidator', function () {
  let owner, governance, user;
  let agsToken, quoteToken, pool;
  let validator, oracle;

  const parseEther = ethers.parseEther;

  beforeEach(async function () {
    [owner, governance, user] = await ethers.getSigners();

    // Deploy mock tokens
    const MockERC20 = await ethers.getContractFactory('contracts/test/MockERC20.sol:MockERC20');
    agsToken = await MockERC20.deploy('Aegis', 'AGS');
    quoteToken = await MockERC20.deploy('USD Coin', 'USDC');

    // Deploy pool
    const Pool = await ethers.getContractFactory('PublicLiquidityPool');
    pool = await Pool.deploy(
      await agsToken.getAddress(),
      await quoteToken.getAddress(),
      false,
      'AGS-USDC LP',
      'AGS-USDC-LP',
      30
    );

    // Deploy mock oracle (price: 1 USDC = 0.01 AGS, so 1 AGS = 100 USDC)
    // Oracle returns price in USD with 8 decimals, so 100 USDC = 100 * 1e8 = 10000000000
    const MockOracle = await ethers.getContractFactory('MockChainlinkOracle');
    oracle = await MockOracle.deploy(10000000000n); // 100 USDC per AGS

    // Deploy validator
    const Validator = await ethers.getContractFactory('PoolPriceValidator');
    validator = await Validator.deploy(owner.address);

    // Fund pool with liquidity (1 AGS : 100 USDC ratio)
    await agsToken.mint(owner.address, parseEther('1000'));
    await quoteToken.mint(owner.address, parseEther('100000'));
    await agsToken.approve(await pool.getAddress(), parseEther('1000'));
    await quoteToken.approve(await pool.getAddress(), parseEther('100000'));
    await pool.addLiquidity(parseEther('1000'), parseEther('100000'), 0, owner.address);
  });

  describe('Deployment', function () {
    it('sets admin and governance roles', async function () {
      expect(await validator.hasRole(await validator.DEFAULT_ADMIN_ROLE(), owner.address)).to.be.true;
      expect(await validator.hasRole(await validator.GOVERNANCE_ROLE(), owner.address)).to.be.true;
    });
  });

  describe('Pool Configuration', function () {
    it('configures pool with oracle', async function () {
      await validator.configurePool(
        await pool.getAddress(),
        await oracle.getAddress(),
        ethers.ZeroAddress,
        true,
        500, // 5% max deviation
        0 // twapWindow (0 = use default)
      );

      const config = await validator.poolConfigs(await pool.getAddress());
      expect(config.poolAddress).to.equal(await pool.getAddress());
      expect(config.quoteOracle).to.equal(await oracle.getAddress());
      expect(config.enabled).to.be.true;
      expect(config.maxDeviationBps).to.equal(500);
    });

    it('reverts if pool address is zero', async function () {
      await expect(
        validator.configurePool(
          ethers.ZeroAddress,
          await oracle.getAddress(),
          ethers.ZeroAddress,
          true,
          500,
          0
        )
      ).to.be.revertedWith('Pool zero');
    });

    it('reverts if oracle required but not provided when enabled', async function () {
      await expect(
        validator.configurePool(
          await pool.getAddress(),
          ethers.ZeroAddress,
          ethers.ZeroAddress,
          true,
          500,
          0
        )
      ).to.be.revertedWith('Oracle required when enabled');
    });

    it('allows zero oracle when disabled', async function () {
      await validator.configurePool(
        await pool.getAddress(),
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        false,
        500,
        0
      );

      const config = await validator.poolConfigs(await pool.getAddress());
      expect(config.enabled).to.be.false;
    });
  });

  describe('Price Validation', function () {
    beforeEach(async function () {
      await validator.configurePool(
        await pool.getAddress(),
        await oracle.getAddress(),
        ethers.ZeroAddress,
        true,
        500, // 5% max deviation
        0 // twapWindow (0 = use default)
      );
    });

    it('validates pool price within acceptable deviation', async function () {
      const [isValid, poolPrice, oraclePrice, deviation] = await validator.validatePoolPrice.staticCall(
        await pool.getAddress()
      );

      expect(isValid).to.be.true;
      expect(poolPrice).to.be.gt(0n);
      expect(oraclePrice).to.be.gt(0n);
      expect(deviation).to.be.lte(500n); // Within 5%
    });

    it('calculates correct pool price', async function () {
      const [isValid, poolPrice, oraclePrice] = await validator.validatePoolPrice.staticCall(await pool.getAddress());

      // Pool: 1000 AGS : 100000 USDC = 100 USDC per AGS
      // Oracle: 100 USDC per AGS
      expect(poolPrice).to.be.closeTo(oraclePrice, oraclePrice / 20n); // Within 5%
      expect(isValid).to.be.true;
    });

    it('detects high deviation and marks invalid', async function () {
      // Change oracle price significantly (50 USDC per AGS instead of 100)
      await oracle.updateAnswer(5000000000n); // 50 USDC per AGS

      const [isValid, poolPrice, oraclePrice, deviation] = await validator.validatePoolPrice.staticCall(
        await pool.getAddress()
      );

      expect(deviation).to.be.gt(500n); // More than 5%
      expect(isValid).to.be.false;
    });

    it('reverts on seeding with invalid price', async function () {
      // Set oracle to very different price
      await oracle.updateAnswer(1000000000n); // 10 USDC per AGS (90% deviation)

      // The oracle price will be zero or invalid, causing revert
      await expect(
        validator.validateSeedingPrice(await pool.getAddress(), parseEther('100'), parseEther('10000'))
      ).to.be.reverted;
    });
  });

  describe('Seeding Price Validation', function () {
    beforeEach(async function () {
      await validator.configurePool(
        await pool.getAddress(),
        await oracle.getAddress(),
        ethers.ZeroAddress,
        true,
        500,
        0
      );
    });

    it('validates seeding price within deviation', async function () {
      // Seed at 100 USDC per AGS (matches oracle)
      await expect(
        validator.validateSeedingPrice(await pool.getAddress(), parseEther('100'), parseEther('10000'))
      ).to.not.be.reverted;
    });

    it('skips validation when disabled', async function () {
      await validator.setValidationEnabled(await pool.getAddress(), false);

      await expect(
        validator.validateSeedingPrice(await pool.getAddress(), parseEther('100'), parseEther('10000'))
      ).to.not.be.reverted;
    });

    it('reverts if agsAmount is zero', async function () {
      await expect(
        validator.validateSeedingPrice(await pool.getAddress(), 0n, parseEther('10000'))
      ).to.be.revertedWith('AGS amount zero');
    });
  });

  describe('Hybrid Price', function () {
    beforeEach(async function () {
      await validator.configurePool(
        await pool.getAddress(),
        await oracle.getAddress(),
        ethers.ZeroAddress,
        true,
        500,
        0
      );
    });

    it('returns hybrid price (70% pool, 30% oracle)', async function () {
      const [hybridPrice, poolPrice, oraclePrice] = await validator.getHybridPrice(await pool.getAddress());

      expect(hybridPrice).to.be.gt(0n);
      expect(poolPrice).to.be.gt(0n);
      expect(oraclePrice).to.be.gt(0n);

      // Hybrid = 70% pool + 30% oracle
      const expectedHybrid = (poolPrice * 70n) / 100n + (oraclePrice * 30n) / 100n;
      expect(hybridPrice).to.be.closeTo(expectedHybrid, expectedHybrid / 1000n);
    });
  });

  describe('Dynamic Fee Calculation', function () {
    beforeEach(async function () {
      await validator.configurePool(
        await pool.getAddress(),
        await oracle.getAddress(),
        ethers.ZeroAddress,
        true,
        500,
        0
      );
    });

    it('returns base fee for low deviation', async function () {
      const fee = await validator.calculateDynamicFee(await pool.getAddress());
      // Base fee is 0.30% = 30 basis points
      expect(fee).to.be.gte(30n);
      expect(fee).to.be.lte(300n); // Max fee is 3.00% = 300 basis points
    });

    it('returns higher fee for high deviation', async function () {
      // Manipulate price significantly
      await oracle.updateAnswer(5000000000n); // 50 USDC per AGS

      const fee = await validator.calculateDynamicFee(await pool.getAddress());
      expect(fee).to.be.gt(30n); // Higher than base fee
    });
  });

  describe('Governance Functions', function () {
    beforeEach(async function () {
      await validator.configurePool(
        await pool.getAddress(),
        await oracle.getAddress(),
        ethers.ZeroAddress,
        true,
        500,
        0
      );
    });

    it('enables/disables validation', async function () {
      await validator.setValidationEnabled(await pool.getAddress(), false);
      let config = await validator.poolConfigs(await pool.getAddress());
      expect(config.enabled).to.be.false;

      await validator.setValidationEnabled(await pool.getAddress(), true);
      config = await validator.poolConfigs(await pool.getAddress());
      expect(config.enabled).to.be.true;
    });

    it('updates max deviation threshold', async function () {
      await validator.setMaxDeviation(await pool.getAddress(), 1000); // 10%
      const config = await validator.poolConfigs(await pool.getAddress());
      expect(config.maxDeviationBps).to.equal(1000);
    });

    it('reverts if max deviation too high', async function () {
      await expect(validator.setMaxDeviation(await pool.getAddress(), 3000)).to.be.revertedWith(
        'Deviation too high'
      );
    });

    it('restricts governance functions to governance role', async function () {
      await expect(validator.connect(user).setValidationEnabled(await pool.getAddress(), false)).to.be.reverted;
      await expect(validator.connect(user).setMaxDeviation(await pool.getAddress(), 1000)).to.be.reverted;
    });
  });

  describe('Edge Cases', function () {
    it('handles empty pool', async function () {
      const EmptyPool = await ethers.getContractFactory('PublicLiquidityPool');
      const emptyPool = await EmptyPool.deploy(
        await agsToken.getAddress(),
        await quoteToken.getAddress(),
        false,
        'Empty LP',
        'EMPTY-LP',
        30
      );

      await validator.configurePool(
        await emptyPool.getAddress(),
        await oracle.getAddress(),
        ethers.ZeroAddress,
        true,
        500,
        0
      );

      await expect(validator.validatePoolPrice(await emptyPool.getAddress())).to.be.revertedWith('Pool empty');
    });

    it('handles stale oracle price', async function () {
      // Create oracle with stale price (updated 2 hours ago)
      const MockOracle = await ethers.getContractFactory('MockChainlinkOracle');
      const staleOracle = await MockOracle.deploy(10000000000n);
      await staleOracle.updateAnswerWithDelay(10000000000n, 7200); // 2 hours ago

      await validator.configurePool(
        await pool.getAddress(),
        await staleOracle.getAddress(),
        ethers.ZeroAddress,
        true,
        500,
        0
      );

      // Should handle stale price (will revert with "Price stale")
      await expect(validator.validatePoolPrice.staticCall(await pool.getAddress())).to.be.revertedWith('Price stale');
    });
  });
});

