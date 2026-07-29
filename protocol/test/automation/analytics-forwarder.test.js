const { expect } = require('chai');
const { MetricAccumulator, JsonState } = require('../../scripts/automation/analytics-forwarder');
const path = require('path');
const fs = require('fs').promises;

describe('Analytics Forwarder Utilities', function () {
    describe('MetricAccumulator', function () {
        it('aggregates metrics per protocol/type', function () {
            const accumulator = new MetricAccumulator();
            accumulator.add('DEX', 'VOLUME', 5n);
            accumulator.add('DEX', 'VOLUME', 7n);
            accumulator.add('LENDING', 'TVL', 3n);

            const drained = accumulator.drain();
            expect(drained).to.deep.include({ protocol: 'DEX', metric: 'VOLUME', value: 12n });
            expect(drained).to.deep.include({ protocol: 'LENDING', metric: 'TVL', value: 3n });
            expect(accumulator.drain()).to.deep.equal([]);
        });

        it('treats numeric strings as BigInt-compatible', function () {
            const acc = new MetricAccumulator();
            acc.add('STAKING', 'TVL', '9000');
            const d = acc.drain();
            expect(d[0].value).to.equal(9000n);
        });

        it('keeps separate buckets when metric name contains delimiter substring', function () {
            const acc = new MetricAccumulator();
            acc.add('PROTO|A', 'M|X', 1n);
            acc.add('PROTO', 'MX', 2n);
            const d = acc.drain();
            expect(d).to.have.lengthOf(2);
        });

        it('accumulates zero explicitly and drops on drain', function () {
            const acc = new MetricAccumulator();
            acc.add('X', 'Y', 0n);
            acc.add('X', 'Y', 5n);
            acc.add('X', 'Y', -5n);
            const d = acc.drain();
            expect(d.find((e) => e.protocol === 'X')).to.be.undefined;
        });

        it('handles many protocols in insertion order for drain', function () {
            const acc = new MetricAccumulator();
            for (let i = 0; i < 20; i++) {
                acc.add(`P${i}`, 'TX', 1n);
            }
            const d = acc.drain();
            expect(d).to.have.lengthOf(20);
        });
    });

    describe('JsonState', function () {
        const statePath = path.join(__dirname, '..', 'tmp-state.json');

        afterEach(async function () {
            try {
                await fs.unlink(statePath);
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }
        });

        it('persists and restores last processed block', async function () {
            const state = new JsonState(statePath);
            await state.load();
            state.setLastBlock('PrivateAMMContract', 123);
            await state.save();

            const reloaded = new JsonState(statePath);
            await reloaded.load();
            expect(reloaded.getLastBlock('PrivateAMMContract')).to.equal(123);
        });

        it('increments nullifier salt deterministically', async function () {
            const state = new JsonState(statePath);
            expect(state.nextNullifierSalt()).to.equal(1);
            expect(state.nextNullifierSalt()).to.equal(2);
        });

        it('isolates last block per contract key', async function () {
            const state = new JsonState(statePath);
            await state.load();
            state.setLastBlock('A', 1);
            state.setLastBlock('B', 999);
            await state.save();
            const r = new JsonState(statePath);
            await r.load();
            expect(r.getLastBlock('A')).to.equal(1);
            expect(r.getLastBlock('B')).to.equal(999);
            expect(r.getLastBlock('missing')).to.equal(0);
        });

        it('overwrites same contract block idempotently', async function () {
            const state = new JsonState(statePath);
            await state.load();
            state.setLastBlock('C', 10);
            state.setLastBlock('C', 20);
            await state.save();
            const r = new JsonState(statePath);
            await r.load();
            expect(r.getLastBlock('C')).to.equal(20);
        });

        it('preserves nullifier salt across save/load', async function () {
            const state = new JsonState(statePath);
            await state.load();
            state.nextNullifierSalt();
            state.nextNullifierSalt();
            await state.save();
            const r = new JsonState(statePath);
            await r.load();
            expect(r.nextNullifierSalt()).to.equal(3);
        });
    });
});
