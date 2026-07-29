const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DecentralizedInsurance mutual types", function () {
  it("initializes HEALTH, CROP, and BUSINESS premium rates", async function () {
    const [owner] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("contracts/test/TokenDistributionMocks.sol:MockERC20");
    const token = await MockERC20.deploy("AGS", "AGS", 0);

    const Ceremony = await ethers.getContractFactory("CeremonyVerifier");
    const ceremony = await Ceremony.deploy(owner.address);

    const Gov = await ethers.getContractFactory("PrivateGovernance");
    const gov = await Gov.deploy(owner.address, owner.address, owner.address);

    const Factory = await ethers.getContractFactory("VerifierFactory");
    const factory = await Factory.deploy(await ceremony.getAddress(), await gov.getAddress());

    const Insurance = await ethers.getContractFactory("DecentralizedInsurance");
    const insurance = await Insurance.deploy(await token.getAddress(), await factory.getAddress(), 0);

    // enum: HEALTH=5, CROP=6, BUSINESS=7
    expect(await insurance.basePremiumRates(5)).to.equal(400);
    expect(await insurance.basePremiumRates(6)).to.equal(350);
    expect(await insurance.basePremiumRates(7)).to.equal(450);
    expect(await insurance.riskMultipliers(5)).to.equal(180);
    expect(await insurance.riskMultipliers(6)).to.equal(160);
    expect(await insurance.riskMultipliers(7)).to.equal(170);
  });
});
