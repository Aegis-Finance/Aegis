import fs from "fs/promises";
import path from "path";

export interface LocalGovernanceDeployment {
  verifierFactory: string;
  privateGovernance: string;
  privateToken: string;
}

/**
 * Reads the latest local governance deployment from deployments/local/
 * @returns Local governance deployment addresses
 */
export async function getLocalGovernanceDeployment(): Promise<LocalGovernanceDeployment> {
  const deploymentsDir = path.resolve("deployments", "local");
  
  try {
    const files = await fs.readdir(deploymentsDir);
    
    // Look for local-zk-setup files (most recent)
    const setupFiles = files
      .filter(f => f.startsWith("local-zk-setup-") && f.endsWith(".json"))
      .sort()
      .reverse();
    
    if (setupFiles.length > 0) {
      const latestSetup = await fs.readFile(
        path.join(deploymentsDir, setupFiles[0]),
        "utf8"
      );
      const setup = JSON.parse(latestSetup);
      
      // If the setup file has governance info, use it
      if (setup.verifierFactory && setup.governance) {
        return {
          verifierFactory: setup.verifierFactory,
          privateGovernance: setup.governance,
          privateToken: setup.privateToken || ""
        };
      }
    }
    
    // Fallback: check for governance deployment files
    const govFiles = files
      .filter(f => f.includes("governance") && f.endsWith(".json"))
      .sort()
      .reverse();
    
    if (govFiles.length > 0) {
      const latestGov = await fs.readFile(
        path.join(deploymentsDir, govFiles[0]),
        "utf8"
      );
      const gov = JSON.parse(latestGov);
      
      return {
        verifierFactory: gov.verifierFactory || "",
        privateGovernance: gov.privateGovernance || gov.governance || "",
        privateToken: gov.privateToken || gov.token || ""
      };
    }
    
    throw new Error(
      "No local governance deployment found. Run deployment scripts first or set environment variables:\n" +
      "  - VERIFIER_FACTORY_ADDRESS\n" +
      "  - PRIVATE_GOVERNANCE_ADDRESS\n" +
      "  - PRIVATE_TOKEN_ADDRESS (if needed)"
    );
  } catch (error: any) {
    if (error.code === "ENOENT") {
      throw new Error(
        `Deployments directory not found: ${deploymentsDir}\n` +
        "Run deployment scripts first or set environment variables."
      );
    }
    throw error;
  }
}

