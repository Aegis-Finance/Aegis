#!/usr/bin/env node
/**
 * End-to-end Groth16 check for `circuits/aggregator.circom`:
 * compile (circom) → dev powersOfTau (cached) → zkey (cached) → fullProve → verify.
 *
 * **Public I/O note:** Groth16 `publicSignals` order is **`[valid, nullifierHash, commitmentHash, merkleRoot, aggregatedAmount, batchId]`**
 * (6 values: template `output valid` then `main { public [...] }` list). This matches **`HyperOptimizedAggregator`** / batch Merkle semantics.
 * **`PrivateAMMContract`** uses factory type **`private-amm`** (`circuits/private-amm.circom`); see `npm run circuits:private-amm-snark-e2e`.
 *
 * Requires: `circom` on PATH, Node 22+.
 *
 * Run from `Aegis-contracts/`:
 *   npm run circuits:aggregator-snark-e2e
 *
 * Env:
 *   AEGIS_AGGREGATOR_FORCE_ZKEY=1 — delete cached dev zkey/vkey and regenerate.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPoseidon } from "circomlibjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const CIRCUITS = path.join(ROOT, "circuits");
const OUT = path.join(ROOT, "build", "aggregator-e2e");
const R1CS = path.join(OUT, "aggregator.r1cs");
const WASM_DIR = path.join(OUT, "aggregator_js");
const WASM = path.join(WASM_DIR, "aggregator.wasm");
const PTAU_0 = path.join(OUT, "pot14_0000.ptau");
const PTAU_1 = path.join(OUT, "pot14_0001.ptau");
const PTAU_FINAL = path.join(OUT, "pot14_final.ptau");
const ZKEY_0 = path.join(OUT, "aggregator_0000.zkey");
const ZKEY_FINAL = path.join(OUT, "aggregator_dev.zkey");
const VKEY = path.join(OUT, "aggregator_vkey.json");

const LEVELS = 20;

function snarkjsCli() {
  return path.join(ROOT, "node_modules", "snarkjs", "build", "cli.cjs");
}

async function snarkjsRun(args) {
  await run(process.execPath, [snarkjsCli(), ...args], ROOT);
}

function run(cmd, args, cwd = ROOT) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
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
      "circom not found (PATH or ./circom.exe). Install circom 2.x or place circom.exe at Aegis-contracts root."
    );
  }
  return cmd;
}

async function compileAggregator(circomCmd) {
  await fs.mkdir(OUT, { recursive: true });
  await run(
    circomCmd,
    ["aggregator.circom", "--r1cs", "--wasm", "-l", path.join(ROOT, "node_modules"), "-o", OUT],
    CIRCUITS
  );
  if (!existsSync(WASM)) {
    throw new Error(`Expected wasm at ${WASM}`);
  }
}

/**
 * Match `MerkleTreeInclusionProof` + `Selector` in aggregator.circom.
 * @param {import('circomlibjs').Poseidon} poseidon
 * @param {import('circomlibjs').Poseidon['F']} F
 */
function merkleRootFromPath(poseidon, F, leaf, pathElements, pathIndices) {
  let cur = leaf;
  for (let i = 0; i < LEVELS; i++) {
    const sib = pathElements[i];
    const sel = pathIndices[i];
    let left;
    let right;
    if (sel === 0n) {
      left = cur;
      right = sib;
    } else {
      left = sib;
      right = cur;
    }
    const h = poseidon([left, right]);
    cur = BigInt(F.toString(h));
  }
  return cur;
}

function p2(poseidon, F, a, b) {
  const h = poseidon([a, b]);
  return BigInt(F.toString(h));
}

function p4(poseidon, F, a, b, c, d) {
  const h = poseidon([a, b, c, d]);
  return BigInt(F.toString(h));
}

