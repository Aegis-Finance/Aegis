const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { TestHelpers } = require("../helpers/TestHelpers");

function proofArrayFromMock(mock) {
  return [
    BigInt(mock.a[0]),
    BigInt(mock.a[1]),
    BigInt(mock.b[0][0]),
    BigInt(mock.b[0][1]),
    BigInt(mock.b[1][0]),
    BigInt(mock.b[1][1]),
    BigInt(mock.c[0]),
    BigInt(mock.c[1]),
  ];
}

/**
 * Phase F scaffold: relayer-paid gas for privacy entry (`shield`, `unshield`, `shieldedTransfer`).
 * See docs/AEGIS_MAXIMUM_STEALTH_LOCAL_BUILD_SPEC.md §0–§3.
 */
describe("MockPrivacyEntryRelay (privacy entry / relayer scaffold)", function () {
  async function deployFixture() {
    const [owner, governance, user1, relayer] = await ethers.getSigners();

    const MockVerifierFactory = await ethers.getContractFactory("MockVerifierFactory");
    const verifierFactory = await MockVerifierFactory.deploy();
    await verifierFactory.waitForDeployment();

    const TokenAllocation = await ethers.getContractFactory("TokenAllocation");
    const tokenAllocation = await TokenAllocation.deploy(governance.address);
    await tokenAllocation.waitForDeployment();

    const testHelpers = new TestHelpers();
    await testHelpers.initialize();
    const proofLibAddress = await testHelpers.deployProofLib();
    const PrivateTokenContract = await testHelpers.getContractFactoryWithProofLib(
      "PrivateTokenContract",
      proofLibAddress
    );
    const token = await PrivateTokenContract.deploy(
      await verifierFactory.getAddress(),
      await tokenAllocation.getAddress()
    );
    await token.waitForDeployment();

    await token.syncVerifiersFromFactory();

    await token.setGovernanceContract(governance.address);
    await token.setEcosystemContracts(governance.address, governance.address, governance.address);

    await tokenAllocation.connect(governance).setToken(await token.getAddress());
    await tokenAllocation.connect(governance).setTreasuryWallet(user1.address);
    await tokenAllocation.connect(governance).allocateTreasuryTokens();

    const Relay = await ethers.getContractFactory("MockPrivacyEntryRelay");
    const relay = await Relay.deploy(await token.getAddress());
    await relay.waitForDeployment();

    await token.connect(governance).authorizeContract(await relay.getAddress());

    const mintAddr = (await token.verifiers()).mint;
    const mintVerifier = await ethers.getContractAt("MockZKVerifier", mintAddr);
    await mintVerifier.setShouldVerify(true);

    const transferAddr = (await token.verifiers()).transfer;
    const transferVerifier = await ethers.getContractAt("MockZKVerifier", transferAddr);
    await transferVerifier.setShouldVerify(true);

    return {
      token,
      relay,
      verifierFactory,
      tokenAllocation,
      governance,
      user1,
      relayer,
      owner,
      testHelpers,
    };
  }

  function buildShieldCalldata(testHelpers, depositorSigner, outputCommitment, amount) {
    const depositNullifier = testHelpers.generateUniqueNullifier(`relay_${Date.now()}`);
    const depositorAddr = depositorSigner.address ?? depositorSigner;
    const depositorUint = BigInt(ethers.zeroPadValue(depositorAddr, 32));
    const publicInputs = [
      BigInt(depositNullifier),
      BigInt(outputCommitment),
      amount,
      depositorUint,
    ];
    const mock = testHelpers.generateMockZKProof("contribution");
    const proof = proofArrayFromMock(mock);
    return { proof, publicInputs, depositNullifier };
  }

  function buildUnshieldCalldata(testHelpers, nullifier, recipientAddress, amount, inputCommitmentBytes32) {
    const mock = testHelpers.generateMockZKProof("contribution");
    const proof = proofArrayFromMock(mock);
    const recipientUint = BigInt(ethers.zeroPadValue(recipientAddress, 32));
    const publicInputs = [
      BigInt(nullifier),
      recipientUint,
      amount,
      BigInt(inputCommitmentBytes32),
    ];
    return { proof, publicInputs };
  }

  function buildShieldedTransferCalldata(
    testHelpers,
    inputCommitment1,
    inputCommitment2,
    balance1,
    balance2,
    outputAmount1,
    outputAmount2
  ) {
    const totalAmount = balance1 + balance2;
    if (outputAmount1 + outputAmount2 !== totalAmount) {
      throw new Error("buildShieldedTransferCalldata: output amounts must sum to merged input balance");
    }
    const n1 = testHelpers.generateUniqueNullifier("st_in1");
    const n2 = testHelpers.generateUniqueNullifier("st_in2");
    const o1 = testHelpers.generateUniqueCommitment("st_out1");
    const o2 = testHelpers.generateUniqueCommitment("st_out2");
    const mock = testHelpers.generateMockZKProof("contribution");
    const proof = proofArrayFromMock(mock);
    const publicInputs = [
      BigInt(n1),
      BigInt(n2),
      BigInt(o1),
      BigInt(o2),
      totalAmount,
      BigInt(inputCommitment1),
      BigInt(inputCommitment2),
      0n,
      0n,
      outputAmount1,
      outputAmount2,
    ];
    return { proof, publicInputs };
  }

  it("relays shield: relayer pays gas, depositor transparent balance is debited", async function () {
    const { token, relay, user1, relayer, testHelpers } = await loadFixture(deployFixture);

    const amount = ethers.parseEther("100");
    const outputCommitment = testHelpers.generateUniqueCommitment("relay-out");
    const { proof, publicInputs } = buildShieldCalldata(testHelpers, user1, outputCommitment, amount);

    const balBefore = await token.transparentBalances(user1.address);
    expect(balBefore).to.be.gte(amount);

    await expect(relay.connect(relayer).relayShield(user1.address, proof, publicInputs))
      .to.emit(token, "Shield")
      .withArgs(outputCommitment);

    expect(await token.transparentBalances(user1.address)).to.equal(balBefore - amount);
    expect(await relay.shieldRelayCount()).to.equal(1n);
    expect(await token.commitments(outputCommitment)).to.equal(true);
  });

  it("with publicEntry disabled, user cannot shield but relay still can", async function () {
    const { token, relay, governance, user1, relayer, testHelpers } = await loadFixture(deployFixture);

    await token.connect(governance).setPublicEntryEnabled(false);

    const amount = ethers.parseEther("50");
    const outputCommitment = testHelpers.generateUniqueCommitment("relay-pe");
    const { proof, publicInputs } = buildShieldCalldata(testHelpers, user1, outputCommitment, amount);

    await expect(token.connect(user1).shield(proof, publicInputs)).to.be.revertedWithCustomError(
      token,
      "UnauthorizedContract"
    );

    await expect(relay.connect(relayer).relayShield(user1.address, proof, publicInputs)).to.not.be.reverted;
    expect(await relay.shieldRelayCount()).to.equal(1n);
  });

  it("reverts when depositor does not match publicInputs[3]", async function () {
    const { relay, user1, relayer, testHelpers } = await loadFixture(deployFixture);

    const amount = ethers.parseEther("10");
    const outputCommitment = testHelpers.generateUniqueCommitment("relay-bad");
    const { proof, publicInputs } = buildShieldCalldata(testHelpers, user1, outputCommitment, amount);
    publicInputs[3] = publicInputs[3] + 1n;

    await expect(
      relay.connect(relayer).relayShield(user1.address, proof, publicInputs)
    ).to.be.revertedWithCustomError(relay, "DepositorMismatch");
  });

  it("relayUnshield: shield then unshield via relay; transparent balance restored", async function () {
    const { token, relay, user1, relayer, testHelpers } = await loadFixture(deployFixture);

    const amount = ethers.parseEther("77");
    const outputCommitment = testHelpers.generateUniqueCommitment("cycle-c");
    const { proof: sProof, publicInputs: sIn } = buildShieldCalldata(testHelpers, user1, outputCommitment, amount);
    const bal0 = await token.transparentBalances(user1.address);

    await relay.connect(relayer).relayShield(user1.address, sProof, sIn);
    expect(await token.transparentBalances(user1.address)).to.equal(bal0 - amount);

    const unshieldNullifier = testHelpers.generateUniqueNullifier("unsh");
    const { proof: uProof, publicInputs: uIn } = buildUnshieldCalldata(
      testHelpers,
      unshieldNullifier,
      user1.address,
      amount,
      outputCommitment
    );

    await expect(relay.connect(relayer).relayUnshield(uProof, uIn)).to.emit(token, "Unshield");
    expect(await token.transparentBalances(user1.address)).to.equal(bal0);
    expect(await relay.unshieldRelayCount()).to.equal(1n);
  });

  it("with publicEntry disabled, user cannot unshield but relay still can", async function () {
    const { token, relay, governance, user1, relayer, testHelpers } = await loadFixture(deployFixture);

    const amount = ethers.parseEther("22");
    const outputCommitment = testHelpers.generateUniqueCommitment("unsh-pe");
    const { proof: sProof, publicInputs: sIn } = buildShieldCalldata(testHelpers, user1, outputCommitment, amount);
    await relay.connect(relayer).relayShield(user1.address, sProof, sIn);

    await token.connect(governance).setPublicEntryEnabled(false);

    const unshieldNullifier = testHelpers.generateUniqueNullifier("unsh-pe");
    const { proof: uProof, publicInputs: uIn } = buildUnshieldCalldata(
      testHelpers,
      unshieldNullifier,
      user1.address,
      amount,
      outputCommitment
    );

    await expect(token.connect(user1).unshield(uProof, uIn)).to.be.revertedWithCustomError(
      token,
      "UnauthorizedContract"
    );
    await expect(relay.connect(relayer).relayUnshield(uProof, uIn)).to.not.be.reverted;
    expect(await relay.unshieldRelayCount()).to.equal(1n);
  });

  it("relayShieldedTransfer succeeds with mock verifier (counters)", async function () {
    const { token, relay, relayer, user1, testHelpers } = await loadFixture(deployFixture);

    const amount = ethers.parseEther("1");
    const half = amount / 2n;
    const rest = amount - half;
    const inputC1 = testHelpers.generateUniqueCommitment("st-mock-in-1");
    const inputC2 = testHelpers.generateUniqueCommitment("st-mock-in-2");

    const { proof: p1, publicInputs: in1 } = buildShieldCalldata(testHelpers, user1, inputC1, half);
    await relay.connect(relayer).relayShield(user1.address, p1, in1);
    const { proof: p2, publicInputs: in2 } = buildShieldCalldata(testHelpers, user1, inputC2, rest);
    await relay.connect(relayer).relayShield(user1.address, p2, in2);

    const { proof, publicInputs } = buildShieldedTransferCalldata(
      testHelpers,
      inputC1,
      inputC2,
      half,
      rest,
      half,
      rest
    );

    await expect(relay.connect(relayer).relayShieldedTransfer(proof, publicInputs)).to.not.be.reverted;
    expect(await relay.shieldedTransferRelayCount()).to.equal(1n);
  });

  it("with publicEntry disabled, user cannot shieldedTransfer but relay still can", async function () {
    const { token, relay, governance, relayer, user1, testHelpers } = await loadFixture(deployFixture);

    const amount = ethers.parseEther("3");
    const half = amount / 2n;
    const rest = amount - half;
    const inputC1 = testHelpers.generateUniqueCommitment("st-mock-pe-1");
    const inputC2 = testHelpers.generateUniqueCommitment("st-mock-pe-2");

    const { proof: p1, publicInputs: in1 } = buildShieldCalldata(testHelpers, user1, inputC1, half);
    await relay.connect(relayer).relayShield(user1.address, p1, in1);
    const { proof: p2, publicInputs: in2 } = buildShieldCalldata(testHelpers, user1, inputC2, rest);
    await relay.connect(relayer).relayShield(user1.address, p2, in2);

    await token.connect(governance).setPublicEntryEnabled(false);

    const { proof, publicInputs } = buildShieldedTransferCalldata(
      testHelpers,
      inputC1,
      inputC2,
      half,
      rest,
      half,
      rest
    );

    await expect(token.connect(user1).shieldedTransfer(proof, publicInputs)).to.be.revertedWithCustomError(
      token,
      "UnauthorizedContract"
    );
    await expect(relay.connect(relayer).relayShieldedTransfer(proof, publicInputs)).to.not.be.reverted;
    expect(await relay.shieldedTransferRelayCount()).to.equal(1n);
  });
});
