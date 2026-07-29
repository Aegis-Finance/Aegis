import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import fc from "fast-check";

import { withSnapshot } from "./utils";

const UNIT = ethers.parseUnits("1", 18);
const DEFAULT_RUNS = parseInt(process.env.FUZZ_RUNS ?? "60", 10);

async function deployLiquidityFixture() {
  const [deployer, user] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory("contracts/test/MockERC20.sol:MockERC20");
  const agsToken = (await MockERC20.deploy("Mock AGS", "mAGS")) as any;
  await agsToken.waitForDeployment();

  const quoteToken = (await MockERC20.deploy("Mock Quote", "mQT")) as any;
  await quoteToken.waitForDeployment();

  const PublicLiquidityPool = await ethers.getContractFactory("PublicLiquidityPool");
  const pool = (await PublicLiquidityPool.deploy(
    await agsToken.getAddress(),
    await quoteToken.getAddress(),
    false,
    "AGS/QUOTE LP",
    "AGS-QUOTE-LP",
    30
  )) as any;
  await pool.waitForDeployment();

  const initialMint = UNIT * 10_000n;
  await agsToken.connect(deployer).mint(deployer.address, initialMint);
  await quoteToken.connect(deployer).mint(deployer.address, initialMint);
  await agsToken.connect(deployer).mint(user.address, initialMint);
  await quoteToken.connect(deployer).mint(user.address, initialMint);

  const poolAddress = await pool.getAddress();
  await agsToken.connect(user).approve(poolAddress, ethers.MaxUint256);
  await quoteToken.connect(user).approve(poolAddress, ethers.MaxUint256);
  await agsToken.connect(deployer).approve(poolAddress, ethers.MaxUint256);
  await quoteToken.connect(deployer).approve(poolAddress, ethers.MaxUint256);

  await pool.connect(deployer).addLiquidity(UNIT * 1_000n, UNIT * 1_000n, 0, deployer.address);

  return { pool, agsToken, quoteToken, user, deployer, poolAddress };
}

