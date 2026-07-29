import { groth16 } from 'snarkjs'
import { parseList, buildGatewayUrls, pickFirstReachable } from './arweaveGateway'
import { proveViaService, proverServiceUrl } from './zkHelpers'

function hexToBigIntArray(hex: string): bigint[] {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (clean.length !== 64 * 8) {
    throw new Error('Invalid proof length')
  }
  const arr: bigint[] = []
  for (let i = 0; i < 8; i++) {
    const chunk = '0x' + clean.slice(i * 64, (i + 1) * 64)
    arr.push(BigInt(chunk))
  }
  return arr
}

function normalizePublicAssetPath(path: string): string {
  if (!path || path.startsWith('http://') || path.startsWith('https://')) return path
  return path.startsWith('/') ? path : `/${path.replace(/^\/+/, '')}`
}

async function resolveCircuitUrl(primary: string | undefined, fallbackTxId: string | undefined, pathSuffix = ''): Promise<string> {
  const local = primary || ''
  if (local.startsWith('http')) return local

  const arweaveGateways = parseList(import.meta.env.VITE_ARWEAVE_GATEWAYS as string | undefined) || [
    'https://arweave.net',
    'https://arweave.dev',
    'https://gateway.irys.xyz',
  ]
  const ipfsGateways = parseList(import.meta.env.VITE_IPFS_GATEWAYS as string | undefined) || [
    'https://ipfs.io/ipfs',
    'https://cloudflare-ipfs.com/ipfs',
  ]
  const localMirror = (import.meta.env.VITE_LOCAL_MIRROR as string | undefined) || ''

  const candidates: string[] = []
  const normalizedSuffix = pathSuffix ? normalizePublicAssetPath(pathSuffix) : ''

  if (localMirror && normalizedSuffix) {
    candidates.push(`${localMirror.replace(/\/+$/, '')}${normalizedSuffix}`)
  }

  if (fallbackTxId && normalizedSuffix) {
    candidates.push(...buildGatewayUrls(fallbackTxId, arweaveGateways, normalizedSuffix))
    candidates.push(...buildGatewayUrls(fallbackTxId, ipfsGateways, normalizedSuffix))
  }

  if (normalizedSuffix) {
    candidates.push(normalizedSuffix)
  }

  if (primary && !primary.startsWith('http')) {
    candidates.unshift(normalizePublicAssetPath(primary))
  } else if (primary) {
    candidates.unshift(primary)
  }

  return pickFirstReachable(candidates)
}

