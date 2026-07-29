import { expect } from "chai";
import { ethers } from "hardhat";
import fc from "fast-check";

import { withSnapshot } from "./utils";

const DEFAULT_RUNS = parseInt(process.env.FUZZ_RUNS ?? "60", 10);
const WAD = 10n ** 18n;

describe("Property suite – AuctionPriceLib (TGE Dutch curve)", function () {
  this.timeout(0);

  async function deployHarness() {
    const Factory = await ethers.getContractFactory(
      "contracts/test/AuctionPriceLibHarness.sol:AuctionPriceLibHarness"
    );
    const harness = await Factory.deploy();
    await harness.waitForDeployment();
    return { harness };
  }

  it("[property] linearDutchPrice stays within [reserve, startPrice] before sale end", async function () {
    const { harness } = await deployHarness();
    await fc.assert(
      fc.asyncProperty(
        fc.bigInt({ min: 2n, max: 10_000n }),
        fc.bigInt({ min: 1n, max: 9_999n }),
        fc.bigInt({ min: 1_000_000n, max: 2_000_000n }),
        fc.integer({ min: 10, max: 10_000 }),
        fc.integer({ min: 0, max: 9_999 }),
        async (startWhole, reserveWhole, startTime, windowSecs, offsetSecs) => {
          await withSnapshot(async () => {
            if (reserveWhole >= startWhole) return;
            const startPrice = startWhole * WAD;
            const reserve = reserveWhole * WAD;
            const start = BigInt(startTime);
            const end = start + BigInt(windowSecs);
            const now = start + BigInt(offsetSecs % windowSecs);
            const price = await harness.linearDutchPrice(
              startPrice,
              reserve,
              start,
              end,
              now,
              false
            );
            expect(price).to.be.gte(reserve);
            expect(price).to.be.lte(startPrice);
          });
        }
      ),
      { numRuns: DEFAULT_RUNS }
    );
  });

  it("[property] linearDutchPrice is non-increasing in time before sale end", async function () {
    const { harness } = await deployHarness();
    await fc.assert(
      fc.asyncProperty(
        fc.bigInt({ min: 100n, max: 10_000n }),
        fc.bigInt({ min: 1n, max: 99n }),
        fc.bigInt({ min: 1_000_000n, max: 2_000_000n }),
        fc.integer({ min: 100, max: 10_000 }),
        fc.integer({ min: 0, max: 98 }),
        fc.integer({ min: 1, max: 99 }),
        async (startWhole, reserveWhole, startTime, windowSecs, t0Pct, t1Pct) => {
          await withSnapshot(async () => {
            const startPrice = startWhole * WAD;
            const reserve = reserveWhole * WAD;
            const start = BigInt(startTime);
            const end = start + BigInt(windowSecs);
            const t0 = start + (BigInt(windowSecs) * BigInt(t0Pct)) / 100n;
            const t1 = start + (BigInt(windowSecs) * BigInt(t1Pct)) / 100n;
            if (t0 > t1) return;
            const p0 = await harness.linearDutchPrice(startPrice, reserve, start, end, t0, false);
            const p1 = await harness.linearDutchPrice(startPrice, reserve, start, end, t1, false);
            expect(p1).to.be.lte(p0);
          });
        }
      ),
      { numRuns: DEFAULT_RUNS }
    );
  });

  it("[property] saleCompleted or post-end timestamp returns reserve", async function () {
    const { harness } = await deployHarness();
    await fc.assert(
      fc.asyncProperty(
        fc.bigInt({ min: 100n, max: 5_000n }),
        fc.bigInt({ min: 1n, max: 99n }),
        fc.boolean(),
        async (startWhole, reserveWhole, completed) => {
          await withSnapshot(async () => {
            const startPrice = startWhole * WAD;
            const reserve = reserveWhole * WAD;
            const start = 1_000_000n;
            const end = start + 1000n;
            const now = completed ? start + 10n : end + 500n;
            const price = await harness.linearDutchPrice(
              startPrice,
              reserve,
              start,
              end,
              now,
              completed
            );
            expect(price).to.equal(reserve);
          });
        }
      ),
      { numRuns: DEFAULT_RUNS }
    );
  });
});
