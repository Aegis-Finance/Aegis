#!/usr/bin/env node
/**
 * End-to-end Groth16 check for `circuits/private-amm.circom` (aligned with `PrivateAMMContract`).
 * compile → dev ptau/zkey (cached under `build/private-amm-e2e/`) → fullProve → verify.
 *
 * Public signal order (snarkjs): `[valid, op, s1, ..., s8]` — **10** values (`valid` output first).
 *
 * Requires: `circom` on PATH, Node 22+.
 *
 * Run: `npm run circuits:private-amm-snark-e2e` from `Aegis-contracts/`.
 *
 * Env: `AEGIS_PRIVATE_AMM_FORCE_ZKEY=1` — regenerate cached dev zkey/vkey (dev ptau is **pot13**; v2 circuit ~4k constraints).
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const CIRCUITS = path.join(ROOT, "circuits");
const OUT = path.join(ROOT, "build", "private-amm-e2e");
const R1CS = path.join(OUT, "private-amm.r1cs");
const WASM_DIR = path.join(OUT, "private-amm_js");
const WASM = path.join(WASM_DIR, "private-amm.wasm");
// pot13: private-amm v2 exceeds bn128 pot12 domain after adding per-op comparators (~4k+ constraints).
const PTAU_0 = path.join(OUT, "pot13_0000.ptau");
const PTAU_1 = path.join(OUT, "pot13_0001.ptau");
const PTAU_FINAL = path.join(OUT, "pot13_final.ptau");
const ZKEY_0 = path.join(OUT, "private-amm_0000.zkey");
const ZKEY_FINAL = path.join(OUT, "private-amm_dev.zkey");
const VKEY = path.join(OUT, "private-amm_vkey.json");

const AMM_ZK_VALID = 1n;
const OP_CREATE = 1n;
const OP_ADD = 2n;
const OP_SWAP = 3n;
const OP_REMOVE = 4n;

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
    ["private-amm.circom", "--r1cs", "--wasm", "-l", path.join(ROOT, "node_modules"), "-o", OUT],
    CIRCUITS
  );
  if (!existsSync(WASM)) {
    throw new Error(`Expected wasm at ${WASM}`);
  }
}

function str(x) {
  return typeof x === "bigint" ? x.toString() : String(x);
}

/** @returns {{ input: Record<string, string>, expectPublic: string[] }} */
function caseForOp(op) {
  const z = 0n;
  const mk = (s1, s2, s3, s4, s5, s6, s7, s8) => ({
    input: {
      op: str(op),
      s1: str(s1),
      s2: str(s2),
      s3: str(s3),
      s4: str(s4),
      s5: str(s5),
      s6: str(s6),
      s7: str(s7),
      s8: str(s8),
    },
    expectPublic: [str(AMM_ZK_VALID), str(op), str(s1), str(s2), str(s3), str(s4), str(s5), str(s6), str(s7), str(s8)],
  });

  if (op === OP_CREATE) {
    return mk(11n, 22n, 33n, 44n, 1000n, 2000n, z, z);
  }
  if (op === OP_ADD) {
    return mk(1n, 2n, 3n, 4n, 1500n, 1600n, 10n, 1_800_000_000n);
  }
  if (op === OP_SWAP) {
    return mk(9n, 8n, 1500n, 1n, 1n, 1_900_000_000n, z, z);
  }
  if (op === OP_REMOVE) {
    return mk(5n, 6n, 7n, 1500n, 1n, 2n, z, z);
  }
  throw new Error(`unknown op ${op}`);
}

async function ensurePotTau() {
  if (existsSync(PTAU_FINAL)) return;
  await snarkjsRun(["powersoftau", "new", "bn128", "13", PTAU_0, "-v"]);
  await snarkjsRun([
    "powersoftau",
    "contribute",
    PTAU_0,
    PTAU_1,
    "--name=e2e-dev-private-amm",
    "-v",
    "-e=random",
  ]);
  await snarkjsRun(["powersoftau", "prepare", "phase2", PTAU_1, PTAU_FINAL, "-v"]);
}

async function ensureZkey() {
  if (existsSync(ZKEY_FINAL) && existsSync(VKEY) && !process.env.AEGIS_PRIVATE_AMM_FORCE_ZKEY) return;
  if (process.env.AEGIS_PRIVATE_AMM_FORCE_ZKEY) {
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
    "--name=e2e-private-amm",
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
  console.log("private-amm-snark-e2e: compiling circom…");
  await compileCircuit(circomCmd);

  console.log("private-amm-snark-e2e: ensuring dev ptau + zkey…");
  await ensureZkey();

  const snarkjs = await import("snarkjs");
  const vkeyJson = JSON.parse(await fs.readFile(VKEY, "utf8"));

  for (const op of [OP_CREATE, OP_ADD, OP_SWAP, OP_REMOVE]) {
    const { input, expectPublic } = caseForOp(op);
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY_FINAL);
    const got = normalizePub(publicSignals);
    if (got.length !== 10) {
      throw new Error(`op=${op}: expected 10 public signals, got ${got.length}`);
    }
    for (let i = 0; i < expectPublic.length; i++) {
      if (got[i] !== expectPublic[i]) {
        throw new Error(`op=${op}: publicSignals[${i}] want ${expectPublic[i]} got ${got[i]}`);
      }
    }
    const ok = await snarkjs.groth16.verify(vkeyJson, publicSignals, proof);
    if (!ok) {
      throw new Error(`op=${op}: groth16.verify returned false`);
    }
    console.log(`private-amm-snark-e2e: OK op=${op}`);
  }

  console.log("private-amm-snark-e2e: all ops passed (10 public signals each)");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
