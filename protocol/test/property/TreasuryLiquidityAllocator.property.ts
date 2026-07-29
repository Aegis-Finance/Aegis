import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import fc from "fast-check";

import { withSnapshot } from "./utils";

const UNIT = ethers.parseUnits("1", 18);
const DEFAULT_RUNS = parseInt(process.env.FUZZ_RUNS ?? "60", 10);

async function deployAllocatorFixture() {
  const [governance] = await ethers.getSigners();

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
    "AGS/Quote LP",
    "AGS-QUOTE-LP",
    30
  )) as any;
  await pool.waitForDeployment();

  const TreasuryLiquidityAllocator = await ethers.getContractFactory("TreasuryLiquidityAllocator");
  const allocator = (await TreasuryLiquidityAllocator.deploy(
    governance.address,
    await agsToken.getAddress(),
    await quoteToken.getAddress()
  )) as any;
  await allocator.waitForDeployment();

  const initialLiquidity = UNIT * 5_000n;
  await agsToken.connect(governance).mint(await allocator.getAddress(), initialLiquidity);
  await quoteToken.connect(governance).mint(await allocator.getAddress(), initialLiquidity);

  await agsToken.connect(governance).mint(governance.address, initialLiquidity);
  await quoteToken.connect(governance).mint(governance.address, initialLiquidity);
  await agsToken.connect(governance).approve(pool.getAddress(), ethers.MaxUint256);
  await quoteToken.connect(governance).approve(pool.getAddress(), ethers.MaxUint256);
  await pool.connect(governance).addLiquidity(UNIT * 1_000n, UNIT * 1_000n, 0, governance.address);

  return { allocator, pool, agsToken, quoteToken, governance };
}

describe("Property suite – TreasuryLiquidityAllocator", function () {
  this.timeout(0);

  it("[property] seeding public pools always resets allowances back to zero", async function () {
    const base = await loadFixture(deployAllocatorFixture);
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: 120 }), { minLength: 1, maxLength: 5 }),
        async amounts => {
          await withSnapshot(async () => {
            const { allocator, pool, agsToken, quoteToken, governance } = base;
            const allocatorAddress = await allocator.getAddress();
            const poolAddress = await pool.getAddress();

            for (const amt of amounts) {
              const amount = UNIT * BigInt(amt);
              await allocator.connect(governance).seedPublicPools([
                {
                  pool: poolAddress,
                  agsAmount: amount,
                  quoteAmount: amount,
                  minShares: 0,
                  lpRecipient: governance.address
                }
              ]);

              expect(await agsToken.allowance(allocatorAddress, poolAddress)).to.equal(0n);
              expect(await quoteToken.allowance(allocatorAddress, poolAddress)).to.equal(0n);
            }
          });
        }
      ),
      { numRuns: DEFAULT_RUNS }
    );
  });

  it("[property] seeding transfers equal AGS and quote amounts into the pool", async function () {
    const base = await loadFixture(deployAllocatorFixture);
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 250 }), async amountUnits => {
        await withSnapshot(async () => {
          const { allocator, pool, agsToken, quoteToken, governance } = base;
          const amount = UNIT * BigInt(amountUnits);

          const [agsReserveBefore, quoteReserveBefore] = await pool.getReserves();
          await allocator.connect(governance).seedPublicPools([
            {
              pool: await pool.getAddress(),
              agsAmount: amount,
              quoteAmount: amount,
              minShares: 0,
              lpRecipient: governance.address
            }
          ]);
          const [agsReserveAfter, quoteReserveAfter] = await pool.getReserves();

          expect(agsReserveAfter - agsReserveBefore).to.equal(amount);
          expect(quoteReserveAfter - quoteReserveBefore).to.equal(amount);
          expect(await agsToken.balanceOf(await allocator.getAddress())).to.be.gte(0n);
          expect(await quoteToken.balanceOf(await allocator.getAddress())).to.be.gte(0n);
        });
      }),
      { numRuns: DEFAULT_RUNS }
    );
  });

  it("[property] seeding mints LP tokens for the designated recipient", async function () {
    const base = await loadFixture(deployAllocatorFixture);
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 180 }), async amountUnits => {
        await withSnapshot(async () => {
          const { allocator, pool, governance } = base;
          const amount = UNIT * BigInt(amountUnits);
          const lpRecipient = governance.address;
          const lpBalanceBefore = (await pool.balanceOf(lpRecipient)) as bigint;

          await allocator.connect(governance).seedPublicPools([
            {
              pool: await pool.getAddress(),
              agsAmount: amount,
              quoteAmount: amount,
              minShares: 0,
              lpRecipient
            }
          ]);

          const lpBalanceAfter = (await pool.balanceOf(lpRecipient)) as bigint;
          expect(lpBalanceAfter).to.be.gt(lpBalanceBefore);
        });
      }),
      { numRuns: DEFAULT_RUNS }
    );
  });

  it("[property] rescueToken moves balances without mutating internal allowances", async function () {
    const base = await loadFixture(deployAllocatorFixture);
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 300 }), async amountUnits => {
        await withSnapshot(async () => {
          const { allocator, agsToken, governance } = base;
          const allocatorAddress = await allocator.getAddress();
          const amount = UNIT * BigInt(amountUnits);

          await agsToken.connect(governance).mint(allocatorAddress, amount);
          const recipient = governance.address;
          const balanceBefore = await agsToken.balanceOf(recipient);

          await allocator.connect(governance).rescueToken(await agsToken.getAddress(), recipient, amount);

          const balanceAfter = await agsToken.balanceOf(recipient);
          expect(balanceAfter - balanceBefore).to.equal(amount);
          expect(await agsToken.allowance(allocatorAddress, recipient)).to.equal(0n);
        });
      }),
      { numRuns: Math.max(10, DEFAULT_RUNS / 2) }
    );
  });
});
