#!/usr/bin/env node
/**
 * Dev Groth16 artifacts for frontend gaps not yet under `build/circuits/`.
 * Writes `build/circuits/<dir>/<base>_final.zkey` for `frontend/scripts/copy-circuits.mjs`.
 *
 * Usage (from `Aegis-contracts/`):
 *   npm run circuits:build-frontend-zk-gaps
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
const SHARED_POT14 = path.join(ROOT, "build", "frontend-zk-gaps", "pot14_final.ptau");
const SHARED_POT13 = path.join(ROOT, "build", "frontend-zk-gaps", "pot13_final.ptau");

/** @type {{ file: string, base: string, dir: string, pot: 13 | 14 }[]} */
const SPECS = [
  { file: "private-amm.circom", base: "private-amm", dir: "private-amm", pot: 13 },
  { file: "transfer-unshield.circom", base: "transfer-unshield", dir: "transfer-unshield", pot: 14 },
  { file: "selective-disclosure.circom", base: "selective-disclosure", dir: "selective-disclosure", pot: 14 },
  { file: "stealth-address.circom", base: "stealth-address", dir: "stealth-address", pot: 14 },
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

async function ensurePotTau(pot) {
  const finalPath = pot === 13 ? SHARED_POT13 : SHARED_POT14;
  if (existsSync(finalPath)) return finalPath;

  if (pot === 14) {
    const lendingPot = path.join(ROOT, "build", "lending-split-dev", "pot14_final.ptau");
    if (existsSync(lendingPot)) return lendingPot;
    const stakingPot = path.join(ROOT, "build", "staking-reward-dev", "pot14_final.ptau");
    if (existsSync(stakingPot)) return stakingPot;
  }

  if (pot === 13) {
    const ammPot = path.join(ROOT, "build", "private-amm-e2e", "pot13_final.ptau");
    if (existsSync(ammPot)) return ammPot;
  }

  const sharedDir = path.join(ROOT, "build", "frontend-zk-gaps");
  await fs.mkdir(sharedDir, { recursive: true });
  const p0 = path.join(sharedDir, `pot${pot}_0000.ptau`);
  const p1 = path.join(sharedDir, `pot${pot}_0001.ptau`);
  await snarkjsRun(["powersoftau", "new", "bn128", String(pot), p0, "-v"]);
  await snarkjsRun([
    "powersoftau",
    "contribute",
    p0,
    p1,
    `--name=frontend-zk-gaps-pot${pot}`,
    "-v",
    "-e=random",
  ]);
  await snarkjsRun(["powersoftau", "prepare", "phase2", p1, finalPath, "-v"]);
  return finalPath;
}

/**
 * @param {string} circomCmd
 * @param {{ file: string, base: string, dir: string, pot: 13 | 14 }} spec
 */
async function buildOne(circomCmd, spec) {
  const outDir = path.join(ROOT, "build", "circuits", spec.dir);
  const r1cs = path.join(outDir, `${spec.base}.r1cs`);
  const wasm = path.join(outDir, `${spec.base}_js`, `${spec.base}.wasm`);
  const zkey0 = path.join(outDir, `${spec.base}_0000.zkey`);
  const zkeyFinal = path.join(outDir, `${spec.base}_final.zkey`);

  if (existsSync(zkeyFinal) && existsSync(wasm) && process.env.AEGIS_FRONTEND_ZK_GAPS_FORCE !== "1") {
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

  const potFinal = await ensurePotTau(spec.pot);
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
  console.log("circuits:build-frontend-zk-gaps — private-amm, transfer-unshield, selective-disclosure, stealth-address…");
  for (const spec of SPECS) {
    await buildOne(circomCmd, spec);
  }
  console.log("\nDone. Copy to frontend: cd ../frontend && npm run copy-circuits");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
