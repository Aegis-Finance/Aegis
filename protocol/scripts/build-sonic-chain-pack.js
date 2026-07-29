#!/usr/bin/env node
/**
 * Merge Sonic-facing config into a single versioned artifact (reduces drift between
 * bridge-tokens, gateway/infra, and Uniswap v3 addresses).
 *
 * Sources of truth (edit these; do not hand-edit sonic-chain-pack.json):
 *   - config/bridge-tokens.json
 *   - config/sonic-infrastructure.json
 *   - config/uniswap-v3-sonic.json
 *
 * Usage: node scripts/build-sonic-chain-pack.js
 *        npm run sync:chain-pack
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG = path.join(ROOT, 'config');

function readJson(rel) {
  const p = path.join(CONFIG, rel);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/**
 * Ensure `settlementRail` is present on bridge token rows in the merged pack
 * (USDC → circle-cctp-v2; other non-AGS → sonic-gateway-native) when not set in bridge-tokens.json.
 */
function enrichBridgeTokenRow(row) {
  if (!row || typeof row !== 'object') return row;
  const sym = row.tokenSymbol;
  let rail = row.settlementRail;
  if (!rail && sym && sym !== 'AGS') {
    rail = sym === 'USDC' ? 'circle-cctp-v2' : 'sonic-gateway-native';
  }
  const out = { ...row };
  if (rail) {
    out.settlementRail = rail;
  } else {
    delete out.settlementRail;
  }
  return out;
}

function enrichBridgeTokens(rows) {
  return Array.isArray(rows) ? rows.map(enrichBridgeTokenRow) : [];
}

const DOCS = {
  contractAddresses: 'https://docs.soniclabs.com/sonic/build-on-sonic/contract-addresses',
  programmaticGateway: 'https://docs.soniclabs.com/sonic/build-on-sonic/programmatic-gateway',
  integratingStaking: 'https://docs.soniclabs.com/sonic/build-on-sonic/integrating-staking',
  networkParameters: 'https://docs.soniclabs.com/sonic/build-on-sonic/network-parameters',
  verifyContracts: 'https://docs.soniclabs.com/sonic/build-on-sonic/verify-contracts',
  deployContracts: 'https://docs.soniclabs.com/sonic/build-on-sonic/deploy-contracts',
  sonicGateway: 'https://docs.soniclabs.com/sonic/sonic-gateway',
  feeMonetization: 'https://docs.soniclabs.com/funding/fee-monetization',
};

