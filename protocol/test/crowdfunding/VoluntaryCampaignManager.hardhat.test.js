const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("VoluntaryCampaignManager", function () {
  function validConfig() {
    return {
      enableMilestoneTracking: true,
      enablePeerReview: true,
      enableAutomaticRelease: false,
      enableCreatorOverride: false,
      reviewPeriod: 3 * 24 * 3600,
      minimumReviewers: 3,
    };
  }

  async function deployFixture() {
    const [_, creator, other] = await ethers.getSigners();
    const MockShield = await ethers.getContractFactory("MockCrowdShield");
    const shield = await MockShield.deploy();
    const Vcm = await ethers.getContractFactory("VoluntaryCampaignManager");
    const manager = await Vcm.deploy(await shield.getAddress());
    await manager.waitForDeployment();

    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 100_000;
    await shield
      .connect(creator)
      .createMockCampaign(
        creator.address,
        ethers.parseEther("1000"),
        ethers.parseEther("500"),
        deadline,
        2
      );

    return { shield, manager, creator, other };
  }

  it("reverts constructor on zero CrowdShield", async function () {
    const Vcm = await ethers.getContractFactory("VoluntaryCampaignManager");
    await expect(Vcm.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(Vcm, "InvalidCrowdShieldAddress");
  });

  it("createCampaignManagement succeeds for campaign creator", async function () {
    const { manager, creator } = await loadFixture(deployFixture);
    const hash = ethers.keccak256(ethers.toUtf8Bytes("mgmt"));
    await expect(manager.connect(creator).createCampaignManagement(1, validConfig(), hash)).to.emit(
      manager,
      "CampaignManagementCreated"
    );
    const m = await manager.getCampaignManagement(1);
    expect(m.isActive).to.equal(true);
    expect(m.creator).to.equal(creator.address);
  });

  it("reverts createCampaignManagement when not campaign creator", async function () {
    const { manager, other } = await loadFixture(deployFixture);
    await expect(manager.connect(other).createCampaignManagement(1, validConfig(), ethers.ZeroHash)).to.be.revertedWithCustomError(
      manager,
      "NotCampaignCreator"
    );
  });

  it("reverts duplicate createCampaignManagement", async function () {
    const { manager, creator } = await loadFixture(deployFixture);
    const cfg = validConfig();
    await manager.connect(creator).createCampaignManagement(1, cfg, ethers.keccak256(ethers.toUtf8Bytes("a")));
    await expect(manager.connect(creator).createCampaignManagement(1, cfg, ethers.keccak256(ethers.toUtf8Bytes("b")))).to.be.revertedWithCustomError(
      manager,
      "ManagementAlreadyExists"
    );
  });

  it("reverts createCampaignManagement when review period too short", async function () {
    const { manager, creator } = await loadFixture(deployFixture);
    const bad = { ...validConfig(), reviewPeriod: 1 * 24 * 3600 };
    await expect(manager.connect(creator).createCampaignManagement(1, bad, ethers.ZeroHash)).to.be.revertedWithCustomError(
      manager,
      "InvalidMilestoneConfiguration"
    );
  });

  it("reverts createCampaignManagement when review period too long", async function () {
    const { manager, creator } = await loadFixture(deployFixture);
    const bad = { ...validConfig(), reviewPeriod: 40 * 24 * 3600 };
    await expect(manager.connect(creator).createCampaignManagement(1, bad, ethers.ZeroHash)).to.be.revertedWithCustomError(
      manager,
      "InvalidMilestoneConfiguration"
    );
  });

  it("reverts createCampaignManagement when minimumReviewers too low", async function () {
    const { manager, creator } = await loadFixture(deployFixture);
    const bad = { ...validConfig(), minimumReviewers: 2 };
    await expect(manager.connect(creator).createCampaignManagement(1, bad, ethers.ZeroHash)).to.be.revertedWithCustomError(
      manager,
      "InvalidMilestoneConfiguration"
    );
  });

  it("reverts createCampaignManagement when minimumReviewers too high", async function () {
    const { manager, creator } = await loadFixture(deployFixture);
    const bad = { ...validConfig(), minimumReviewers: 22 };
    await expect(manager.connect(creator).createCampaignManagement(1, bad, ethers.ZeroHash)).to.be.revertedWithCustomError(
      manager,
      "InvalidMilestoneConfiguration"
    );
  });

  it("addMilestone emits and increments totalMilestones", async function () {
    const { manager, creator } = await loadFixture(deployFixture);
    await manager.connect(creator).createCampaignManagement(1, validConfig(), ethers.ZeroHash);
    const desc = ethers.keccak256(ethers.toUtf8Bytes("desc"));
    const deliv = ethers.keccak256(ethers.toUtf8Bytes("deliv"));
    await expect(
      manager.connect(creator).addMilestone(1, desc, 1n, 7 * 24 * 3600, deliv, false, 5)
    ).to.emit(manager, "MilestoneCreated");
    const m = await manager.getCampaignManagement(1);
    expect(m.totalMilestones).to.equal(1n);
  });

  it("reverts addMilestone for zero descriptionHash", async function () {
    const { manager, creator } = await loadFixture(deployFixture);
    await manager.connect(creator).createCampaignManagement(1, validConfig(), ethers.ZeroHash);
    await expect(
      manager.connect(creator).addMilestone(1, ethers.ZeroHash, 1n, 100, ethers.keccak256(ethers.toUtf8Bytes("d")), false, 5)
    ).to.be.revertedWithCustomError(manager, "InvalidDescriptionHash");
  });

  it("reverts addMilestone for zero targetAmount", async function () {
    const { manager, creator } = await loadFixture(deployFixture);
    await manager.connect(creator).createCampaignManagement(1, validConfig(), ethers.ZeroHash);
    await expect(
      manager
        .connect(creator)
        .addMilestone(1, ethers.keccak256(ethers.toUtf8Bytes("ab")), 0n, 100, ethers.keccak256(ethers.toUtf8Bytes("cd")), false, 5)
    ).to.be.revertedWithCustomError(manager, "InvalidTargetAmount");
  });

  it("reverts addMilestone for zero duration", async function () {
    const { manager, creator } = await loadFixture(deployFixture);
    await manager.connect(creator).createCampaignManagement(1, validConfig(), ethers.ZeroHash);
    await expect(
      manager
        .connect(creator)
        .addMilestone(1, ethers.keccak256(ethers.toUtf8Bytes("ab")), 1n, 0, ethers.keccak256(ethers.toUtf8Bytes("cd")), false, 5)
    ).to.be.revertedWithCustomError(manager, "InvalidDuration");
  });

  it("reverts addMilestone for zero deliverableHash", async function () {
    const { manager, creator } = await loadFixture(deployFixture);
    await manager.connect(creator).createCampaignManagement(1, validConfig(), ethers.ZeroHash);
    await expect(
      manager.connect(creator).addMilestone(1, ethers.keccak256(ethers.toUtf8Bytes("ab")), 1n, 100, ethers.ZeroHash, false, 5)
    ).to.be.revertedWithCustomError(manager, "InvalidDeliverableHash");
  });

  it("reverts addMilestone when voterThreshold below minimum reviewers", async function () {
    const { manager, creator } = await loadFixture(deployFixture);
    await manager.connect(creator).createCampaignManagement(1, validConfig(), ethers.ZeroHash);
    await expect(
      manager
        .connect(creator)
        .addMilestone(1, ethers.keccak256(ethers.toUtf8Bytes("ab")), 1n, 100, ethers.keccak256(ethers.toUtf8Bytes("cd")), false, 2)
    ).to.be.revertedWithCustomError(manager, "InsufficientVoterThreshold");
  });

  it("reverts addMilestone when not creator", async function () {
    const { manager, creator, other } = await loadFixture(deployFixture);
    await manager.connect(creator).createCampaignManagement(1, validConfig(), ethers.ZeroHash);
    await expect(
      manager
        .connect(other)
        .addMilestone(1, ethers.keccak256(ethers.toUtf8Bytes("ab")), 1n, 100, ethers.keccak256(ethers.toUtf8Bytes("cd")), false, 5)
    ).to.be.revertedWithCustomError(manager, "NotCampaignCreator");
  });

  it("activateNextMilestone reverts when no milestones", async function () {
    const { manager, creator } = await loadFixture(deployFixture);
    await manager.connect(creator).createCampaignManagement(1, validConfig(), ethers.ZeroHash);
    await expect(manager.connect(creator).activateNextMilestone(1)).to.be.revertedWithCustomError(manager, "NoMoreMilestones");
  });

  it("activateNextMilestone succeeds when funding covers target", async function () {
    const { manager, creator } = await loadFixture(deployFixture);
    await manager.connect(creator).createCampaignManagement(1, validConfig(), ethers.ZeroHash);
    const desc = ethers.keccak256(ethers.toUtf8Bytes("m1"));
    const deliv = ethers.keccak256(ethers.toUtf8Bytes("d1"));
    await manager.connect(creator).addMilestone(1, desc, ethers.parseEther("100"), 30 * 24 * 3600, deliv, false, 5);
    await expect(manager.connect(creator).activateNextMilestone(1)).to.emit(manager, "MilestoneActivated");
    const ids = await manager.getCampaignMilestones(1);
    const ms = await manager.getMilestone(ids[0]);
    expect(ms.status).to.equal(1);
  });

  it("activateNextMilestone reverts when raised funds are below milestone target", async function () {
    const { manager, creator } = await loadFixture(deployFixture);
    await manager.connect(creator).createCampaignManagement(1, validConfig(), ethers.ZeroHash);
    const desc = ethers.keccak256(ethers.toUtf8Bytes("high"));
    const deliv = ethers.keccak256(ethers.toUtf8Bytes("d2"));
    await manager
      .connect(creator)
      .addMilestone(1, desc, ethers.parseEther("600"), 30 * 24 * 3600, deliv, false, 5);
    await expect(manager.connect(creator).activateNextMilestone(1)).to.be.revertedWithCustomError(
      manager,
      "InsufficientFundingForMilestone"
    );
  });

  it("getCreatorManagedCampaigns lists campaign", async function () {
    const { manager, creator } = await loadFixture(deployFixture);
    await manager.connect(creator).createCampaignManagement(1, validConfig(), ethers.ZeroHash);
    const list = await manager.getCreatorManagedCampaigns(creator.address);
    expect(list.map((x) => Number(x))).to.deep.equal([1]);
  });
});
