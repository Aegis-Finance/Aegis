const { ethers } = require("hardhat");

/**
 * Shield transparent AGS into a commitment using the mint-optimized Groth16 path.
 * For Hardhat tests with {@link MockVerifierFactory} / {@link MockZKVerifier}: ensures the mint verifier accepts the proof.
 *
 * @param {import("ethers").Contract} tokenContract - PrivateTokenContract
 * @param {import("ethers").Signer} signer - Payer (transparent balance debited); must match public input depositor unless caller is authorized
 * @param {string} outputCommitment - bytes32 commitment (new note)
 * @param {bigint} amount - wei shielded
 * @param {*} testHelpers - TestHelpers instance (mock mint verifier wiring)
 */
async function mintShield(tokenContract, signer, outputCommitment, amount, testHelpers) {
    const depositNullifier = testHelpers.generateUniqueNullifier(`mintshield_${Date.now()}`);
    const depositorAddr = await signer.getAddress();
    const depositorUint = BigInt(ethers.zeroPadValue(depositorAddr, 32));

    const publicInputs = [
        BigInt(depositNullifier),
        BigInt(outputCommitment),
        amount,
        depositorUint,
    ];

    const mock = testHelpers.generateMockZKProof("contribution");
    const proof = [
        BigInt(mock.a[0]),
        BigInt(mock.a[1]),
        BigInt(mock.b[0][0]),
        BigInt(mock.b[0][1]),
        BigInt(mock.b[1][0]),
        BigInt(mock.b[1][1]),
        BigInt(mock.c[0]),
        BigInt(mock.c[1]),
    ];

    const { mint: mintAddr } = await tokenContract.verifiers();
    if (mintAddr && mintAddr !== ethers.ZeroAddress) {
        const mv = await ethers.getContractAt("MockZKVerifier", mintAddr);
        try {
            await mv.setShouldVerify(true);
        } catch {
            // Not a MockZKVerifier (e.g. production Groth16) — ignore
        }
    }

    return tokenContract.connect(signer).shield(proof, publicInputs);
}

module.exports = { mintShield };
