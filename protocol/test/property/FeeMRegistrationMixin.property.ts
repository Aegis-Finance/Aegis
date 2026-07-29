import { ethers } from "hardhat";
import { expect } from "chai";
import fc from "fast-check";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { withSnapshot } from "./utils";

const DEFAULT_RUNS = parseInt(process.env.FUZZ_RUNS ?? "60", 10);

async function deployFeeMFixture() {
  const FeeMRegistry = await ethers.getContractFactory("MockFeeMRegistry");
  const registryImplementation = await FeeMRegistry.deploy();
  await registryImplementation.waitForDeployment();

  const registryAddress = "0xDC2B0D2Dd2b7759D97D50db4eabDC36973110830";
  const registryCode = await ethers.provider.getCode(await registryImplementation.getAddress());
  await ethers.provider.send("hardhat_setCode", [registryAddress, registryCode]);

  const registry = FeeMRegistry.attach(registryAddress);
  await registry.setShouldSucceed(true);

  const Harness = await ethers.getContractFactory("FeeMRegistrationHarness");
  const harness = await Harness.deploy();
  await harness.waitForDeployment();

  return { registry, harness };
}

describe("Property suite – FeeMRegistrationMixin", function () {
  this.timeout(0);

  it("[property] initial registration succeeds and flips the status flag", async function () {
    const base = await loadFixture(deployFeeMFixture);
    await fc.assert(
      fc.asyncProperty(fc.boolean(), async _ => {
        await withSnapshot(async () => {
          const { registry, harness } = base;

          expect(await harness.registrationStatus()).to.equal(false);
          await expect(harness.register()).to.emit(registry, "FeeMRegistered");
          expect(await harness.registrationStatus()).to.equal(true);
        });
      }),
      { numRuns: DEFAULT_RUNS }
    );
  });

  it("[property] subsequent attempts revert with AlreadyFeeMRegistered", async function () {
    const base = await loadFixture(deployFeeMFixture);
    await fc.assert(
      fc.asyncProperty(fc.boolean(), async shouldAttempt => {
        await withSnapshot(async () => {
          const { harness } = base;

          await harness.register();
          expect(await harness.registrationStatus()).to.equal(true);

          if (shouldAttempt) {
            await expect(harness.register()).to.be.revertedWithCustomError(harness, "AlreadyFeeMRegistered");
          }

          expect(await harness.registrationStatus()).to.equal(true);
        });
      }),
      { numRuns: DEFAULT_RUNS }
    );
  });
});
