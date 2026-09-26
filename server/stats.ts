/**
 * Stats — everything the site shows, derived from the raw event tables.
 *
 * Positions are rebuilt from scratch on every snapshot (mint ⟶ optional live
 * exits ⟶ settlement), so there is no mutable "won" column that could drift
 * from the chain. A position has a result only when its market is past expiry
 * AND the chain has published a settlement price.
 */

import type { Db } from './db.js';
import { getMeta } from './db.js';
import { POS_INF_TICK } from './indexer.js';

const USDC = 1e6;
const FP = 1e9;

export type Status = 'open' | 'settling' | 'exited' | 'won' | 'lost';

export interface Position {
  /** Order ids are only unique within a market, so a position is (market, root). */
  rootId: string;
  owner: string;
  sender: string;
  marketId: string;
  underlying: string | null;
  digest: string;
  mintedAtMs: number;
  expiryMs: number | null;
  side: 'up' | 'down' | 'range';
  /** Strike bounds in USD; null = unbounded. */
  strikeLow: number | null;
  strikeHigh: number | null;
  entryProb: number;
  quantity: number;
  cost: number;
  mintFees: number;
  exitProceeds: number;
  exitQuantity: number;
  exitFees: number;
  exits: number;
  lastExitMs: number | null;
  lastExitDigest: string | null;
  settlement: number | null;
  status: Status;
  /** Value of the unexited remainder at settlement (USDC). */
  settledValue: number | null;
  /** Sum of SettledOrderRedeemed payouts seen on chain for this root. */
  claimed: number | null;
  claimDigest: string | null;
  /** Realized PnL after all fees; null until the position is closed or settled. */
  pnl: number | null;
  resolvedAtMs: number | null;
  secondsToExpiry: number | null;
}

interface Row {
  root_id: string;
  owner: string;
  sender: string;
  market_id: string;
  digest: string;
  ts_ms: number;
  lower_tick: string;
  higher_tick: string;
  side: 'up' | 'down' | 'range';
  entry_prob: number;
  quantity: number;
  cost: number;
  trading_fee: number;
  subsidy: number;
  builder_fee: number;
  penalty_fee: number;
  underlying: string | null;
  expiry_ms: number | null;
  tick_size: string | null;
  settlement_price: string | null;
  x_proceeds: number | null;
  x_qty: number | null;
  x_fees: number | null;
  x_n: number | null;
  x_last: number | null;
  x_digest: string | null;
  c_payout: number | null;
  c_digest: string | null;
}

