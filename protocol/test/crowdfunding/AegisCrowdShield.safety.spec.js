const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("AegisCrowdShield — settlement & dispute safety", function () {
  const sevenDays = 7n * 24n * 3600n;
  const fourteenDays = 14n * 24n * 3600n;

  const sovWithDisputes = {
    enablePrivateContributions: false,
    enableMarketDrivenDisputes: true,
    enableVoluntaryCompliance: false,
    enableSpontaneousOrder: false,
    minimumStakeForSovereignty: 0n,
    minimumContribution: 1n,
    maximumContribution: 10_000n,
  };

  const zeroZkProof = [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n];

  const commitment = ethers.id("campaign-commitment");

  async function deployFixture() {
    const [creator, backerA, backerB, other] = await ethers.getSigners();
    const VF = await ethers.getContractFactory("CrowdTestVerifierFactory");
    const vf = await VF.deploy();
    const Gov = await ethers.getContractFactory("CrowdTestGovernance");
    const gov = await Gov.deploy();
    const Shield = await ethers.getContractFactory("AegisCrowdShield");
    const shield = await Shield.deploy(await vf.getAddress(), await gov.getAddress());
    return { shield, vf, gov, creator, backerA, backerB, other };
  }

  it("schedules creator withdrawal at deadline + dispute period and rejects early withdraw", async function () {
    const { shield, creator, backerA } = await deployFixture();
    await shield.connect(creator).createCampaign(
      10_000n,
      sevenDays,
      ethers.ZeroAddress,
      commitment,
      false,
      sovWithDisputes
    );
    const id = await shield.nextCampaignId();
    await shield.connect(backerA).contribute(id, 10_000n, ethers.ZeroHash, zeroZkProof, [], { value: 10_000n });

    const c = await shield.getCampaign(id);
    const unlock = await shield.getCreatorWithdrawUnlock(id);
    expect(c.status).to.equal(1); // Successful
    expect(unlock).to.equal(c.deadline + fourteenDays);

    await expect(shield.connect(creator).withdrawFunds(id)).to.be.revertedWithCustomError(
      shield,
      "WithdrawTooEarly"
    );

    await time.increaseTo(unlock + 1n);
    await expect(shield.connect(creator).withdrawFunds(id)).to.emit(shield, "FundsWithdrawn");
  });

  it("blocks creator withdraw while a dispute is open (even after unlock)", async function () {
    const { shield, creator, backerA, backerB } = await deployFixture();
    await shield.connect(creator).createCampaign(
      10_000n,
      sevenDays,
      ethers.ZeroAddress,
      commitment,
      false,
      sovWithDisputes
    );
    const id = await shield.nextCampaignId();
    await shield.connect(backerA).contribute(id, 5_000n, ethers.ZeroHash, zeroZkProof, [], { value: 5_000n });
    await shield.connect(backerB).contribute(id, 5_000n, ethers.ZeroHash, zeroZkProof, [], { value: 5_000n });

    const unlock = await shield.getCreatorWithdrawUnlock(id);
    await time.increaseTo(unlock + 1n);

    const stake = ethers.parseEther("0.1");
    await shield.connect(backerA).initiateDispute(id, ethers.id("evidence"), { value: stake });

    await expect(shield.connect(creator).withdrawFunds(id)).to.be.revertedWithCustomError(
      shield,
      "CampaignDisputed"
    );
  });

  it("reverts a second initiateDispute while one is open", async function () {
    const { shield, creator, backerA, backerB } = await deployFixture();
    await shield.connect(creator).createCampaign(
      10_000n,
      sevenDays,
      ethers.ZeroAddress,
      commitment,
      false,
      sovWithDisputes
    );
    const id = await shield.nextCampaignId();
    await shield.connect(backerA).contribute(id, 5_000n, ethers.ZeroHash, zeroZkProof, [], { value: 5_000n });
    await shield.connect(backerB).contribute(id, 5_000n, ethers.ZeroHash, zeroZkProof, [], { value: 5_000n });
    const stake = ethers.parseEther("0.1");
    await shield.connect(backerA).initiateDispute(id, ethers.id("evidence-a"), { value: stake });
    await expect(
      shield.connect(backerB).initiateDispute(id, ethers.id("evidence-b"), { value: stake })
    ).to.be.revertedWithCustomError(shield, "DisputeAlreadyOpen");
  });

  it("reverts dispute before the campaign is economically successful", async function () {
    const { shield, creator, backerA } = await deployFixture();
    await shield.connect(creator).createCampaign(
      10_000n,
      sevenDays,
      ethers.ZeroAddress,
      commitment,
      false,
      sovWithDisputes
    );
    const id = await shield.nextCampaignId();
    await shield.connect(backerA).contribute(id, 100n, ethers.ZeroHash, zeroZkProof, [], { value: 100n });
    const stake = ethers.parseEther("0.1");
    await expect(
      shield.connect(backerA).initiateDispute(id, ethers.id("evidence"), { value: stake })
    ).to.be.revertedWithCustomError(shield, "CannotDisputeInCurrentState");
  });

  it("reverts creator withdraw when paused (governance)", async function () {
    const { shield, creator, backerA, gov } = await deployFixture();
    await shield.connect(creator).createCampaign(
      10_000n,
      sevenDays,
      ethers.ZeroAddress,
      commitment,
      false,
      sovWithDisputes
    );
    const id = await shield.nextCampaignId();
    await shield.connect(backerA).contribute(id, 10_000n, ethers.ZeroHash, zeroZkProof, [], { value: 10_000n });
    const unlock = await shield.getCreatorWithdrawUnlock(id);
    await time.increaseTo(unlock + 1n);
    await gov.pauseCrowd(await shield.getAddress());
    await expect(shield.connect(creator).withdrawFunds(id)).to.be.revertedWithCustomError(
      shield,
      "EnforcedPause"
    );
  });
});
