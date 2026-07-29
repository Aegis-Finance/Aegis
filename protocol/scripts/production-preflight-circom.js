#!/usr/bin/env node
/**
 * Optional Circom e2e during `npm run production:preflight`:
 * if `circom` is on PATH, runs PrivateToken compile smoke then auction + aggregator + private-amm + sybil-protection + tokendistribution Groth16 dev smokes.
 * If `circom` is missing, prints one line and exits 0.
 *
 * Set `AEGIS_SKIP_CIRCOM_PREFLIGHT=1` to skip even when circom exists (slow CI duplicate locally).
 */

"use strict";

const { execFileSync } = require("child_process");
const path = require("path");

function hasCircom() {
  try {
    execFileSync("circom", ["--version"], { stdio: "pipe", encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}

function runNpm(script) {
  const root = path.resolve(__dirname, "..");
  const npmExecPath = process.env.npm_execpath;
  if (!npmExecPath) {
    throw new Error("npm_execpath is not set; cannot invoke nested npm scripts safely.");
  }
  execFileSync(process.execPath, [npmExecPath, "run", script], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
}

function main() {
  if (process.env.AEGIS_SKIP_CIRCOM_PREFLIGHT === "1") {
    console.log("production-preflight-circom: skip (AEGIS_SKIP_CIRCOM_PREFLIGHT=1)");
    return;
  }
  if (!hasCircom()) {
    console.log(
      "production-preflight-circom: circom not on PATH — skipping circuits:auction-check / aggregator / private-amm / sybil / tokendistribution (CI still runs them)."
    );
    return;
  }
  console.log(
    "production-preflight-circom: running private-token compile smoke, auction-check, aggregator-check, private-amm-check, sybil-check, tokendistribution-check…"
  );
  runNpm("circuits:private-token-circom-compile-smoke");
  runNpm("circuits:auction-check");
  runNpm("circuits:aggregator-check");
  runNpm("circuits:private-amm-check");
  runNpm("circuits:sybil-check");
  runNpm("circuits:tokendistribution-check");
  console.log("production-preflight-circom: OK");
}

main();
