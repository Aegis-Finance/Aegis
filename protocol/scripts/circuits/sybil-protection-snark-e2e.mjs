#!/usr/bin/env node
/**
 * End-to-end Groth16 check for `circuits/sybil-protection.circom`:
 * compile → dev ptau (cached) → zkey (cached) → fullProve → verify.
 *
 * Public signal order must match `TimeLockPurchaseLimits.sol` (4 signals).
 *
 * Run from `Aegis-contracts/`:
 *   npm run circuits:sybil-snark-e2e
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
const OUT = path.join(ROOT, "build", "sybil-protection-e2e");
const NAME = "sybil-protection";
const R1CS = path.join(OUT, `${NAME}.r1cs`);
const WASM_DIR = path.join(OUT, `${NAME}_js`);
const WASM = path.join(WASM_DIR, `${NAME}.wasm`);
const PTAU_0 = path.join(OUT, "pot12_0000.ptau");
const PTAU_1 = path.join(OUT, "pot12_0001.ptau");
const PTAU_FINAL = path.join(OUT, "pot12_final.ptau");
const ZKEY_0 = path.join(OUT, `${NAME}_0000.zkey`);
const ZKEY_FINAL = path.join(OUT, `${NAME}_dev.zkey`);
const VKEY = path.join(OUT, `${NAME}_vkey.json`);

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

async function compileCircuit(circomCmd) {
  await fs.mkdir(OUT, { recursive: true });
  await run(
    circomCmd,
    [`${NAME}.circom`, "--r1cs", "--wasm", "-l", path.join(ROOT, "node_modules"), "-o", OUT],
    CIRCUITS
  );
  if (!existsSync(WASM)) {
    throw new Error(`Expected wasm at ${WASM}`);
  }
}

async function ensurePotTau() {
  if (existsSync(PTAU_FINAL)) return;
  await snarkjsRun(["powersoftau", "new", "bn128", "12", PTAU_0, "-v"]);
  await snarkjsRun([
    "powersoftau",
    "contribute",
    PTAU_0,
    PTAU_1,
    "--name=e2e-sybil",
    "-v",
    "-e=random",
  ]);
  await snarkjsRun(["powersoftau", "prepare", "phase2", PTAU_1, PTAU_FINAL, "-v"]);
}

async function ensureZkey() {
  if (existsSync(ZKEY_FINAL) && existsSync(VKEY) && !process.env.AEGIS_SYBIL_FORCE_ZKEY) return;
  if (process.env.AEGIS_SYBIL_FORCE_ZKEY) {
    for (const p of [ZKEY_0, ZKEY_FINAL, VKEY]) {
      if (existsSync(p)) await fs.unlink(p);
    }
  }
  await ensurePotTau();
  await snarkjsRun(["zkey", "new", R1CS, PTAU_FINAL, ZKEY_0, "-v"]);
  await snarkjsRun([
    "zkey",
    "contribute",
    ZKEY_0,
    ZKEY_FINAL,
    "--name=e2e-sybil",
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
  console.log("sybil-protection-snark-e2e: compiling circom…");
  await compileCircuit(circomCmd);

  console.log("sybil-protection-snark-e2e: ensuring dev ptau + zkey…");
  await ensureZkey();

  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const identitySecret = 42n;
  const purchaseNonce = 99n;
  const buyerAddress = BigInt("0x1111111111111111111111111111111111111111");
  const purchaseAmount = 10n ** 18n;

  const nullifierHash = poseidon([identitySecret, purchaseNonce]);
  const commitmentHash = poseidon([identitySecret, buyerAddress, purchaseAmount, purchaseNonce]);

  const identityNullifier = F.toObject(nullifierHash).toString();
  const identityCommitment = F.toObject(commitmentHash).toString();

  const input = {
    identitySecret: identitySecret.toString(),
    purchaseNonce: purchaseNonce.toString(),
    identityCommitment,
    identityNullifier,
    buyerAddress: buyerAddress.toString(),
    purchaseAmount: purchaseAmount.toString(),
  };

  const expectPublic = [identityCommitment, identityNullifier, buyerAddress.toString(), purchaseAmount.toString()];

  const snarkjs = await import("snarkjs");
  console.log("sybil-protection-snark-e2e: groth16.fullProve…");
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY_FINAL);

  const got = normalizePub(publicSignals);
  if (got.length !== 4) {
    throw new Error(`expected 4 public signals, got ${got.length}`);
  }
  for (let i = 0; i < 4; i++) {
    if (got[i] !== expectPublic[i]) {
      throw new Error(`publicSignals[${i}] mismatch: want ${expectPublic[i]} got ${got[i]}`);
    }
  }

  const vkeyJson = JSON.parse(await fs.readFile(VKEY, "utf8"));
  const ok = await snarkjs.groth16.verify(vkeyJson, publicSignals, proof);
  if (!ok) {
    throw new Error("groth16.verify returned false");
  }

  console.log("sybil-protection-snark-e2e: OK (4 public signals, matches TimeLockPurchaseLimits)");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
