const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

/** ActionType enum order matches AustrianAnalytics.sol */
const ActionType = {
    CONTRIBUTION: 0,
    MILESTONE_REVIEW: 1,
    REFUND_REQUEST: 2,
    CAMPAIGN_CREATION: 3,
    REPUTATION_UPDATE: 4,
    MARKET_SIGNAL: 5,
    COORDINATION: 6,
    VALUE_DISCOVERY: 7,
};

describe("AustrianAnalytics behavior", function () {
    async function deployFixture() {
        const [governance, alice, bob] = await ethers.getSigners();
        const AustrianAnalytics = await ethers.getContractFactory("AustrianAnalytics");
        const analytics = await AustrianAnalytics.deploy(governance.address);
        const campaignId = 42n;
        await analytics.connect(governance).startCampaignAnalysis(campaignId);
        return { analytics, governance, alice, bob, campaignId };
    }

        it("recordAction increments per-actor contribution count", async function () {
        const { analytics, alice, campaignId } = await loadFixture(deployFixture);
        await expect(analytics.recordAction(campaignId, alice.address, ActionType.CONTRIBUTION, 1000n)).to.emit(
            analytics,
            "ActorBehaviorUpdated"
        );

        expect(await analytics.getActorActionCount(campaignId, alice.address, ActionType.CONTRIBUTION)).to.equal(1n);
    });

    it("globalActorBehavior marks actor active after first action", async function () {
        const { analytics, alice, campaignId } = await loadFixture(deployFixture);
        await analytics.recordAction(campaignId, alice.address, ActionType.CONTRIBUTION, 1n);
        const row = await analytics.globalActorBehavior(alice.address);
        expect(row.actor).to.equal(alice.address);
        expect(row.isActive).to.be.true;
        expect(row.totalActions).to.equal(1n);
    });

    it("second action within threshold keeps actor active", async function () {
        const { analytics, alice, campaignId } = await loadFixture(deployFixture);
        await analytics.recordAction(campaignId, alice.address, ActionType.CONTRIBUTION, 1n);
        await analytics.recordAction(campaignId, alice.address, ActionType.MARKET_SIGNAL, 2n);
        const row = await analytics.globalActorBehavior(alice.address);
        expect(row.isActive).to.be.true;
        expect(row.totalActions).to.equal(2n);
    });

    it("calculateGlobalMetrics throttles within ANALYSIS_UPDATE_INTERVAL", async function () {
        const { analytics, governance } = await loadFixture(deployFixture);
        await time.increase(3601n);
        await analytics.connect(governance).calculateGlobalMetrics();
        await expect(analytics.connect(governance).calculateGlobalMetrics()).to.be.revertedWithCustomError(
            analytics,
            "UpdateTooFrequent"
        );
    });

    it("calculateGlobalMetrics succeeds after interval", async function () {
        const { analytics, governance } = await loadFixture(deployFixture);
        await time.increase(3601n);
        await analytics.connect(governance).calculateGlobalMetrics();
        await time.increase(3601n);
        await expect(analytics.connect(governance).calculateGlobalMetrics()).to.emit(analytics, "GlobalMetricsCalculated");
    });
});
