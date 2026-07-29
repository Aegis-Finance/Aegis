#!/usr/bin/env node
/**
 * Dev Groth16 artifacts for shielded-ecosystem circuits (payroll, savings, bonds, etc.).
 * **Mainnet:** copy production ceremony zkeys — dev zkeys will NOT match on-chain verifiers.
 *
 * Usage (from `Aegis-contracts/`):
 *   npm run circuits:build-ecosystem-dev
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
const SHARED_POT14 = path.join(ROOT, "build", "ecosystem-circuits-dev", "pot14_final.ptau");

/** @type {{ file: string, base: string, dir: string }[]} */
const SPECS = [
  { file: "private-stable.circom", base: "private-stable", dir: "private-stable" },
  { file: "credit-profile.circom", base: "credit-profile", dir: "credit-profile" },
  { file: "private-bond.circom", base: "private-bond", dir: "private-bond" },
  { file: "prediction-market.circom", base: "prediction-market", dir: "prediction-market" },
  { file: "payroll.circom", base: "payroll", dir: "payroll" },
  { file: "savings.circom", base: "savings", dir: "savings" },
  { file: "treasury-shield.circom", base: "treasury-shield", dir: "treasury-shield" },
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
  await run(cmd, ["--version"], CIRCUITS);
  return cmd;
}

async function ensurePotTau() {
  if (existsSync(SHARED_POT14)) return SHARED_POT14;
  for (const p of [
    path.join(ROOT, "build", "staking-reward-dev", "pot14_final.ptau"),
    path.join(ROOT, "build", "lending-split-dev", "pot14_final.ptau"),
    path.join(ROOT, "build", "frontend-zk-gaps", "pot14_final.ptau"),
  ]) {
    if (existsSync(p)) return p;
  }
  const sharedDir = path.join(ROOT, "build", "ecosystem-circuits-dev");
  await fs.mkdir(sharedDir, { recursive: true });
  const p0 = path.join(sharedDir, "pot14_0000.ptau");
  const p1 = path.join(sharedDir, "pot14_0001.ptau");
  await snarkjsRun(["powersoftau", "new", "bn128", "14", p0, "-v"]);
  await snarkjsRun(["powersoftau", "contribute", p0, p1, "--name=ecosystem-dev-pot14", "-v", "-e=random"]);
  await snarkjsRun(["powersoftau", "prepare", "phase2", p1, SHARED_POT14, "-v"]);
  return SHARED_POT14;
}

async function buildOne(circomCmd, spec) {
  const outDir = path.join(ROOT, "build", "circuits", spec.dir);
  const r1cs = path.join(outDir, `${spec.base}.r1cs`);
  const wasm = path.join(outDir, `${spec.base}_js`, `${spec.base}.wasm`);
  const zkey0 = path.join(outDir, `${spec.base}_0000.zkey`);
  const zkeyFinal = path.join(outDir, `${spec.base}_final.zkey`);

  if (existsSync(zkeyFinal) && existsSync(wasm) && process.env.AEGIS_ECOSYSTEM_CIRCUITS_FORCE !== "1") {
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
  await snarkjsRun(["zkey", "contribute", zkey0, zkeyFinal, `--name=${spec.base}-dev`, "-v", "-e=random"]);
  console.log(`Built ${spec.dir} → ${path.relative(ROOT, zkeyFinal)}`);
  console.warn(`  ⚠ dev zkey — replace with production ceremony artifact before mainnet proofs`);
}

async function main() {
  const circomCmd = await ensureCircom();
  console.log("circuits:build-ecosystem-dev — payroll, savings, private-stable, bonds, …");
  for (const spec of SPECS) {
    await buildOne(circomCmd, spec);
  }
  console.log("\nDone. Copy wasm+zkey: cd ../frontend && npm run copy-circuits");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