export function loadPositions(db: Db, nowMs: number): Position[] {
  const rows = db
    .prepare(
      `SELECT m.root_id, m.owner, m.sender, m.market_id, m.digest, m.ts_ms, m.lower_tick, m.higher_tick,
              m.side, m.entry_prob, m.quantity, m.cost, m.trading_fee, m.subsidy, m.builder_fee,
              m.penalty_fee, k.underlying, k.expiry_ms, k.tick_size, k.settlement_price,
              x.proceeds AS x_proceeds, x.qty AS x_qty, x.fees AS x_fees, x.n AS x_n,
              x.last AS x_last, x.digest AS x_digest, c.payout AS c_payout, c.digest AS c_digest
       FROM mints m
       LEFT JOIN markets k ON k.market_id = m.market_id
       LEFT JOIN (
         SELECT market_id, root_id, SUM(proceeds) AS proceeds, SUM(quantity_closed) AS qty,
                SUM(trading_fee + builder_fee + penalty_fee) AS fees, COUNT(*) AS n,
                MAX(ts_ms) AS last,
                (SELECT e2.digest FROM exits e2 WHERE e2.market_id = e.market_id AND e2.root_id = e.root_id
                 ORDER BY e2.ts_ms DESC LIMIT 1) AS digest
         FROM exits e GROUP BY market_id, root_id
       ) x ON x.market_id = m.market_id AND x.root_id = m.root_id
       LEFT JOIN (
         SELECT market_id, root_id, SUM(payout) AS payout, MAX(digest) AS digest
         FROM claims GROUP BY market_id, root_id
       ) c ON c.market_id = m.market_id AND c.root_id = m.root_id
       WHERE m.root_id = m.order_id
       ORDER BY m.ts_ms ASC`,
    )
    .all() as unknown as Row[];

  return rows.map((r) => {
    const lo = BigInt(r.lower_tick);
    const hi = BigInt(r.higher_tick);
    const tick = r.tick_size == null ? null : BigInt(r.tick_size);
    const quantity = r.quantity / USDC;
    const cost = r.cost / USDC;
    const exitProceeds = (r.x_proceeds ?? 0) / USDC;
    const exitQuantity = (r.x_qty ?? 0) / USDC;
    const fullyExited = (r.x_qty ?? 0) >= r.quantity;
    const expired = r.expiry_ms != null && nowMs >= r.expiry_ms;
    const settledRaw = expired && r.settlement_price != null ? BigInt(r.settlement_price) : null;

    let status: Status;
    let settledValue: number | null = null;
    let pnl: number | null = null;
    let resolvedAtMs: number | null = null;
    if (fullyExited) {
      status = 'exited';
      pnl = exitProceeds - cost;
      resolvedAtMs = r.x_last;
    } else if (settledRaw != null && tick != null) {
      // Won iff settlement ∈ (lower, higher]; tick 0 = −∞, POS_INF = +∞. Exact integers.
      const aboveLow = lo === 0n || settledRaw > lo * tick;
      const belowHigh = hi === POS_INF_TICK || settledRaw <= hi * tick;
      const won = aboveLow && belowHigh;
      status = won ? 'won' : 'lost';
      settledValue = won ? (r.quantity - (r.x_qty ?? 0)) / USDC : 0;
      pnl = exitProceeds + settledValue - cost;
      resolvedAtMs = r.expiry_ms;
    } else {
      status = expired ? 'settling' : 'open';
    }

    const tickUsd = tick == null ? null : Number(tick) / FP;
    return {
      rootId: r.root_id,
      owner: r.owner,
      sender: r.sender,
      marketId: r.market_id,
      underlying: r.underlying,
      digest: r.digest,
      mintedAtMs: r.ts_ms,
      expiryMs: r.expiry_ms,
      side: r.side,
      strikeLow: lo === 0n || tickUsd == null ? null : Number(lo) * tickUsd,
      strikeHigh: hi === POS_INF_TICK || tickUsd == null ? null : Number(hi) * tickUsd,
      entryProb: r.entry_prob / FP,
      quantity,
      cost,
      mintFees: (r.trading_fee - r.subsidy + r.builder_fee + r.penalty_fee) / USDC,
      exitProceeds,
      exitQuantity,
      exitFees: (r.x_fees ?? 0) / USDC,
      exits: r.x_n ?? 0,
      lastExitMs: r.x_last,
      lastExitDigest: r.x_digest,
      settlement: settledRaw == null ? null : Number(settledRaw) / FP,
      status,
      settledValue,
      claimed: r.c_payout == null ? null : r.c_payout / USDC,
      claimDigest: r.c_digest,
      pnl,
      resolvedAtMs,
      secondsToExpiry: r.expiry_ms == null ? null : (r.expiry_ms - r.ts_ms) / 1000,
    };
  });
}

// ── wallets ──────────────────────────────────────────────────────────────────

export interface WalletStats {
  owner: string;
  positions: number;
  open: number;
  openCost: number;
  volume: number;
  notional: number;
  feesPaid: number;
  realizedPnl: number;
  resolvedSpent: number;
  roi: number | null;
  earlyExitRate: number;
  avgEntryProb: number;
  avgSecondsToExpiry: number | null;
  /** Held-to-expiry settled positions: realized wins vs the sum of entry probabilities. */
  held: { n: number; wins: number; expected: number; winRate: number | null; implied: number | null; z: number | null };
  sides: { up: number; down: number; range: number };
  firstMs: number;
  lastMs: number;
}

