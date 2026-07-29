import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import fc from "fast-check";

import { findEvent, impersonateSigner, withSnapshot } from "./utils";

const UNIT = ethers.parseUnits("1", 18);
const DEFAULT_RUNS = parseInt(process.env.FUZZ_RUNS ?? "60", 10);

async function deployGovernanceTreasuryFixture() {
  const [deployer, recipientA, recipientB] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory("contracts/test/MockERC20.sol:MockERC20");
  const treasuryToken = (await MockERC20.deploy("Treasury Token", "TRES")) as any;
  await treasuryToken.waitForDeployment();

  const GovernanceCoreStub = await ethers.getContractFactory("GovernanceCoreStub");
  const governanceCore = await GovernanceCoreStub.deploy();
  await governanceCore.waitForDeployment();

  const GovernanceTreasury = await ethers.getContractFactory("GovernanceTreasury");
  const treasury = (await GovernanceTreasury.deploy(await governanceCore.getAddress())) as any;
  await treasury.waitForDeployment();

  await treasury.configureTreasury(await treasuryToken.getAddress(), await treasury.getAddress());

  const initialBalance = UNIT * 50_000n;
  await treasuryToken.connect(deployer).mint(await treasury.getAddress(), initialBalance);

  return {
    treasury,
    treasuryToken,
    governanceCore,
    recipients: [recipientA.address, recipientB.address]
  };
}

const proposalParamsArb = fc.record({
  title: fc.string({ minLength: 1, maxLength: 18 }),
  description: fc.string({ minLength: 1, maxLength: 48 }),
  proposalType: fc.integer({ min: 0, max: 4 }),
  amount: fc.integer({ min: 1, max: 5_000 }),
  recipientIndex: fc.integer({ min: 0, max: 1 })
});

type ProposalInput = {
  title: string;
  description: string;
  proposalType: number;
  recipient: string;
  amount: bigint;
};

async function submitTreasuryProposal(treasury: any, input: ProposalInput) {
  const tx = await treasury.createTreasuryProposal(
    input.title,
    input.description,
    input.proposalType,
    input.recipient,
    input.amount,
    ethers.ZeroHash,
    ethers.ZeroHash,
    "0x"
  );
  const receipt = await tx.wait();
  const createdEvent = receipt && findEvent(receipt.logs, treasury.interface, "TreasuryProposalCreated");
  expect(createdEvent, "TreasuryProposalCreated event").to.not.equal(undefined);
  const proposalId = createdEvent!.args.proposalId as bigint;
  return { proposalId, receipt, event: createdEvent };
}

