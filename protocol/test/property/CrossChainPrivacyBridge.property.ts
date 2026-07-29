import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import fc from "fast-check";

import { withSnapshot } from "./utils";

const DEFAULT_RUNS = parseInt(process.env.FUZZ_RUNS ?? "60", 10);
const ZERO_PROOF = ethers.AbiCoder.defaultAbiCoder().encode(["uint256[8]"], [new Array(8).fill(0n)]);
const MIN_CHAIN_AMOUNT = ethers.parseUnits("1", 18);
const MAX_CHAIN_AMOUNT = ethers.parseUnits("1000000", 18);

function deriveCommitment(tag: string, salt: bigint): string {
  return ethers.keccak256(ethers.solidityPacked(["string", "uint256"], [tag, salt]));
}

async function deployBridgeFixture() {
  const [governance] = await ethers.getSigners();

  const MockVerifierFactory = await ethers.getContractFactory("contracts/test/MockContracts.sol:MockVerifierFactory");
  const verifierFactory = await MockVerifierFactory.deploy();
  await verifierFactory.waitForDeployment();

  const MockBridgeToken = await ethers.getContractFactory("contracts/test/MockContracts.sol:MockBridgeToken");
  const mockToken = await MockBridgeToken.deploy();
  await mockToken.waitForDeployment();

  const CrossChainPrivacyBridge = await ethers.getContractFactory("CrossChainPrivacyBridge");
  const bridge = (await CrossChainPrivacyBridge.deploy(
    await mockToken.getAddress(),
    await verifierFactory.getAddress(),
    1,
    ethers.parseUnits("100", 18)
  )) as any;
  await bridge.waitForDeployment();

  if ((await bridge.governance()) !== governance.address) {
    await bridge.updateGovernance(governance.address);
  }

  const bridgeVerifier = await verifierFactory.bridgeVerifier();
  const mockVerifier = await ethers.getContractAt("MockZKVerifier", bridgeVerifier);
  await mockVerifier.setShouldVerify(true);

  return { bridge, governance, mockToken, verifierFactory };
}

