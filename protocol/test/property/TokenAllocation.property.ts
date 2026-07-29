import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import fc from "fast-check";

import { Contract, Signer } from "ethers";
import { withSnapshot } from "./utils";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

const TOTAL_SUPPLY = ethers.parseUnits("21000000", 18);
const DEFAULT_RUNS = parseInt(process.env.FUZZ_RUNS ?? "60", 10);

type TokenAllocationContract = Contract & {
  connect(signer: Signer): TokenAllocationContract;
  setToken(address: string): Promise<unknown>;
  setPublicSaleContract(address: string): Promise<unknown>;
  setEcosystemRewardsContract(address: string): Promise<unknown>;
  setTreasuryWallet(address: string): Promise<unknown>;
  setGovernanceContract(address: string): Promise<unknown>;
  allocatePublicTokens(): Promise<unknown>;
  allocateEcosystemTokens(): Promise<unknown>;
  allocateTreasuryTokens(): Promise<unknown>;
  allocateAllTokens(): Promise<unknown>;
  allocationCompleted(tranche: string): Promise<boolean>;
  getAllocationAmounts(): Promise<{
    publicAmount: bigint;
    ecosystemAmount: bigint;
    treasuryAmount: bigint;
  }>;
  [key: string]: any;
};

type MockErc20Contract = Contract & {
  connect(signer: Signer): MockErc20Contract;
  mint(to: string, amount: bigint): Promise<unknown>;
  balanceOf(account: string): Promise<bigint>;
  [key: string]: any;
};

type TimelockControllerContract = Contract & {
  schedule(
    target: string,
    value: number,
    data: string,
    predecessor: string,
    salt: string,
    delay: number
  ): Promise<unknown>;
  execute(
    target: string,
    value: number,
    data: string,
    predecessor: string,
    salt: string
  ): Promise<unknown>;
  waitForDeployment(): Promise<void>;
  getAddress(): Promise<string>;
  connect(signer: Signer): TimelockControllerContract;
};
type AllocationFixture = {
  owner: HardhatEthersSigner;
  publicSale: HardhatEthersSigner;
  ecosystem: HardhatEthersSigner;
  treasury: HardhatEthersSigner;
  governance: HardhatEthersSigner;
  allocation: TokenAllocationContract;
  token: MockErc20Contract;
};

async function deployTokenAllocationFixture(): Promise<AllocationFixture> {
  const signerSet = (await ethers.getSigners()) as HardhatEthersSigner[];
  const [owner, publicSale, ecosystem, treasury, governance] = signerSet;

  const MockERC20Factory = await ethers.getContractFactory("contracts/test/MockERC20.sol:MockERC20");
  const token = (await MockERC20Factory.deploy("Mock AGS", "mAGS")) as unknown as MockErc20Contract;
  await token.waitForDeployment();

  const TokenAllocationFactory = await ethers.getContractFactory("TokenAllocation");
  const allocation = (await TokenAllocationFactory.deploy(owner.address)) as unknown as TokenAllocationContract;
  await allocation.waitForDeployment();

  await token.mint(await allocation.getAddress(), TOTAL_SUPPLY);

  return {
    owner,
    publicSale,
    ecosystem,
    treasury,
    governance,
    allocation,
    token
  };
}

async function configureDefaultAllocation(base: AllocationFixture) {
  const allocation = base.allocation as any;
  const token = base.token as any;
  await allocation.connect(base.owner).setToken(await token.getAddress());
  await allocation.connect(base.owner).setPublicSaleContract(base.publicSale.address);
  await allocation.connect(base.owner).setEcosystemRewardsContract(base.ecosystem.address);
  await allocation.connect(base.owner).setTreasuryWallet(base.treasury.address);
}

const trancheKeyArb = fc.constantFrom("public", "ecosystem", "treasury");

