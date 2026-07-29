const { expect } = require('chai');
const { ethers } = require('hardhat');

const describeLiquidity = process.env.RUN_LIQUIDITY_SUITE === "0" ? describe.skip : describe;

describeLiquidity('TreasuryLiquidityAllocator', function () {
  let owner, governance, recipient;
  let Aggregator, allocator;
  let Pool, nativePool, usdcPool;
  let MockToken, agsToken, usdcToken;
  let MockWETH, wrappedSonic;

  const parseEther = ethers.parseEther;

  beforeEach(async function () {
    [owner, governance, recipient] = await ethers.getSigners();

    MockToken = await ethers.getContractFactory('contracts/test/MockERC20.sol:MockERC20');
    agsToken = await MockToken.deploy('Aegis', 'AGS');
    usdcToken = await MockToken.deploy('USD Coin', 'USDC');

    MockWETH = await ethers.getContractFactory('contracts/test/MockWETH.sol:MockWETH');
    wrappedSonic = await MockWETH.deploy();

    Aggregator = await ethers.getContractFactory('TreasuryLiquidityAllocator');
    allocator = await Aggregator.deploy(owner.address, await agsToken.getAddress(), await wrappedSonic.getAddress(), ethers.ZeroAddress);

    Pool = await ethers.getContractFactory('PublicLiquidityPool');
    nativePool = await Pool.deploy(
      await agsToken.getAddress(),
      await wrappedSonic.getAddress(),
      true,
      'AGS-SONIC LP',
      'AGS-SONIC-LP',
      30
    );
    usdcPool = await Pool.deploy(
      await agsToken.getAddress(),
      await usdcToken.getAddress(),
      false,
      'AGS-USDC LP',
      'AGS-USDC-LP',
      30
    );

    // Fund allocator with AGS and USDC
    await agsToken.mint(await allocator.getAddress(), parseEther('1000'));
    await usdcToken.mint(await allocator.getAddress(), parseEther('500'));

    // Seed allocator with wrapped SONIC liquidity
    await wrappedSonic.deposit({ value: parseEther('100') });
    await wrappedSonic.transfer(await allocator.getAddress(), parseEther('100'));
  });

  it('seeds public pools with native and ERC-20 quotes', async function () {
    const allocatorSigner = allocator.connect(owner);

    const allocations = [
      {
        pool: await nativePool.getAddress(),
        agsAmount: parseEther('100'),
        quoteAmount: parseEther('10'),
        minShares: 0,
        lpRecipient: owner.address,
      },
      {
        pool: await usdcPool.getAddress(),
        agsAmount: parseEther('50'),
        quoteAmount: parseEther('25'),
        minShares: 0,
        lpRecipient: owner.address,
      },
    ];

    await expect(allocatorSigner.seedPublicPools(allocations)).to.emit(allocator, 'PublicLiquiditySeeded');

    const nativeReserves = await nativePool.getReserves();
    expect(nativeReserves[0]).to.equal(parseEther('100'));
    expect(nativeReserves[1]).to.equal(parseEther('10'));

    const usdcReserves = await usdcPool.getReserves();
    expect(usdcReserves[0]).to.equal(parseEther('50'));
    expect(usdcReserves[1]).to.equal(parseEther('25'));

    const lpNative = await nativePool.balanceOf(owner.address);
    const lpUsdc = await usdcPool.balanceOf(owner.address);
    expect(lpNative).to.be.gt(0n);
    expect(lpUsdc).to.be.gt(0n);
  });

  it('wraps and unwraps native SONIC', async function () {
    const allocatorSigner = allocator.connect(owner);

    await owner.sendTransaction({ to: await allocator.getAddress(), value: parseEther('5') });
    await allocatorSigner.wrapNative(parseEther('5'));
    expect(await wrappedSonic.balanceOf(await allocator.getAddress())).to.equal(parseEther('105'));

    await allocatorSigner.unwrapNative(parseEther('5'), recipient.address);
    expect(await wrappedSonic.balanceOf(await allocator.getAddress())).to.equal(parseEther('100'));
    expect(await ethers.provider.getBalance(recipient.address)).to.be.gt(0n);
  });

  it('rescues ERC-20 and native balances', async function () {
    const allocatorSigner = allocator.connect(owner);

    await allocatorSigner.rescueToken(await agsToken.getAddress(), recipient.address, parseEther('10'));
    expect(await agsToken.balanceOf(recipient.address)).to.equal(parseEther('10'));

    await owner.sendTransaction({ to: await allocator.getAddress(), value: parseEther('1') });
    await allocatorSigner.rescueNative(recipient.address, parseEther('1'));

    const recipientBalance = await ethers.provider.getBalance(recipient.address);
    expect(recipientBalance).to.be.gt(0n);
  });
});