describe("Property suite – CrossChainPrivacyBridge", function () {
  this.timeout(0);

  it("[property] validator slash penalty accepts values up to 10,000 basis points and rejects larger ones", async function () {
    const base = await loadFixture(deployBridgeFixture);
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 20_000 }), async newPenalty => {
        await withSnapshot(async () => {
          const { bridge, governance } = base;

          if (newPenalty <= 10_000) {
            await bridge.connect(governance).setValidatorSlashPenalty(newPenalty);
            expect(await bridge.validatorSlashPenaltyBps()).to.equal(BigInt(newPenalty));
          } else {
            await expect(
              bridge.connect(governance).setValidatorSlashPenalty(newPenalty)
            ).to.be.revertedWithCustomError(bridge, "InvalidSlashPenalty");
          }
        });
      }),
      { numRuns: DEFAULT_RUNS }
    );
  });

  it("[property] merkle root activation delay enforces the configured minimum", async function () {
    const base = await loadFixture(deployBridgeFixture);
    const minDelay = Number(await base.bridge.MIN_MERKLE_ROOT_DELAY());

    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: minDelay * 6 }), async newDelay => {
        await withSnapshot(async () => {
          const { bridge, governance } = base;

          if (newDelay >= minDelay) {
            await bridge.connect(governance).setMerkleRootActivationDelay(newDelay);
            expect(await bridge.merkleRootActivationDelay()).to.equal(BigInt(newDelay));
          } else {
            await expect(
              bridge.connect(governance).setMerkleRootActivationDelay(newDelay)
            ).to.be.revertedWithCustomError(bridge, "InvalidActivationDelay");
          }
        });
      }),
      { numRuns: DEFAULT_RUNS }
    );
  });

  it("[property] governance update rejects zero addresses and preserves authority", async function () {
  const base = await loadFixture(deployBridgeFixture);
  const scenarioArb = fc.oneof(
    fc.constant({ kind: "zero" as const }),
    fc.constant({ kind: "contract" as const }),
    fc.uint8Array({ minLength: 20, maxLength: 20 }).map(bytes => ({
      kind: "eoa" as const,
      address: ethers.getAddress(ethers.hexlify(bytes))
    }))
  );

  await fc.assert(
    fc.asyncProperty(scenarioArb, async scenario => {
      await withSnapshot(async () => {
        const { bridge, governance } = base;

        if (scenario.kind === "zero") {
          await expect(bridge.connect(governance).updateGovernance(ethers.ZeroAddress)).to.be.revertedWithCustomError(
            bridge,
            "InvalidGovernanceAddress"
          );
        } else if (scenario.kind === "contract") {
          const Stub = await ethers.getContractFactory("GovernanceCoreStub");
          const stub = await Stub.deploy();
          await stub.waitForDeployment();
          const candidate = await stub.getAddress();

          await bridge.connect(governance).updateGovernance(candidate);
          expect(await bridge.governance()).to.equal(candidate);

          await expect(
            bridge.connect(governance).updateGovernance(governance.address)
          ).to.be.revertedWithCustomError(bridge, "UnauthorizedGovernanceAccess");
        } else {
          await expect(
            bridge.connect(governance).updateGovernance(scenario.address)
          ).to.be.revertedWithCustomError(bridge, "GovernanceMustBeContract");
        }
      });
    }),
    { numRuns: DEFAULT_RUNS }
  );
  });

  it("[property] addLiquidity accumulates reserves and provider balances", async function () {
    const base = await loadFixture(deployBridgeFixture);
    const amountArrayArb = fc.array(fc.integer({ min: 1, max: 5_000 }), { minLength: 1, maxLength: 4 });

    await fc.assert(
      fc.asyncProperty(amountArrayArb, async rawAmounts => {
        await withSnapshot(async () => {
          const { bridge, governance, mockToken } = base;
          const chainId = 42069;

          await bridge.connect(governance).addSupportedChain(
            chainId,
            "Testnet",
            await bridge.getAddress(),
            12,
            MIN_CHAIN_AMOUNT,
            MAX_CHAIN_AMOUNT,
            10
          );

          let expectedLiquidity = 0n;

          for (let i = 0; i < rawAmounts.length; i += 1) {
            const amount = ethers.parseUnits(rawAmounts[i].toString(), 18);
            const salt = BigInt(i + 1);
            const providerCommitment = deriveCommitment("provider-liquidity", salt);
            const nullifier = deriveCommitment("liquidity-nullifier", salt);

            await mockToken.seedCommitment(providerCommitment, amount);

            await bridge.connect(governance).addLiquidity({
              chainId,
              amount,
              providerCommitment,
              nullifier,
              zkProof: ZERO_PROOF
            });

            expectedLiquidity += amount;

            const info = await bridge.chainLiquidityInfo(chainId);
            expect(info.availableLiquidity).to.equal(expectedLiquidity);
            expect(info.totalReserves).to.equal(expectedLiquidity);

            const provider = await bridge.getLiquidityProvider(providerCommitment);
            expect(provider.currentLiquidity).to.equal(amount);
            expect(provider.totalProvided).to.equal(amount);
          }
        });
      }),
      { numRuns: DEFAULT_RUNS }
    );
  });

  it("[property] removeLiquidity returns funds and updates reserves proportionally", async function () {
    const base = await loadFixture(deployBridgeFixture);
    const scenarioArb = fc.record({
      tokens: fc.integer({ min: 100, max: 10_000 }),
      withdrawBps: fc.integer({ min: 500, max: 9_500 })
    });

    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ tokens, withdrawBps }) => {
        await withSnapshot(async () => {
          const { bridge, governance, mockToken } = base;
          const chainId = 42110;

          await bridge.connect(governance).addSupportedChain(
            chainId,
            "Testnet-Removal",
            await bridge.getAddress(),
            12,
            MIN_CHAIN_AMOUNT,
            MAX_CHAIN_AMOUNT,
            10
          );

          const amount = ethers.parseUnits(tokens.toString(), 18);
          const providerCommitment = deriveCommitment("provider-remove", BigInt(tokens));
          const addNullifier = deriveCommitment("add-nullifier", BigInt(tokens));

          await mockToken.seedCommitment(providerCommitment, amount);

          await bridge.connect(governance).addLiquidity({
            chainId,
            amount,
            providerCommitment,
            nullifier: addNullifier,
            zkProof: ZERO_PROOF
          });

          let removeAmount = (amount * BigInt(withdrawBps)) / 10_000n;
          if (removeAmount === 0n) {
            removeAmount = 1n;
          }

          const removeNullifier = deriveCommitment("remove-nullifier", BigInt(withdrawBps) + 1n);

          await bridge
            .connect(governance)
            .removeLiquidity(chainId, removeAmount, providerCommitment, removeNullifier, ZERO_PROOF);

          const info = await bridge.chainLiquidityInfo(chainId);
          expect(info.availableLiquidity).to.equal(amount - removeAmount);
          expect(info.totalReserves).to.equal(amount - removeAmount);

          const provider = await bridge.getLiquidityProvider(providerCommitment);
          expect(provider.currentLiquidity).to.equal(amount - removeAmount);
          expect(provider.totalProvided).to.equal(amount);
        });
      }),
      { numRuns: DEFAULT_RUNS }
    );
  });

  it("[property] attempting to remove more liquidity than available reverts", async function () {
    const base = await loadFixture(deployBridgeFixture);
    const scenarioArb = fc.record({
      tokens: fc.integer({ min: 1_000, max: 5_000 }),
      excess: fc.integer({ min: 1, max: 1_000 })
    });

    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ tokens, excess }) => {
        await withSnapshot(async () => {
          const { bridge, governance, mockToken } = base;
          const chainId = 42222;

          await bridge.connect(governance).addSupportedChain(
            chainId,
            "Testnet-Excess",
            await bridge.getAddress(),
            12,
            MIN_CHAIN_AMOUNT,
            MAX_CHAIN_AMOUNT,
            10
          );

          const amount = ethers.parseUnits(tokens.toString(), 18);
          const providerCommitment = deriveCommitment("provider-excess", BigInt(tokens));
          const addNullifier = deriveCommitment("add-nullifier-excess", BigInt(tokens));

          await mockToken.seedCommitment(providerCommitment, amount);

          await bridge.connect(governance).addLiquidity({
            chainId,
            amount,
            providerCommitment,
            nullifier: addNullifier,
            zkProof: ZERO_PROOF
          });

          const removeAmount = amount + ethers.parseUnits(excess.toString(), 18);
          const removeNullifier = deriveCommitment("remove-nullifier-excess", BigInt(excess) + 1n);

          await expect(
            bridge
              .connect(governance)
              .removeLiquidity(chainId, removeAmount, providerCommitment, removeNullifier, ZERO_PROOF)
          ).to.be.revertedWithCustomError(bridge, "InsufficientLiquidity");
        });
      }),
      { numRuns: DEFAULT_RUNS }
    );
  });
});

