const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("StagedCapitalVault", function () {
  const BPS_HALF = 5000;

  /** OpenZeppelin merkle-tree style leaf for a single address value. */
  function investorLeaf(addr) {
    const inner = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address"], [addr]));
    return ethers.keccak256(ethers.concat([inner]));
  }

  /** Sorted commutative pair hash (matches `Hashes.commutativeKeccak256` + `efficientKeccak256`). */
  function commHash(a, b) {
    const aa = BigInt(a);
    const bb = BigInt(b);
    const [x, y] = aa < bb ? [a, b] : [b, a];
    return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes32"], [x, y]));
  }

  async function deployFixture() {
    const [deployer, founder, inv1, inv2, c1, c2, outsider] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("contracts/test/MockERC20.sol:MockERC20");
    const token = await MockERC20.deploy("Stable", "STB");
    await token.waitForDeployment();

    const Vault = await ethers.getContractFactory("StagedCapitalVault");
    const vault = await Vault.deploy();
    await vault.waitForDeployment();

    const vaultAddr = await vault.getAddress();
    const mint = ethers.parseEther("1000000");
    await token.mint(inv1.address, mint);
    await token.mint(inv2.address, mint);
    await token.connect(inv1).approve(vaultAddr, ethers.MaxUint256);
    await token.connect(inv2).approve(vaultAddr, ethers.MaxUint256);

    return { vault, token, deployer, founder, inv1, inv2, c1, c2, outsider, vaultAddr };
  }

  async function signAttestation(wallet, vault, chainId, roundId, milestoneIndex, evidenceHash) {
    const domain = {
      name: "AegisStagedCapital",
      version: "1",
      chainId,
      verifyingContract: vault,
    };
    const types = {
      MilestoneAttestation: [
        { name: "roundId", type: "uint256" },
        { name: "milestoneIndex", type: "uint256" },
        { name: "evidenceHash", type: "bytes32" },
      ],
    };
    const value = {
      roundId,
      milestoneIndex,
      evidenceHash,
    };
    return wallet.signTypedData(domain, types, value);
  }

  it("full happy path: fund, finalize, attest, claim both milestones", async function () {
    const { vault, token, founder, inv1, inv2, c1, c2, vaultAddr } = await loadFixture(deployFixture);

    const latest = BigInt((await time.latest()).toString());
    const start = latest + 10n;
    const end = latest + 3600n;

    const hardCap = ethers.parseEther("1000");
    const minRaise = ethers.parseEther("400");

    await vault.createRound(
      await token.getAddress(),
      founder.address,
      [c1.address, c2.address],
      2,
      hardCap,
      minRaise,
      start,
      end,
      [BPS_HALF, BPS_HALF],
      ethers.ZeroHash
    );

    const roundId = 1n;
    await time.setNextBlockTimestamp(Number(start + 1n));

    const tag = ethers.keccak256(ethers.toUtf8Bytes("cap-table-commitment"));
    await vault.connect(inv1).commitCapital(roundId, ethers.parseEther("600"), tag, []);
    await vault.connect(inv2).commitCapital(roundId, ethers.parseEther("400"), ethers.ZeroHash, []);

    expect(await token.balanceOf(vaultAddr)).to.equal(hardCap);

    await time.increaseTo(Number(end + 1n));
    await vault.finalizeRound(roundId);

    const r = await vault.getRound(roundId);
    expect(r.status).to.equal(2); // Active

    const net = await ethers.provider.getNetwork();
    const evidence0 = ethers.keccak256(ethers.toUtf8Bytes("m0"));
    const sig01 = await signAttestation(c1, vaultAddr, net.chainId, roundId, 0n, evidence0);
    const sig02 = await signAttestation(c2, vaultAddr, net.chainId, roundId, 0n, evidence0);

    await vault.attestMilestone(roundId, 0n, evidence0, [c1.address, c2.address], [sig01, sig02]);

    const before0 = await token.balanceOf(founder.address);
    await vault.connect(founder).claimMilestone(roundId);
    const mid0 = await token.balanceOf(founder.address);
    expect(mid0 - before0).to.equal(ethers.parseEther("500"));

    const evidence1 = ethers.keccak256(ethers.toUtf8Bytes("m1"));
    const sig11 = await signAttestation(c1, vaultAddr, net.chainId, roundId, 1n, evidence1);
    const sig12 = await signAttestation(c2, vaultAddr, net.chainId, roundId, 1n, evidence1);
    await vault.attestMilestone(roundId, 1n, evidence1, [c1.address, c2.address], [sig11, sig12]);
    await vault.connect(founder).claimMilestone(roundId);

    const final = await token.balanceOf(founder.address);
    expect(final - before0).to.equal(hardCap);

    const r2 = await vault.getRound(roundId);
    expect(r2.status).to.equal(3); // Completed
  });

  it("fails below minRaise: refunds pro-rata", async function () {
    const { vault, token, founder, inv1, inv2, c1, c2, vaultAddr } = await loadFixture(deployFixture);

    const latest = BigInt((await time.latest()).toString());
    const start = latest + 5n;
    const end = latest + 2000n;

    await vault.createRound(
      await token.getAddress(),
      founder.address,
      [c1.address, c2.address],
      2,
      ethers.parseEther("1000"),
      ethers.parseEther("500"),
      start,
      end,
      [BPS_HALF, BPS_HALF],
      ethers.ZeroHash
    );

    const roundId = 1n;
    await time.setNextBlockTimestamp(Number(start + 1n));
    await vault.connect(inv1).commitCapital(roundId, ethers.parseEther("200"), ethers.ZeroHash, []);
    await vault.connect(inv2).commitCapital(roundId, ethers.parseEther("200"), ethers.ZeroHash, []);

    await time.increaseTo(Number(end + 1n));
    await vault.finalizeRound(roundId);
    const r = await vault.getRound(roundId);
    expect(r.status).to.equal(1); // Failed

    const b1 = await token.balanceOf(inv1.address);
    await vault.connect(inv1).refund(roundId);
    expect(await token.balanceOf(inv1.address)).to.equal(b1 + ethers.parseEther("200"));

    const b2 = await token.balanceOf(inv2.address);
    await vault.connect(inv2).refund(roundId);
    expect(await token.balanceOf(inv2.address)).to.equal(b2 + ethers.parseEther("200"));

    expect(await token.balanceOf(vaultAddr)).to.equal(0n);
  });

  it("reverts duplicate committee members", async function () {
    const { vault, token, founder, c1 } = await loadFixture(deployFixture);
    const latest = BigInt((await time.latest()).toString());
    await expect(
      vault.createRound(
        await token.getAddress(),
        founder.address,
        [c1.address, c1.address],
        2,
        ethers.parseEther("1000"),
        ethers.parseEther("1"),
        latest + 1n,
        latest + 100n,
        [BPS_HALF, BPS_HALF],
        ethers.ZeroHash
      )
    ).to.be.revertedWithCustomError(vault, "InvalidCommittee");
  });

  it("reverts when releaseBps do not sum to 10000", async function () {
    const { vault, token, founder, c1, c2 } = await loadFixture(deployFixture);
    const latest = BigInt((await time.latest()).toString());
    await expect(
      vault.createRound(
        await token.getAddress(),
        founder.address,
        [c1.address, c2.address],
        2,
        ethers.parseEther("1000"),
        ethers.parseEther("1"),
        latest + 1n,
        latest + 100n,
        [4000, 4000],
        ethers.ZeroHash
      )
    ).to.be.revertedWithCustomError(vault, "InvalidMilestones");
  });

  it("reverts attest from non-committee signature", async function () {
    const { vault, token, founder, inv1, c1, c2, outsider, vaultAddr } = await loadFixture(deployFixture);
    const latest = BigInt((await time.latest()).toString());
    const start = latest + 10n;
    const end = latest + 5000n;
    await vault.createRound(
      await token.getAddress(),
      founder.address,
      [c1.address, c2.address],
      2,
      ethers.parseEther("1000"),
      ethers.parseEther("100"),
      start,
      end,
      [BPS_HALF, BPS_HALF],
      ethers.ZeroHash
    );
    const roundId = 1n;
    await time.setNextBlockTimestamp(Number(start + 1n));
    await vault.connect(inv1).commitCapital(roundId, ethers.parseEther("1000"), ethers.ZeroHash, []);
    await time.increaseTo(Number(end + 1n));
    await vault.finalizeRound(roundId);

    const net = await ethers.provider.getNetwork();
    const evidence0 = ethers.keccak256(ethers.toUtf8Bytes("e"));
    const sigBad = await signAttestation(outsider, vaultAddr, net.chainId, roundId, 0n, evidence0);
    const sigOk = await signAttestation(c2, vaultAddr, net.chainId, roundId, 0n, evidence0);

    await expect(
      vault.attestMilestone(roundId, 0n, evidence0, [outsider.address, c2.address], [sigBad, sigOk])
    ).to.be.revertedWithCustomError(vault, "CommitteeNotMember");
  });

  it("investor merkle allowlist: allowed depositor succeeds, other reverts", async function () {
    const { vault, token, founder, inv1, inv2, c1, c2, vaultAddr } = await loadFixture(deployFixture);

    const l0 = investorLeaf(inv1.address);
    const l1 = investorLeaf(inv2.address);
    const root = commHash(l0, l1);
    expect(await vault.computeInvestorLeaf(inv1.address)).to.equal(l0);

    const latest = BigInt((await time.latest()).toString());
    const start = latest + 10n;
    const end = latest + 3600n;

    await vault.createRound(
      await token.getAddress(),
      founder.address,
      [c1.address, c2.address],
      2,
      ethers.parseEther("1000"),
      ethers.parseEther("100"),
      start,
      end,
      [BPS_HALF, BPS_HALF],
      root
    );

    const roundId = 1n;
    await time.setNextBlockTimestamp(Number(start + 1n));

    const proofInv1 = [l1];
    await vault.connect(inv1).commitCapital(roundId, ethers.parseEther("500"), ethers.ZeroHash, proofInv1);

    const proofInv2 = [l0];
    await vault.connect(inv2).commitCapital(roundId, ethers.parseEther("500"), ethers.ZeroHash, proofInv2);

    const signers = await ethers.getSigners();
    const stranger = signers[9];
    await token.mint(stranger.address, ethers.parseEther("10000"));
    await token.connect(stranger).approve(vaultAddr, ethers.MaxUint256);

    await expect(
      vault.connect(stranger).commitCapital(roundId, ethers.parseEther("1"), ethers.ZeroHash, [])
    ).to.be.revertedWithCustomError(vault, "AllowlistInvalid");

    await expect(
      vault.connect(stranger).commitCapital(roundId, ethers.parseEther("1"), ethers.ZeroHash, [l0])
    ).to.be.revertedWithCustomError(vault, "AllowlistInvalid");
  });

  it("reverts non-empty merkle proof when allowlist is disabled", async function () {
    const { vault, token, founder, inv1, c1, c2 } = await loadFixture(deployFixture);
    const latest = BigInt((await time.latest()).toString());
    const start = latest + 10n;
    const end = latest + 3600n;
    await vault.createRound(
      await token.getAddress(),
      founder.address,
      [c1.address, c2.address],
      2,
      ethers.parseEther("1000"),
      ethers.parseEther("1"),
      start,
      end,
      [BPS_HALF, BPS_HALF],
      ethers.ZeroHash
    );
    const roundId = 1n;
    await time.setNextBlockTimestamp(Number(start + 1n));
    await expect(
      vault.connect(inv1).commitCapital(roundId, ethers.parseEther("1"), ethers.ZeroHash, [ethers.ZeroHash])
    ).to.be.revertedWithCustomError(vault, "UnexpectedMerkleProof");
  });
});