function buildSonicChainPack(options = {}) {
  const { silent = false } = options;
  const bridge = readJson('bridge-tokens.json');
  const infra = readJson('sonic-infrastructure.json');
  const uni = readJson('uniswap-v3-sonic.json');
  const { dutchAuctionDisplay: _stripDad, ...bridgeMetaForPack } = bridge.meta || {};

  const gwEth = infra.sonic?.gatewayEthereum || {};
  const gwSon = infra.sonic?.gatewaySonic || {};

  const pack = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    description:
      'Merged Sonic chain pack: bridge tokens + Gateway/Multicall/SFC + Uniswap v3 (mainnet). Regenerate via npm run sync:chain-pack.',
    meta: {
      generatedAt: new Date().toISOString(),
      sources: {
        bridgeTokens: 'config/bridge-tokens.json',
        sonicInfrastructure: 'config/sonic-infrastructure.json',
        uniswapV3Sonic: 'config/uniswap-v3-sonic.json',
      },
      documentation: DOCS,
      notes: [
        'Aegis Sonic testnet uses chainId 14601 (see hardhat.config.js, frontend DEFAULT_NETWORK). Some third-party snippets may show a different testnet id; trust SonicScan testnet + eth_getRules on your RPC.',
        'Programmatic Gateway deposit/claim/proof flow: see documentation.programmaticGateway (same contract set as infrastructure.gateway*).',
        'SFC staking integration (delegate, rewards, constsAddress): see documentation.integratingStaking.',
        'Live gas/rules: POST eth_getRules — see documentation.networkParameters.',
        'Contract verification: Hardhat `sonic` + `sonicTestnet` use Etherscan API V2 URLs in `hardhat.config.js` (see `sonicMainnet.verify` / `sonicTestnet.verify` in generated chain pack).',
      ],
      bridgeTokensFileMeta: bridgeMetaForPack,
      dutchAuctionDisplay: bridge.meta?.dutchAuctionDisplay || undefined,
    },
    sonicMainnet: {
      chainId: 146,
      rpcUrls: ['https://rpc.soniclabs.com'],
      blockExplorer: 'https://sonicscan.org',
      bridgeTokens: enrichBridgeTokens(bridge.sonic || []),
      infrastructure: infra.sonic || {},
      staking: {
        sfc: infra.sonic?.sfc || '0xFC00FACE00000000000000000000000000000000',
        doc: DOCS.integratingStaking,
        keyFunctions: [
          'delegate(validatorID)',
          'undelegate(validatorID, wrID, amount)',
          'withdraw(validatorID, wrID)',
          'pendingRewards(delegator, validatorID)',
          'claimRewards(validatorID)',
          'constsAddress()',
        ],
      },
      /** Mirrors names from Sonic "Programmatic Gateway" guide for scripting ergonomics */
      programmaticGateway: {
        ethereum: {
          TOKEN_DEPOSIT: gwEth.tokenDeposit,
          TOKEN_PAIRS: gwEth.tokenPairs,
          STATE_ORACLE: gwEth.stateOracle,
        },
        sonic: {
          BRIDGE: gwSon.bridge,
          TOKEN_PAIRS: gwSon.tokenPairs,
          STATE_ORACLE: gwSon.stateOracle,
        },
      },
      uniswapV3: uni.sonicMainnet || null,
      networkParameters: {
        doc: DOCS.networkParameters,
        example: {
          method: 'eth_getRules',
          params: ['latest'],
          curlOneLine:
            'curl -sX POST -H "Content-type: application/json" -d \'{"id":1,"jsonrpc":"2.0","method":"eth_getRules","params":["latest"]}\' https://rpc.soniclabs.com',
        },
      },
      verify: {
        doc: DOCS.verifyContracts,
        hardhatNetworks: ['sonic', 'sonicTestnet'],
        apiEnvHint:
          'ETHERSCAN_API_KEY (Etherscan API V2: ?chainid=146 mainnet, ?chainid=14601 testnet) — hardhat.config.js etherscan.customChains',
      },
      deploy: {
        doc: DOCS.deployContracts,
        rpcUrl: 'https://rpc.soniclabs.com',
      },
    },
    sonicTestnet: {
      chainId: 14601,
      rpcUrls: ['https://rpc.testnet.soniclabs.com', 'https://rpc.blaze.soniclabs.com'],
      blockExplorer: 'https://testnet.sonicscan.org',
      bridgeTokens: enrichBridgeTokens(bridge.sonicTestnet || []),
      infrastructure: infra.sonicTestnet || {},
      uniswapV3: null,
      programmaticGateway: {
        documentation: DOCS.programmaticGateway,
        note:
          'L1 deposit/claim uses Ethereum mainnet addresses under sonicMainnet.programmaticGateway.ethereum. Sonic testnet official tab lists fewer contracts; re-check contract-addresses before scripting claims on testnet.',
        sonic: infra.sonicTestnet?.gatewaySonic || null,
      },
      deploy: {
        doc: DOCS.deployContracts,
        rpcUrl: 'https://rpc.testnet.soniclabs.com',
        faucetHint: 'https://testnet.soniclabs.com/account',
      },
      verify: {
        doc: DOCS.verifyContracts,
        hardhatNetwork: 'sonicTestnet',
        chainId: 14601,
        apiEnvHint:
          'ETHERSCAN_API_KEY (Etherscan API V2: ?chainid=14601) — hardhat.config.js etherscan.customChains',
      },
    },
  };

  const dest = path.join(CONFIG, 'sonic-chain-pack.json');
  fs.writeFileSync(dest, `${JSON.stringify(pack, null, 2)}\n`);
  if (!silent) {
    console.log(`✅ Wrote ${path.relative(ROOT, dest)}`);
  }
  return pack;
}

module.exports = { buildSonicChainPack };

if (require.main === module) {
  buildSonicChainPack();
}
