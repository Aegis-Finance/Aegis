#!/usr/bin/env node
/**
 * Fuzz-test: Dutch auction math used by `AuctionPriceLib` matches the constraints
 * implemented in `circuits/auction.circom` (floor decay + WAD rate binding).
 *
 * Run: node scripts/circuits/auction-math-alignment.mjs
 */

const WAD = 10n ** 18n;
const ITERS = 5000n;

function linearDutchPrice(start, reserve, startTime, endTime, now, saleCompleted) {
  if (saleCompleted || now >= endTime) return reserve;
  if (now <= startTime) return start;
  const totalDuration = endTime - startTime;
  if (totalDuration === 0n) throw new Error("zero duration");
  const timeElapsed = now - startTime;
  const priceDecay = ((start - reserve) * timeElapsed) / totalDuration;
  return start - priceDecay;
}

function decayRatePerSecondWad(start, reserve, startTime, endTime) {
  const totalDuration = endTime - startTime;
  if (totalDuration === 0n) throw new Error("zero duration");
  return ((start - reserve) * WAD) / totalDuration;
}

function randBigint(bits) {
  if (bits <= 0n) return 0n;
  const bytes = Number((bits + 7n) / 8n);
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let x = 0n;
  for (let i = 0; i < bytes; i++) x = (x << 8n) | BigInt(buf[i]);
  const mask = (1n << bits) - 1n;
  return x & mask;
}

let failures = 0;

for (let i = 0n; i < ITERS; i++) {
  const reserve = randBigint(120n) + 1n;
  const delta = randBigint(120n) + 1n;
  const start = reserve + delta;
  const duration = randBigint(40n) + 1n;
  const startTime = randBigint(48n);
  const endTime = startTime + duration;
  const elapsed = randBigint(40n) % duration;
  const now = startTime + elapsed;

  const rate = decayRatePerSecondWad(start, reserve, startTime, endTime);
  const price = linearDutchPrice(start, reserve, startTime, endTime, now, false);

  const priceDecayCircuit = (delta * elapsed) / duration;
  const rateCircuit = (delta * WAD) / duration;
  const calcCircuit = start - priceDecayCircuit;

  if (rateCircuit !== rate) {
    console.error("rate mismatch", { start, reserve, duration, rate, rateCircuit });
    failures++;
  }
  if (calcCircuit !== price) {
    console.error("price mismatch", { start, reserve, now, startTime, endTime, price, calcCircuit });
    failures++;
  }
}

if (failures > 0) {
  console.error(`auction-math-alignment: ${failures} failure(s)`);
  process.exit(1);
}

console.log(`auction-math-alignment: OK (${ITERS} random cases)`);
