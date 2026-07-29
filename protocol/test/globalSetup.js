const { network } = require("hardhat");

beforeEach(async function () {
  try {
    await network.provider.send("hardhat_setNextBlockBaseFeePerGas", ["0x0"]);
  } catch (error) {
    console.warn(
      "[globalSetup] Unable to reset base fee per gas; proceeding with default behavior.",
      error?.message ?? error
    );
  }
});

