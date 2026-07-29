const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const describeLiquidity = process.env.RUN_LIQUIDITY_SUITE === "0" ? describe.skip : describe;

/** Uniswap v3 sqrt price at tick 0 (1:1), valid for `AutomatedLiquidityDeployer` bounds checks */
const SQRT_PRICE_X96_1_1 = 79228162514264337593543950336n;

describeLiquidity("AutomatedLiquidityDeployer", function () {
    const POOL_FEE = 3000;
    const INITIAL_TOKEN_SUPPLY = ethers.parseEther("10000000");

    async function deployFixture() {
        const [owner, other, trustedAuction] = await ethers.getSigners();

        const MockERC20 = await ethers.getContractFactory("contracts/test/TokenDistributionMocks.sol:MockERC20");
        const agsToken = await MockERC20.deploy("Aegis Token", "AGS", INITIAL_TOKEN_SUPPLY);

        const MockWETH = await ethers.getContractFactory("contracts/test/TokenDistributionMocks.sol:MockWETH");
        const weth = await MockWETH.deploy();

        const MockNpm = await ethers.getContractFactory("MockNonfungiblePositionManager");
        const positionManager = await MockNpm.deploy();

        const AutomatedLiquidityDeployer = await ethers.getContractFactory("AutomatedLiquidityDeployer");
        const deployer = await AutomatedLiquidityDeployer.deploy(
            await agsToken.getAddress(),
            await weth.getAddress(),
            await positionManager.getAddress(),
            POOL_FEE,
            owner.address,
            ethers.ZeroAddress,
            ethers.ZeroAddress
        );

        return {
            deployer,
            agsToken,
            weth,
            positionManager,
            owner,
            other,
            trustedAuction,
        };
    }

    describe("Deployment", function () {
        it("wires immutables and defaults sinks/recipient to owner when zero", async function () {
            const { deployer, agsToken, weth, positionManager, owner } = await loadFixture(deployFixture);

            expect(await deployer.agsToken()).to.equal(await agsToken.getAddress());
            expect(await deployer.weth9()).to.equal(await weth.getAddress());
            expect(await deployer.positionManager()).to.equal(await positionManager.getAddress());
            expect(await deployer.poolFee()).to.equal(BigInt(POOL_FEE));
            expect(await deployer.owner()).to.equal(owner.address);
            expect(await deployer.excessTokenSink()).to.equal(owner.address);
            expect(await deployer.positionRecipient()).to.equal(owner.address);
            expect(await deployer.trustedAuction()).to.equal(ethers.ZeroAddress);
        });

        it("reverts ZeroAddress for ags, weth, position manager, or owner", async function () {
            const fx = await loadFixture(deployFixture);
            const { agsToken, weth, positionManager, owner } = fx;
            const Factory = await ethers.getContractFactory("AutomatedLiquidityDeployer");

            await expect(
                Factory.deploy(
                    ethers.ZeroAddress,
                    await weth.getAddress(),
                    await positionManager.getAddress(),
                    POOL_FEE,
                    owner.address,
                    ethers.ZeroAddress,
                    ethers.ZeroAddress
                )
            ).to.be.revertedWithCustomError(Factory, "ZeroAddress");

            await expect(
                Factory.deploy(
                    await agsToken.getAddress(),
                    ethers.ZeroAddress,
                    await positionManager.getAddress(),
                    POOL_FEE,
                    owner.address,
                    ethers.ZeroAddress,
                    ethers.ZeroAddress
                )
            ).to.be.revertedWithCustomError(Factory, "ZeroAddress");

            await expect(
                Factory.deploy(
                    await agsToken.getAddress(),
                    await weth.getAddress(),
                    ethers.ZeroAddress,
                    POOL_FEE,
                    owner.address,
                    ethers.ZeroAddress,
                    ethers.ZeroAddress
                )
            ).to.be.revertedWithCustomError(Factory, "ZeroAddress");

            await expect(
                Factory.deploy(
                    await agsToken.getAddress(),
                    await weth.getAddress(),
                    await positionManager.getAddress(),
                    POOL_FEE,
                    ethers.ZeroAddress,
                    ethers.ZeroAddress,
                    ethers.ZeroAddress
                )
            ).to.be.revertedWithCustomError(Factory, "OwnableInvalidOwner");
        });
    });

    describe("Admin setters", function () {
        it("allows owner to update sinks, recipient, and trusted auction", async function () {
            const { deployer, owner, other, trustedAuction } = await loadFixture(deployFixture);

            await expect(deployer.connect(owner).setExcessTokenSink(other.address))
                .to.emit(deployer, "ExcessSinkUpdated")
                .withArgs(owner.address, other.address);
            expect(await deployer.excessTokenSink()).to.equal(other.address);

            await expect(deployer.connect(owner).setPositionRecipient(trustedAuction.address))
                .to.emit(deployer, "PositionRecipientUpdated")
                .withArgs(owner.address, trustedAuction.address);
            expect(await deployer.positionRecipient()).to.equal(trustedAuction.address);

            await expect(deployer.connect(owner).setTrustedAuction(trustedAuction.address))
                .to.emit(deployer, "TrustedAuctionUpdated")
                .withArgs(ethers.ZeroAddress, trustedAuction.address);
            expect(await deployer.trustedAuction()).to.equal(trustedAuction.address);
        });

        it("reverts non-owner", async function () {
            const { deployer, other } = await loadFixture(deployFixture);
            await expect(deployer.connect(other).setExcessTokenSink(other.address)).to.be.revertedWithCustomError(
                deployer,
                "OwnableUnauthorizedAccount"
            );
        });

        it("reverts zero sink/recipient on setters", async function () {
            const { deployer, owner } = await loadFixture(deployFixture);
            await expect(deployer.connect(owner).setExcessTokenSink(ethers.ZeroAddress)).to.be.revertedWithCustomError(
                deployer,
                "ZeroAddress"
            );
            await expect(deployer.connect(owner).setPositionRecipient(ethers.ZeroAddress)).to.be.revertedWithCustomError(
                deployer,
                "ZeroAddress"
            );
        });
    });

    describe("notifyAuctionPayout", function () {
        it("pulls AGS from trusted auction when configured", async function () {
            const { deployer, agsToken, owner, trustedAuction } = await loadFixture(deployFixture);
            await deployer.connect(owner).setTrustedAuction(trustedAuction.address);

            const amount = ethers.parseEther("1000");
            await agsToken.transfer(trustedAuction.address, amount);
            await agsToken.connect(trustedAuction).approve(await deployer.getAddress(), amount);

            await expect(deployer.connect(trustedAuction).notifyAuctionPayout(amount)).to.not.be.reverted;
            expect(await agsToken.balanceOf(await deployer.getAddress())).to.equal(amount);
        });

        it("reverts when caller is not trusted auction", async function () {
            const { deployer, agsToken, owner, other, trustedAuction } = await loadFixture(deployFixture);
            await deployer.connect(owner).setTrustedAuction(trustedAuction.address);
            const amount = ethers.parseEther("10");
            await agsToken.transfer(other.address, amount);
            await agsToken.connect(other).approve(await deployer.getAddress(), amount);
            await expect(deployer.connect(other).notifyAuctionPayout(amount)).to.be.revertedWithCustomError(
                deployer,
                "UnauthorizedAuction"
            );
        });

        it("reverts when trusted auction unset", async function () {
            const { deployer, agsToken, owner } = await loadFixture(deployFixture);
            const amount = ethers.parseEther("10");
            await agsToken.connect(owner).approve(await deployer.getAddress(), amount);
            await expect(deployer.connect(owner).notifyAuctionPayout(amount)).to.be.revertedWithCustomError(
                deployer,
                "UnauthorizedAuction"
            );
        });
    });

    describe("mintInitialLiquidity", function () {
        async function fundedDeployer() {
            const ctx = await deployFixture();
            const { deployer, agsToken, weth, owner } = ctx;
            const sonic = ethers.parseEther("5");
            const ags = ethers.parseEther("10000");
            await agsToken.transfer(await deployer.getAddress(), ags);
            await owner.sendTransaction({ to: await deployer.getAddress(), value: sonic });
            return { ...ctx, sonic, ags };
        }

        it("wraps native, creates pool, mints via NPM, emits event", async function () {
            const { deployer, owner } = await loadFixture(fundedDeployer);
            const deadline = BigInt(await time.latest()) + 3600n;

            await expect(
                deployer.connect(owner).mintInitialLiquidity(SQRT_PRICE_X96_1_1, -60000, 60000, 0n, 0n, deadline)
            ).to.emit(deployer, "InitialLiquidityMinted");

            expect(await ethers.provider.getBalance(await deployer.getAddress())).to.equal(0n);
        });

        it("reverts on bad sqrt price", async function () {
            const { deployer, owner } = await loadFixture(fundedDeployer);
            const deadline = BigInt(await time.latest()) + 3600n;
            await expect(
                deployer.connect(owner).mintInitialLiquidity(100n, -60, 60, 0n, 0n, deadline)
            ).to.be.revertedWithCustomError(deployer, "InvalidSqrtPrice");
        });

        it("reverts when tickLower >= tickUpper", async function () {
            const { deployer, owner } = await loadFixture(fundedDeployer);
            const deadline = BigInt(await time.latest()) + 3600n;
            await expect(
                deployer.connect(owner).mintInitialLiquidity(SQRT_PRICE_X96_1_1, 60, 60, 0n, 0n, deadline)
            ).to.be.revertedWithCustomError(deployer, "InvalidTickRange");
        });

        it("reverts past deadline", async function () {
            const { deployer, owner } = await loadFixture(fundedDeployer);
            const deadline = BigInt(await time.latest()) - 1n;
            await expect(
                deployer.connect(owner).mintInitialLiquidity(SQRT_PRICE_X96_1_1, -60, 60, 0n, 0n, deadline)
            ).to.be.revertedWithCustomError(deployer, "PastDeadline");
        });

        it("reverts for non-owner", async function () {
            const { deployer, other } = await loadFixture(fundedDeployer);
            const deadline = BigInt(await time.latest()) + 3600n;
            await expect(
                deployer.connect(other).mintInitialLiquidity(SQRT_PRICE_X96_1_1, -60, 60, 0n, 0n, deadline)
            ).to.be.revertedWithCustomError(deployer, "OwnableUnauthorizedAccount");
        });
    });

    describe("previewProportionalPairing", function () {
        it("returns full pairing when native covers ideal", async function () {
            const { deployer, agsToken } = await loadFixture(deployFixture);
            const amount = ethers.parseEther("1000");
            await agsToken.transfer(await deployer.getAddress(), amount);
            const mean = ethers.parseEther("0.01");
            const native = ethers.parseEther("100");
            const [agsToPair, nativeToPair] = await deployer.previewProportionalPairing(mean, amount, native);
            expect(agsToPair).to.equal(amount);
            expect(nativeToPair).to.equal((amount * mean) / ethers.parseEther("1"));
        });

        it("returns zeros when mean price is zero", async function () {
            const { deployer, agsToken, owner } = await loadFixture(deployFixture);
            await agsToken.transfer(await deployer.getAddress(), ethers.parseEther("1"));
            const [a, n] = await deployer.previewProportionalPairing(0n, ethers.parseEther("1"), 1n);
            expect(a).to.equal(0n);
            expect(n).to.equal(0n);
        });
    });

    describe("sweep / unwrap / rescue", function () {
        it("sweepToken moves ERC20 to recipient", async function () {
            const { deployer, agsToken, owner, other } = await loadFixture(deployFixture);
            const v = ethers.parseEther("50");
            await agsToken.transfer(await deployer.getAddress(), v);
            await deployer.connect(owner).sweepToken(await agsToken.getAddress(), other.address, v);
            expect(await agsToken.balanceOf(other.address)).to.equal(v);
        });

        it("unwrapAndSweepNative unwraps WETH and sends native", async function () {
            const { deployer, weth, owner, other } = await loadFixture(deployFixture);
            const amt = ethers.parseEther("2");
            await weth.deposit({ value: amt });
            await weth.transfer(await deployer.getAddress(), amt);
            const before = await ethers.provider.getBalance(other.address);
            await deployer.connect(owner).unwrapAndSweepNative(other.address, amt);
            expect(await ethers.provider.getBalance(other.address)).to.equal(before + amt);
        });

        it("rescueDustToSink sends residual balances to excess sink", async function () {
            const { deployer, agsToken, weth, owner, other } = await loadFixture(deployFixture);
            await deployer.connect(owner).setExcessTokenSink(other.address);
            await agsToken.transfer(await deployer.getAddress(), ethers.parseEther("3"));
            await weth.deposit({ value: ethers.parseEther("1") });
            await weth.transfer(await deployer.getAddress(), ethers.parseEther("1"));
            await deployer.connect(owner).rescueDustToSink();
            expect(await agsToken.balanceOf(other.address)).to.be.gt(0n);
        });
    });

    describe("receive", function () {
        it("accepts native via receive()", async function () {
            const { deployer, owner } = await loadFixture(deployFixture);
            const v = ethers.parseEther("1");
            await expect(owner.sendTransaction({ to: await deployer.getAddress(), value: v })).to.emit(
                deployer,
                "NativeReceived"
            );
            expect(await ethers.provider.getBalance(await deployer.getAddress())).to.equal(v);
        });
    });
});
