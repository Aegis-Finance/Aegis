const { expect } = require('chai');
const { ethers } = require('hardhat');

async function deployCore(owner) {
  const proofLib = await (await ethers.getContractFactory('ProofLib')).deploy();
  const proofLibAddress = await proofLib.getAddress();
  const tokenAllocation = await (
    await ethers.getContractFactory('TokenAllocation')
  ).deploy(owner.address);
  const ceremony = await (await ethers.getContractFactory('CeremonyVerifier')).deploy(owner.address);
  const gov = await (
    await ethers.getContractFactory('PrivateGovernance')
  ).deploy(owner.address, owner.address, owner.address);
  const factory = await (
    await ethers.getContractFactory('VerifierFactory')
  ).deploy(await ceremony.getAddress(), await gov.getAddress());
  const tokenFactory = await ethers.getContractFactory('PrivateTokenContract', {
    libraries: { 'contracts/libraries/ProofLib.sol:ProofLib': proofLibAddress },
  });
  const token = await tokenFactory.deploy(await factory.getAddress(), await tokenAllocation.getAddress());
  const lendingFactory = await ethers.getContractFactory('PrivateLendingContract', {
    libraries: { 'contracts/libraries/ProofLib.sol:ProofLib': proofLibAddress },
  });
  const lending = await lendingFactory.deploy(await token.getAddress(), await factory.getAddress());
  const credit = await (
    await ethers.getContractFactory('PrivateCreditProfile')
  ).deploy(await token.getAddress(), await factory.getAddress());
  return { lending, credit };
}

describe('PrivateLending credit-profile gate', function () {
  it('links hub and reverts borrow when credit proof missing', async function () {
    const [owner] = await ethers.getSigners();
    const { lending, credit } = await deployCore(owner);

    await lending.setPrivateCreditProfileHub(await credit.getAddress());
    expect(await lending.privateCreditProfileHub()).to.equal(await credit.getAddress());

    const emptyProof = [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n];
    await expect(
      lending.borrowWithCollateralAndCreditProfile(500, emptyProof, [], emptyProof, [])
    ).to.be.reverted;
  });
});
