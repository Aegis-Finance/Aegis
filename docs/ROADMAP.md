# Aegis Roadmap (2026–2030)

## What we are building

**An AI-powered telematics intelligence platform for commercial motor insurers and fleet operators.**

Fleet vehicles generate continuous signal — GPS, speed, harsh braking, idle time, dashcam video, CAN-bus events, weather, and route context. Most of that data sits in silos: telematics vendors, insurers, and fleet managers rarely share a single source of truth for **risk scoring, incident detection, fraud checks, and claim decisions**.

Aegis connects **telematics + AI** to **programmable settlement on Sonic** so partners can act on fleet intelligence with auditable outcomes — without publishing raw driver or vehicle data on a public ledger.

---

## Who it is for

| Customer | What they get |
|----------|----------------|
| **Commercial motor insurers** | Better underwriting and claims from verified fleet events; faster parametric settlement when triggers are clear. |
| **Fleet operators** | Safety scores, driver coaching signals, incident alerts, and lower friction when claims are evidence-backed. |
| **Integrators / TSPs** | APIs and attested feeds into the Aegis oracle layer; optional on-chain policy and payout hooks. |

We start **B2B** (insurers and fleets), not consumer retail auto.

---

## Mission

Turn fleet telematics into **actionable intelligence** — and, where partners choose it, **programmable insurance outcomes** on open contracts with privacy-preserving proofs.

---

## How blockchain fits (Aegis on Sonic)

Blockchain is not the product. It is the **trust and settlement layer** that makes telematics-driven insurance programmable and verifiable.

```text
Fleet telematics (OBD, dashcam, GPS, CAN, third-party TSP feeds)
        ↓
Aegis intelligence layer (AI event detection, risk scores, fraud signals)
        ↓
Attested oracle pipeline (signed event bundles, replay protection, quorum)
        ↓
Optional: on-chain policy + claim on Sonic (ZK-backed where circuits apply)
        ↓
Payout / notification / fleet dashboard — partner systems + Aegis dApp
        ↓
Dispute path when a fleet or driver objects
```

**What Sonic and Aegis add that a typical telematics SaaS does not**

| Layer | Role |
|-------|------|
| **Telematics + AI (off-chain)** | Ingest streams, classify incidents, score risk, detect fraud — the core platform value. |
| **Oracle attestations** | Cryptographically signed evidence that an event bundle existed at a time; multi-operator quorum reduces spoofing. |
| **On-chain insurance module** | Policies, premiums, and claims enforced by `DecentralizedInsurance` contracts — rules are code, not PDFs. |
| **ZK proofs (Groth16 / Circom)** | Prove a claim satisfies policy limits and oracle inputs **without** putting raw video or PII on-chain. |
| **AGS + DeFi rails** | Ecosystem liquidity, treasury, and governance for protocol upgrades — supporting partners who settle in or around the Aegis network. |
| **DAO governance** | Parameter changes (fees, oracle sets, circuit versions) via on-chain votes — no hidden admin overrides. |

Partners can use **intelligence-only** (APIs and dashboards) or **intelligence + on-chain settlement** (full Aegis stack). The protocol is optional depth, not a forced wallet experience for every fleet manager.

---

## North star (2030)

Directional goals — not next-quarter promises:

- **Fleet-scale telematics intelligence** — incident detection and risk scoring trusted by commercial motor underwriters.
- **Fast parametric claims** — minutes to hours for clear, sensor-backed fleet events where products allow it.
- **Open integration** — insurers and TSPs plug in via Risk API and oracle feeds without rebuilding the stack.
- **Privacy by default** — telematics stay encrypted off-chain; chain shows commitments, proofs, and settlement — not dashcam files.

---

## What we believe

1. **Telematics first** — the moat is real fleet data and models, not generic LLM wrappers.
2. **Prediction, not conversation** — classify events, estimate severity, score risk, recommend action.
3. **AI proposes; rules decide** — models output confidence; policy logic and tiering control auto vs manual review.
4. **Blockchain for proof and payout** — verifiable rules, ZK scope honesty, programmable claims when partners want on-chain settlement.
5. **B2B before breadth** — nail commercial motor and fleet pilots before expanding product surface.

---

## Timeline (realistic phases)

Dates are targets, not guarantees.

### 2026 — Platform foundation

