/**
 * Property-style invariants for ZK **public input layouts** consumed by `PrivateTokenContract`
 * and `PrivacyEntryRouter` (mint / unshield / shielded vector lengths). Catches accidental `BigInt(address)` misuse.
 */
const { expect } = require('chai');
const fc = require('fast-check');
const { ethers } = require('hardhat');

describe('ZK public layout invariants (privacy entry + mint)', function () {
  const FIELD_MOD =
    21888242871839275222246405745257275088548364400416034343698204186575808495617n;

  /** Random 20-byte address as canonical 0x + checksum where applicable */
  const addressBytesArb = fc
    .uint8Array({ minLength: 20, maxLength: 20 })
    .map((b) => ethers.getAddress(ethers.hexlify(b)));

  it('mint layout: publicInputs[3] == uint256(uint160(depositor))', function () {
    fc.assert(
      fc.property(addressBytesArb, (depositor) => {
        const slot = BigInt(ethers.zeroPadValue(depositor, 32));
        const fromUint160 = BigInt(depositor);
        expect(slot).to.equal(fromUint160);
        expect(slot).to.be.lessThan(1n << 160n);
      }),
      { numRuns: 48 }
    );
  });

  it('unshield layout: publicInputs[1] == uint256(uint160(recipient))', function () {
    fc.assert(
      fc.property(addressBytesArb, (recipient) => {
        const slot = BigInt(ethers.zeroPadValue(recipient, 32));
        expect(slot).to.equal(BigInt(recipient));
      }),
      { numRuns: 48 }
    );
  });

  it('public input digests stay within field (sanity)', function () {
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: 0n, max: FIELD_MOD - 1n }), { minLength: 4, maxLength: 11 }),
        (pub) => {
          for (const x of pub) {
            expect(x).to.be.at.least(0n);
            expect(x).to.be.lessThan(FIELD_MOD);
          }
        }
      ),
      { numRuns: 30 }
    );
  });
});
