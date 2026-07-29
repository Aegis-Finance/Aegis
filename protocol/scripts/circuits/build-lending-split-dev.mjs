#!/usr/bin/env node
/**
 * Dev Groth16 artifacts for **split** `PrivateLendingContract` circuits (VerifierFactory types
 * `lending-tenor`, `lending-liquidity`, `lending-repay`, `lending-withdraw`, `lending-liquidate`).
 *
 * Writes under `build/circuits/<dir>/` the layout expected by `scripts/utils/resolve-groth16-artifacts.js`
 * and consumed by `frontend/scripts/copy-circuits.mjs` → `frontend/public/circuits/…`.
 *
 * Requires: `circom` on PATH (or `./circom.exe` at repo root). First run creates a shared dev
 * `pot14_final.ptau` under `build/lending-split-dev/` (~1–3 min).
 *
 * Usage (from `Aegis-contracts/`):
 *   npm run circuits:build-lending-split-dev
 *
 * Env:
 *   AEGIS_LENDING_SPLIT_FORCE=1 — delete existing wasm/r1cs/zkey per circuit and rebuild.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const CIRCUITS = path.join(ROOT, "circuits");
const SHARED = path.join(ROOT, "build", "lending-split-dev");
const PTAU_0 = path.join(SHARED, "pot14_0000.ptau");
const PTAU_1 = path.join(SHARED, "pot14_0001.ptau");
const PTAU_FINAL = path.join(SHARED, "pot14_final.ptau");

/** @type {{ file: string, base: string, dir: string }[]} */
const LENDING_SPECS = [
  { file: "lending_tenor.circom", base: "lending_tenor", dir: "lending-tenor" },
  { file: "lending_liquidity.circom", base: "lending_liquidity", dir: "lending-liquidity" },
  { file: "lending_repay.circom", base: "lending_repay", dir: "lending-repay" },
  { file: "lending_withdraw.circom", base: "lending_withdraw", dir: "lending-withdraw" },
  { file: "lending_liquidate.circom", base: "lending_liquidate", dir: "lending-liquidate" },
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
  if (existsSync(PTAU_FINAL)) return;
  await fs.mkdir(SHARED, { recursive: true });
  await snarkjsRun(["powersoftau", "new", "bn128", "14", PTAU_0, "-v"]);
  await snarkjsRun([
    "powersoftau",
    "contribute",
    PTAU_0,
    PTAU_1,
    "--name=lending-split-dev",
    "-v",
    "-e=random",
  ]);
  await snarkjsRun(["powersoftau", "prepare", "phase2", PTAU_1, PTAU_FINAL, "-v"]);
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

  if (process.env.AEGIS_LENDING_SPLIT_FORCE === "1") {
    for (const p of [r1cs, zkey0, zkeyFinal, wasm]) {
      try {
        if (existsSync(p)) await fs.unlink(p);
      } catch {
        /* ignore */
      }
    }
    const wasmDir = path.dirname(wasm);
    if (existsSync(wasmDir)) {
      await fs.rm(wasmDir, { recursive: true, force: true });
    }
  }

  if (existsSync(zkeyFinal) && existsSync(wasm) && process.env.AEGIS_LENDING_SPLIT_FORCE !== "1") {
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

  await ensurePotTau();
  await snarkjsRun(["zkey", "new", r1cs, PTAU_FINAL, zkey0, "-v"]);
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
  console.log("circuits:build-lending-split-dev — compiling + zkey for 5 lending circuits…");
  for (const spec of LENDING_SPECS) {
    await buildOne(circomCmd, spec);
  }
  console.log("\nDone. Copy to frontend: cd ../frontend && npm run copy-circuits");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