**Telematics intelligence (core)**

- Ingest schema v1: GPS, speed, acceleration, idle, geofence, dashcam metadata, CAN events.
- Vehicle/fleet **telemetry testbed** (synthetic + consented pilot installs).
- Event classifiers v0: harsh events, impact bands, route risk, idle abuse, basic fraud hints.

**Aegis protocol (Sonic)**

- Mainnet launch: core DeFi modules + **on-chain insurance** (create policy, premium, ZK claim path).
- Oracle data schema v1 (signed bundles, replay protection).
- Public liquidity and swap rails for AGS ecosystem use.

**Go-to-market**

- Design partnerships with **fleet operators** and **commercial motor insurers** (data + pilot scope).

**Not in 2026:** production claims at national scale, full dashcam AI in every market.

---

### 2027 — Fleet pilots

**Intelligence product**

- Fleet dashboard: safety scores, driver/vehicle rankings, incident timeline, export for underwriters.
- AI claims sandbox on pilot fleets: confidence scores, fraud flags, parametric trigger matching.

**Oracle & settlement**

- Oracle **quorum beta** (multiple attestation operators).
- Parametric / supplemental **fleet products** in first approved market — clear sensor consensus only (Tier-0/Tier-1).
- Target: same-day decision on eligible events; stretch **under 30 minutes** for simplest triggers.
- Notification to fleet contact; **objection window** before final payout on contested cases.

**Disputes**

- Dispute framework v1: objection → re-run → council review (eligible jurors, not wealth-ranked wallets).

---

### 2028 — Scale depth

**Platform**

- Dynamic pricing inputs from accumulated **fleet kilometers and behavior** (consent-based).
- **Aegis Fleet Safety Score** — measurable behavior linked to premium or coaching programs.
- Risk API preview for insurers: scores, event feeds, attestation hashes.

**Insurance automation**

- Broader commercial motor coverage with tiered automation (clear events fast; injury, total loss, fraud → human review).
- Second region or product **if** first pilot metrics are healthy.

---

### 2029 — Partner platform

- White-label **telematics intelligence** hooks for insurers and TSPs.
- Deeper oracle/model operator standards and SLAs.
- Optional treasury and incentive rails for fleets that improve measured safety over time.

---

### 2030 — Category default for fleet intelligence

- **Aegis Risk API** standard for commercial motor: ingest, score, attest, settle (optional on-chain).
- Multi-tenant fleet and insurer ecosystem on shared oracle and proof standards.
- Partner-led volume is a major share of platform activity.

---

## Near term (next ~12 months)

| Period | Focus |
|--------|--------|
| **H2 2026** | Mainnet readiness, telematics ingest v1, fleet testbed, oracle schema, insurer/fleet design partners |
| **H1 2027** | First fleet pilot (narrow commercial motor product), quorum oracle beta, dispute v1 |
| **H2 2027** | Production cohort; measure incident detection accuracy, claim speed, dispute rate, loss ratio |

---

## What success looks like

- **Detection** — precision/recall on fleet incidents vs labeled ground truth.
- **Speed** — time from telematics event to insurer/fleet alert and (where applicable) claim decision.
- **Fairness** — dispute and overturn rates on automated decisions.
- **Adoption** — fleets connected, insurer integrations live, telematics kilometers under analysis.
- **Trust** — no material privacy breaches; auditable attestations and ZK scope documented publicly.

---

## Big bets

- **Aegis Fleet Safety Score** — telematics-backed scoring for underwriting and coaching.
- **Consented fleet dataset** — kilometers and labeled events as a durable asset for model improvement.
- **Attested parametric triggers** — impact, geofence, and downtime events that map cleanly to policy rules.
- **Gas-sponsored flows** — fleet managers interact through familiar UX; blockchain details abstracted where possible.

---

## What we are not claiming

- We are **not** a generic consumer insurance app or a dashcam storage company.
- We are **not** putting raw telematics or video on-chain.
- We are **not** auto-adjudicating every fleet claim in sub-minute time regardless of severity.
- We **are** building telematics intelligence for commercial motor — with optional programmable settlement on Aegis when partners want verifiable, privacy-preserving outcomes.

---

*This roadmap describes direction. We expand product scope and regions when telematics quality, security, and partner readiness are green.*
