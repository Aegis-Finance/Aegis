# Security policy

## Reporting a vulnerability

If you believe you have found a security issue in smart contracts, Circom circuits, verifier wiring, or client applications:

1. **Do not** disclose exploit details in a public issue before coordinated disclosure.
2. Contact maintainers through the private channel published on our release page (GitHub Security Advisories or security contact email).
3. Include: affected path (`protocol/contracts/…`, `protocol/circuits/…`, `clients/…`), chain ID if on-chain, and a minimal proof of concept or clear reasoning.

## Priority review areas

- Groth16 circuits and alignment with on-chain `verifyProof` public inputs
- `VerifierFactory` and `CeremonyVerifier` policy on Sonic mainnet (chain 146)
- Token distribution (`AutomatedDutchAuction`, claim circuits) and oracle / pricing paths
- Privacy entry relay (`PrivacyEntryRouter`) and EIP-712 intent handling

## Out of scope

- Third-party RPC availability or Arweave gateway choice
- Social engineering of key holders
- Issues in retired mainnet deploy #1 contracts

## Bug bounty

No formal bounty program is attached to this file. Treat it as coordination policy unless a separate program is announced in [RELEASES.md](RELEASES.md).
