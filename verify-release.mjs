#!/usr/bin/env node
/**
 * Verify CHECKSUMS.sha256 + CHECKSUMS.sha256.sig for this repository (standalone).
 * Run from repo root: node verify-release.mjs
 */
import { createHash, createPublicKey, verify } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, posix } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(ROOT, "CHECKSUMS.sha256");
const SIG = join(ROOT, "CHECKSUMS.sha256.sig");
const PUBKEY = join(ROOT, "RELEASE_SIGNING_KEY.pem");

const SKIP_DIRS = new Set(["node_modules", ".git", "playwright-report", "test-results"]);
const MANIFEST_SKIP = new Set(["CHECKSUMS.sha256", "CHECKSUMS.sha256.sig"]);

function rel(p) {
  return posix.normalize(relative(ROOT, p).replace(/\\/g, "/"));
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const r = rel(p);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (!MANIFEST_SKIP.has(r)) out.push(p);
  }
  return out;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function parseSignatureB64(sigFileText) {
  const lines = sigFileText.split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^[A-Za-z0-9+/]+=*$/.test(lines[i])) return lines[i];
  }
  return null;
}

function main() {
  const manifest = readFileSync(MANIFEST);
  const sigText = readFileSync(SIG, "utf8");
  const b64 = parseSignatureB64(sigText);
  if (!b64) {
    console.error("Invalid signature file");
    process.exit(1);
  }
  const key = createPublicKey(readFileSync(PUBKEY, "utf8"));
  if (!verify(null, manifest, key, Buffer.from(b64, "base64"))) {
    console.error("Signature FAILED");
    process.exit(1);
  }
  console.log("Signature OK");

  const expected = new Map();
  for (const line of manifest.toString("utf8").split("\n")) {
    if (!line.trim()) continue;
    const m = /^([a-f0-9]{64})\s{2}(.+)$/.exec(line);
    if (m) expected.set(m[2], m[1]);
  }
  let bad = 0;
  for (const [r, h] of expected) {
    const p = join(ROOT, r);
    if (!existsSync(p) || sha256(p) !== h) {
      console.error("FAIL", r);
      bad++;
    }
  }
  const onDisk = new Set(walk(ROOT).map(rel));
  for (const r of onDisk) {
    if (!expected.has(r)) {
      console.error("EXTRA (not in manifest)", r);
      bad++;
    }
  }
  if (bad) process.exit(1);
  console.log(`Verified ${expected.size} files.`);
}

main();
