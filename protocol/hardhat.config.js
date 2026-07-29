require("ts-node").register({
  transpileOnly: true,
  files: true
});
require("@nomicfoundation/hardhat-toolbox");
require("@nomicfoundation/hardhat-verify");
require("@openzeppelin/hardhat-upgrades");
require("hardhat-contract-sizer");
require("hardhat-gas-reporter");
require("./tasks/tokenomics");
try {
  require("hardhat-tracer");
} catch (error) {
  console.warn("hardhat-tracer disabled (optional dependency missing):", error?.message ?? error);
}
require("dotenv").config();

/**
 * Sonic testnet deployer keys: prefer PRIVATE_KEY; otherwise use DEPLOY_MNEMONIC or the same
 * public Hardhat default mnemonic as `networks.hardhat` (fund account #0 on the faucet).
 * @see https://docs.soniclabs.com/sonic/build-on-sonic/getting-started
 * @returns {string[] | import('hardhat/config').HDAccountsUserConfig}
 */
function resolveSonicTestnetAccounts() {
  if (process.env.PRIVATE_KEY) {
    return [process.env.PRIVATE_KEY];
  }
  return {
    mnemonic:
      process.env.DEPLOY_MNEMONIC ??
      "test test test test test test test test test test test junk",
    path: "m/44'/60'/0'/0",
    initialIndex: 0,
    count: Number(process.env.DEPLOY_MNEMONIC_ACCOUNT_COUNT || 20),
  };
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.26",
        settings: {
          evmVersion: "cancun",
          optimizer: {
            enabled: true,
            runs: 10000, // High optimization for DeFi contracts
            details: {
              yul: true,
              yulDetails: {
                stackAllocation: true,
                optimizerSteps: "dhfoDgvulfnTUtnIf[xa[r]EscLMcCTUtTOntnfDIulLculVcul [j]Tpeulxa[rul]xa[r]cLgvifCTUca[r]LSsTFOtfDnca[r]Iulc]jmul[jul] VcTOcul jmul"
              },
              peephole: true,
              inliner: true,
              jumpdestRemover: true,
              orderLiterals: true,
              deduplicate: true,
              cse: true,
              constantOptimizer: true
            }
          },
          viaIR: true, // Essential for complex ZK contracts
          metadata: {
            // Reduce metadata size for privacy
            bytecodeHash: "none"
          },
          outputSelection: {
            "*": {
              "*": ["abi", "evm.bytecode", "evm.deployedBytecode", "evm.methodIdentifiers", "metadata"],
              "": ["ast"]
            }
          }
        },
      },
      // Fallback compiler for legacy dependencies
      {
        version: "0.8.19",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          },
          viaIR: false,
          metadata: {
            bytecodeHash: "none"
          }
        }
      }
    ],
  },
  networks: {
    hardhat: {
      chainId: Number(process.env.FORK_CHAIN_ID ?? 14601),
      allowUnlimitedContractSize: true,
      blockGasLimit: 30000000,
      gas: 30000000,
      gasPrice: 1_000_000_000,
      allowBlocksWithSameTimestamp: true,
      initialBaseFeePerGas: 1,
      hardfork: process.env.FORK_HARDFORK ?? "cancun",
      hardforkHistory: {
        byzantium: 0,
        constantinople: 0,
        petersburg: 0,
        istanbul: 0,
        muirGlacier: 0,
        berlin: 0,
        london: 0,
        arrowGlacier: 0,
        grayGlacier: 0,
        merge: 0,
        shanghai: 0,
        cancun: 0
      },
      chains: {
        14601: {
          hardforkHistory: {
            byzantium: 0,
            constantinople: 0,
            petersburg: 0,
            istanbul: 0,
            muirGlacier: 0,
            berlin: 0,
            london: 0,
            arrowGlacier: 0,
            grayGlacier: 0,
            merge: 0,
            shanghai: 0,
            cancun: 0
          }
        },
        // Sonic mainnet — use FORK_CHAIN_ID=146 + FORK_URL=<sonic rpc> to fork locally
        146: {
          hardforkHistory: {
            byzantium: 0,
            constantinople: 0,
            petersburg: 0,
            istanbul: 0,
            muirGlacier: 0,
            berlin: 0,
            london: 0,
            arrowGlacier: 0,
            grayGlacier: 0,
            merge: 0,
            shanghai: 0,
            cancun: 0
          }
        }
      },
      accounts: {
        mnemonic: "test test test test test test test test test test test junk",
        count: 20,
        accountsBalance: "10000000000000000000000000000" // 10,000,000,000 ETH per account to satisfy high-liquidity rehearsals
      },
      edr: {
        enabled: false
      },
      forking: process.env.FORK_URL ? {
        url: process.env.FORK_URL,
        blockNumber: process.env.FORK_BLOCK_NUMBER ? parseInt(process.env.FORK_BLOCK_NUMBER) : undefined
      } : undefined,
      mining: {
        auto: true,
        interval: 0
      }
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: Number(process.env.FORK_CHAIN_ID ?? 14601),
      accounts: "remote"
    },
    localhost_alt: {
      url: "http://127.0.0.1:8546",
      chainId: Number(process.env.FORK_CHAIN_ID ?? 14601),
      accounts: "remote",
      timeout: 120000
    },
    coreTestnet: {
      url: process.env.CORE_TESTNET_RPC || "https://rpc.test.btcs.network",
      chainId: 1115,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: 20000000000,
      gas: "auto",
      gasMultiplier: 1.2,
      timeout: 60000,
      confirmations: 2
    },
    coreMainnet: {
      url: process.env.CORE_MAINNET_RPC || "https://rpc.coredao.org",
      chainId: 1116,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: 20000000000,
      gas: "auto",
      gasMultiplier: 1.1,
      timeout: 120000,
      confirmations: 5
    },
    // Additional networks for cross-chain functionality
    ethereum: {
      url: process.env.ETHEREUM_RPC || `https://mainnet.infura.io/v3/${process.env.INFURA_PROJECT_ID}`,
      chainId: 1,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: "auto",
      timeout: 120000
    },
    polygon: {
      url: process.env.POLYGON_RPC || "https://polygon-rpc.com",
      chainId: 137,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: "auto",
      timeout: 120000
    },
    // Sonic Testnet Configuration
    sonicTestnet: {
      url: process.env.SONIC_TESTNET_RPC || "https://rpc.testnet.soniclabs.com",
      chainId: 14601,
      accounts: resolveSonicTestnetAccounts(),
      gasPrice: "auto",
      gas: "auto",
      gasMultiplier: 1.2,
      timeout: 60000,
      confirmations: 2
    },
    // Sonic Mainnet Configuration
    sonic: {
      url: process.env.SONIC_MAINNET_RPC || "https://rpc.soniclabs.com",
      chainId: 146,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: "auto",
      gas: "auto",
      gasMultiplier: 1.2,
      timeout: 60000,
      confirmations: 3
    },
    arbitrum: {
      url: process.env.ARBITRUM_RPC || "https://arb1.arbitrum.io/rpc",
      chainId: 42161,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: "auto",
      timeout: 120000
    },
    optimism: {
      url: process.env.OPTIMISM_RPC || "https://mainnet.optimism.io",
      chainId: 10,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: "auto",
      timeout: 120000
    }
  },
  etherscan: {
    // Single string key → Etherscan API v2. One key from https://etherscan.io/myapikey works for every
    // chain Hardhat targets via v2 (including Sonic mainnet 146 + Sonic testnet 14601); the UI may say
    // "Ethereum" but the key is account-scoped, not "mainnet-only".
    apiKey: process.env.ETHERSCAN_API_KEY || "",
    customChains: [
      {
        network: "sonicTestnet",
        chainId: 14601,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api",
          browserURL: "https://testnet.sonicscan.org",
        },
      },
      {
        network: "sonic",
        chainId: 146,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api",
          browserURL: "https://sonicscan.org",
        },
      },
    ],
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
    coinmarketcap: process.env.COINMARKETCAP_API_KEY,
    gasPrice: 20, // gwei
    showTimeSpent: true,
    showMethodSig: true,
    maxMethodDiff: 10,
    excludeContracts: ["Mock", "Test"],
    src: "./contracts",
    outputFile: process.env.GAS_REPORT_FILE || undefined,
    noColors: process.env.CI !== undefined
  },
  contractSizer: {
    alphaSort: true,
    disambiguatePaths: false,
    // When true, every command that compiles (including `hardhat console`) prints the full size table.
    // Opt in: `CONTRACT_SIZER_ON_COMPILE=1 npx hardhat compile` — otherwise use `npm run size`.
    runOnCompile: process.env.CONTRACT_SIZER_ON_COMPILE === "1",
    strict: true,
    only: [],
    except: ["Mock", "Test"],
    outputFile: "./contract-sizes.txt"
  },
  mocha: {
    timeout: 120000, // Increased for ZK proof tests
    reporter: process.env.CI ? "json" : "spec",
    reporterOptions: process.env.CI ? {
      output: "./test-results.json"
    } : undefined,
    require: ["./test/globalSetup.js"],
    grep: process.env.TEST_GREP || undefined,
    bail: process.env.CI !== undefined
  },
  // Path configurations
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
    deploy: "./deploy",
    deployments: "./deployments"
  },
  // Type extensions for better IDE support
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
    alwaysGenerateOverloads: false,
    discriminateTypes: true,
    tsNocheck: false
  },
  // Deployment configurations
  namedAccounts: {
    deployer: {
      default: 0,
      1: process.env.MAINNET_DEPLOYER || 0,
      1115: process.env.CORE_TESTNET_DEPLOYER || 0,
      1116: process.env.CORE_MAINNET_DEPLOYER || 0,
      146: process.env.SONIC_MAINNET_DEPLOYER || 0,
      14601: process.env.SONIC_TESTNET_DEPLOYER || 0
    },
    admin: {
      default: 1,
      1: process.env.MAINNET_ADMIN || 1,
      1115: process.env.CORE_TESTNET_ADMIN || 1,
      1116: process.env.CORE_MAINNET_ADMIN || 1,
      146: process.env.SONIC_MAINNET_ADMIN || 1,
      14601: process.env.SONIC_TESTNET_ADMIN || 1
    },
    treasury: {
      default: 2,
      1: process.env.MAINNET_TREASURY || 2,
      1115: process.env.CORE_TESTNET_TREASURY || 2,
      1116: process.env.CORE_MAINNET_TREASURY || 2,
      146: process.env.SONIC_MAINNET_TREASURY || 2,
      14601: process.env.SONIC_TESTNET_TREASURY || 2
    }
  },
  // External deployments for cross-chain integration
  external: {
    contracts: [
      {
        artifacts: "node_modules/@openzeppelin/contracts/build/contracts",
        deploy: "node_modules/@openzeppelin/hardhat-upgrades/dist/deploy"
      }
    ],
    deployments: {
      localhost: ["deployments/hardhat"],
      hardhat: ["deployments/hardhat"]
    }
  },
  // Defender integration for security monitoring
  defender: {
    apiKey: process.env.DEFENDER_API_KEY || "",
    apiSecret: process.env.DEFENDER_API_SECRET || ""
  },
  // Tenderly integration for debugging
  tenderly: {
    project: process.env.TENDERLY_PROJECT || "aegis",
    username: process.env.TENDERLY_USERNAME || "",
    privateVerification: true
  },
  // Warnings configuration
  warnings: {
    "*": {
      "code-size": "error",
      "unused-param": "off",
      "unused-var": "error"
    }
  }
};