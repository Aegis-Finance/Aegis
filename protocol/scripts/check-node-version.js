#!/usr/bin/env node
/**
 * Enforces `engines.node` from the nearest package.json (Aegis-contracts root).
 * Supports semver-style minimums such as ">=22.13.0" (not only major).
 * Set SKIP_NODE_VERSION_CHECK=1 to bypass (CI/legacy environments).
 */
const fs = require('fs');
const path = require('path');

if (process.env.SKIP_NODE_VERSION_CHECK === '1' || process.env.SKIP_NODE_VERSION_CHECK === 'true') {
  process.exit(0);
}

const pkgPath = path.resolve(__dirname, '..', 'package.json');
let enginesNode = '>=22.13.0';
try {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (pkg.engines && pkg.engines.node) enginesNode = pkg.engines.node;
} catch {
  console.warn('[check-node-version] Could not read package.json; skipping check.');
  process.exit(0);
}

/** Parse ">=22.13.0", "^22.0.0", "22.12.1", "22" into { major, minor, patch } */
function parseMinVersion(spec) {
  const s = String(spec).trim().replace(/^(>=|\^|~)\s*/, '');
  const parts = s.split('.').map((p) => parseInt(String(p).replace(/[^\d].*$/, ''), 10));
  const major = Number.isFinite(parts[0]) ? parts[0] : 0;
  const minor = Number.isFinite(parts[1]) ? parts[1] : 0;
  const patch = Number.isFinite(parts[2]) ? parts[2] : 0;
  return { major, minor, patch };
}

function parseCurrent() {
  const parts = process.versions.node.split('.').map((p) => parseInt(p, 10));
  return {
    major: parts[0] || 0,
    minor: parts[1] || 0,
    patch: parts[2] || 0,
  };
}

function lessThan(a, b) {
  if (a.major !== b.major) return a.major < b.major;
  if (a.minor !== b.minor) return a.minor < b.minor;
  return a.patch < b.patch;
}

const required = parseMinVersion(enginesNode);
const current = parseCurrent();

if (lessThan(current, required)) {
  console.error(
    `[check-node-version] Node ${process.versions.node} is too old. This package requires ${enginesNode} (minimum ${required.major}.${required.minor}.${required.patch}).`
  );
  console.error('[check-node-version] Upgrade Node (e.g. nvm install 22.13 && nvm use), or set SKIP_NODE_VERSION_CHECK=1 to bypass (not recommended).');
  process.exit(1);
}

process.exit(0);
