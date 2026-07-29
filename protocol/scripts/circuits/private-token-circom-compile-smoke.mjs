#!/usr/bin/env node
/**
 * Compile-only smoke for `PrivateTokenContract` privacy rail Circom sources.
 * Catches syntax / include drift without running Groth16 trusted setup.
 *
 * Circuits (factory-aligned):
 *   mint-optimized, transfer-unshield, shielded-transfer,
 *   transfer-to-pool, transfer-commitment-internal, transfer-commitment-action
 *
 * Run from `Aegis-contracts/`:
 *   npm run circuits:private-token-circom-compile-smoke
 *
 * Requires circom 2.x on PATH or `./circom.exe` / `./circom` at repo root (same as other circuit scripts).
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const CIRCUITS = path.join(ROOT, "circuits");
const OUT_ROOT = path.join(ROOT, "build", "private-token-circom-smoke");

const FILES = [
  "mint-optimized.circom",
  "transfer-unshield.circom",
  "shielded-transfer.circom",
  "transfer-to-pool.circom",
  "transfer-commitment-internal.circom",
  "transfer-commitment-action.circom",
];

function run(cmd, args, cwd = ROOT) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${stderr || ""}\n${err.message}`));
      } else {
        resolve(stdout);
      }
    });
  });
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
      "circom not found (PATH or ./circom.exe). Install circom 2.x or place the binary at Aegis-contracts root."
    );
  }
  return cmd;
}

async function main() {
  const circomCmd = await ensureCircom();
  await fs.mkdir(OUT_ROOT, { recursive: true });

  for (const file of FILES) {
    const base = file.replace(/\.circom$/i, "");
    const outDir = path.join(OUT_ROOT, base);
    await fs.mkdir(outDir, { recursive: true });
    process.stdout.write(`circom compile: ${file} → ${path.relative(ROOT, outDir)}\n`);
    await run(
      circomCmd,
      [file, "--r1cs", "--wasm", "-l", path.join(ROOT, "node_modules"), "-o", outDir],
      CIRCUITS
    );
  }

  console.log("private-token-circom-compile-smoke: OK (" + FILES.length + " circuits)");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