describe("Property suite – TokenAllocation", function () {
  this.timeout(0);

  it("[property] each tranche can be allocated exactly once", async function () {
    const base: AllocationFixture = await loadFixture(deployTokenAllocationFixture);
    await fc.assert(
      fc.asyncProperty(fc.shuffledSubarray(["public", "ecosystem", "treasury"], { minLength: 1 }), async order => {
        await withSnapshot(async () => {
          const { owner, publicSale, ecosystem, treasury } = base;
          const allocation = base.allocation as any;
          const token = base.token as any;
          await configureDefaultAllocation(base);
          const allocationAddress = await allocation.getAddress();
          const amounts = await allocation.getAllocationAmounts();

          const actionMap: Record<string, () => Promise<unknown>> = {
            public: () => allocation.connect(owner).allocatePublicTokens(),
            ecosystem: () => allocation.connect(owner).allocateEcosystemTokens(),
            treasury: () => allocation.connect(owner).allocateTreasuryTokens()
          };

          for (const tranche of order) {
            await expect(actionMap[tranche]()).to.not.be.reverted;
          }

          const publicBalance = await token.balanceOf(publicSale.address);
          const ecosystemBalance = await token.balanceOf(ecosystem.address);
          const treasuryBalance = await token.balanceOf(treasury.address);
          const contractBalance = await token.balanceOf(allocationAddress);

          expect(publicBalance).to.equal(order.includes("public") ? amounts.publicAmount : 0n);
          expect(ecosystemBalance).to.equal(order.includes("ecosystem") ? amounts.ecosystemAmount : 0n);
          expect(treasuryBalance).to.equal(order.includes("treasury") ? amounts.treasuryAmount : 0n);
          expect(publicBalance + ecosystemBalance + treasuryBalance + contractBalance).to.equal(TOTAL_SUPPLY);
        });
      }),
      { numRuns: DEFAULT_RUNS }
    );
  });

  it("[property] repeated allocation calls revert with AllocationAlreadyCompleted", async function () {
    const base: AllocationFixture = await loadFixture(deployTokenAllocationFixture);
    await fc.assert(
      fc.asyncProperty(trancheKeyArb, async tranche => {
        await withSnapshot(async () => {
          const { owner } = base;
          const allocation = base.allocation as any;
          await configureDefaultAllocation(base);
          const actionMap: Record<string, () => Promise<unknown>> = {
            public: () => allocation.connect(owner).allocatePublicTokens(),
            ecosystem: () => allocation.connect(owner).allocateEcosystemTokens(),
            treasury: () => allocation.connect(owner).allocateTreasuryTokens()
          };

          await actionMap[tranche]();
          await expect(actionMap[tranche]()).to.be.revertedWithCustomError(allocation, "AllocationAlreadyCompleted");
        });
      }),
      { numRuns: DEFAULT_RUNS }
    );
  });

  it("[property] total supply is conserved across any allocation order", async function () {
    const base: AllocationFixture = await loadFixture(deployTokenAllocationFixture);
    await fc.assert(
      fc.asyncProperty(fc.array(trancheKeyArb, { minLength: 1, maxLength: 3 }), async order => {
        await withSnapshot(async () => {
          const { owner, publicSale, ecosystem, treasury } = base;
          const allocation = base.allocation as any;
          const token = base.token as any;
          await configureDefaultAllocation(base);
          const allocationAddress = await allocation.getAddress();
          const used = new Set<string>();

          const actionMap: Record<string, () => Promise<unknown>> = {
            public: () => allocation.connect(owner).allocatePublicTokens(),
            ecosystem: () => allocation.connect(owner).allocateEcosystemTokens(),
            treasury: () => allocation.connect(owner).allocateTreasuryTokens()
          };

          for (const tranche of order) {
            if (!used.has(tranche)) {
              await actionMap[tranche]();
              used.add(tranche);
            }
          }

          const totalExternal =
            (await token.balanceOf(publicSale.address)) +
            (await token.balanceOf(ecosystem.address)) +
            (await token.balanceOf(treasury.address));
          const contractBalance = await token.balanceOf(allocationAddress);
          expect(totalExternal + contractBalance).to.equal(TOTAL_SUPPLY);
        });
      }),
      { numRuns: DEFAULT_RUNS }
    );
  });

  it("[property] governance takeover revokes owner allocation rights", async function () {
    const base: AllocationFixture = await loadFixture(deployTokenAllocationFixture);
    const trancheArb = fc.constantFrom<"public" | "ecosystem">("public", "ecosystem");

    await fc.assert(
      fc.asyncProperty(trancheArb, async tranche => {
        await withSnapshot(async () => {
          const { owner, governance } = base;
          const allocation = base.allocation as any;
          await configureDefaultAllocation(base);
          await allocation.connect(owner).setGovernanceContract(governance.address);

          const guardedActions: Record<"public" | "ecosystem", () => Promise<unknown>> = {
            public: () => allocation.connect(owner).allocatePublicTokens(),
            ecosystem: () => allocation.connect(owner).allocateEcosystemTokens()
          };

          await expect(guardedActions[tranche]()).to.be.revertedWithCustomError(allocation, "UnauthorizedAccess");
        });
      }),
      { numRuns: DEFAULT_RUNS }
    );
  });

  it("[property] allocateAllTokens only distributes configured tranches", async function () {
    const base: AllocationFixture = await loadFixture(deployTokenAllocationFixture);
    const missingSetArb = fc
      .array(trancheKeyArb, { minLength: 0, maxLength: 3 })
      .map(values => Array.from(new Set(values)));

    await fc.assert(
      fc.asyncProperty(missingSetArb, async missing => {
        await withSnapshot(async () => {
          const { owner, publicSale, ecosystem, treasury } = base;
          const allocation = base.allocation as any;
          const token = base.token as any;
          await allocation.connect(owner).setToken(await token.getAddress());

          if (!missing.includes("public")) {
            await allocation.connect(owner).setPublicSaleContract(publicSale.address);
          }
          if (!missing.includes("ecosystem")) {
            await allocation.connect(owner).setEcosystemRewardsContract(ecosystem.address);
          }
          if (!missing.includes("treasury")) {
            await allocation.connect(owner).setTreasuryWallet(treasury.address);
          }

          await allocation.connect(owner).allocateAllTokens();

          const amounts = await allocation.getAllocationAmounts();
          const balances = {
            public: await token.balanceOf(publicSale.address),
            ecosystem: await token.balanceOf(ecosystem.address),
            treasury: await token.balanceOf(treasury.address)
          };

          expect(balances.public).to.equal(missing.includes("public") ? 0n : amounts.publicAmount);
          expect(balances.ecosystem).to.equal(missing.includes("ecosystem") ? 0n : amounts.ecosystemAmount);
          expect(balances.treasury).to.equal(missing.includes("treasury") ? 0n : amounts.treasuryAmount);

          expect(await allocation.allocationCompleted("public")).to.equal(!missing.includes("public"));
          expect(await allocation.allocationCompleted("ecosystem")).to.equal(!missing.includes("ecosystem"));
          expect(await allocation.allocationCompleted("treasury")).to.equal(!missing.includes("treasury"));

          const allocationAddress = await allocation.getAddress();
          const contractBalance = await token.balanceOf(allocationAddress);
          expect(balances.public + balances.ecosystem + balances.treasury + contractBalance).to.equal(TOTAL_SUPPLY);
        });
      }),
      { numRuns: DEFAULT_RUNS }
    );
  });

  it("[property] timelock enforces delay before governance allocations execute", async function () {
    const base: AllocationFixture = await loadFixture(deployTokenAllocationFixture);
    const delayArb = fc.integer({ min: 2, max: 24 * 60 * 60 });
    const saltArb = fc.bigUintN(256);
    const tranchePairArb = fc
      .array(fc.constantFrom("public", "ecosystem"), { minLength: 1, maxLength: 2 })
      .map(values => Array.from(new Set(values)));

    await fc.assert(
      fc.asyncProperty(delayArb, saltArb, tranchePairArb, async (delaySeconds: number, rawSalt: bigint, tranches: string[]) => {
        await withSnapshot(async () => {
          const { owner, publicSale, ecosystem } = base;
          const allocationContract = base.allocation as TokenAllocationContract;
          const tokenContract = base.token as MockErc20Contract;
          const allocationFromOwner = allocationContract.connect(owner) as TokenAllocationContract;

          await allocationFromOwner.setToken(await tokenContract.getAddress());
          await allocationFromOwner.setPublicSaleContract(publicSale.address);
          await allocationFromOwner.setEcosystemRewardsContract(ecosystem.address);

          const Timelock = await ethers.getContractFactory(
            "contracts/test/TestTimelockController.sol:TestTimelockController"
          );
          const proposers = [owner.address];
          const executors = [owner.address];
          const timelock = (await Timelock.deploy(
            delaySeconds,
            proposers,
            executors,
            owner.address
          )) as unknown as TimelockControllerContract;
          await timelock.waitForDeployment();

          await allocationFromOwner.setGovernanceContract(await timelock.getAddress());

          const target = await allocationContract.getAddress();
          const zeroHash = ethers.ZeroHash;
          const operations = tranches.map((tranche, index) => {
            const fn =
              tranche === "public"
                ? "allocatePublicTokens"
                : "allocateEcosystemTokens";
            const data = allocationContract.interface.encodeFunctionData(fn);
            const salt = ethers.keccak256(
              ethers.toUtf8Bytes(`${rawSalt.toString()}-${tranche}-${index}`)
            );
            return { tranche, data, salt };
          });

          for (const op of operations) {
            const timelockOwner = timelock.connect(owner) as TimelockControllerContract;
            await timelockOwner.schedule(target, 0, op.data, zeroHash, op.salt, delaySeconds);

            await expect(
              timelockOwner.execute(target, 0, op.data, zeroHash, op.salt)
            ).to.be.reverted;
          }

          await time.increase(delaySeconds + 1);

          for (const op of operations) {
            const timelockOwner = timelock.connect(owner) as TimelockControllerContract;
            await timelockOwner.execute(target, 0, op.data, zeroHash, op.salt);
          }

          const balances = {
            public: await tokenContract.balanceOf(publicSale.address),
            ecosystem: await tokenContract.balanceOf(ecosystem.address)
          };
          const amounts = await allocationContract.getAllocationAmounts();

          expect(balances.public).to.equal(
            tranches.includes("public") ? amounts.publicAmount : 0n
          );
          expect(balances.ecosystem).to.equal(
            tranches.includes("ecosystem") ? amounts.ecosystemAmount : 0n
          );
        });
      }),
      { numRuns: Math.max(12, Math.floor(DEFAULT_RUNS / 2)) }
    );
  });
});
