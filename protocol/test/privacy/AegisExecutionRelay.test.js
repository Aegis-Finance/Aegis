const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('AegisExecutionRelay', function () {
  it('relays allowlisted call with EIP-712 signature', async function () {
    const [owner, user, relayer] = await ethers.getSigners();
    const Mock = await ethers.getContractFactory('MockExecutionRelayTarget');
    const target = await Mock.deploy();
    const relay = await (await ethers.getContractFactory('AegisExecutionRelay')).deploy(owner.address);

    await relay.setAllowedTarget(await target.getAddress(), true);
    await relay.setAllowedSelector(await target.getAddress(), target.interface.getFunction('setValue').selector, true);

    const value = 42n;
    const data = target.interface.encodeFunctionData('setValue', [value]);
    const nonce = 0n;
    const deadline = BigInt((await ethers.provider.getBlock('latest')).timestamp + 3600);

    const domain = {
      name: 'AegisExecutionRelay',
      version: '1',
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await relay.getAddress(),
    };
    const types = {
      ExecutionIntent: [
        { name: 'user', type: 'address' },
        { name: 'target', type: 'address' },
        { name: 'dataHash', type: 'bytes32' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    };
    const dataHash = ethers.keccak256(data);
    const signature = await user.signTypedData(domain, types, {
      user: user.address,
      target: await target.getAddress(),
      dataHash,
      value: 0n,
      nonce,
      deadline,
    });

    await relay.connect(relayer).execute(
      user.address,
      await target.getAddress(),
      data,
      0n,
      deadline,
      nonce,
      signature,
    );

    expect(await target.value()).to.equal(value);
    expect(await relay.nonces(user.address)).to.equal(1n);
  });
});