describe("Property suite – GovernanceTreasury", function () {
  this.timeout(0);

  it("[property] creating a treasury proposal stores mapping and updates allocation", async function () {
    const base = await loadFixture(deployGovernanceTreasuryFixture);
    await fc.assert(
      fc.asyncProperty(proposalParamsArb, async params => {
        await withSnapshot(async () => {
          const { treasury, recipients } = base;
          const recipient = recipients[params.recipientIndex];
          const amount = UNIT * BigInt(params.amount);

          const { proposalId } = await submitTreasuryProposal(treasury, {
            title: params.title,
            description: params.description,
            proposalType: params.proposalType,
            recipient,
            amount
          });

          const storedProposal = await treasury.treasuryProposals(proposalId);
          expect(storedProposal.proposalType).to.equal(params.proposalType);
          expect(storedProposal.recipient).to.equal(recipient);
          expect(storedProposal.amount).to.equal(amount);
          expect(storedProposal.executed).to.equal(false);

          const proposalHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
            ["uint8", "address", "uint256"],
            [params.proposalType, recipient, amount]
          ));
          expect(await treasury.proposalHashToId(proposalHash)).to.equal(proposalId + 1n);

          const treasuryState = await treasury.treasuryState();
          expect(treasuryState.totalAllocated).to.equal(amount);
        });
      }),
      { numRuns: DEFAULT_RUNS }
    );
  });

  it("[property] repeated proposal creation accumulates allocations and refreshes hash mapping", async function () {
    const base = await loadFixture(deployGovernanceTreasuryFixture);
    await fc.assert(
      fc.asyncProperty(fc.tuple(proposalParamsArb, proposalParamsArb), async ([first, second]) => {
        await withSnapshot(async () => {
          const { treasury, recipients } = base;

          const firstRecipient = recipients[first.recipientIndex];
          const firstAmount = UNIT * BigInt(first.amount);
          const { proposalId: firstId } = await submitTreasuryProposal(treasury, {
            title: first.title,
            description: first.description,
            proposalType: first.proposalType,
            recipient: firstRecipient,
            amount: firstAmount
          });

          const secondRecipient = recipients[second.recipientIndex];
          const secondAmount = UNIT * BigInt(second.amount);
          const { proposalId: secondId } = await submitTreasuryProposal(treasury, {
            title: second.title,
            description: second.description,
            proposalType: second.proposalType,
            recipient: secondRecipient,
            amount: secondAmount
          });

          const treasuryState = await treasury.treasuryState();
          expect(treasuryState.totalAllocated).to.equal(firstAmount + secondAmount);

          const latestHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
            ["uint8", "address", "uint256"],
            [second.proposalType, secondRecipient, secondAmount]
          ));
          expect(await treasury.proposalHashToId(latestHash)).to.equal(secondId + 1n);

          const previousHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
            ["uint8", "address", "uint256"],
            [first.proposalType, firstRecipient, firstAmount]
          ));
          expect(await treasury.proposalHashToId(previousHash)).to.equal(firstId + 1n);
        });
      }),
      { numRuns: DEFAULT_RUNS }
    );
  });

  it("[property] executing a queued proposal transfers funds exactly once", async function () {
    const base = await loadFixture(deployGovernanceTreasuryFixture);
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          proposal: proposalParamsArb,
          proposalType: fc.integer({ min: 0, max: 4 })
        }),
        async ({ proposal, proposalType }) => {
          await withSnapshot(async () => {
            const { treasury, treasuryToken, governanceCore, recipients } = base;
            const recipient = recipients[proposal.recipientIndex];
            const amount = UNIT * BigInt(proposal.amount);

            const { proposalId, event: createdEvent, receipt } = await submitTreasuryProposal(treasury, {
              title: proposal.title,
              description: proposal.description,
              proposalType,
              recipient,
              amount
            });
            expect(createdEvent, "TreasuryProposalCreated event").to.not.equal(undefined);

            await governanceCore.setProposalState(proposalId, 5);

            const { signer: governanceProxy, stop } = await impersonateSigner(await governanceCore.getAddress());
            try {
              const balanceBefore = await treasuryToken.balanceOf(recipient);

              await expect(
                treasury.connect(governanceProxy).executeTreasuryTransfer(proposalType, recipient, amount)
              ).to.not.be.reverted;

              const balanceAfter = await treasuryToken.balanceOf(recipient);
              expect(balanceAfter - balanceBefore).to.equal(amount);

              const treasuryState = await treasury.treasuryState();
              expect(treasuryState.totalExecuted).to.equal(amount);

              await expect(
                treasury.connect(governanceProxy).executeTreasuryTransfer(proposalType, recipient, amount)
              ).to.be.revertedWithCustomError(treasury, "ProposalAlreadyExecuted");
            } finally {
              await stop();
            }
          });
        }
      ),
      { numRuns: DEFAULT_RUNS }
    );
  });

  it("[property] mismatched execution parameters revert gracefully", async function () {
    const base = await loadFixture(deployGovernanceTreasuryFixture);
    await fc.assert(
      fc.asyncProperty(proposalParamsArb, async params => {
        await withSnapshot(async () => {
          const { treasury, governanceCore, recipients } = base;
          const recipient = recipients[params.recipientIndex];
          const amount = UNIT * BigInt(params.amount);

          const { proposalId } = await submitTreasuryProposal(treasury, {
            title: params.title,
            description: params.description,
            proposalType: params.proposalType,
            recipient,
            amount
          });

          await governanceCore.setProposalState(proposalId, 5);

          const { signer: governanceProxy, stop } = await impersonateSigner(await governanceCore.getAddress());
          try {
            await expect(
              treasury
                .connect(governanceProxy)
                .executeTreasuryTransfer(params.proposalType, recipient, amount + UNIT)
            ).to.be.reverted;
          } finally {
            await stop();
          }
        });
      }),
      { numRuns: Math.max(10, DEFAULT_RUNS / 2) }
    );
  });
});

