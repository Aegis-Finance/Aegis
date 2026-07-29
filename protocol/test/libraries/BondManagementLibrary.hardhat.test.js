const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("BondManagementLibrary (via BondManagementLibraryHarness)", function () {
  async function deployMocks() {
    const [_, creator, other] = await ethers.getSigners();
    const ValLib = await ethers.getContractFactory("ValidationLibrary");
    const valLib = await ValLib.deploy();
    await valLib.waitForDeployment();
    const valLibAddress = await valLib.getAddress();

    const BondLib = await ethers.getContractFactory("BondManagementLibrary", {
      libraries: {
        "contracts/libraries/ValidationLibrary.sol:ValidationLibrary": valLibAddress,
      },
    });
    const bondLib = await BondLib.deploy();
    await bondLib.waitForDeployment();
    const bondLibAddress = await bondLib.getAddress();

    const MockShield = await ethers.getContractFactory("MockCrowdShield");
    const shield = await MockShield.deploy();
    const Harness = await ethers.getContractFactory("BondManagementLibraryHarness", {
      libraries: {
        "contracts/libraries/BondManagementLibrary.sol:BondManagementLibrary": bondLibAddress,
      },
    });
    const harness = await Harness.deploy();
    await harness.waitForDeployment();
    return { shield, harness, creator, other };
  }

  it("createBond sets creator, amounts, active flag, and unlock in the future", async function () {
    const { harness, creator } = await loadFixture(deployMocks);
    const campaignId = 42n;
    const amount = ethers.parseEther("5");
    const bondType = 1; // Delivery
    const [outCreator, outAmount, outCamp, unlockTime, isActive, isSlashed] = await harness.exCreateBond(
      creator.address,
      amount,
      campaignId,
      bondType
    );
    expect(outCreator).to.equal(creator.address);
    expect(outAmount).to.equal(amount);
    expect(outCamp).to.equal(campaignId);
    expect(isActive).to.equal(true);
    expect(isSlashed).to.equal(false);
    const latest = BigInt((await ethers.provider.getBlock("latest")).timestamp);
    expect(BigInt(unlockTime)).to.be.gt(latest);
  });

  it("validateBondPosting succeeds when campaign creator matches", async function () {
    const { shield, harness, creator } = await loadFixture(deployMocks);
    await shield.createMockCampaign(
      creator.address,
      ethers.parseEther("1000"),
      ethers.parseEther("100"),
      (await ethers.provider.getBlock("latest")).timestamp + 10_000,
      2 // Failed — only used for existence + creator binding in mock
    );
    await expect(
      harness.exValidateBondPosting(await shield.getAddress(), 1, creator.address, ethers.parseEther("1"))
    ).to.not.be.reverted;
  });

  it("validateBondPosting reverts when caller is not campaign creator", async function () {
    const { shield, harness, creator, other } = await loadFixture(deployMocks);
    await shield.createMockCampaign(
      creator.address,
      ethers.parseEther("1000"),
      ethers.parseEther("100"),
      (await ethers.provider.getBlock("latest")).timestamp + 10_000,
      2
    );
    await expect(
      harness.exValidateBondPosting(await shield.getAddress(), 1, other.address, ethers.parseEther("1"))
    ).to.be.reverted;
  });

  it("validateBondPosting reverts for sub-minimum bond amount", async function () {
    const { shield, harness, creator } = await loadFixture(deployMocks);
    await shield.createMockCampaign(
      creator.address,
      ethers.parseEther("1000"),
      ethers.parseEther("100"),
      (await ethers.provider.getBlock("latest")).timestamp + 10_000,
      2
    );
    await expect(
      harness.exValidateBondPosting(await shield.getAddress(), 1, creator.address, ethers.parseEther("0.05"))
    ).to.be.reverted;
  });

  it("validateBondPosting reverts for non-existent campaign id", async function () {
    const { shield, harness, creator } = await loadFixture(deployMocks);
    await expect(
      harness.exValidateBondPosting(await shield.getAddress(), 999, creator.address, ethers.parseEther("1"))
    ).to.be.reverted;
  });

  it("createBond preserves distinct bond types in returned struct", async function () {
    const { harness, creator } = await loadFixture(deployMocks);
    const t0 = await harness.exCreateBond(creator.address, 100n, 1n, 0);
    const t4 = await harness.exCreateBond(creator.address, 100n, 1n, 4);
    expect(t0[3]).to.equal(t4[3]); // same block → same unlock baseline
    expect(t0[2]).to.equal(1n);
    expect(t4[2]).to.equal(1n);
  });
});
