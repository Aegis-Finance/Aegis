/**
 * Regression: `scripts/ops/fetch-partner-market-snapshot.js` must stay aligned with
 * `PrivateLendingContract.getLendingMarketSnapshot` and `DecentralizedInsurance.getInsuranceMarketSnapshot`
 * (aggregate-only partner JSON — see docs/AEGIS_PARTNER_MARKET_SNAPSHOT.md).
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const LENDING_SNAPSHOT_KEYS = [
  "totalLiquidityShares",
  "liquidityPoolWei",
  "totalBorrowedWei",
  "utilizationBps",
  "spotBorrowRateBps",
  "withdrawRunCheckpointBlock",
  "withdrawRunPoolStartWei",
  "withdrawRunCumulativeWei",
  "withdrawRunCapWei",
  "isPaused",
  "concentrationCapBpsAtCurrentUtil",
  "maxSingleLoanByConcentrationAtCurrentUtilWei",
  "previewMaxNewLoanWeiUpperBound",
];

const INSURANCE_SNAPSHOT_KEYS = [
  "poolWei",
  "outstandingCoverageWei",
  "premiumsCollectedWei",
  "claimsPaidWei",
  "coverageToPoolBps",
  "lossRatioBps",
];

describe("Partner market snapshot — ABI shape vs ops script", function () {
  it("getLendingMarketSnapshot return names/order match fetch-partner-market-snapshot.js LENDING_KEYS", async function () {
    const artifactPath = path.join(
      __dirname,
      "../../artifacts/contracts/PrivateLendingContract.sol/PrivateLendingContract.json"
    );
    const { abi } = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    const iface = new ethers.Interface(abi);
    const fn = iface.getFunction("getLendingMarketSnapshot");
    expect(fn.outputs.length).to.equal(LENDING_SNAPSHOT_KEYS.length);
    for (let i = 0; i < LENDING_SNAPSHOT_KEYS.length; i++) {
      expect(fn.outputs[i].name).to.equal(LENDING_SNAPSHOT_KEYS[i]);
    }
  });

  it("getInsuranceMarketSnapshot return names/order match fetch-partner-market-snapshot.js INSURANCE_KEYS", async function () {
    const artifactPath = path.join(
      __dirname,
      "../../artifacts/contracts/DecentralizedInsurance.sol/DecentralizedInsurance.json"
    );
    const { abi } = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    const iface = new ethers.Interface(abi);
    const fn = iface.getFunction("getInsuranceMarketSnapshot");
    expect(fn.outputs.length).to.equal(INSURANCE_SNAPSHOT_KEYS.length);
    for (let i = 0; i < INSURANCE_SNAPSHOT_KEYS.length; i++) {
      expect(fn.outputs[i].name).to.equal(INSURANCE_SNAPSHOT_KEYS[i]);
    }
  });
});
