/**
 * Run Slither on `contracts/` via Hardhat (see `.slither.config.json`), then gate on High findings.
 * Usage from protocol/: node scripts/security/slither-gate.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const reportPath = path.join(root, 'slither-report.json');

function pythonBinary() {
  if (process.platform === 'win32') return 'python';
  const r = spawnSync('which', ['python3'], { encoding: 'utf8' });
  if (r.status === 0 && r.stdout?.trim()) return 'python3';
  return 'python';
}

const sh = (cmd, extraEnv = {}) => {
  const r = spawnSync(cmd, {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...extraEnv }
  });
  return r.status ?? 1;
};

console.log('>>> Slither scan (Slither may exit non-zero when it reports issues)…');
sh('npm run audit:slither:scan');

if (!fs.existsSync(reportPath)) {
  console.error('Missing slither-report.json after scan.');
  process.exit(2);
}

const py = pythonBinary();
console.log(`>>> Summarize with SLITHER_FAIL_ON_HIGH=1 (${py})…`);
const code = sh(`${py} analyze_slither.py`, { SLITHER_FAIL_ON_HIGH: '1' });
process.exit(code === 0 ? 0 : code);
