#!/usr/bin/env node
const { execFile } = require("child_process");
const fs = require("fs/promises");
const path = require("path");

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd: cwd || process.cwd() }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err && err.message));
      resolve();
    });
  });
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

function getCircomCmd() {
  const localWin = path.resolve("circom.exe");
  const localUnix = path.resolve("circom");
  return require("fs").existsSync(localWin)
    ? localWin
    : (require("fs").existsSync(localUnix) ? localUnix : "circom");
}

async function buildCircuit(name) {
  const outDir = path.resolve("build", name);
  await ensureDir(outDir);
  const circomFile = path.resolve("circuits", `${name}.circom`);
  const circomCmd = getCircomCmd();
  await run(circomCmd, [circomFile, "--r1cs", "--wasm", "--sym", "-l", "node_modules", "-o", outDir]);
  return {
    r1cs: path.join(outDir, `${name}.r1cs`),
    wasm: path.join(outDir, `${name}.wasm`)
  };
}

async function setupPowersOfTau() {
  const buildDir = path.resolve("build");
  await ensureDir(buildDir);
  const pot0 = path.join(buildDir, "pot14_0000.ptau");
  const pot1 = path.join(buildDir, "pot14_0001.ptau");
  const potFinal = path.join(buildDir, "pot14_final.ptau");
  await run(process.platform === "win32" ? "npx.cmd" : "npx", ["snarkjs", "powersoftau", "new", "bn128", "14", pot0, "-v"]);
  await run(process.platform === "win32" ? "npx.cmd" : "npx", ["snarkjs", "powersoftau", "contribute", pot0, pot1, "--name=contrib-1", "-v", "-e=random"]);
  await run(process.platform === "win32" ? "npx.cmd" : "npx", ["snarkjs", "powersoftau", "prepare", "phase2", pot1, potFinal, "-v"]);
  return potFinal;
}

async function zkeyPipeline(r1csPath, potFinal, basename) {
  const buildDir = path.resolve("build");
  const z0 = path.join(buildDir, `${basename}_0000.zkey`);
  const z1 = path.join(buildDir, `${basename}_0001.zkey`);
  const vkey = path.join(buildDir, `${basename}_verification_key.json`);
  await run(process.platform === "win32" ? "npx.cmd" : "npx", ["snarkjs", "zkey", "new", r1csPath, potFinal, z0]);
  await run(process.platform === "win32" ? "npx.cmd" : "npx", ["snarkjs", "zkey", "contribute", z0, z1, "--name=Key Contributor", "-v", "-e=random"]);
  await run(process.platform === "win32" ? "npx.cmd" : "npx", ["snarkjs", "zkey", "export", "verificationkey", z1, vkey]);
  return { zkey: z1, vkey };
}

async function main() {
  const claim = await buildCircuit("auction-claim");
  const sybil = await buildCircuit("sybil-protection");

  const potFinal = await setupPowersOfTau();

  const claimKeys = await zkeyPipeline(claim.r1cs, potFinal, "auction-claim");
  const sybilKeys = await zkeyPipeline(sybil.r1cs, potFinal, "sybil-protection");

  // Never hardcode machine paths. Use AEGIS_SECRETS_DIR or repo-local `.secrets/` (gitignored).
  const secretsDir = process.env.AEGIS_SECRETS_DIR
    ? path.resolve(process.env.AEGIS_SECRETS_DIR)
    : path.resolve(process.cwd(), ".secrets");
  try {
    await ensureDir(secretsDir);
  } catch (e) {
    console.warn("Could not create secrets directory:", secretsDir, e?.message ?? e);
  }

  const claimZ = path.join(secretsDir, "auction-claim_final.zkey");
  const claimV = path.join(secretsDir, "auction-claim_verification_key.json");
  const sybilZ = path.join(secretsDir, "sybil-protection_final.zkey");
  const sybilV = path.join(secretsDir, "sybil-protection_verification_key.json");

  await fs.copyFile(claimKeys.zkey, claimZ);
  await fs.copyFile(path.resolve("build", "auction-claim_verification_key.json"), claimV);
  await fs.copyFile(sybilKeys.zkey, sybilZ);
  await fs.copyFile(path.resolve("build", "sybil-protection_verification_key.json"), sybilV);

  console.log(JSON.stringify({
    auctionClaimZkey: claimZ,
    auctionClaimVkey: claimV,
    sybilZkey: sybilZ,
    sybilVkey: sybilV
  }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});