#!/usr/bin/env node
/**
 * Dev Groth16 artifacts for `staking` and `reward` (VerifierFactory types used by Staking UI).
 *
 * Writes under `build/circuits/<dir>/` for `frontend/scripts/copy-circuits.mjs`.
 *
 * Usage (from `Aegis-contracts/`):
 *   npm run circuits:build-staking-reward-dev
 *   cd ../frontend && npm run copy-circuits
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const CIRCUITS = path.join(ROOT, "circuits");
const SHARED = path.join(ROOT, "build", "staking-reward-dev");
const PTAU_0 = path.join(SHARED, "pot14_0000.ptau");
const PTAU_1 = path.join(SHARED, "pot14_0001.ptau");
const PTAU_FINAL = path.join(SHARED, "pot14_final.ptau");

/** @type {{ file: string, base: string, dir: string }[]} */
const SPECS = [
  { file: "staking.circom", base: "staking", dir: "staking" },
  { file: "reward.circom", base: "reward", dir: "reward" },
];

function snarkjsCli() {
  return path.join(ROOT, "node_modules", "snarkjs", "build", "cli.cjs");
}

function run(cmd, args, cwd = ROOT) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${stderr || ""}\n${err.message}`));
      else resolve(stdout);
    });
  });
}

async function snarkjsRun(args) {
  await run(process.execPath, [snarkjsCli(), ...args], ROOT);
}

function getCircomCmd() {
  const localWin = path.join(ROOT, "circom.exe");
  const localUnix = path.join(ROOT, "circom");
  if (existsSync(localWin)) return localWin;
  if (existsSync(localUnix)) return localUnix;
  return "circom";
}

async function ensureCircom() {
  const cmd = getCircomCmd();
  try {
    await run(cmd, ["--version"], CIRCUITS);
  } catch {
    throw new Error(
      "circom not found (PATH or ./circom.exe). Install circom 2.x or place circom.exe at Aegis-contracts root.",
    );
  }
  return cmd;
}

async function ensurePotTau() {
  const lendingPot = path.join(ROOT, "build", "lending-split-dev", "pot14_final.ptau");
  if (existsSync(lendingPot)) return lendingPot;
  if (existsSync(PTAU_FINAL)) return PTAU_FINAL;
  await fs.mkdir(SHARED, { recursive: true });
  await snarkjsRun(["powersoftau", "new", "bn128", "14", PTAU_0, "-v"]);
  await snarkjsRun([
    "powersoftau",
    "contribute",
    PTAU_0,
    PTAU_1,
    "--name=staking-reward-dev",
    "-v",
    "-e=random",
  ]);
  await snarkjsRun(["powersoftau", "prepare", "phase2", PTAU_1, PTAU_FINAL, "-v"]);
  return PTAU_FINAL;
}

/**
 * @param {string} circomCmd
 * @param {{ file: string, base: string, dir: string }} spec
 */
async function buildOne(circomCmd, spec) {
  const outDir = path.join(ROOT, "build", "circuits", spec.dir);
  const r1cs = path.join(outDir, `${spec.base}.r1cs`);
  const wasm = path.join(outDir, `${spec.base}_js`, `${spec.base}.wasm`);
  const zkey0 = path.join(outDir, `${spec.base}_0000.zkey`);
  const zkeyFinal = path.join(outDir, `${spec.base}_final.zkey`);

  if (existsSync(zkeyFinal) && existsSync(wasm) && process.env.AEGIS_STAKING_REWARD_FORCE !== "1") {
    console.log(`OK (cached) ${spec.dir}`);
    return;
  }

  await fs.mkdir(outDir, { recursive: true });
  await run(
    circomCmd,
    [spec.file, "--r1cs", "--wasm", "-l", path.join(ROOT, "node_modules"), "-o", outDir],
    CIRCUITS,
  );

  if (!existsSync(r1cs)) throw new Error(`Missing r1cs: ${r1cs}`);
  if (!existsSync(wasm)) throw new Error(`Missing wasm: ${wasm}`);

  const potFinal = await ensurePotTau();
  await snarkjsRun(["zkey", "new", r1cs, potFinal, zkey0, "-v"]);
  await snarkjsRun([
    "zkey",
    "contribute",
    zkey0,
    zkeyFinal,
    `--name=${spec.base}-dev`,
    "-v",
    "-e=random",
  ]);

  console.log(`Built ${spec.dir} → ${path.relative(ROOT, zkeyFinal)}`);
}

async function main() {
  const circomCmd = await ensureCircom();
  console.log("circuits:build-staking-reward-dev — compiling + zkey for staking + reward…");
  for (const spec of SPECS) {
    await buildOne(circomCmd, spec);
  }
  console.log("\nDone. Copy to frontend: cd ../frontend && COPY_CIRCUITS_FILTER=staking npm run copy-circuits");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
