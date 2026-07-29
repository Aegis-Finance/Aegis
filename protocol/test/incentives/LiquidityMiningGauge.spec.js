const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("LiquidityMiningGauge", function () {
    async function fixture() {
        const [owner, gov, alice, bob] = await ethers.getSigners();
        const Token = await ethers.getContractFactory("MintableTestToken");
        const lp = await Token.deploy("LP", "LP");
        const ags = await Token.deploy("AGS", "AGS");
        const Gauge = await ethers.getContractFactory("LiquidityMiningGauge");
        const gauge = await Gauge.deploy(owner.address, await lp.getAddress(), await ags.getAddress());
        await gauge.setGovernance(gov.address);
        return { owner, gov, alice, bob, lp, ags, gauge };
    }

    it("pays rewards pro-rata over the emission window", async function () {
        const { gov, alice, bob, lp, ags, gauge } = await loadFixture(fixture);
        const stakeAmt = ethers.parseEther("100");
        await lp.mint(alice.address, stakeAmt);
        await lp.mint(bob.address, stakeAmt);
        await lp.connect(alice).approve(await gauge.getAddress(), stakeAmt);
        await lp.connect(bob).approve(await gauge.getAddress(), stakeAmt);

        const reward = ethers.parseEther("700");
        const duration = 7n * 24n * 3600n;
        await ags.mint(gov.address, reward);
        await ags.connect(gov).transfer(await gauge.getAddress(), reward);
        await gauge.connect(gov).notifyRewardAmount(reward, duration);

        await gauge.connect(alice).stake(stakeAmt / 2n);
        await gauge.connect(bob).stake(stakeAmt);

        await time.increase(Number(duration / 2n));

        await gauge.connect(alice).getReward();
        await gauge.connect(bob).getReward();

        const a = await ags.balanceOf(alice.address);
        const b = await ags.balanceOf(bob.address);
        expect(a + b).to.be.closeTo(reward / 2n, ethers.parseEther("2"));
        expect(b > a).to.equal(true);
    });

    it("increments competitionId on each notify", async function () {
        const { gov, ags, gauge } = await loadFixture(fixture);
        const r = ethers.parseEther("10");
        const d = 3600n;
        await ags.mint(gov.address, r * 4n);
        await ags.connect(gov).transfer(await gauge.getAddress(), r * 2n);
        expect(await gauge.competitionId()).to.equal(0n);
        await gauge.connect(gov).notifyRewardAmount(r, d);
        expect(await gauge.competitionId()).to.equal(1n);
        await time.increase(Number(d) + 1);
        await ags.connect(gov).transfer(await gauge.getAddress(), r);
        await gauge.connect(gov).notifyRewardAmount(r, d);
        expect(await gauge.competitionId()).to.equal(2n);
    });

    it("reverts notify without reward balance", async function () {
        const { gov, gauge } = await loadFixture(fixture);
        await expect(gauge.connect(gov).notifyRewardAmount(1000n, 100n)).to.be.revertedWithCustomError(
            gauge,
            "InsufficientRewardBalance"
        );
    });

    it("getRewardTo sends AGS to a chosen recipient", async function () {
        const { gov, alice, bob, lp, ags, gauge } = await loadFixture(fixture);
        const stakeAmt = ethers.parseEther("100");
        await lp.mint(alice.address, stakeAmt);
        await lp.connect(alice).approve(await gauge.getAddress(), stakeAmt);

        const reward = ethers.parseEther("100");
        const duration = 7n * 24n * 3600n;
        await ags.mint(gov.address, reward);
        await ags.connect(gov).transfer(await gauge.getAddress(), reward);
        await gauge.connect(gov).notifyRewardAmount(reward, duration);

        await gauge.connect(alice).stake(stakeAmt);
        await time.increase(Number(duration));

        const beforeBob = await ags.balanceOf(bob.address);
        await gauge.connect(alice).getRewardTo(bob.address);
        const afterBob = await ags.balanceOf(bob.address);
        expect(afterBob - beforeBob).to.be.closeTo(reward, ethers.parseEther("0.01"));
        expect(await ags.balanceOf(alice.address)).to.equal(0n);
    });

    it("withdrawTo sends LP to recipient", async function () {
        const { alice, bob, lp, ags, gauge, gov } = await loadFixture(fixture);
        const stakeAmt = ethers.parseEther("50");
        await lp.mint(alice.address, stakeAmt);
        await lp.connect(alice).approve(await gauge.getAddress(), stakeAmt);
        await ags.mint(gov.address, ethers.parseEther("10"));
        await ags.connect(gov).transfer(await gauge.getAddress(), ethers.parseEther("10"));
        await gauge.connect(gov).notifyRewardAmount(ethers.parseEther("10"), 3600n);

        await gauge.connect(alice).stake(stakeAmt);
        await gauge.connect(alice).withdrawTo(bob.address, stakeAmt);
        expect(await lp.balanceOf(bob.address)).to.equal(stakeAmt);
        expect(await gauge.balanceOf(alice.address)).to.equal(0n);
    });
});