describe("Property suite – PublicLiquidityPool", function () {
  this.timeout(0);

  it("[property] add liquidity increases reserves by the deposited amounts", async function () {
    const base = await loadFixture(deployLiquidityFixture);
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 500 }),
        fc.integer({ min: 1, max: 500 }),
        async (agsUnits, quoteUnits) => {
          await withSnapshot(async () => {
            const { pool, agsToken, quoteToken, user, poolAddress } = base;
            const agsAmount = UNIT * BigInt(agsUnits);
            const quoteAmount = UNIT * BigInt(quoteUnits);

            await agsToken.connect(user).approve(poolAddress, ethers.MaxUint256);
            await quoteToken.connect(user).approve(poolAddress, ethers.MaxUint256);

            const [beforeAgs, beforeQuote] = await pool.getReserves();
            await pool.connect(user).addLiquidity(agsAmount, quoteAmount, 0, user.address);
            const [afterAgs, afterQuote] = await pool.getReserves();

            expect(afterAgs - beforeAgs).to.equal(agsAmount);
            expect(afterQuote - beforeQuote).to.equal(quoteAmount);
          });
        }
      ),
      { numRuns: DEFAULT_RUNS }
    );
  });

  it("[property] swapping AGS for quote maintains a non-decreasing constant product", async function () {
    const base = await loadFixture(deployLiquidityFixture);
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 200 }), async agsUnits => {
        await withSnapshot(async () => {
          const { pool, agsToken, user, poolAddress } = base;
          const agsAmount = UNIT * BigInt(agsUnits);

          await agsToken.connect(user).approve(poolAddress, ethers.MaxUint256);

          const [reserveAgsBefore, reserveQuoteBefore] = await pool.getReserves();
          const productBefore = reserveAgsBefore * reserveQuoteBefore;

          await pool.connect(user).swapExactInput(true, agsAmount, 0, user.address);

          const [reserveAgsAfter, reserveQuoteAfter] = await pool.getReserves();
          const productAfter = reserveAgsAfter * reserveQuoteAfter;

          expect(productAfter).to.be.gte(productBefore);
          expect(reserveAgsAfter).to.be.gte(0n);
          expect(reserveQuoteAfter).to.be.gte(0n);
        });
      }),
      { numRuns: DEFAULT_RUNS }
    );
  });

  it("[property] swapping quote for AGS maintains a non-decreasing constant product", async function () {
    const base = await loadFixture(deployLiquidityFixture);
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 200 }), async quoteUnits => {
        await withSnapshot(async () => {
          const { pool, quoteToken, user, poolAddress } = base;
          const quoteAmount = UNIT * BigInt(quoteUnits);

          await quoteToken.connect(user).approve(poolAddress, ethers.MaxUint256);

          const [reserveAgsBefore, reserveQuoteBefore] = await pool.getReserves();
          const productBefore = reserveAgsBefore * reserveQuoteBefore;

          await pool.connect(user).swapExactInput(false, quoteAmount, 0, user.address);

          const [reserveAgsAfter, reserveQuoteAfter] = await pool.getReserves();
          const productAfter = reserveAgsAfter * reserveQuoteAfter;

          expect(productAfter).to.be.gte(productBefore);
          expect(reserveAgsAfter).to.be.gte(0n);
          expect(reserveQuoteAfter).to.be.gte(0n);
        });
      }),
      { numRuns: DEFAULT_RUNS }
    );
  });

  it("[property] removing liquidity burns the exact LP shares and returns proportional reserves", async function () {
    const base = await loadFixture(deployLiquidityFixture);
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 400 }),
        fc.integer({ min: 1, max: 10_000 }),
        async (depositUnits, burnBps) => {
          await withSnapshot(async () => {
            const { pool, agsToken, quoteToken, user, poolAddress } = base;
            const depositAmount = UNIT * BigInt(depositUnits);

            await agsToken.connect(user).approve(poolAddress, ethers.MaxUint256);
            await quoteToken.connect(user).approve(poolAddress, ethers.MaxUint256);

            await pool.connect(user).addLiquidity(depositAmount, depositAmount, 0, user.address);

            const totalSupplyBefore = (await pool.totalSupply()) as bigint;
            const userSharesBefore = (await pool.balanceOf(user.address)) as bigint;
            const [reserveAgsBeforeRemoval, reserveQuoteBeforeRemoval] = await pool.getReserves();

            const burnAmount = userSharesBefore * BigInt(burnBps) / 10_000n;
            if (burnAmount === 0n) {
              return;
            }

            const agsBalanceBefore = await agsToken.balanceOf(user.address);
            const quoteBalanceBefore = await quoteToken.balanceOf(user.address);

            await pool.connect(user).removeLiquidity(burnAmount, 0, 0, user.address);

            const userSharesAfter = (await pool.balanceOf(user.address)) as bigint;
            expect(userSharesBefore - userSharesAfter).to.equal(burnAmount);

            const [reserveAgsAfter, reserveQuoteAfter] = await pool.getReserves();
            const agsDelta = (await agsToken.balanceOf(user.address)) - agsBalanceBefore;
            const quoteDelta = (await quoteToken.balanceOf(user.address)) - quoteBalanceBefore;
            const agsReserveDelta = reserveAgsBeforeRemoval - reserveAgsAfter;
            const quoteReserveDelta = reserveQuoteBeforeRemoval - reserveQuoteAfter;

            expect(agsDelta).to.equal(agsReserveDelta);
            expect(quoteDelta).to.equal(quoteReserveDelta);
            expect(reserveAgsAfter).to.be.gte(0n);
            expect(reserveQuoteAfter).to.be.gte(0n);
          });
        }
      ),
      { numRuns: Math.max(10, DEFAULT_RUNS / 2) }
    );
  });

  it("[property] alternating add/remove cycles never drive reserves negative", async function () {
    const base = await loadFixture(deployLiquidityFixture);
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: 120 }), { minLength: 1, maxLength: 6 }),
        async deposits => {
          await withSnapshot(async () => {
            const { pool, agsToken, quoteToken, user, poolAddress } = base;

            for (const depositUnits of deposits) {
              const depositAmount = UNIT * BigInt(depositUnits);
              await agsToken.connect(user).approve(poolAddress, ethers.MaxUint256);
              await quoteToken.connect(user).approve(poolAddress, ethers.MaxUint256);

              await pool.connect(user).addLiquidity(depositAmount, depositAmount, 0, user.address);

              const lpBalance = (await pool.balanceOf(user.address)) as bigint;
              const burnAmount = lpBalance / 2n;
              if (burnAmount > 0n) {
                await pool.connect(user).removeLiquidity(burnAmount, 0, 0, user.address);
              }

              const [reserveAgs, reserveQuote] = await pool.getReserves();
              expect(reserveAgs).to.be.gte(0n);
              expect(reserveQuote).to.be.gte(0n);
            }
          });
        }
      ),
      { numRuns: DEFAULT_RUNS }
    );
  });
});