export function walletStats(owner: string, ps: Position[]): WalletStats {
  let volume = 0, notional = 0, fees = 0, pnl = 0, spent = 0, open = 0, openCost = 0;
  let exited = 0, probSum = 0, ttmSum = 0, ttmN = 0;
  let hn = 0, hw = 0, he = 0, hv = 0;
  const sides = { up: 0, down: 0, range: 0 };
  for (const p of ps) {
    volume += p.cost;
    notional += p.quantity;
    fees += p.mintFees + p.exitFees;
    probSum += p.entryProb;
    sides[p.side]++;
    if (p.exits > 0) exited++;
    if (p.secondsToExpiry != null) {
      ttmSum += p.secondsToExpiry;
      ttmN++;
    }
    if (p.pnl != null) {
      pnl += p.pnl;
      spent += p.cost;
    } else {
      open++;
      openCost += p.cost;
    }
    if (p.exits === 0 && (p.status === 'won' || p.status === 'lost')) {
      hn++;
      if (p.status === 'won') hw++;
      he += p.entryProb;
      hv += p.entryProb * (1 - p.entryProb);
    }
  }
  const n = ps.length;
  return {
    owner,
    positions: n,
    open,
    openCost,
    volume,
    notional,
    feesPaid: fees,
    realizedPnl: pnl,
    resolvedSpent: spent,
    roi: spent > 0 ? pnl / spent : null,
    earlyExitRate: n ? exited / n : 0,
    avgEntryProb: n ? probSum / n : 0,
    avgSecondsToExpiry: ttmN ? ttmSum / ttmN : null,
    held: {
      n: hn,
      wins: hw,
      expected: he,
      winRate: hn ? hw / hn : null,
      implied: hn ? he / hn : null,
      z: hv > 0 ? (hw - he) / Math.sqrt(hv) : null,
    },
    sides,
    firstMs: n ? ps[0]!.mintedAtMs : 0,
    lastMs: n ? ps[n - 1]!.mintedAtMs : 0,
  };
}

// ── markets ──────────────────────────────────────────────────────────────────

export interface MarketStats {
  marketId: string;
  underlying: string | null;
  expiryMs: number | null;
  status: 'open' | 'settling' | 'settled';
  settlement: number | null;
  positions: number;
  traders: number;
  volume: number;
  notional: number;
  sides: { up: number; down: number; range: number };
  exits: number;
  traderPnl: number | null;
  firstMintMs: number;
}

function marketStats(marketId: string, ps: Position[], nowMs: number): MarketStats {
  const p0 = ps[0]!;
  const owners = new Set<string>();
  const sides = { up: 0, down: 0, range: 0 };
  let volume = 0, notional = 0, exits = 0, pnl = 0, resolved = 0;
  let settlement: number | null = null;
  for (const p of ps) {
    owners.add(p.owner);
    sides[p.side]++;
    volume += p.cost;
    notional += p.quantity;
    if (p.exits) exits++;
    if (p.settlement != null) settlement = p.settlement;
    if (p.pnl != null) {
      pnl += p.pnl;
      resolved++;
    }
  }
  const expired = p0.expiryMs != null && nowMs >= p0.expiryMs;
  return {
    marketId,
    underlying: p0.underlying,
    expiryMs: p0.expiryMs,
    status: settlement != null ? 'settled' : expired ? 'settling' : 'open',
    settlement,
    positions: ps.length,
    traders: owners.size,
    volume,
    notional,
    sides,
    exits,
    traderPnl: resolved === ps.length ? pnl : null,
    firstMintMs: p0.mintedAtMs,
  };
}

// ── snapshot ─────────────────────────────────────────────────────────────────

interface Bucket {
  t: number;
  volume: number;
  positions: number;
  wallets: number;
  up: number;
  down: number;
  range: number;
  fees: number;
  traderPnl: number;
}

export interface Snapshot {
  builtAtMs: number;
  asOf: { checkpoint: number | null; lastEventMs: number | null; lastSyncMs: number | null };
  positions: Position[];
  byOwner: Map<string, Position[]>;
  byMarket: Map<string, Position[]>;
  wallets: WalletStats[];
  markets: MarketStats[];
  overview: ReturnType<typeof buildOverview>;
}

