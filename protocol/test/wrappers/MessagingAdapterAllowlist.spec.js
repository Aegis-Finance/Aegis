const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("MessagingAdapterAllowlist", function () {
    async function fixture() {
        const [owner, gov, alice, adapter] = await ethers.getSigners();
        const Factory = await ethers.getContractFactory("MessagingAdapterAllowlist");
        const list = await Factory.deploy(owner.address);
        await list.setGovernance(gov.address);
        return { owner, gov, alice, adapter, list };
    }

    it("only governance can allow or deny adapters", async function () {
        const { gov, alice, adapter, list } = await loadFixture(fixture);
        await expect(list.connect(alice).setMessagingAdapterAllowed(adapter.address, true)).to.be.revertedWithCustomError(
            list,
            "UnauthorizedAccess"
        );
        await list.connect(gov).setMessagingAdapterAllowed(adapter.address, true);
        expect(await list.isMessagingAdapterAllowed(adapter.address)).to.equal(true);
        await list.connect(gov).setMessagingAdapterAllowed(adapter.address, false);
        expect(await list.isMessagingAdapterAllowed(adapter.address)).to.equal(false);
    });

    it("reverts on zero adapter", async function () {
        const { gov, list } = await loadFixture(fixture);
        await expect(
            list.connect(gov).setMessagingAdapterAllowed(ethers.ZeroAddress, true)
        ).to.be.revertedWithCustomError(list, "ZeroAddress");
    });

    it("owner sets governance; governance sets timelock", async function () {
        const [owner, gov, tl] = await ethers.getSigners();
        const Factory = await ethers.getContractFactory("MessagingAdapterAllowlist");
        const list = await Factory.deploy(owner.address);
        await list.setGovernance(gov.address);
        await list.connect(gov).setTimelockController(tl.address);
        expect(await list.timelockController()).to.equal(tl.address);
    });
});
