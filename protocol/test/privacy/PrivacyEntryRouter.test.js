const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
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

/** Matches `PrivacyEntryRouter` / Solidity `keccak256(abi.encode(uint256[]))`. */
function publicInputsDigest(publicInputs) {
  const asBigint = publicInputs.map((x) => (typeof x === "bigint" ? x : BigInt(x)));
  return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint256[]"], [asBigint]));
}

/** One primary type per `signTypedData` call (ethers v6 rejects combined structs). */
const TYPES_SHIELD = {
  ShieldIntent: [
    { name: "depositor", type: "address" },
    { name: "publicInputsHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};
const TYPES_UNSHIELD = {
  UnshieldIntent: [
    { name: "recipient", type: "address" },
    { name: "publicInputsHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};
const TYPES_SHIELDED_TRANSFER = {
  ShieldedTransferIntent: [
    { name: "authorizedSigner", type: "address" },
    { name: "publicInputsHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

async function eip712Domain(router) {
  const net = await ethers.provider.getNetwork();
  return {
    name: "AegisPrivacyEntry",
    version: "1",
    chainId: net.chainId,
    verifyingContract: await router.getAddress(),
  };
}

/**
 * Production privacy entry router: EIP-712 + nonces; relayer pays gas.
 * See `contracts/privacy/PrivacyEntryRouter.sol` and docs/PRIVATE_TOKEN_AUTHORIZE_CONTRACT_MATRIX.md.
 */
describe("PrivacyEntryRouter (EIP-712 + nonces)", function () {
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

    const Router = await ethers.getContractFactory("PrivacyEntryRouter");
    const router = await Router.deploy(await token.getAddress(), governance.address);
    await router.waitForDeployment();

    await token.connect(governance).authorizeContract(await router.getAddress());

    const mintAddr = (await token.verifiers()).mint;
    const mintVerifier = await ethers.getContractAt("MockZKVerifier", mintAddr);
    await mintVerifier.setShouldVerify(true);

    const transferAddr = (await token.verifiers()).transfer;
    const transferVerifier = await ethers.getContractAt("MockZKVerifier", transferAddr);
    await transferVerifier.setShouldVerify(true);

    return {
      token,
      router,
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
    const depositNullifier = testHelpers.generateUniqueNullifier(`per_${Date.now()}`);
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

  async function relayShieldSigned(router, user1, relayer, testHelpers, outputCommitment, amount) {
    const { proof, publicInputs } = buildShieldCalldata(testHelpers, user1, outputCommitment, amount);
    const pih = publicInputsDigest(publicInputs);
    const nonce = await router.nonces(user1.address);
    const deadline = BigInt(await time.latest()) + 3600n;
    const domain = await eip712Domain(router);
    const sig = await user1.signTypedData(domain, TYPES_SHIELD, {
      depositor: user1.address,
      publicInputsHash: pih,
      nonce,
      deadline,
    });
    await router.connect(relayer).relayShield(proof, publicInputs, deadline, nonce, sig);
  }

  it("relayShield: digest matches Solidity; relayer pays gas; depositor debited", async function () {
    const { token, router, user1, relayer, testHelpers } = await loadFixture(deployFixture);

    const amount = ethers.parseEther("100");
    const outputCommitment = testHelpers.generateUniqueCommitment("per-out");
    const { proof, publicInputs } = buildShieldCalldata(testHelpers, user1, outputCommitment, amount);

    const pih = publicInputsDigest(publicInputs);
    expect(pih).to.equal(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint256[]"], [publicInputs])));

    const balBefore = await token.transparentBalances(user1.address);
    expect(balBefore).to.be.gte(amount);

    const nonce = await router.nonces(user1.address);
    const deadline = BigInt(await time.latest()) + 3600n;
    const domain = await eip712Domain(router);
    const sig = await user1.signTypedData(domain, TYPES_SHIELD, {
      depositor: user1.address,
      publicInputsHash: pih,
      nonce,
      deadline,
    });

    await expect(
      router.connect(relayer).relayShield(proof, publicInputs, deadline, nonce, sig)
    )
      .to.emit(token, "Shield")
      .withArgs(outputCommitment)
      .and.to.emit(router, "ShieldRelayed");

    expect(await token.transparentBalances(user1.address)).to.equal(balBefore - amount);
    expect(await router.nonces(user1.address)).to.equal(nonce + 1n);
    expect(await token.commitments(outputCommitment)).to.equal(true);
  });

  it("with publicEntry disabled, user cannot shield but router still can (signed)", async function () {
    const { token, router, governance, user1, relayer, testHelpers } = await loadFixture(deployFixture);

    await token.connect(governance).setPublicEntryEnabled(false);

    const amount = ethers.parseEther("50");
    const outputCommitment = testHelpers.generateUniqueCommitment("per-pe");
    const { proof, publicInputs } = buildShieldCalldata(testHelpers, user1, outputCommitment, amount);

    await expect(token.connect(user1).shield(proof, publicInputs)).to.be.revertedWithCustomError(
      token,
      "UnauthorizedContract"
    );

    const pih = publicInputsDigest(publicInputs);
    const nonce = await router.nonces(user1.address);
    const deadline = BigInt(await time.latest()) + 3600n;
    const domain = await eip712Domain(router);
    const sig = await user1.signTypedData(domain, TYPES_SHIELD, {
      depositor: user1.address,
      publicInputsHash: pih,
      nonce,
      deadline,
    });

    await expect(router.connect(relayer).relayShield(proof, publicInputs, deadline, nonce, sig)).to.not.be.reverted;
  });

  it("reverts ExpiredIntent when deadline passed", async function () {
    const { router, user1, relayer, testHelpers } = await loadFixture(deployFixture);

    const amount = ethers.parseEther("10");
    const outputCommitment = testHelpers.generateUniqueCommitment("per-exp");
    const { proof, publicInputs } = buildShieldCalldata(testHelpers, user1, outputCommitment, amount);
    const pih = publicInputsDigest(publicInputs);
    const nonce = await router.nonces(user1.address);
    const deadline = 1n;
    const domain = await eip712Domain(router);
    const sig = await user1.signTypedData(domain, TYPES_SHIELD, {
      depositor: user1.address,
      publicInputsHash: pih,
      nonce,
      deadline,
    });

    await expect(
      router.connect(relayer).relayShield(proof, publicInputs, deadline, nonce, sig)
    ).to.be.revertedWithCustomError(router, "ExpiredIntent");
  });

  it("reverts BadNonce when nonce wrong", async function () {
    const { router, user1, relayer, testHelpers } = await loadFixture(deployFixture);

    const amount = ethers.parseEther("10");
    const outputCommitment = testHelpers.generateUniqueCommitment("per-nonce");
    const { proof, publicInputs } = buildShieldCalldata(testHelpers, user1, outputCommitment, amount);
    const pih = publicInputsDigest(publicInputs);
    const deadline = BigInt(await time.latest()) + 3600n;
    const domain = await eip712Domain(router);
    const sig = await user1.signTypedData(domain, TYPES_SHIELD, {
      depositor: user1.address,
      publicInputsHash: pih,
      nonce: 9n,
      deadline,
    });

    await expect(
      router.connect(relayer).relayShield(proof, publicInputs, deadline, 9n, sig)
    ).to.be.revertedWithCustomError(router, "BadNonce");
  });

  it("reverts BadSig when signature not from depositor", async function () {
    const { router, user1, relayer, owner, testHelpers } = await loadFixture(deployFixture);

    const amount = ethers.parseEther("10");
    const outputCommitment = testHelpers.generateUniqueCommitment("per-badsig");
    const { proof, publicInputs } = buildShieldCalldata(testHelpers, user1, outputCommitment, amount);
    const pih = publicInputsDigest(publicInputs);
    const nonce = await router.nonces(user1.address);
    const deadline = BigInt(await time.latest()) + 3600n;
    const domain = await eip712Domain(router);
    const sig = await owner.signTypedData(domain, TYPES_SHIELD, {
      depositor: user1.address,
      publicInputsHash: pih,
      nonce,
      deadline,
    });

    await expect(
      router.connect(relayer).relayShield(proof, publicInputs, deadline, nonce, sig)
    ).to.be.revertedWithCustomError(router, "BadSig");
  });

  it("relayUnshield: shield then unshield with recipient signature", async function () {
    const { token, router, user1, relayer, testHelpers } = await loadFixture(deployFixture);

    const amount = ethers.parseEther("77");
    const outputCommitment = testHelpers.generateUniqueCommitment("per-cycle");
    const { proof: sProof, publicInputs: sIn } = buildShieldCalldata(testHelpers, user1, outputCommitment, amount);
    const bal0 = await token.transparentBalances(user1.address);

    const sPih = publicInputsDigest(sIn);
    let nonce = await router.nonces(user1.address);
    let deadline = BigInt(await time.latest()) + 3600n;
    let domain = await eip712Domain(router);
    let sig = await user1.signTypedData(domain, TYPES_SHIELD, {
      depositor: user1.address,
      publicInputsHash: sPih,
      nonce,
      deadline,
    });
    await router.connect(relayer).relayShield(sProof, sIn, deadline, nonce, sig);
    expect(await token.transparentBalances(user1.address)).to.equal(bal0 - amount);

    const unshieldNullifier = testHelpers.generateUniqueNullifier("per-unsh");
    const { proof: uProof, publicInputs: uIn } = buildUnshieldCalldata(
      testHelpers,
      unshieldNullifier,
      user1.address,
      amount,
      outputCommitment
    );

    const uPih = publicInputsDigest(uIn);
    nonce = await router.nonces(user1.address);
    deadline = BigInt(await time.latest()) + 3600n;
    domain = await eip712Domain(router);
    sig = await user1.signTypedData(domain, TYPES_UNSHIELD, {
      recipient: user1.address,
      publicInputsHash: uPih,
      nonce,
      deadline,
    });

    await expect(router.connect(relayer).relayUnshield(uProof, uIn, deadline, nonce, sig)).to.emit(
      token,
      "Unshield"
    );
    expect(await token.transparentBalances(user1.address)).to.equal(bal0);
  });

  it("relayShieldedTransfer with authorizedSigner signature", async function () {
    const { token, router, governance, user1, relayer, testHelpers } = await loadFixture(deployFixture);

    const amount = ethers.parseEther("3");
    const half = amount / 2n;
    const rest = amount - half;
    const inputC1 = testHelpers.generateUniqueCommitment("st-in-1");
    const inputC2 = testHelpers.generateUniqueCommitment("st-in-2");

    await relayShieldSigned(router, user1, relayer, testHelpers, inputC1, half);
    await relayShieldSigned(router, user1, relayer, testHelpers, inputC2, rest);

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

    const pih = publicInputsDigest(publicInputs);
    const nonce = await router.nonces(user1.address);
    const deadline = BigInt(await time.latest()) + 3600n;
    const domain = await eip712Domain(router);
    const sig = await user1.signTypedData(domain, TYPES_SHIELDED_TRANSFER, {
      authorizedSigner: user1.address,
      publicInputsHash: pih,
      nonce,
      deadline,
    });

    await expect(
      router.connect(relayer).relayShieldedTransfer(proof, publicInputs, deadline, nonce, user1.address, sig)
    ).to.not.be.reverted;
  });

  it("reverts Paused when owner paused", async function () {
    const { router, governance, user1, relayer, testHelpers } = await loadFixture(deployFixture);

    await router.connect(governance).setPaused(true);

    const amount = ethers.parseEther("10");
    const outputCommitment = testHelpers.generateUniqueCommitment("per-pause");
    const { proof, publicInputs } = buildShieldCalldata(testHelpers, user1, outputCommitment, amount);
    const pih = publicInputsDigest(publicInputs);
    const nonce = await router.nonces(user1.address);
    const deadline = BigInt(await time.latest()) + 3600n;
    const domain = await eip712Domain(router);
    const sig = await user1.signTypedData(domain, TYPES_SHIELD, {
      depositor: user1.address,
      publicInputsHash: pih,
      nonce,
      deadline,
    });

    await expect(
      router.connect(relayer).relayShield(proof, publicInputs, deadline, nonce, sig)
    ).to.be.revertedWithCustomError(router, "Paused");
  });

  it("setRelayFee: non-zero fee requires recipient", async function () {
    const { router, governance } = await loadFixture(deployFixture);
    await expect(router.connect(governance).setRelayFee(1n, ethers.ZeroAddress)).to.be.revertedWithCustomError(
      router,
      "FeeRecipientUnset"
    );
  });

  it("relayShield forwards relay fee to recipient and refunds excess", async function () {
    const { router, governance, user1, relayer, testHelpers } = await loadFixture(deployFixture);
    const treasury = (await ethers.getSigners())[4];
    const fee = 10_000n;
    await router.connect(governance).setRelayFee(fee, treasury.address);

    const amount = ethers.parseEther("5");
    const outputCommitment = testHelpers.generateUniqueCommitment("per-fee");
    const { proof, publicInputs } = buildShieldCalldata(testHelpers, user1, outputCommitment, amount);
    const pih = publicInputsDigest(publicInputs);
    const nonce = await router.nonces(user1.address);
    const deadline = BigInt(await time.latest()) + 3600n;
    const domain = await eip712Domain(router);
    const sig = await user1.signTypedData(domain, TYPES_SHIELD, {
      depositor: user1.address,
      publicInputsHash: pih,
      nonce,
      deadline,
    });

    const over = 3333n;
    const balBefore = await ethers.provider.getBalance(treasury.address);
    await router.connect(relayer).relayShield(proof, publicInputs, deadline, nonce, sig, { value: fee + over });
    expect(await ethers.provider.getBalance(treasury.address)).to.equal(balBefore + fee);
  });

  it("reverts InsufficientRelayFee when fee enabled and msg.value too low", async function () {
    const { router, governance, user1, relayer, testHelpers } = await loadFixture(deployFixture);
    await router.connect(governance).setRelayFee(100n, user1.address);

    const amount = ethers.parseEther("1");
    const outputCommitment = testHelpers.generateUniqueCommitment("per-lowfee");
    const { proof, publicInputs } = buildShieldCalldata(testHelpers, user1, outputCommitment, amount);
    const pih = publicInputsDigest(publicInputs);
    const nonce = await router.nonces(user1.address);
    const deadline = BigInt(await time.latest()) + 3600n;
    const domain = await eip712Domain(router);
    const sig = await user1.signTypedData(domain, TYPES_SHIELD, {
      depositor: user1.address,
      publicInputsHash: pih,
      nonce,
      deadline,
    });

    await expect(
      router.connect(relayer).relayShield(proof, publicInputs, deadline, nonce, sig, { value: 50n })
    ).to.be.revertedWithCustomError(router, "InsufficientRelayFee");
  });

  it("refunds full msg.value when relay fee is zero", async function () {
    const { router, user1, relayer, testHelpers } = await loadFixture(deployFixture);
    expect(await router.relayFeeWei()).to.equal(0n);

    const amount = ethers.parseEther("2");
    const outputCommitment = testHelpers.generateUniqueCommitment("per-refund");
    const { proof, publicInputs } = buildShieldCalldata(testHelpers, user1, outputCommitment, amount);
    const pih = publicInputsDigest(publicInputs);
    const nonce = await router.nonces(user1.address);
    const deadline = BigInt(await time.latest()) + 3600n;
    const domain = await eip712Domain(router);
    const sig = await user1.signTypedData(domain, TYPES_SHIELD, {
      depositor: user1.address,
      publicInputsHash: pih,
      nonce,
      deadline,
    });

    const dust = 42_000n;
    const relBefore = await ethers.provider.getBalance(relayer.address);
    const tx = await router.connect(relayer).relayShield(proof, publicInputs, deadline, nonce, sig, { value: dust });
    const rc = await tx.wait();
    const gas = rc.gasUsed * rc.gasPrice;
    const relAfter = await ethers.provider.getBalance(relayer.address);
    expect(relAfter + gas).to.be.closeTo(relBefore, ethers.parseEther("0.001"));
  });
});
