/**
 * Copy built Groth16 wasm + `*_final.zkey` from `Aegis-contracts/build/circuits/`
 * into `frontend/public/circuits/<dir>/` using the same path rules as
 * `Aegis-contracts/scripts/utils/resolve-groth16-artifacts.js`.
 *
 * Run from `frontend/` after building circuits in `Aegis-contracts/`:
 *   npm run copy-circuits
 *
 * Env:
 *   AEGIS_CONTRACTS_ROOT — override path to `Aegis-contracts` (default: monorepo sibling of `frontend/`).
 *   COPY_CIRCUITS_FILTER — substring filter on `circuitType` (e.g. `lending-` to only copy split lending).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const contractsRoot =
  process.env.AEGIS_CONTRACTS_ROOT?.trim() ||
  path.resolve(__dirname, '..', '..', 'Aegis-contracts');

const { VERIFIER_FACTORY_CIRCUIT_BUILD_SPECS, resolveGroth16ArtifactPaths } = require(
  path.join(contractsRoot, 'scripts', 'utils', 'resolve-groth16-artifacts.js'),
);

const DEST_BASE = path.resolve(__dirname, '..', 'public', 'circuits');
const SRC_BASE = path.join(contractsRoot, 'build', 'circuits');
const filterSub = (process.env.COPY_CIRCUITS_FILTER || '').trim();

async function copyFile(src, dest) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
}

async function writeBundleIndex() {
  const circuits = {};
  let entries;
  try {
    entries = await fs.readdir(DEST_BASE, { withFileTypes: true });
  } catch {
    entries = [];
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(DEST_BASE, ent.name);
    const files = await fs.readdir(dir);
    const wasm = files.find((f) => f.endsWith('.wasm'));
    const zkey = files.find((f) => f.endsWith('_final.zkey'));
    if (!wasm || !zkey) continue;
    circuits[ent.name] = {
      wasm: `/circuits/${ent.name}/${wasm}`,
      zkey: `/circuits/${ent.name}/${zkey}`,
    };
  }
  const payload =
    JSON.stringify({ generatedAt: new Date().toISOString(), circuits }, null, 2) + '\n';
  const indexPaths = [
    path.resolve(__dirname, '..', 'public', 'config', 'circuit-bundle-index.json'),
    path.resolve(__dirname, '..', 'src', 'config', 'circuit-bundle-index.json'),
  ];
  for (const indexPath of indexPaths) {
    await fs.mkdir(path.dirname(indexPath), { recursive: true });
    await fs.writeFile(indexPath, payload);
    console.log(
      `[copy-circuits] wrote ${path.relative(path.resolve(__dirname, '..'), indexPath)} (${Object.keys(circuits).length} entries)`,
    );
  }
}

async function main() {
  let n = 0;
  for (const spec of VERIFIER_FACTORY_CIRCUIT_BUILD_SPECS) {
    if (filterSub && !spec.circuitType.includes(filterSub)) continue;
    const resolved = resolveGroth16ArtifactPaths(
      SRC_BASE,
      spec.dir,
      spec.wasmBase,
      spec.alternateDirs || [],
    );
    if (!resolved) {
      console.log(`[copy-circuits] skip ${spec.circuitType} — no wasm+zkey under ${path.join('build', 'circuits', spec.dir)}`);
      continue;
    }
    const destDir = path.join(DEST_BASE, spec.dir);
    const wasmDest = path.join(destDir, `${spec.wasmBase}.wasm`);
    const zkeyDest = path.join(destDir, `${spec.wasmBase}_final.zkey`);
    await copyFile(resolved.wasmSrc, wasmDest);
    await copyFile(resolved.zkeySrc, zkeyDest);
    console.log(`[copy-circuits] ${spec.circuitType} → ${path.relative(path.resolve(__dirname, '..'), wasmDest)}`);
    n += 1;
  }
  await writeBundleIndex();
  console.log(`[copy-circuits] done (${n} circuit(s)). AEGIS_CONTRACTS_ROOT=${contractsRoot}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
