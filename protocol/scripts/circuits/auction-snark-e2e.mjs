#!/usr/bin/env node
/**
 * End-to-end Groth16 check for `circuits/auction.circom`:
 * compile (circom) → dev powersOfTau (cached) → zkey (cached) → fullProve → verify.
 *
 * Requires: `circom` on PATH (same as `npm run circuits:build-keys`), Node 22+.
 *
 * Run from repo `Aegis-contracts/`:
 *   npm run circuits:auction-snark-e2e
 *
 * Env:
 *   AEGIS_AUCTION_FORCE_ZKEY=1  — delete cached dev zkey/vkey and regenerate (keeps pot14_final.ptau if present).
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const CIRCUITS = path.join(ROOT, "circuits");
const OUT = path.join(ROOT, "build", "auction-e2e");
const R1CS = path.join(OUT, "auction.r1cs");
const WASM_DIR = path.join(OUT, "auction_js");
const WASM = path.join(WASM_DIR, "auction.wasm");
const PTAU_0 = path.join(OUT, "pot14_0000.ptau");
const PTAU_1 = path.join(OUT, "pot14_0001.ptau");
const PTAU_FINAL = path.join(OUT, "pot14_final.ptau");
const ZKEY_0 = path.join(OUT, "auction_0000.zkey");
const ZKEY_FINAL = path.join(OUT, "auction_dev.zkey");
const VKEY = path.join(OUT, "auction_vkey.json");

const WAD = 10n ** 18n;

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

async function compileAuction(circomCmd) {
  await fs.mkdir(OUT, { recursive: true });
  await run(
    circomCmd,
    ["auction.circom", "--r1cs", "--wasm", "-l", path.join(ROOT, "node_modules"), "-o", OUT],
    CIRCUITS
  );
  if (!existsSync(WASM)) {
    throw new Error(`Expected wasm at ${WASM}`);
  }
}

function auctionInputCase() {
  const startPrice = 10_000n;
  const reservePrice = 1_000n;
  const startTime = 1_700_000_000n;
  const duration = 100n;
  const currentTime = startTime + 50n;
  const endTime = startTime + duration;
  const delta = startPrice - reservePrice;
  const elapsed = currentTime - startTime;
  const priceDecay = (delta * elapsed) / duration;
  const calculatedPrice = startPrice - priceDecay;
  const priceDecayRate = (delta * WAD) / duration;
  const bidAmount = calculatedPrice;
  const maxPrice = calculatedPrice + 100n;

  return {
    json: {
      startPrice: startPrice.toString(),
      reservePrice: reservePrice.toString(),
      startTime: startTime.toString(),
      duration: duration.toString(),
      currentTime: currentTime.toString(),
      priceDecayRate: priceDecayRate.toString(),
      bidAmount: bidAmount.toString(),
      maxPrice: maxPrice.toString(),
    },
    expectPublic: [
      startPrice.toString(),
      reservePrice.toString(),
      startTime.toString(),
      duration.toString(),
      currentTime.toString(),
      priceDecayRate.toString(),
    ],
    endTime,
  };
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
  if (existsSync(ZKEY_FINAL) && existsSync(VKEY) && !process.env.AEGIS_AUCTION_FORCE_ZKEY) return;
  if (process.env.AEGIS_AUCTION_FORCE_ZKEY) {
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
    "--name=e2e-auction",
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
  console.log("auction-snark-e2e: compiling circom…");
  await compileAuction(circomCmd);

  console.log("auction-snark-e2e: ensuring dev ptau + zkey (first run may take ~1–3 min)…");
  await ensureZkey();

  const { json: input, expectPublic } = auctionInputCase();
  const snarkjs = await import("snarkjs");

  console.log("auction-snark-e2e: groth16.fullProve…");
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY_FINAL);

  const got = normalizePub(publicSignals);
  if (got.length !== 6) {
    throw new Error(`expected 6 public signals, got ${got.length}`);
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

  console.log("auction-snark-e2e: OK (witness + proof + verify, 6 public signals)");
}

main()
  .then(() => {
    // snarkjs / wasm witness stack can leave handles open; explicit exit so the shell returns.
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
