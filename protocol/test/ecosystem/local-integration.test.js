const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('Ecosystem local wiring', function () {
  it('deploys ShieldedYieldVault linked to savings vault', async function () {
    const [owner] = await ethers.getSigners();
    const MockERC20 = await ethers.getContractFactory('contracts/test/TokenDistributionMocks.sol:MockERC20');
    const token = await MockERC20.deploy('AGS', 'AGS', 0);
    const Ceremony = await ethers.getContractFactory('CeremonyVerifier');
    const ceremony = await Ceremony.deploy(owner.address);
    const Gov = await ethers.getContractFactory('PrivateGovernance');
    const gov = await Gov.deploy(owner.address, owner.address, owner.address);
    const Factory = await ethers.getContractFactory('VerifierFactory');
    const factory = await Factory.deploy(await ceremony.getAddress(), await gov.getAddress());

    const Savings = await ethers.getContractFactory('PrivacySavingsVault');
    const savings = await Savings.deploy(await token.getAddress(), await factory.getAddress());
    const YieldVault = await ethers.getContractFactory('ShieldedYieldVault');
    const yieldVault = await YieldVault.deploy(
      await token.getAddress(),
      await factory.getAddress(),
      await savings.getAddress()
    );

    const commitment = ethers.id('yield-lock-1');
    const tx = await yieldVault.openLockedYield(commitment, 86400);
    await tx.wait();
    expect(await yieldVault.savingsVault()).to.equal(await savings.getAddress());
  });

  it('ShieldedIncentiveClaims stores gauge and auction addresses', async function () {
    const [owner, gauge, auction] = await ethers.getSigners();
    const MockERC20 = await ethers.getContractFactory('contracts/test/TokenDistributionMocks.sol:MockERC20');
    const token = await MockERC20.deploy('AGS', 'AGS', 0);
    const Ceremony = await ethers.getContractFactory('CeremonyVerifier');
    const ceremony = await Ceremony.deploy(owner.address);
    const Factory = await ethers.getContractFactory('VerifierFactory');
    const factory = await Factory.deploy(await ceremony.getAddress(), owner.address);
    const Claims = await ethers.getContractFactory('ShieldedIncentiveClaims');
    const claims = await Claims.deploy(await token.getAddress(), await factory.getAddress());
    await claims.setGovernance(owner.address);
    await claims.setLiquidityMiningGauge(gauge.address);
    await claims.setTreasuryBondAuction(auction.address);
    expect(await claims.liquidityMiningGauge()).to.equal(gauge.address);
    expect(await claims.treasuryBondAuction()).to.equal(auction.address);
  });
});
