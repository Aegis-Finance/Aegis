#!/usr/bin/env node
/**
 * @file prepare-spartan.js
 *
 * Enterprise readiness helper that fetches the Spartan-ECDSA proving artifacts,
 * locks their SHA-256 fingerprints, and records them in the local artifact directory.
 *
 * The Persona Labs team explicitly recommends hosting these binaries yourself.
 * This script enforces that guidance by caching the circuit and WASM blobs inside
 * the repo (under circuits/spartan/) and verifying their digests every run.
 */

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');

const ARTIFACT_DIR = path.join(__dirname, '..', '..', 'circuits', 'spartan');

const REMOTE_FILES = [
  {
    url: 'https://storage.googleapis.com/personae-proving-keys/membership/pubkey_membership.circuit',
    filename: 'pubkey_membership.circuit',
    sha256: '7b2c79a8db6b89f975f468a60c2f1f806e8249b60e4e576a5d5424a9063b1460',
  },
  {
    url: 'https://storage.googleapis.com/personae-proving-keys/membership/pubkey_membership.wasm',
    filename: 'pubkey_membership.wasm',
    sha256: '3cc1507ceca5a2b1ad6db9ef71eef864da0265a3ef1b172fb680562285a9d25b',
  },
  {
    url: 'https://storage.googleapis.com/personae-proving-keys/membership/addr_membership.circuit',
    filename: 'addr_membership.circuit',
    sha256: '4465dfe0085ef2f0ec623538f1b1cf1fc19d7f5d602a65f45df017ce8d2edfc8',
  },
  {
    url: 'https://storage.googleapis.com/personae-proving-keys/membership/addr_membership.wasm',
    filename: 'addr_membership.wasm',
    sha256: '7be06aa9d1b620342ea4d7434eb2b3160dd90ccd78dacf4aeafab12b7a77c9f8',
  },
];

function ensureArtifactDir() {
  if (!fs.existsSync(ARTIFACT_DIR)) {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  }
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);

  return new Promise((resolve, reject) => {
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(destination);
    https
      .get(url, response => {
      if (response.statusCode !== 200) {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          const hint =
            response.statusCode === 403 &&
            body.includes('Access denied')
              ? '\nThe storage bucket rejected the request. Persona Labs\' CDN occasionally geo-restricts access; rerun this script from an allow-listed network or download the file manually and place it under circuits/spartan/.'
              : '';
          reject(
            new Error(
              `Failed to download ${url} – status ${response.statusCode}${hint}`
            )
          );
        });
        response.on('error', reject);
        return;
      }

        response.pipe(fileStream);
        fileStream.on('finish', () => fileStream.close(resolve));
        fileStream.on('error', reject);
      })
      .on('error', reject);
  });
}

async function materializeArtifact({ url, filename, sha256 }) {
  const destination = path.join(ARTIFACT_DIR, filename);

  if (!fs.existsSync(destination)) {
    console.log(`Downloading ${filename}…`);
    await downloadFile(url, destination);
  }

  const digest = await sha256File(destination);
  if (digest !== sha256) {
    throw new Error(
      `Integrity mismatch for ${filename}: expected ${sha256}, got ${digest}`
    );
  }

  console.log(`OK  ${filename} (${digest})`);
}

async function main() {
  ensureArtifactDir();

  for (const file of REMOTE_FILES) {
    await materializeArtifact(file);
  }

  console.log('\nSpartan-ECDSA artifacts ready for local consumption.');
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

