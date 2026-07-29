import { ethers } from "hardhat";
import type { Interface, Log } from "ethers";

export async function withSnapshot<T>(callback: () => Promise<T>): Promise<T> {
  const snapshotId = await ethers.provider.send("evm_snapshot", []);
  try {
    return await callback();
  } finally {
    await ethers.provider.send("evm_revert", [snapshotId]);
  }
}

export interface ImpersonatedSigner {
  signer: Awaited<ReturnType<typeof ethers.getSigner>>;
  stop: () => Promise<void>;
}

export async function impersonateSigner(
  address: string,
  balance: bigint = ethers.parseEther("100")
): Promise<ImpersonatedSigner> {
  const balanceHex = ethers.toBeHex(balance);
  await ethers.provider.send("hardhat_setBalance", [address, balanceHex]);
  await ethers.provider.send("hardhat_impersonateAccount", [address]);

  const signer = await ethers.getSigner(address);

  return {
    signer,
    stop: async () => {
      await ethers.provider.send("hardhat_stopImpersonatingAccount", [address]);
    }
  };
}

export function findEvent(logs: readonly Log[], iface: Interface, eventName: string) {
  for (const log of logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed && parsed.name === eventName) {
        return parsed;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