export async function proveTransfer(input: any): Promise<{ proof: bigint[]; publicInputs: bigint[] }> {
  // Use multi-gateway fallback for circuit artifacts
  const wasm = await resolveCircuitUrl(
    import.meta.env.VITE_TRANSFER_WASM as string | undefined,
    import.meta.env.VITE_TRANSFER_TXID as string | undefined,
    '/circuits/transfer/transfer.wasm'
  )
  const zkey = await resolveCircuitUrl(
    import.meta.env.VITE_TRANSFER_ZKEY as string | undefined,
    import.meta.env.VITE_TRANSFER_ZKEY_TXID as string | undefined,
    '/circuits/transfer/transfer_final.zkey'
  )

  const { proof, publicSignals } = await groth16.fullProve(input, wasm, zkey)
  const solidityCalldata: string = await groth16.exportSolidityCallData(proof, publicSignals)
  const parts = solidityCalldata.replace(/\s+/g, '').split('],[')
  const proofHex = parts[0].replace('[', '').replace(']', '').replace(/"/g, '')
  const inputsHex = parts[1].replace(']', '').replace('[', '').replace(/"/g, '')
  const proofArr = hexToBigIntArray(proofHex)
  const inputsArr = inputsHex.split(',').filter(Boolean).map((x) => BigInt(x))
  return { proof: proofArr, publicInputs: inputsArr }
}

export async function proveBridgeTransfer(input: any): Promise<{ proof: bigint[]; publicInputs: bigint[] }> {
  // Use multi-gateway fallback for circuit artifacts
  const wasm = await resolveCircuitUrl(
    import.meta.env.VITE_BRIDGE_TRANSFER_WASM as string | undefined,
    import.meta.env.VITE_BRIDGE_TRANSFER_TXID as string | undefined,
    '/circuits/bridge/bridge_transfer.wasm'
  )
  const zkey = await resolveCircuitUrl(
    import.meta.env.VITE_BRIDGE_TRANSFER_ZKEY as string | undefined,
    import.meta.env.VITE_BRIDGE_TRANSFER_ZKEY_TXID as string | undefined,
    '/circuits/bridge/bridge_transfer_final.zkey'
  )

  const { proof, publicSignals } = await groth16.fullProve(input, wasm, zkey)
  const solidityCalldata: string = await groth16.exportSolidityCallData(proof, publicSignals)
  const parts = solidityCalldata.replace(/\s+/g, '').split('],[')
  const proofHex = parts[0].replace('[', '').replace(']', '').replace(/"/g, '')
  const inputsHex = parts[1].replace(']', '').replace('[', '').replace(/"/g, '')
  const proofArr = hexToBigIntArray(proofHex)
  const inputsArr = inputsHex.split(',').filter(Boolean).map((x) => BigInt(x))
  return { proof: proofArr, publicInputs: inputsArr }
}

export async function proveSwap(input: any): Promise<{ proof: bigint[]; publicInputs: bigint[] }> {
  /** Loads **`private-amm`** artifacts only (`VerifierFactory` type `private-amm`). No separate `swap` circuit. */
  const wasm = await resolveCircuitUrl(
    import.meta.env.VITE_PRIVATE_AMM_WASM as string | undefined,
    import.meta.env.VITE_PRIVATE_AMM_WASM_TXID as string | undefined,
    '/circuits/private-amm/private-amm.wasm'
  )
  const zkey = await resolveCircuitUrl(
    import.meta.env.VITE_PRIVATE_AMM_ZKEY as string | undefined,
    import.meta.env.VITE_PRIVATE_AMM_ZKEY_TXID as string | undefined,
    '/circuits/private-amm/private-amm_final.zkey'
  )

  const { proof, publicSignals } = await groth16.fullProve(input, wasm, zkey)
  const solidityCalldata: string = await groth16.exportSolidityCallData(proof, publicSignals)
  const parts = solidityCalldata.replace(/\s+/g, '').split('],[')
  const proofHex = parts[0].replace('[', '').replace(']', '').replace(/"/g, '')
  const inputsHex = parts[1].replace(']', '').replace('[', '').replace(/"/g, '')
  const proofArr = hexToBigIntArray(proofHex)
  const inputsArr = inputsHex.split(',').filter(Boolean).map((x) => BigInt(x))
  return { proof: proofArr, publicInputs: inputsArr }
}

export async function proveCrowdfunding(input: any): Promise<{ proof: bigint[]; publicInputs: bigint[] }> {
  // Use multi-gateway fallback for circuit artifacts
  const wasm = await resolveCircuitUrl(
    import.meta.env.VITE_CROWDFUNDING_WASM as string | undefined,
    import.meta.env.VITE_CROWDFUNDING_TXID as string | undefined,
    '/circuits/crowdfunding/crowdfunding.wasm'
  )
  const zkey = await resolveCircuitUrl(
    import.meta.env.VITE_CROWDFUNDING_ZKEY as string | undefined,
    import.meta.env.VITE_CROWDFUNDING_ZKEY_TXID as string | undefined,
    '/circuits/crowdfunding/crowdfunding_final.zkey'
  )

  const { proof, publicSignals } = await groth16.fullProve(input, wasm, zkey)
  const solidityCalldata: string = await groth16.exportSolidityCallData(proof, publicSignals)
  const parts = solidityCalldata.replace(/\s+/g, '').split('],[')
  const proofHex = parts[0].replace('[', '').replace(']', '').replace(/"/g, '')
  const inputsHex = parts[1].replace(']', '').replace('[', '').replace(/"/g, '')
  const proofArr = hexToBigIntArray(proofHex)
  const inputsArr = inputsHex.split(',').filter(Boolean).map((x) => BigInt(x))
  return { proof: proofArr, publicInputs: inputsArr }
}

export async function proveStaking(input: any): Promise<{ proof: bigint[]; publicInputs: bigint[] }> {
  // Use multi-gateway fallback for circuit artifacts
  const wasm = await resolveCircuitUrl(
    import.meta.env.VITE_STAKING_WASM as string | undefined,
    import.meta.env.VITE_STAKING_TXID as string | undefined,
    '/circuits/staking/staking.wasm'
  )
  const zkey = await resolveCircuitUrl(
    import.meta.env.VITE_STAKING_ZKEY as string | undefined,
    import.meta.env.VITE_STAKING_ZKEY_TXID as string | undefined,
    '/circuits/staking/staking_final.zkey'
  )

  const { proof, publicSignals } = await groth16.fullProve(input, wasm, zkey)
  const solidityCalldata: string = await groth16.exportSolidityCallData(proof, publicSignals)
  const parts = solidityCalldata.replace(/\s+/g, '').split('],[')
  const proofHex = parts[0].replace('[', '').replace(']', '').replace(/"/g, '')
  const inputsHex = parts[1].replace(']', '').replace('[', '').replace(/"/g, '')
  const proofArr = hexToBigIntArray(proofHex)
  const inputsArr = inputsHex.split(',').filter(Boolean).map((x) => BigInt(x))
  return { proof: proofArr, publicInputs: inputsArr }
}

async function groth16ToSolidityProof(
  input: any,
  wasm: string,
  zkey: string,
): Promise<{ proof: bigint[]; publicInputs: bigint[] }> {
  const { proof, publicSignals } = await groth16.fullProve(input, wasm, zkey)
  const solidityCalldata: string = await groth16.exportSolidityCallData(proof, publicSignals)
  const parts = solidityCalldata.replace(/\s+/g, '').split('],[')
  const proofHex = parts[0].replace('[', '').replace(']', '').replace(/"/g, '')
  const inputsHex = parts[1].replace(']', '').replace('[', '').replace(/"/g, '')
  const proofArr = hexToBigIntArray(proofHex)
  const inputsArr = inputsHex.split(',').filter(Boolean).map((x) => BigInt(x))
  return { proof: proofArr, publicInputs: inputsArr }
}

/** `PrivateLendingContract.provideLiquidity` — VerifierFactory `lending-liquidity` (3 public inputs). */
export async function proveLendingLiquidity(input: any): Promise<{ proof: bigint[]; publicInputs: bigint[] }> {
  const wasm = await resolveCircuitUrl(
    import.meta.env.VITE_LENDING_LIQUIDITY_WASM as string | undefined,
    import.meta.env.VITE_LENDING_LIQUIDITY_TXID as string | undefined,
    '/circuits/lending-liquidity/lending_liquidity.wasm',
  )
  const zkey = await resolveCircuitUrl(
    import.meta.env.VITE_LENDING_LIQUIDITY_ZKEY as string | undefined,
    import.meta.env.VITE_LENDING_LIQUIDITY_ZKEY_TXID as string | undefined,
    '/circuits/lending-liquidity/lending_liquidity_final.zkey',
  )
  return groth16ToSolidityProof(input, wasm, zkey)
}

/** `PrivateLendingContract.borrowWithCollateral` — VerifierFactory `lending-tenor` (6 public inputs incl. `tenorSeconds`). */
export async function proveLendingTenor(input: any): Promise<{ proof: bigint[]; publicInputs: bigint[] }> {
  const wasm = await resolveCircuitUrl(
    import.meta.env.VITE_LENDING_TENOR_WASM as string | undefined,
    import.meta.env.VITE_LENDING_TENOR_TXID as string | undefined,
    '/circuits/lending-tenor/lending_tenor.wasm',
  )
  const zkey = await resolveCircuitUrl(
    import.meta.env.VITE_LENDING_TENOR_ZKEY as string | undefined,
    import.meta.env.VITE_LENDING_TENOR_ZKEY_TXID as string | undefined,
    '/circuits/lending-tenor/lending_tenor_final.zkey',
  )
  return groth16ToSolidityProof(input, wasm, zkey)
}

/** `PrivateLendingContract.repayLoan` — VerifierFactory `lending-repay` (5 public inputs). */
export async function proveLendingRepay(input: any): Promise<{ proof: bigint[]; publicInputs: bigint[] }> {
  const wasm = await resolveCircuitUrl(
    import.meta.env.VITE_LENDING_REPAY_WASM as string | undefined,
    import.meta.env.VITE_LENDING_REPAY_TXID as string | undefined,
    '/circuits/lending-repay/lending_repay.wasm',
  )
  const zkey = await resolveCircuitUrl(
    import.meta.env.VITE_LENDING_REPAY_ZKEY as string | undefined,
    import.meta.env.VITE_LENDING_REPAY_ZKEY_TXID as string | undefined,
    '/circuits/lending-repay/lending_repay_final.zkey',
  )
  return groth16ToSolidityProof(input, wasm, zkey)
}

/** `PrivateLendingContract.withdrawLiquidity` — VerifierFactory `lending-withdraw` (4 public inputs). */
export async function proveLendingWithdraw(input: any): Promise<{ proof: bigint[]; publicInputs: bigint[] }> {
  const wasm = await resolveCircuitUrl(
    import.meta.env.VITE_LENDING_WITHDRAW_WASM as string | undefined,
    import.meta.env.VITE_LENDING_WITHDRAW_TXID as string | undefined,
    '/circuits/lending-withdraw/lending_withdraw.wasm',
  )
  const zkey = await resolveCircuitUrl(
    import.meta.env.VITE_LENDING_WITHDRAW_ZKEY as string | undefined,
    import.meta.env.VITE_LENDING_WITHDRAW_ZKEY_TXID as string | undefined,
    '/circuits/lending-withdraw/lending_withdraw_final.zkey',
  )
  return groth16ToSolidityProof(input, wasm, zkey)
}

/** `PrivateLendingContract.liquidateLoan` — VerifierFactory `lending-liquidate` (4 public inputs). */
export async function proveLendingLiquidate(input: any): Promise<{ proof: bigint[]; publicInputs: bigint[] }> {
  const wasm = await resolveCircuitUrl(
    import.meta.env.VITE_LENDING_LIQUIDATE_WASM as string | undefined,
    import.meta.env.VITE_LENDING_LIQUIDATE_TXID as string | undefined,
    '/circuits/lending-liquidate/lending_liquidate.wasm',
  )
  const zkey = await resolveCircuitUrl(
    import.meta.env.VITE_LENDING_LIQUIDATE_ZKEY as string | undefined,
    import.meta.env.VITE_LENDING_LIQUIDATE_ZKEY_TXID as string | undefined,
    '/circuits/lending-liquidate/lending_liquidate_final.zkey',
  )
  return groth16ToSolidityProof(input, wasm, zkey)
}

async function proveEcosystemCircuit(
  input: unknown,
  slug: string,
  wasmFile: string,
  zkeyFile: string,
  envWasm?: string,
  envZkey?: string
): Promise<{ proof: bigint[]; publicInputs: bigint[] }> {
  const proverUrl = proverServiceUrl()
  if (proverUrl) {
    try {
      return await proveViaService(`/ecosystem/${slug}/prove`, input)
    } catch {
      // fall through to local artifacts when prover lacks this route
    }
  }

  const wasm = await resolveCircuitUrl(
    envWasm as string | undefined,
    undefined,
    `/circuits/${slug}/${wasmFile}`
  )
  const zkey = await resolveCircuitUrl(
    envZkey as string | undefined,
    undefined,
    `/circuits/${slug}/${zkeyFile}`
  )
  return groth16ToSolidityProof(input, wasm, zkey)
}

export async function proveGovernance(input: unknown) {
  return proveEcosystemCircuit(
    input,
    'governance',
    'governance.wasm',
    'governance_final.zkey',
    import.meta.env.VITE_GOVERNANCE_WASM as string | undefined,
    import.meta.env.VITE_GOVERNANCE_ZKEY as string | undefined
  )
}

export const proveStealthAddress = (input: unknown) =>
  proveEcosystemCircuit(input, 'stealth-address', 'stealth-address.wasm', 'stealth-address_final.zkey')

export const proveSelectiveDisclosure = (input: unknown) =>
  proveEcosystemCircuit(
    input,
    'selective-disclosure',
    'selective-disclosure.wasm',
    'selective-disclosure_final.zkey'
  )

export const provePayroll = (input: unknown) =>
  proveEcosystemCircuit(input, 'payroll', 'payroll.wasm', 'payroll_final.zkey')

export const proveSavings = (input: unknown) =>
  proveEcosystemCircuit(input, 'savings', 'savings.wasm', 'savings_final.zkey')

export const provePrivateBond = (input: unknown) =>
  proveEcosystemCircuit(input, 'private-bond', 'private-bond.wasm', 'private-bond_final.zkey')

export const provePredictionMarket = (input: unknown) =>
  proveEcosystemCircuit(input, 'prediction-market', 'prediction-market.wasm', 'prediction-market_final.zkey')

export const provePrivateStable = (input: unknown) =>
  proveEcosystemCircuit(input, 'private-stable', 'private-stable.wasm', 'private-stable_final.zkey')

export const proveCreditProfile = (input: unknown) =>
  proveEcosystemCircuit(input, 'credit-profile', 'credit-profile.wasm', 'credit-profile_final.zkey')

export const proveTreasuryShield = (input: unknown) =>
  proveEcosystemCircuit(input, 'treasury-shield', 'treasury-shield.wasm', 'treasury-shield_final.zkey')

export async function proveInsurance(input: any): Promise<{ proof: bigint[]; publicInputs: bigint[] }> {
  const wasm = await resolveCircuitUrl(
    import.meta.env.VITE_INSURANCE_WASM as string | undefined,
    import.meta.env.VITE_INSURANCE_TXID as string | undefined,
    '/circuits/insurance/insurance.wasm'
  )
  const zkey = await resolveCircuitUrl(
    import.meta.env.VITE_INSURANCE_ZKEY as string | undefined,
    import.meta.env.VITE_INSURANCE_ZKEY_TXID as string | undefined,
    '/circuits/insurance/insurance_final.zkey'
  )
  return groth16ToSolidityProof(input, wasm, zkey)
}

export async function proveYieldFarming(input: any): Promise<{ proof: bigint[]; publicInputs: bigint[] }> {
  // Use multi-gateway fallback for circuit artifacts
  const wasm = await resolveCircuitUrl(
    import.meta.env.VITE_FARMING_WASM as string | undefined,
    import.meta.env.VITE_FARMING_TXID as string | undefined,
    '/circuits/farming/farming.wasm'
  )
  const zkey = await resolveCircuitUrl(
    import.meta.env.VITE_FARMING_ZKEY as string | undefined,
    import.meta.env.VITE_FARMING_ZKEY_TXID as string | undefined,
    '/circuits/farming/farming_final.zkey'
  )

  const { proof, publicSignals } = await groth16.fullProve(input, wasm, zkey)
  const solidityCalldata: string = await groth16.exportSolidityCallData(proof, publicSignals)
  const parts = solidityCalldata.replace(/\s+/g, '').split('],[')
  const proofHex = parts[0].replace('[', '').replace(']', '').replace(/"/g, '')
  const inputsHex = parts[1].replace(']', '').replace('[', '').replace(/"/g, '')
  const proofArr = hexToBigIntArray(proofHex)
  const inputsArr = inputsHex.split(',').filter(Boolean).map((x) => BigInt(x))
  return { proof: proofArr, publicInputs: inputsArr }
}

export async function proveReward(input: any): Promise<{ proof: bigint[]; publicInputs: bigint[] }> {
  // Use multi-gateway fallback for circuit artifacts
  const wasm = await resolveCircuitUrl(
    import.meta.env.VITE_REWARD_WASM as string | undefined,
    import.meta.env.VITE_REWARD_TXID as string | undefined,
    '/circuits/reward/reward.wasm'
  )
  const zkey = await resolveCircuitUrl(
    import.meta.env.VITE_REWARD_ZKEY as string | undefined,
    import.meta.env.VITE_REWARD_ZKEY_TXID as string | undefined,
    '/circuits/reward/reward_final.zkey'
  )

  const { proof, publicSignals } = await groth16.fullProve(input, wasm, zkey)
  const solidityCalldata: string = await groth16.exportSolidityCallData(proof, publicSignals)
  const parts = solidityCalldata.replace(/\s+/g, '').split('],[')
  const proofHex = parts[0].replace('[', '').replace(']', '').replace(/"/g, '')
  const inputsHex = parts[1].replace(']', '').replace('[', '').replace(/"/g, '')
  const proofArr = hexToBigIntArray(proofHex)
  const inputsArr = inputsHex.split(',').filter(Boolean).map((x) => BigInt(x))
  return { proof: proofArr, publicInputs: inputsArr }
}

/** `PrivateDerivatives.createContract` / `exerciseOption` — factory circuit `derivative`. */
export async function proveDerivative(input: unknown): Promise<{ proof: bigint[]; publicInputs: bigint[] }> {
  return proveEcosystemCircuit(
    input,
    'derivative',
    'derivative.wasm',
    'derivative_final.zkey',
    import.meta.env.VITE_DERIVATIVE_WASM as string | undefined,
    import.meta.env.VITE_DERIVATIVE_ZKEY as string | undefined
  )
}

/** Private purchase on `AutomatedBondingCurve` — factory circuit `bonding-curve-purchase`. */
export async function proveBondingCurvePurchase(input: any): Promise<{ proof: bigint[]; publicInputs: bigint[] }> {
  const wasm = await resolveCircuitUrl(
    import.meta.env.VITE_BONDING_CURVE_PURCHASE_WASM as string | undefined,
    import.meta.env.VITE_BONDING_CURVE_PURCHASE_TXID as string | undefined,
    '/circuits/bonding-curve-purchase/bonding_curve_purchase.wasm'
  )
  const zkey = await resolveCircuitUrl(
    import.meta.env.VITE_BONDING_CURVE_PURCHASE_ZKEY as string | undefined,
    import.meta.env.VITE_BONDING_CURVE_PURCHASE_ZKEY_TXID as string | undefined,
    '/circuits/bonding-curve-purchase/bonding_curve_purchase_final.zkey'
  )

  const { proof, publicSignals } = await groth16.fullProve(input, wasm, zkey)
  const solidityCalldata: string = await groth16.exportSolidityCallData(proof, publicSignals)
  const parts = solidityCalldata.replace(/\s+/g, '').split('],[')
  const proofHex = parts[0].replace('[', '').replace(']', '').replace(/"/g, '')
  const inputsHex = parts[1].replace(']', '').replace('[', '').replace(/"/g, '')
  const proofArr = hexToBigIntArray(proofHex)
  const inputsArr = inputsHex.split(',').filter(Boolean).map((x) => BigInt(x))
  return { proof: proofArr, publicInputs: inputsArr }
}

/** Private sell on `AutomatedBondingCurve` — factory circuit `bonding-curve-sell`. */
export async function proveBondingCurveSell(input: any): Promise<{ proof: bigint[]; publicInputs: bigint[] }> {
  const wasm = await resolveCircuitUrl(
    import.meta.env.VITE_BONDING_CURVE_SELL_WASM as string | undefined,
    import.meta.env.VITE_BONDING_CURVE_SELL_TXID as string | undefined,
    '/circuits/bonding-curve-sell/bonding_curve_sell.wasm'
  )
  const zkey = await resolveCircuitUrl(
    import.meta.env.VITE_BONDING_CURVE_SELL_ZKEY as string | undefined,
    import.meta.env.VITE_BONDING_CURVE_SELL_ZKEY_TXID as string | undefined,
    '/circuits/bonding-curve-sell/bonding_curve_sell_final.zkey'
  )

  const { proof, publicSignals } = await groth16.fullProve(input, wasm, zkey)
  const solidityCalldata: string = await groth16.exportSolidityCallData(proof, publicSignals)
  const parts = solidityCalldata.replace(/\s+/g, '').split('],[')
  const proofHex = parts[0].replace('[', '').replace(']', '').replace(/"/g, '')
  const inputsHex = parts[1].replace(']', '').replace('[', '').replace(/"/g, '')
  const proofArr = hexToBigIntArray(proofHex)
  const inputsArr = inputsHex.split(',').filter(Boolean).map((x) => BigInt(x))
  return { proof: proofArr, publicInputs: inputsArr }
}

/** `PrivateTokenContract.shield` — factory circuit `mint-optimized` (4 public inputs). */
export async function proveMintOptimized(input: unknown): Promise<{ proof: bigint[]; publicInputs: bigint[] }> {
  const wasm = await resolveCircuitUrl(
    import.meta.env.VITE_MINT_OPTIMIZED_WASM as string | undefined,
    import.meta.env.VITE_MINT_OPTIMIZED_WASM_TXID as string | undefined,
    '/circuits/mint-optimized/mint-optimized.wasm',
  )
  const zkey = await resolveCircuitUrl(
    import.meta.env.VITE_MINT_OPTIMIZED_ZKEY as string | undefined,
    import.meta.env.VITE_MINT_OPTIMIZED_ZKEY_TXID as string | undefined,
    '/circuits/mint-optimized/mint-optimized_final.zkey',
  )
  return groth16ToSolidityProof(input, wasm, zkey)
}

/** `PrivateTokenContract.unshield` — factory circuit `transfer-unshield` (4 public inputs). */
export async function proveTransferUnshield(input: unknown): Promise<{ proof: bigint[]; publicInputs: bigint[] }> {
  const wasm = await resolveCircuitUrl(
    import.meta.env.VITE_TRANSFER_UNSHIELD_WASM as string | undefined,
    import.meta.env.VITE_TRANSFER_UNSHIELD_WASM_TXID as string | undefined,
    '/circuits/transfer-unshield/transfer-unshield.wasm',
  )
  const zkey = await resolveCircuitUrl(
    import.meta.env.VITE_TRANSFER_UNSHIELD_ZKEY as string | undefined,
    import.meta.env.VITE_TRANSFER_UNSHIELD_ZKEY_TXID as string | undefined,
    '/circuits/transfer-unshield/transfer-unshield_final.zkey',
  )
  return groth16ToSolidityProof(input, wasm, zkey)
}

/** `PrivateTokenContract.shieldedTransfer` — factory circuit `shielded-transfer` (11 public inputs). */
export async function proveShieldedTransfer(input: unknown): Promise<{ proof: bigint[]; publicInputs: bigint[] }> {
  const wasm = await resolveCircuitUrl(
    import.meta.env.VITE_SHIELDED_TRANSFER_WASM as string | undefined,
    import.meta.env.VITE_SHIELDED_TRANSFER_WASM_TXID as string | undefined,
    '/circuits/shielded-transfer/shielded-transfer.wasm',
  )
  const zkey = await resolveCircuitUrl(
    import.meta.env.VITE_SHIELDED_TRANSFER_ZKEY as string | undefined,
    import.meta.env.VITE_SHIELDED_TRANSFER_ZKEY_TXID as string | undefined,
    '/circuits/shielded-transfer/shielded-transfer_final.zkey',
  )
  return groth16ToSolidityProof(input, wasm, zkey)
}

