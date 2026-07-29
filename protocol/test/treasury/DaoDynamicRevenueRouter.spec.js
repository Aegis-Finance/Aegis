const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("DaoDynamicRevenueRouter", function () {
  async function deploySystem() {
    const [govSigner, payer, sinkGov, sinkIns, sinkEco] = await ethers.getSigners();
    const govAddr = await govSigner.getAddress();

    const Mock = await ethers.getContractFactory("MintableTestToken");
    const token = await Mock.deploy("Mock AGS", "mAGS");

    const Router = await ethers.getContractFactory("DaoDynamicRevenueRouter");
    const router = await Router.deploy(
      govAddr,
      ethers.ZeroAddress,
      await token.getAddress(),
      sinkGov.address,
      sinkIns.address,
      sinkEco.address,
      5000,
      3000,
      2000,
      ethers.parseEther("100"),
      ethers.parseEther("1000000"),
      1000,
      0n,
      0n
    );

    return { token, router, govSigner, payer, sinkGov, sinkIns, sinkEco };
  }

  it("tilts from governance toward insurance when insurance sink is below low watermark", async function () {
    const { token, router, payer, sinkGov, sinkIns, sinkEco } = await deploySystem();
    // insurance has 0 < low watermark (100 ether)
    const [g, i, e] = await router.effectiveSplitBps();
    expect(g).to.equal(4000);
    expect(i).to.equal(4000);
    expect(e).to.equal(2000);

    const amt = 10_000n;
    await token.mint(payer.address, amt);
    await token.connect(payer).approve(await router.getAddress(), amt);

    await expect(router.connect(payer).payAndRoute(amt)).to.emit(router, "PaymentRouted");

    expect(await token.balanceOf(sinkGov.address)).to.equal((amt * 4000n) / 10_000n);
    expect(await token.balanceOf(sinkIns.address)).to.equal((amt * 4000n) / 10_000n);
    expect(await token.balanceOf(sinkEco.address)).to.equal(amt - (amt * 4000n) / 10_000n - (amt * 4000n) / 10_000n);
  });

  it("tilts from insurance toward ecosystem when insurance sink is above high watermark", async function () {
    const { token, router, payer, sinkGov, sinkIns, sinkEco } = await deploySystem();
    const preIns = ethers.parseEther("2000000");
    await token.mint(sinkIns.address, preIns);

    const [g, i, e] = await router.effectiveSplitBps();
    expect(g).to.equal(5000);
    expect(i).to.equal(2000);
    expect(e).to.equal(3000);

    const amt = 10_000n;
    await token.mint(payer.address, amt);
    await token.connect(payer).approve(await router.getAddress(), amt);
    await router.connect(payer).payAndRoute(amt);

    const toIns = (amt * 2000n) / 10_000n;
    expect(await token.balanceOf(sinkGov.address)).to.equal((amt * 5000n) / 10_000n);
    expect(await token.balanceOf(sinkIns.address)).to.equal(preIns + toIns);
    expect(await token.balanceOf(sinkEco.address)).to.equal(amt - (amt * 5000n) / 10_000n - toIns);
  });

  it("reverts pay when a sink is unset", async function () {
    const [govSigner, payer, sinkGov, sinkIns, sinkEco] = await ethers.getSigners();
    const govAddr = await govSigner.getAddress();
    const Mock = await ethers.getContractFactory("MintableTestToken");
    const token = await Mock.deploy("Mock AGS", "mAGS");
    const Router = await ethers.getContractFactory("DaoDynamicRevenueRouter");
    const router = await Router.deploy(
      govAddr,
      ethers.ZeroAddress,
      await token.getAddress(),
      sinkGov.address,
      sinkIns.address,
      sinkEco.address,
      5000,
      3000,
      2000,
      0n,
      0n,
      1000,
      0n,
      0n
    );
    await router.connect(govSigner).setSinks(sinkGov.address, sinkIns.address, ethers.ZeroAddress);
    await token.mint(payer.address, 1000n);
    await token.connect(payer).approve(await router.getAddress(), 1000n);
    await expect(router.connect(payer).payAndRoute(1000n)).to.be.revertedWithCustomError(router, "MissingSink");
  });

  it("extends on-chain analytics subscription when payment meets minimum", async function () {
    const [govSigner, payer, sinkGov, sinkIns, sinkEco] = await ethers.getSigners();
    const govAddr = await govSigner.getAddress();
    const Mock = await ethers.getContractFactory("MintableTestToken");
    const token = await Mock.deploy("Mock AGS", "mAGS");
    const Router = await ethers.getContractFactory("DaoDynamicRevenueRouter");
    const router = await Router.deploy(
      govAddr,
      ethers.ZeroAddress,
      await token.getAddress(),
      sinkGov.address,
      sinkIns.address,
      sinkEco.address,
      5000,
      3000,
      2000,
      0n,
      0n,
      1000,
      100n,
      3600n
    );

    expect(await router.hasAnalyticsSubscription(payer.address)).to.equal(false);

    const amt = 500n;
    await token.mint(payer.address, amt);
    await token.connect(payer).approve(await router.getAddress(), amt);
    await expect(router.connect(payer).payAndRoute(amt)).to.emit(router, "AnalyticsAccessExtended");

    expect(await router.hasAnalyticsSubscription(payer.address)).to.equal(true);
    const until = await router.analyticsAccessUntil(payer.address);
    const latest = await ethers.provider.getBlock("latest");
    expect(until).to.be.gt(BigInt(latest.timestamp));
  });

  describe("constructor validation", function () {
    it("reverts when governance is zero", async function () {
      const [, , sinkGov, sinkIns, sinkEco] = await ethers.getSigners();
      const Mock = await ethers.getContractFactory("MintableTestToken");
      const token = await Mock.deploy("Mock AGS", "mAGS");
      const Router = await ethers.getContractFactory("DaoDynamicRevenueRouter");
      await expect(
        Router.deploy(
          ethers.ZeroAddress,
          ethers.ZeroAddress,
          await token.getAddress(),
          sinkGov.address,
          sinkIns.address,
          sinkEco.address,
          5000,
          3000,
          2000,
          0n,
          0n,
          1000,
          0n,
          0n
        )
      ).to.be.revertedWithCustomError(Router, "ZeroAddress");
    });

    it("reverts when payment token is zero", async function () {
      const [gov, , sinkGov, sinkIns, sinkEco] = await ethers.getSigners();
      const Router = await ethers.getContractFactory("DaoDynamicRevenueRouter");
      await expect(
        Router.deploy(
          gov.address,
          ethers.ZeroAddress,
          ethers.ZeroAddress,
          sinkGov.address,
          sinkIns.address,
          sinkEco.address,
          5000,
          3000,
          2000,
          0n,
          0n,
          1000,
          0n,
          0n
        )
      ).to.be.revertedWithCustomError(Router, "ZeroAddress");
    });

    it("reverts on invalid base split (sum != 10_000)", async function () {
      const [gov, , sinkGov, sinkIns, sinkEco] = await ethers.getSigners();
      const Mock = await ethers.getContractFactory("MintableTestToken");
      const token = await Mock.deploy("Mock AGS", "mAGS");
      const Router = await ethers.getContractFactory("DaoDynamicRevenueRouter");
      await expect(
        Router.deploy(
          gov.address,
          ethers.ZeroAddress,
          await token.getAddress(),
          sinkGov.address,
          sinkIns.address,
          sinkEco.address,
          4000,
          4000,
          3000,
          0n,
          0n,
          1000,
          0n,
          0n
        )
      ).to.be.revertedWithCustomError(Router, "InvalidSplit");
    });

    it("reverts when maxTiltBps exceeds 5000", async function () {
      const [gov, , sinkGov, sinkIns, sinkEco] = await ethers.getSigners();
      const Mock = await ethers.getContractFactory("MintableTestToken");
      const token = await Mock.deploy("Mock AGS", "mAGS");
      const Router = await ethers.getContractFactory("DaoDynamicRevenueRouter");
      await expect(
        Router.deploy(
          gov.address,
          ethers.ZeroAddress,
          await token.getAddress(),
          sinkGov.address,
          sinkIns.address,
          sinkEco.address,
          5000,
          3000,
          2000,
          0n,
          0n,
          5001,
          0n,
          0n
        )
      ).to.be.revertedWithCustomError(Router, "BadTilt");
    });
  });

  describe("payAndRoute edge cases", function () {
    it("reverts on zero amount", async function () {
      const { token, router, govSigner, payer, sinkGov, sinkIns, sinkEco } = await deploySystem();
      await token.mint(payer.address, 100n);
      await token.connect(payer).approve(await router.getAddress(), 100n);
      await expect(router.connect(payer).payAndRoute(0)).to.be.revertedWithCustomError(router, "ZeroAmount");
    });

    it("does not extend analytics when amount is below analyticsMinPriceWei", async function () {
      const [govSigner, payer, sinkGov, sinkIns, sinkEco] = await ethers.getSigners();
      const govAddr = await govSigner.getAddress();
      const Mock = await ethers.getContractFactory("MintableTestToken");
      const token = await Mock.deploy("Mock AGS", "mAGS");
      const Router = await ethers.getContractFactory("DaoDynamicRevenueRouter");
      const router = await Router.deploy(
        govAddr,
        ethers.ZeroAddress,
        await token.getAddress(),
        sinkGov.address,
        sinkIns.address,
        sinkEco.address,
        5000,
        3000,
        2000,
        0n,
        0n,
        1000,
        1000n,
        3600n
      );
      const amt = 500n;
      await token.mint(payer.address, amt);
      await token.connect(payer).approve(await router.getAddress(), amt);
      await expect(router.connect(payer).payAndRoute(amt)).to.not.emit(router, "AnalyticsAccessExtended");
      expect(await router.hasAnalyticsSubscription(payer.address)).to.equal(false);
    });

    it("routes full amount to sinks (no dust left on router)", async function () {
      const { token, router, payer, sinkGov, sinkIns, sinkEco } = await deploySystem();
      const amt = 10_007n;
      await token.mint(payer.address, amt);
      await token.connect(payer).approve(await router.getAddress(), amt);
      await router.connect(payer).payAndRoute(amt);
      const bal =
        (await token.balanceOf(sinkGov.address)) +
        (await token.balanceOf(sinkIns.address)) +
        (await token.balanceOf(sinkEco.address));
      expect(bal).to.equal(amt);
      expect(await token.balanceOf(await router.getAddress())).to.equal(0n);
    });

    it("with insuranceSink unset (zero), effectiveSplit equals base (tilt branch skipped)", async function () {
      const [govSigner, payer, sinkGov, , sinkEco] = await ethers.getSigners();
      const govAddr = await govSigner.getAddress();
      const Mock = await ethers.getContractFactory("MintableTestToken");
      const token = await Mock.deploy("Mock AGS", "mAGS");
      const Router = await ethers.getContractFactory("DaoDynamicRevenueRouter");
      const router = await Router.deploy(
        govAddr,
        ethers.ZeroAddress,
        await token.getAddress(),
        sinkGov.address,
        ethers.ZeroAddress,
        sinkEco.address,
        5000,
        3000,
        2000,
        ethers.parseEther("1"),
        ethers.parseEther("1000000"),
        1000,
        0n,
        0n
      );
      const [g, i, e] = await router.effectiveSplitBps();
      expect(g).to.equal(5000);
      expect(i).to.equal(3000);
      expect(e).to.equal(2000);
      await token.mint(payer.address, 1000n);
      await token.connect(payer).approve(await router.getAddress(), 1000n);
      await expect(router.connect(payer).payAndRoute(1000n)).to.be.revertedWithCustomError(router, "MissingSink");
    });
  });

  describe("governance mutations", function () {
    it("non-governance cannot setBaseSplit", async function () {
      const { router, payer } = await deploySystem();
      await expect(router.connect(payer).setBaseSplit(2500, 2500, 5000)).to.be.revertedWithCustomError(
        router,
        "UnauthorizedGovernance"
      );
    });

    it("governance can setBaseSplit and emit event", async function () {
      const { router, govSigner } = await deploySystem();
      await expect(router.connect(govSigner).setBaseSplit(2500, 2500, 5000))
        .to.emit(router, "BaseSplitUpdated")
        .withArgs(2500, 2500, 5000);
      expect(await router.baseGovBps()).to.equal(2500);
    });

    it("governance can setWatermarks and setMaxTilt", async function () {
      const { router, govSigner } = await deploySystem();
      await expect(router.connect(govSigner).setWatermarks(1n, 2n))
        .to.emit(router, "WatermarksUpdated")
        .withArgs(1n, 2n);
      await expect(router.connect(govSigner).setMaxTilt(1234)).to.emit(router, "MaxTiltUpdated").withArgs(1234);
      expect(await router.maxTiltBps()).to.equal(1234);
    });

    it("setMaxTilt reverts above 5000 for governance", async function () {
      const { router, govSigner } = await deploySystem();
      await expect(router.connect(govSigner).setMaxTilt(5001)).to.be.revertedWithCustomError(router, "BadTilt");
    });

    it("governance can setAnalyticsAccessParams", async function () {
      const { router, govSigner } = await deploySystem();
      await expect(router.connect(govSigner).setAnalyticsAccessParams(42n, 99n))
        .to.emit(router, "AnalyticsAccessParamsUpdated")
        .withArgs(42n, 99n);
      expect(await router.analyticsMinPriceWei()).to.equal(42n);
      expect(await router.analyticsSubscriptionDurationSeconds()).to.equal(99n);
    });

    it("governance can rotate governance pointer via setGovernance", async function () {
      const { router, govSigner, payer } = await deploySystem();
      await expect(router.connect(govSigner).setGovernance(payer.address, ethers.ZeroAddress))
        .to.emit(router, "GovernanceUpdated")
        .withArgs(await govSigner.getAddress(), payer.address);
      expect(await router.governance()).to.equal(payer.address);
    });

    it("setGovernance reverts when new governance is zero", async function () {
      const { router, govSigner } = await deploySystem();
      await expect(router.connect(govSigner).setGovernance(ethers.ZeroAddress, ethers.ZeroAddress)).to.be.revertedWithCustomError(
        router,
        "ZeroAddress"
      );
    });

    it("governance setBaseSplit reverts when split does not sum to 10_000", async function () {
      const { router, govSigner } = await deploySystem();
      await expect(router.connect(govSigner).setBaseSplit(3000, 3000, 3000)).to.be.revertedWithCustomError(router, "InvalidSplit");
    });

    it("non-governance cannot setSinks", async function () {
      const { router, payer, sinkGov, sinkIns, sinkEco } = await deploySystem();
      await expect(router.connect(payer).setSinks(sinkGov.address, sinkIns.address, sinkEco.address)).to.be.revertedWithCustomError(
        router,
        "UnauthorizedGovernance"
      );
    });

    it("governance can setSinks and emit SinksUpdated", async function () {
      const { router, govSigner, payer, sinkGov, sinkIns, sinkEco } = await deploySystem();
      await expect(router.connect(govSigner).setSinks(payer.address, sinkIns.address, sinkEco.address))
        .to.emit(router, "SinksUpdated")
        .withArgs(payer.address, sinkIns.address, sinkEco.address);
      expect(await router.governanceTreasury()).to.equal(payer.address);
    });

    it("after governance rotation, old signer cannot mutate but new governance can", async function () {
      const { router, govSigner, payer } = await deploySystem();
      await router.connect(govSigner).setGovernance(payer.address, ethers.ZeroAddress);
      await expect(router.connect(govSigner).setMaxTilt(100)).to.be.revertedWithCustomError(router, "UnauthorizedGovernance");
      await expect(router.connect(payer).setMaxTilt(100)).to.emit(router, "MaxTiltUpdated").withArgs(100);
    });
  });

  describe("analytics subscription stacking", function () {
    it("extends from max(now, currentUntil) when paying again while still subscribed", async function () {
      const [govSigner, payer, sinkGov, sinkIns, sinkEco] = await ethers.getSigners();
      const govAddr = await govSigner.getAddress();
      const Mock = await ethers.getContractFactory("MintableTestToken");
      const token = await Mock.deploy("Mock AGS", "mAGS");
      const Router = await ethers.getContractFactory("DaoDynamicRevenueRouter");
      const router = await Router.deploy(
        govAddr,
        ethers.ZeroAddress,
        await token.getAddress(),
        sinkGov.address,
        sinkIns.address,
        sinkEco.address,
        5000,
        3000,
        2000,
        0n,
        0n,
        1000,
        100n,
        3600n
      );
      await token.mint(payer.address, 1000n);
      await token.connect(payer).approve(await router.getAddress(), 1000n);
      await router.connect(payer).payAndRoute(200n);
      const until1 = await router.analyticsAccessUntil(payer.address);
      await time.increase(100);
      await router.connect(payer).payAndRoute(200n);
      const until2 = await router.analyticsAccessUntil(payer.address);
      expect(until2).to.equal(until1 + 3600n);
    });

    it("hasAnalyticsSubscription is false after subscription window elapses", async function () {
      const [govSigner, payer, sinkGov, sinkIns, sinkEco] = await ethers.getSigners();
      const govAddr = await govSigner.getAddress();
      const Mock = await ethers.getContractFactory("MintableTestToken");
      const token = await Mock.deploy("Mock AGS", "mAGS");
      const Router = await ethers.getContractFactory("DaoDynamicRevenueRouter");
      const router = await Router.deploy(
        govAddr,
        ethers.ZeroAddress,
        await token.getAddress(),
        sinkGov.address,
        sinkIns.address,
        sinkEco.address,
        5000,
        3000,
        2000,
        0n,
        0n,
        1000,
        100n,
        120n
      );
      await token.mint(payer.address, 500n);
      await token.connect(payer).approve(await router.getAddress(), 500n);
      await router.connect(payer).payAndRoute(200n);
      expect(await router.hasAnalyticsSubscription(payer.address)).to.equal(true);
      await time.increase(200);
      expect(await router.hasAnalyticsSubscription(payer.address)).to.equal(false);
    });
  });
});
