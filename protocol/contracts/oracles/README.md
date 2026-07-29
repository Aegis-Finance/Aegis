# Multi-Oracle Integration System

## Overview

This directory contains the complete multi-oracle integration system for Aegis Protocol, supporting all oracle providers available on Sonic Network as documented at https://docs.soniclabs.com.

## Architecture

### Components

1. **IOracleAdapter Interface** (`interfaces/IOracleAdapter.sol`)
   - Unified interface for all oracle providers
   - Ensures consistent integration across different oracle types

2. **Oracle Adapters** (`adapters/`)
   - `ChainlinkAdapter.sol` - Chainlink Data Feeds
   - `PythAdapter.sol` - Pyth Network Price Feeds
   - `API3Adapter.sol` - API3 dAPIs
   - `BandProtocolAdapter.sol` - Band Protocol Standard Dataset
   - `RedStoneAdapter.sol` - RedStone Oracle
   - `SupraAdapter.sol` - Supra Oracle
   - `StorkAdapter.sol` - Stork Network Oracle

3. **MultiOracleAggregator** (`MultiOracleAggregator.sol`)
   - Aggregates prices from multiple oracle providers
   - Maintains same security standards as Chainlink implementation
   - Governance-controlled oracle management

## Security Features

All oracle integrations maintain identical security standards:

- **Maximum Price Staleness**: 1 hour (3600 seconds)
- **Maximum Deviation**: 5% (500 basis points) between oracles
- **Minimum Confirmations**: 2+ oracle confirmations required
- **Median Price Calculation**: Reduces single-oracle manipulation risk
- **Governance Control**: All oracle configuration managed by DAO

## Integration Points

### PoolPriceValidator

The `PoolPriceValidator` contract now supports both:
- **Legacy Mode**: Single Chainlink oracle (backward compatible)
- **Multi-Oracle Mode**: MultiOracleAggregator with multiple providers

**Configuration:**
```solidity
// Legacy Chainlink-only
configurePool(pool, quoteOracle, agsOracle, enabled, maxDeviationBps, twapWindow);

// New multi-oracle support
configurePoolMultiOracle(pool, aggregator, assetId, enabled, maxDeviationBps, twapWindow);
```

### PrivateDerivatives

The `PrivateDerivatives` contract supports:
- **Legacy Mode**: Direct Chainlink oracle addresses
- **Multi-Oracle Mode**: MultiOracleAggregator integration

**Configuration:**
```solidity
// Legacy Chainlink-only
addOracle(asset, chainlinkOracle);

// New multi-oracle support
setMultiOracleAggregator(asset, aggregatorAddress);
```

## Deployment & Configuration Sequence

### Phase 1: Initial Deployment (Chainlink-Only)

**During initial contract deployment**, you can use the legacy Chainlink-only configuration:

```solidity
// 1. Deploy PoolPriceValidator (with governance address)
PoolPriceValidator poolValidator = new PoolPriceValidator(governanceAddress);

// 2. Configure pools with Chainlink oracles (immediately after deployment)
poolValidator.configurePool(
    poolAddress,
    chainlinkQuoteOracle,  // Chainlink USDC/USD oracle
    chainlinkAGSOracle,     // Chainlink AGS/USD oracle (or address(0))
    true,                   // enabled
    500,                    // maxDeviationBps (5%)
    3600                    // twapWindow (1 hour)
);

// 3. Deploy PrivateDerivatives (with governance address)
PrivateDerivatives derivatives = new PrivateDerivatives(
    privateTokenAddress,
    verifierFactoryAddress,
    governanceAddress
);

// 4. Add Chainlink oracles (immediately after deployment)
bytes32 assetId = keccak256("AGS/USD");
derivatives.addOracle(assetId, chainlinkOracleAddress);
```

**At this point, contracts are fully functional with Chainlink-only oracles.**

---

### Phase 2: Multi-Oracle Upgrade (After Initial Deployment)

**Later, when you want to add multi-oracle support**, you can upgrade without redeploying main contracts:

```solidity
// 1. Deploy Oracle Adapters (can be done anytime)
ChainlinkAdapter chainlinkAdapter = new ChainlinkAdapter(chainlinkAggregatorAddress);
PythAdapter pythAdapter = new PythAdapter(pythContractAddress, priceFeedId);
API3Adapter api3Adapter = new API3Adapter(api3ContractAddress);
// ... deploy other adapters as needed

// 2. Deploy MultiOracleAggregator (via governance)
MultiOracleAggregator aggregator = new MultiOracleAggregator(governanceAddress);

// 3. Configure aggregator (via governance)
bytes32 assetId = keccak256("AGS/USD");
aggregator.addOracle(assetId, address(chainlinkAdapter));
aggregator.addOracle(assetId, address(pythAdapter));
aggregator.addOracle(assetId, address(api3Adapter));
aggregator.setRequiredConfirmations(assetId, 2);

// 4. Update existing contracts to use aggregator (via governance)
// This is done AFTER deployment, as an upgrade/enhancement

// For PoolPriceValidator - add multi-oracle configuration
poolValidator.configurePoolMultiOracle(
    poolAddress,
    address(aggregator),
    assetId,
    true,   // enabled
    500,    // maxDeviationBps (5%)
    3600    // twapWindow (1 hour)
);

// For PrivateDerivatives - switch to multi-oracle
derivatives.setMultiOracleAggregator(assetId, address(aggregator));
```

### Phase 3: Price Updates (Ongoing)

```solidity
// Anyone can update prices (oracles are checked automatically)
aggregator.updatePrice(assetId);

// Or configure keepers to update automatically via updatePriceFromOracle()
```

## Key Points

1. **Initial Deployment**: Contracts work immediately with Chainlink-only configuration
2. **Multi-Oracle is Optional**: Can be added later without redeploying main contracts
3. **Backward Compatible**: Legacy Chainlink configuration continues to work
4. **Governance Controlled**: All multi-oracle configuration requires DAO approval
5. **Gradual Migration**: You can migrate pools/assets one at a time

## Oracle Providers Supported

All providers listed in [Sonic Labs Documentation](https://docs.soniclabs.com/sonic/build-on-sonic/tooling-and-infra#oracles):

- ✅ **Chainlink** (Data Feeds) - Primary
- ✅ **Pyth Network** (Price Feed) - Backup
- ✅ **API3** - dAPIs
- ✅ **Band Protocol** - Standard Dataset
- ✅ **RedStone** - Oracle Network
- ✅ **Supra** - Oracle Network
- ✅ **Stork Network** - Oracle Network

## Security Guarantees

1. **Same Security Level as Chainlink**: All adapters enforce identical staleness and deviation checks
2. **Multi-Oracle Consensus**: Requires 2+ independent oracle confirmations
3. **Median Price**: Reduces impact of single oracle manipulation
4. **Deviation Validation**: Max 5% deviation between oracles
5. **Governance Control**: All oracle management requires DAO approval

## Backward Compatibility

- Existing Chainlink-only configurations continue to work
- Legacy functions remain available
- New multi-oracle features are opt-in
- No breaking changes to existing contracts

## Governance

All oracle management functions require `GOVERNANCE_ROLE`:
- Adding/removing oracles
- Setting required confirmations
- Enabling/disabling oracle aggregation
- Configuring pools and assets

This ensures fully decentralized, DAO-controlled oracle management aligned with Austrian Economics principles.

