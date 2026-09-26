/**
 * The rules that make this tool worth trusting. Each test pins one gotcha
 * that a naive indexer gets wrong.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mintCost, redeemProceeds, sideOf, POS_INF_TICK } from './indexer.js';
import { openDb, type Db } from './db.js';
import { loadPositions, walletStats } from './stats.js';

const OWNER = '0x' + 'a'.repeat(64);
const KEY = '0x' + 'b'.repeat(64);
const M1 = '0x' + '1'.repeat(64);
const M2 = '0x' + '2'.repeat(64);
const TICK = 10_000_000n; // $0.01 in 1e9 units

function db(): Db {
  const d = openDb(':memory:');
  return d;
}

function mint(d: Db, o: { id: string; market: string; root: string; lo: bigint; hi: bigint; qty: number; cost: number; prob: number; owner?: string; sender?: string; ts?: number }) {
  d.prepare(
    `INSERT INTO mints VALUES (?, 'D', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, ?)`,
  ).run(o.id, o.ts ?? 1000, o.owner ?? OWNER, o.sender ?? KEY, o.market, o.root, o.root, o.lo.toString(), o.hi.toString(), sideOf(o.lo, o.hi), o.prob, o.qty, o.cost);
}

function market(d: Db, id: string, expiry: number, settlement: bigint | null) {
  d.prepare(`INSERT INTO markets VALUES (?, 'BTC', ?, ?, ?, NULL)`).run(id, expiry, TICK.toString(), settlement?.toString() ?? null);
}

test('side classification', () => {
  assert.equal(sideOf(0n, 8_400_000n), 'down');
  assert.equal(sideOf(8_400_000n, POS_INF_TICK), 'up');
  assert.equal(sideOf(8_400_000n, 8_401_000n), 'range');
  assert.equal(POS_INF_TICK, (1n << 30n) - 1n);
});

test('mint cost nets every fee and subtracts the subsidy', () => {
  const c = mintCost({
    premium: '5322840',
    trading_fee: '4675897',
    fee_incentive_subsidy: '1000',
    builder_fee: '10',
    penalty_fee: '20',
    inventory_impact_charge: '30',
  });
  assert.equal(c, 5322840n + 4675897n - 1000n + 10n + 20n + 30n);
});

test('redeem proceeds subtract fees and add the impact rebate', () => {
  const p = redeemProceeds({
    redeem_amount: '3548189',
    trading_fee: '164083',
    builder_fee: '5',
    penalty_fee: '6',
    inventory_impact_rebate: '7',
  });
  assert.equal(p, 3548189n - 164083n - 5n - 6n + 7n);
});

test('attribution is by owner, not the session-key sender', () => {
  const d = db();
  market(d, M1, 5000, null);
  mint(d, { id: 'e1', market: M1, root: '1', lo: 0n, hi: 100n, qty: 1_000_000, cost: 400_000, prob: 400_000_000 });
  const [p] = loadPositions(d, 2000);
  assert.equal(p!.owner, OWNER);
  assert.equal(p!.sender, KEY);
});

test('never settles before expiry, even if a price is present', () => {
  const d = db();
  // Settlement price present but market not yet expired at "now".
  market(d, M1, 5000, 9_000n * TICK);
  mint(d, { id: 'e1', market: M1, root: '1', lo: 0n, hi: 10_000n, qty: 1_000_000, cost: 400_000, prob: 400_000_000 });
  assert.equal(loadPositions(d, 4999)[0]!.status, 'open');
  assert.equal(loadPositions(d, 4999)[0]!.pnl, null);
  assert.equal(loadPositions(d, 5000)[0]!.status, 'won');
});

test('expired but unsettled markets stay pending', () => {
  const d = db();
  market(d, M1, 5000, null);
  mint(d, { id: 'e1', market: M1, root: '1', lo: 0n, hi: 10_000n, qty: 1_000_000, cost: 400_000, prob: 400_000_000 });
  const [p] = loadPositions(d, 9999);
  assert.equal(p!.status, 'settling');
  assert.equal(p!.pnl, null);
});

test('win range is (lower, higher] with exact tick boundaries', () => {
  const d = db();
  market(d, M1, 5000, 10_000n * TICK); // settles exactly on $100.00
  mint(d, { id: 'down', market: M1, root: '1', lo: 0n, hi: 10_000n, qty: 1_000_000, cost: 500_000, prob: 500_000_000 });
  mint(d, { id: 'up', market: M1, root: '2', lo: 10_000n, hi: POS_INF_TICK, qty: 1_000_000, cost: 500_000, prob: 500_000_000 });
  const ps = loadPositions(d, 6000);
  assert.equal(ps.find((p) => p.rootId === '1')!.status, 'won'); // ≤ strike wins
  assert.equal(ps.find((p) => p.rootId === '2')!.status, 'lost'); // > strike needed
  assert.equal(ps.find((p) => p.rootId === '1')!.pnl, 0.5);
});

test('order ids repeat across markets: positions are keyed by (market, root)', () => {
  const d = db();
  market(d, M1, 5000, 1n * TICK);
  market(d, M2, 5000, 1n * TICK);
  mint(d, { id: 'a', market: M1, root: '7', lo: 0n, hi: 100n, qty: 1_000_000, cost: 100_000, prob: 100_000_000 });
  mint(d, { id: 'b', market: M2, root: '7', lo: 50n, hi: POS_INF_TICK, qty: 1_000_000, cost: 100_000, prob: 100_000_000 });
  d.prepare(`INSERT INTO claims VALUES ('c', 'D', 1, 6000, ?, ?, '7', 1000000)`).run(OWNER, M1);
  const ps = loadPositions(d, 6000);
  const a = ps.find((p) => p.marketId === M1)!;
  const b = ps.find((p) => p.marketId === M2)!;
  assert.equal(a.claimed, 1);
  assert.equal(b.claimed, null);
  assert.equal(a.status, 'won');
  assert.equal(b.status, 'lost');
});

test('partial early exit plus settlement of the remainder', () => {
  const d = db();
  market(d, M1, 5000, 1n * TICK);
  mint(d, { id: 'a', market: M1, root: '9', lo: 0n, hi: 100n, qty: 2_000_000, cost: 800_000, prob: 400_000_000 });
  d.prepare(`INSERT INTO exits VALUES ('x', 'X', 1, 3000, ?, ?, '9', 1000000, 1000000, 600000, 10000, 0, 0, 0, 590000)`).run(OWNER, M1);
  const [p] = loadPositions(d, 6000);
  assert.equal(p!.status, 'won');
  assert.equal(p!.settledValue, 1); // only the unexited $1 pays out
  assert.ok(Math.abs(p!.pnl! - (0.59 + 1 - 0.8)) < 1e-9);
  // Exited positions don't count toward held-to-expiry skill.
  assert.equal(walletStats(OWNER, [p!]).held.n, 0);
});