function bucketize(ps: Position[], sizeMs: number, sinceMs = 0): Bucket[] {
  const map = new Map<number, Bucket & { owners: Set<string> }>();
  for (const p of ps) {
    if (p.mintedAtMs < sinceMs) continue;
    const t = Math.floor(p.mintedAtMs / sizeMs) * sizeMs;
    let b = map.get(t);
    if (!b) {
      b = { t, volume: 0, positions: 0, wallets: 0, up: 0, down: 0, range: 0, fees: 0, traderPnl: 0, owners: new Set() };
      map.set(t, b);
    }
    b.volume += p.cost;
    b.positions++;
    b[p.side] += p.cost;
    b.fees += p.mintFees + p.exitFees;
    b.owners.add(p.owner);
  }
  // Trader PnL lands in the bucket where it was realized.
  for (const p of ps) {
    if (p.pnl == null || p.resolvedAtMs == null || p.resolvedAtMs < sinceMs) continue;
    const b = map.get(Math.floor(p.resolvedAtMs / sizeMs) * sizeMs);
    if (b) b.traderPnl += p.pnl;
  }
  return [...map.values()]
    .sort((a, b) => a.t - b.t)
    .map(({ owners, ...b }) => ({ ...b, wallets: owners.size }));
}

function calibration(ps: Position[], key: (p: Position) => number, edges: number[], labels: string[]) {
  const out = labels.map((label) => ({ label, n: 0, wins: 0, expected: 0, variance: 0 }));
  for (const p of ps) {
    if (p.exits !== 0 || (p.status !== 'won' && p.status !== 'lost')) continue;
    const v = key(p);
    let i = edges.findIndex((e) => v < e);
    if (i < 0) i = edges.length;
    const b = out[i];
    if (!b) continue;
    b.n++;
    if (p.status === 'won') b.wins++;
    b.expected += p.entryProb;
    b.variance += p.entryProb * (1 - p.entryProb);
  }
  return out.map((b) => ({
    label: b.label,
    n: b.n,
    winRate: b.n ? b.wins / b.n : null,
    implied: b.n ? b.expected / b.n : null,
    z: b.variance > 0 ? (b.wins - b.expected) / Math.sqrt(b.variance) : null,
  }));
}

