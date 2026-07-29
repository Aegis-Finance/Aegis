/**
 * Runs the fast-check property suite against current `contracts/` (see test/property/).
 * Prefer: npm run test:fuzz
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const runs = process.env.FUZZ_RUNS ?? "60";

const result = spawnSync(
  "npx",
  ["hardhat", "test", "test/property/all.property.ts", "--grep", "property"],
  {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, FUZZ_RUNS: runs },
  }
);

process.exit(result.status === null ? 1 : result.status);
