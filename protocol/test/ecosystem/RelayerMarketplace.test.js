const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RelayerMarketplace", function () {
  it("registers relayer when stake meets minimum", async function () {
    const [owner, relayer] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("contracts/test/TokenDistributionMocks.sol:MockERC20");
    const token = await MockERC20.deploy("AGS", "AGS", ethers.parseEther("1000000"));

    const Ceremony = await ethers.getContractFactory("CeremonyVerifier");
    const ceremony = await Ceremony.deploy(owner.address);

    const Gov = await ethers.getContractFactory("PrivateGovernance");
    const gov = await Gov.deploy(owner.address, owner.address, owner.address);

    const Factory = await ethers.getContractFactory("VerifierFactory");
    const factory = await Factory.deploy(await ceremony.getAddress(), await gov.getAddress());

    const Marketplace = await ethers.getContractFactory("RelayerMarketplace");
    const minStake = ethers.parseEther("1000");
    const market = await Marketplace.deploy(await token.getAddress(), await factory.getAddress(), minStake);

    await token.transfer(relayer.address, minStake);
    await token.connect(relayer).approve(await market.getAddress(), minStake);
    await market.connect(relayer).register(minStake);

    expect(await market.isActiveRelayer(relayer.address)).to.equal(true);
  });

  it("requires DAO approval when allowlist is enabled", async function () {
    const [owner, relayer] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("contracts/test/TokenDistributionMocks.sol:MockERC20");
    const token = await MockERC20.deploy("AGS", "AGS", ethers.parseEther("1000000"));

    const Ceremony = await ethers.getContractFactory("CeremonyVerifier");
    const ceremony = await Ceremony.deploy(owner.address);

    const Gov = await ethers.getContractFactory("PrivateGovernance");
    const gov = await Gov.deploy(owner.address, owner.address, owner.address);

    const Factory = await ethers.getContractFactory("VerifierFactory");
    const factory = await Factory.deploy(await ceremony.getAddress(), await gov.getAddress());

    const Marketplace = await ethers.getContractFactory("RelayerMarketplace");
    const minStake = ethers.parseEther("1000");
    const market = await Marketplace.deploy(await token.getAddress(), await factory.getAddress(), minStake);
    await market.setGovernance(owner.address);
    await market.setDaoAllowlistRequired(true);

    await token.transfer(relayer.address, minStake);
    await token.connect(relayer).approve(await market.getAddress(), minStake);

    await expect(market.connect(relayer).register(minStake)).to.be.revertedWithCustomError(
      market,
      "RelayerNotDaoApproved"
    );

    await market.setDaoApprovedRelayer(relayer.address, true);
    await market.connect(relayer).register(minStake);
    expect(await market.isActiveRelayer(relayer.address)).to.equal(true);
  });
});

describe("StealthAddressHub", function () {
  it("registers stealth meta", async function () {
    const [owner] = await ethers.getSigners();
    const MockERC20 = await ethers.getContractFactory("contracts/test/TokenDistributionMocks.sol:MockERC20");
    const token = await MockERC20.deploy("AGS", "AGS", 0);
    const Ceremony = await ethers.getContractFactory("CeremonyVerifier");
    const ceremony = await Ceremony.deploy(owner.address);
    const Gov = await ethers.getContractFactory("PrivateGovernance");
    const gov = await Gov.deploy(owner.address, owner.address, owner.address);
    const Factory = await ethers.getContractFactory("VerifierFactory");
    const factory = await Factory.deploy(await ceremony.getAddress(), await gov.getAddress());
    const Hub = await ethers.getContractFactory("StealthAddressHub");
    const hub = await Hub.deploy(await token.getAddress(), await factory.getAddress());

    const viewTag = ethers.id("view-tag-1");
    const spendingKeyHash = ethers.id("spending-key");
    await hub.registerStealthMeta(viewTag, spendingKeyHash);
    const meta = await hub.stealthMetas(viewTag);
    expect(meta.active).to.equal(true);
    expect(meta.spendingKeyHash).to.equal(spendingKeyHash);
  });
});
