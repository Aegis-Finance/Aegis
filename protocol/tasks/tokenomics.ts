import fs from "fs";
import path from "path";
import { task, types } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";
import type { TokenomicsScenarioDefinition } from "../scripts/tokenomics/fork-rehearsal";

const resolveForkingConfig = (forkUrl?: string, forkBlock?: number, networkForking?: any) => {
  if (forkUrl) {
    return {
      jsonRpcUrl: forkUrl,
      blockNumber: forkBlock ?? undefined
    };
  }
  if (networkForking && (networkForking.url || networkForking.jsonRpcUrl)) {
    return {
      jsonRpcUrl: networkForking.url ?? networkForking.jsonRpcUrl,
      blockNumber: networkForking.blockNumber ?? undefined
    };
  }
  return undefined;
};

task("tokenomics:fork-rehearsal", "Run the integrated tokenomics fork rehearsal workflow")
  .addOptionalParam(
    "output",
    "Path to write the rehearsal summary JSON",
    path.resolve("build", "reports", "tokenomics-fork-rehearsal.json")
  )
  .addOptionalParam("forkUrl", "Optional RPC endpoint to fork from before running the rehearsal")
  .addOptionalParam("forkBlock", "Optional block number for the forked RPC endpoint", undefined, types.int)
  .addOptionalParam("scenarioConfig", "Path to a JSON file describing stress-test scenarios")
  .addOptionalParam("bridgeTargets", "Path to a JSON file describing bridge target chains")
  .addOptionalParam(
    "riskLedger",
    "Path to append the governance risk ledger entry",
    path.resolve("build", "ledger", "governance-risk-ledger.json")
  )
  .addFlag("quiet", "Suppress console output during rehearsal execution")
  .setAction(async (taskArgs: TaskArguments, hre) => {
    const { runTokenomicsForkRehearsal } = await import("../scripts/tokenomics/fork-rehearsal");
    const { output, quiet, forkUrl, forkBlock, scenarioConfig, bridgeTargets, riskLedger } = taskArgs as {
      output: string;
      quiet: boolean;
      forkUrl?: string;
      forkBlock?: number;
      scenarioConfig?: string;
      bridgeTargets?: string;
      riskLedger: string;
    };

    if (forkUrl) {
      await hre.network.provider.request({
        method: "hardhat_reset",
        params: [
          {
            forking: {
              jsonRpcUrl: forkUrl,
              blockNumber: forkBlock ?? undefined
            }
          }
        ]
      });
      if (!quiet) {
        console.log(
          `[tokenomics:fork-rehearsal] Forked hardhat network from ${forkUrl}${
            forkBlock ? ` @ block ${forkBlock}` : ""
          }`
        );
      }
    }

    const resolvedOutput = path.resolve(output);
    const resolvedRiskLedger = path.resolve(riskLedger);
    const resolvedScenariosPath = scenarioConfig ? path.resolve(scenarioConfig) : undefined;
    const resolvedBridgeTargetsPath = bridgeTargets ? path.resolve(bridgeTargets) : undefined;
    let parsedScenarios: TokenomicsScenarioDefinition[] | undefined;
    if (resolvedScenariosPath) {
      const raw = JSON.parse(fs.readFileSync(resolvedScenariosPath, "utf8"));
      if (!Array.isArray(raw)) {
        throw new Error("Scenario config must be a JSON array of scenario definitions");
      }
      parsedScenarios = raw as TokenomicsScenarioDefinition[];
    }

    const forkingConfig = resolveForkingConfig(
      forkUrl,
      forkBlock,
      (hre.network.config as any).forking
    );

    const summary = await runTokenomicsForkRehearsal({
      outputPath: resolvedOutput,
      quiet,
      forking: forkingConfig,
      scenarios: parsedScenarios,
      riskLedgerPath: resolvedRiskLedger,
      bridgeTargetsPath: resolvedBridgeTargetsPath
    });

    if (quiet) {
      console.log(JSON.stringify(summary));
    } else {
      console.log(`[tokenomics:fork-rehearsal] Summary saved to ${resolvedOutput}`);
    }
  });