function buildOverview(ps: Position[], wallets: WalletStats[], markets: MarketStats[], db: Db, nowMs: number) {
  const fees = db
    .prepare(
      `SELECT
         (SELECT COALESCE(SUM(trading_fee - subsidy), 0) FROM mints) AS mint_trading,
         (SELECT COALESCE(SUM(subsidy), 0) FROM mints) AS subsidy,
         (SELECT COALESCE(SUM(builder_fee), 0) FROM mints) + (SELECT COALESCE(SUM(builder_fee), 0) FROM exits) AS builder,
         (SELECT COALESCE(SUM(penalty_fee), 0) FROM mints) + (SELECT COALESCE(SUM(penalty_fee), 0) FROM exits) AS penalty,
         (SELECT COALESCE(SUM(referral_fee), 0) FROM mints) AS referral,
         (SELECT COALESCE(SUM(trading_fee), 0) FROM exits) AS exit_trading,
         (SELECT COALESCE(SUM(impact_charge), 0) FROM mints) AS impact_charge,
         (SELECT COALESCE(SUM(impact_rebate), 0) FROM exits) AS impact_rebate,
         (SELECT COUNT(*) FROM exits) AS exit_events,
         (SELECT COUNT(*) FROM claims) AS claim_events`,
    )
    .get() as Record<string, number>;

  let volume = 0, notional = 0, pnl = 0, resolved = 0, exited = 0;
  const sides = { up: 0, down: 0, range: 0 };
  const a24 = new Set<string>(), a7 = new Set<string>();
  let v24 = 0;
  for (const p of ps) {
    volume += p.cost;
    notional += p.quantity;
    sides[p.side] += p.cost;
    if (p.exits) exited++;
    if (p.pnl != null) {
      pnl += p.pnl;
      resolved++;
    }
    if (p.mintedAtMs >= nowMs - 86400_000) {
      a24.add(p.owner);
      v24 += p.cost;
    }
    if (p.mintedAtMs >= nowMs - 7 * 86400_000) a7.add(p.owner);
  }

  // Reconcile our computed settlement value against on-chain claim payouts.
  let claimChecked = 0, claimMatched = 0;
  for (const p of ps) {
    if (p.claimed == null || p.settledValue == null) continue;
    claimChecked++;
    if (Math.abs(p.claimed - p.settledValue) < 1e-6) claimMatched++;
  }

  const profitable = wallets.filter((w) => w.realizedPnl > 0).length;
  const withResolved = wallets.filter((w) => w.resolvedSpent > 0).length;

  return {
    totals: {
      volume,
      notional,
      positions: ps.length,
      wallets: wallets.length,
      markets: markets.length,
      settledMarkets: markets.filter((m) => m.status === 'settled').length,
      openMarkets: markets.filter((m) => m.status === 'open').length,
      exitRate: ps.length ? exited / ps.length : 0,
      volume24h: v24,
      active24h: a24.size,
      active7d: a7.size,
      traderPnl: pnl,
      resolvedPositions: resolved,
      profitableWallets: profitable,
      walletsWithResults: withResolved,
    },
    sides,
    fees: {
      trading: (fees.mint_trading! + fees.exit_trading!) / USDC,
      mintTrading: fees.mint_trading! / USDC,
      exitTrading: fees.exit_trading! / USDC,
      subsidy: fees.subsidy! / USDC,
      builder: fees.builder! / USDC,
      penalty: fees.penalty! / USDC,
      referral: fees.referral! / USDC,
      impactCharged: fees.impact_charge! / USDC,
      impactRebated: fees.impact_rebate! / USDC,
      total: (fees.mint_trading! + fees.exit_trading! + fees.builder! + fees.penalty!) / USDC,
    },
    reconciliation: { claimChecked, claimMatched, exitEvents: fees.exit_events!, claimEvents: fees.claim_events! },
    daily: bucketize(ps, 86400_000),
    hourly: bucketize(ps, 3600_000, nowMs - 7 * 86400_000),
    calibrationByProb: calibration(
      ps,
      (p) => p.entryProb,
      [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
      ['0–10¢', '10–20¢', '20–30¢', '30–40¢', '40–50¢', '50–60¢', '60–70¢', '70–80¢', '80–90¢', '90–100¢'],
    ),
    calibrationByTime: calibration(
      ps,
      (p) => p.secondsToExpiry ?? Infinity,
      [30, 60, 120, 300, 900, 3600],
      ['< 30s', '30–60s', '1–2m', '2–5m', '5–15m', '15–60m', '> 1h'],
    ),
  };
}

export function buildSnapshot(db: Db, nowMs = Date.now()): Snapshot {
  const positions = loadPositions(db, nowMs);
  const byOwner = new Map<string, Position[]>();
  const byMarket = new Map<string, Position[]>();
  for (const p of positions) {
    (byOwner.get(p.owner) ?? byOwner.set(p.owner, []).get(p.owner)!).push(p);
    (byMarket.get(p.marketId) ?? byMarket.set(p.marketId, []).get(p.marketId)!).push(p);
  }
  const wallets = [...byOwner].map(([o, ps]) => walletStats(o, ps));
  const markets = [...byMarket]
    .map(([m, ps]) => marketStats(m, ps, nowMs))
    .sort((a, b) => (b.expiryMs ?? 0) - (a.expiryMs ?? 0));
  const cp = getMeta(db, 'last_checkpoint');
  const le = getMeta(db, 'last_event_ms');
  const ls = getMeta(db, 'last_sync_ms');
  return {
    builtAtMs: nowMs,
    asOf: {
      checkpoint: cp ? Number(cp) : null,
      lastEventMs: le ? Number(le) : null,
      lastSyncMs: ls ? Number(ls) : null,
    },
    positions,
    byOwner,
    byMarket,
    wallets,
    markets,
    overview: buildOverview(positions, wallets, markets, db, nowMs),
  };
}

/** Cumulative realized PnL, one point per resolution. */
export function pnlCurve(ps: Position[]): Array<{ t: number; pnl: number }> {
  const done = ps
    .filter((p) => p.pnl != null && p.resolvedAtMs != null)
    .sort((a, b) => a.resolvedAtMs! - b.resolvedAtMs!);
  let acc = 0;
  return done.map((p) => ({ t: p.resolvedAtMs!, pnl: (acc += p.pnl!) }));
}
