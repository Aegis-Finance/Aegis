#!/usr/bin/env node
/**
 * Generate a SHA-256 manifest for every asset in dist/.
 * Used to verify Arweave deployment integrity post-build.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DIST_DIR = path.resolve(__dirname, '../dist');
const OUTPUT_FILE = path.join(DIST_DIR, 'manifest.hash.json');

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function main() {
  if (!fs.existsSync(DIST_DIR)) {
    console.error(`[hash-dist] dist folder not found at ${DIST_DIR}. Run npm run build first.`);
    process.exit(1);
  }

  const files = walk(DIST_DIR);
  if (files.length === 0) {
    console.warn('[hash-dist] dist folder is empty, skipping manifest generation.');
    return;
  }

  const entries = files
    .map((filePath) => {
      const rel = path.relative(DIST_DIR, filePath).replace(/\\/g, '/');
      return [rel, sha256(filePath)];
    })
    .sort((a, b) => a[0].localeCompare(b[0]));

  const manifest = {
    generatedAt: new Date().toISOString(),
    files: Object.fromEntries(entries),
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(manifest, null, 2));
  console.log(`[hash-dist] wrote ${OUTPUT_FILE} with ${entries.length} entries`);
}

main();

