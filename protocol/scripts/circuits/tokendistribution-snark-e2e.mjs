#!/usr/bin/env node
/**
 * Dev Groth16 smoke for `circuits/tokendistribution.circom` (8 public signals).
 * Run from `Aegis-contracts/`: `npm run circuits:tokendistribution-snark-e2e`
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
const OUT = path.join(ROOT, "build", "tokendistribution-e2e");
const NAME = "tokendistribution";
const R1CS = path.join(OUT, `${NAME}.r1cs`);
const WASM_DIR = path.join(OUT, `${NAME}_js`);
const WASM = path.join(WASM_DIR, `${NAME}.wasm`);
const PTAU_0 = path.join(OUT, "pot14_0000.ptau");
const PTAU_1 = path.join(OUT, "pot14_0001.ptau");
const PTAU_FINAL = path.join(OUT, "pot14_final.ptau");
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
      if (err) reject(new Error(`${stderr || ""}\n${err.message}`));
      else resolve(stdout);
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
    throw new Error("circom not found (PATH or ./circom.exe).");
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
  if (!existsSync(WASM)) throw new Error(`Expected wasm at ${WASM}`);
}

async function ensurePotTau() {
  if (existsSync(PTAU_FINAL)) return;
  await snarkjsRun(["powersoftau", "new", "bn128", "14", PTAU_0, "-v"]);
  await snarkjsRun(["powersoftau", "contribute", PTAU_0, PTAU_1, "--name=e2e-td", "-v", "-e=random"]);
  await snarkjsRun(["powersoftau", "prepare", "phase2", PTAU_1, PTAU_FINAL, "-v"]);
}

async function ensureZkey() {
  if (existsSync(ZKEY_FINAL) && existsSync(VKEY) && !process.env.AEGIS_TD_FORCE_ZKEY) return;
  if (process.env.AEGIS_TD_FORCE_ZKEY) {
    for (const p of [ZKEY_0, ZKEY_FINAL, VKEY]) {
      if (existsSync(p)) await fs.unlink(p);
    }
  }
  await ensurePotTau();
  await snarkjsRun(["zkey", "new", R1CS, PTAU_FINAL, ZKEY_0, "-v"]);
  await snarkjsRun(["zkey", "contribute", ZKEY_0, ZKEY_FINAL, "--name=e2e-td", "-v", "-e=random"]);
  await snarkjsRun(["zkey", "export", "verificationkey", ZKEY_FINAL, VKEY, "-v"]);
}

/** Poseidon Merkle root (depth 20), matching `Selector` + `Poseidon(2)` in `tokendistribution.circom`. */
function merkleRoot20(F, poseidon, leafFe, pathElements, pathIndices) {
  let cur = leafFe;
  for (let i = 0; i < 20; i++) {
    const sib = F.e(BigInt(pathElements[i]));
    const idx = BigInt(pathIndices[i]);
    const left = idx === 0n ? cur : sib;
    const right = idx === 0n ? sib : cur;
    cur = poseidon([left, right]);
  }
  return F.toObject(cur).toString();
}

function normalizePub(signals) {
  return signals.map((x) => (typeof x === "bigint" ? x.toString() : String(x)));
}

async function main() {
  const circomCmd = await ensureCircom();
  console.log("tokendistribution-snark-e2e: compiling…");
  await compileCircuit(circomCmd);
  console.log("tokendistribution-snark-e2e: ptau + zkey…");
  await ensureZkey();

  const poseidon = await buildPoseidon();
  const F = poseidon.F;

  const buyerSecret = 333n;
  const buyerNonce = 444n;
  const purchaseAmount = 1000n;
  const purchaseNonce = 555n;
  const previousPurchases = 0n;
  const pathElements = Array(20).fill("0");
  const pathIndices = Array(20).fill("0");

  const leafFe = poseidon([F.e(buyerSecret), F.e(buyerNonce)]);
  const merkleRoot = merkleRoot20(F, poseidon, leafFe, pathElements, pathIndices);

  const comH = poseidon([F.e(buyerSecret), F.e(purchaseAmount), F.e(purchaseNonce), F.e(BigInt(merkleRoot))]);
  const commitment = F.toObject(comH).toString();

  const nulH = poseidon([F.e(buyerSecret), F.e(purchaseNonce), F.e(BigInt(merkleRoot))]);
  const nullifier = F.toObject(nulH).toString();

  const auctionPrice = (10n ** 18n).toString();
  const maxPurchaseLimit = (5000n).toString();
  const totalSupplyRemaining = (1_000_000n).toString();
  const valid = "1";

  const input = {
    buyerSecret: buyerSecret.toString(),
    buyerNonce: buyerNonce.toString(),
    purchaseAmount: purchaseAmount.toString(),
    purchaseNonce: purchaseNonce.toString(),
    previousPurchases: previousPurchases.toString(),
    pathElements: pathElements,
    pathIndices: pathIndices,
    valid,
    commitment,
    nullifier,
    auctionPrice,
    maxPurchaseLimit,
    totalSupplyRemaining,
    merkleRoot,
  };

  const expectPublic = [
    valid,
    commitment,
    nullifier,
    auctionPrice,
    maxPurchaseLimit,
    totalSupplyRemaining,
    merkleRoot,
    purchaseAmount.toString(),
  ];

  const snarkjs = await import("snarkjs");
  console.log("tokendistribution-snark-e2e: fullProve…");
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY_FINAL);

  const got = normalizePub(publicSignals);
  if (got.length !== 8) throw new Error(`expected 8 public signals, got ${got.length}`);
  for (let i = 0; i < 8; i++) {
    if (got[i] !== expectPublic[i]) {
      throw new Error(`publicSignals[${i}] mismatch: want ${expectPublic[i]} got ${got[i]}`);
    }
  }

  const vkeyJson = JSON.parse(await fs.readFile(VKEY, "utf8"));
  const ok = await snarkjs.groth16.verify(vkeyJson, publicSignals, proof);
  if (!ok) throw new Error("groth16.verify returned false");

  console.log("tokendistribution-snark-e2e: OK (8 public signals)");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