async function aggregatorInputCase() {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;

  const secret = 424242n;
  const nullifier = 777777n;
  const aggregatedAmount = 1n;
  const batchId = 99n;

  const nullifierHash = p2(poseidon, F, secret, nullifier);
  const commitmentHash = p4(poseidon, F, secret, aggregatedAmount, batchId, nullifier);

  const pathElements = Array(LEVELS).fill(0n);
  const pathIndices = Array(LEVELS).fill(0n);
  const merkleRoot = merkleRootFromPath(poseidon, F, commitmentHash, pathElements, pathIndices);

  const str = (x) => x.toString();
  const json = {
    nullifierHash: str(nullifierHash),
    commitmentHash: str(commitmentHash),
    merkleRoot: str(merkleRoot),
    aggregatedAmount: str(aggregatedAmount),
    batchId: str(batchId),
    secret: str(secret),
    nullifier: str(nullifier),
    pathElements: pathElements.map(str),
    pathIndices: pathIndices.map(str),
  };

  // snarkjs public signal order: template `output valid` first, then `main { public [...] }` order.
  const expectPublic = [
    "1",
    str(nullifierHash),
    str(commitmentHash),
    str(merkleRoot),
    str(aggregatedAmount),
    str(batchId),
  ];

  return { json, expectPublic };
}

async function ensurePotTau() {
  if (existsSync(PTAU_FINAL)) return;
  await snarkjsRun(["powersoftau", "new", "bn128", "14", PTAU_0, "-v"]);
  await snarkjsRun([
    "powersoftau",
    "contribute",
    PTAU_0,
    PTAU_1,
    "--name=e2e-dev",
    "-v",
    "-e=random",
  ]);
  await snarkjsRun(["powersoftau", "prepare", "phase2", PTAU_1, PTAU_FINAL, "-v"]);
}

async function ensureZkey() {
  if (existsSync(ZKEY_FINAL) && existsSync(VKEY) && !process.env.AEGIS_AGGREGATOR_FORCE_ZKEY) return;
  if (process.env.AEGIS_AGGREGATOR_FORCE_ZKEY) {
    for (const p of [ZKEY_0, ZKEY_FINAL, VKEY]) {
      if (existsSync(p)) {
        await fs.unlink(p);
      }
    }
  }
  await ensurePotTau();
  await snarkjsRun(["zkey", "new", R1CS, PTAU_FINAL, ZKEY_0, "-v"]);
  await snarkjsRun([
    "zkey",
    "contribute",
    ZKEY_0,
    ZKEY_FINAL,
    "--name=e2e-aggregator",
    "-v",
    "-e=random",
  ]);
  await snarkjsRun(["zkey", "export", "verificationkey", ZKEY_FINAL, VKEY, "-v"]);
}

function normalizePub(signals) {
  return signals.map((x) => (typeof x === "bigint" ? x.toString() : String(x)));
}

async function main() {
  const circomCmd = await ensureCircom();
  console.log("aggregator-snark-e2e: compiling circom…");
  await compileAggregator(circomCmd);

  console.log("aggregator-snark-e2e: ensuring dev ptau + zkey (first run may take ~1–3 min)…");
  await ensureZkey();

  const { json: input, expectPublic } = await aggregatorInputCase();
  const snarkjs = await import("snarkjs");

  console.log("aggregator-snark-e2e: groth16.fullProve…");
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY_FINAL);

  const got = normalizePub(publicSignals);
  if (got.length !== 6) {
    throw new Error(`expected 6 public signals (5 inputs + output valid), got ${got.length}`);
  }
  for (let i = 0; i < expectPublic.length; i++) {
    if (got[i] !== expectPublic[i]) {
      throw new Error(`publicSignals[${i}] mismatch: want ${expectPublic[i]} got ${got[i]}`);
    }
  }

  const vkeyJson = JSON.parse(await fs.readFile(VKEY, "utf8"));
  const ok = await snarkjs.groth16.verify(vkeyJson, publicSignals, proof);
  if (!ok) {
    throw new Error("groth16.verify returned false");
  }

  console.log("aggregator-snark-e2e: OK (witness + proof + verify, 6 public signals: 5 inputs + valid)");
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
