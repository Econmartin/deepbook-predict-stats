/**
 * Indexer — pages Predict order events over gRPC and resolves settlements.
 *
 * Each event stream is paged ASCENDING from the very first event, with the
 * gRPC cursor persisted after every page as the watermark. Rows are keyed by
 * `digest:eventIndex`, so a crash mid-page just replays that page harmlessly.
 *
 * Correctness rules (see README):
 *   - Attribute by the event's `owner`, never the tx sender (session keys).
 *   - Net every fee into mint cost / redeem proceeds.
 *   - Record a settlement price ONLY once the market is past expiry AND the
 *     chain has written `settlement_price`. Never infer a result earlier.
 */

import { normalizeSuiAddress } from '@mysten/sui/utils';
import { eventPage, readMarket, type ChainEvent, type EventName } from './chain.js';
import { getMeta, setMeta, tx, type Db } from './db.js';

export const POS_INF_TICK = (1n << 30n) - 1n;

export function sideOf(lower: bigint, higher: bigint): 'up' | 'down' | 'range' {
  if (lower === 0n) return 'down';
  if (higher === POS_INF_TICK) return 'up';
  return 'range';
}

const big = (v: string | null | undefined): bigint => (v == null || v === '' ? 0n : BigInt(v));
const addr = (v: string | null | undefined): string => normalizeSuiAddress(String(v ?? '')).toLowerCase();
const eventId = (e: ChainEvent) => `${e.digest}:${e.eventIndex}`;

/** All-in trader debit for a mint, in USDC base units. */
export function mintCost(j: Record<string, string | null>): bigint {
  return (
    big(j.premium) +
    big(j.trading_fee) -
    big(j.fee_incentive_subsidy) +
    big(j.builder_fee) +
    big(j.penalty_fee) +
    big(j.inventory_impact_charge)
  );
}

/** Net trader credit for a live (pre-expiry) close, in USDC base units. */
export function redeemProceeds(j: Record<string, string | null>): bigint {
  return (
    big(j.redeem_amount) -
    big(j.trading_fee) -
    big(j.builder_fee) -
    big(j.penalty_fee) +
    big(j.inventory_impact_rebate)
  );
}

function insertMints(db: Db, events: ChainEvent[]): number {
  const stmt = db.prepare(`INSERT OR IGNORE INTO mints (event_id, digest, checkpoint, ts_ms, owner, sender,
      market_id, order_id, root_id, lower_tick, higher_tick, side, entry_prob, quantity, premium,
      trading_fee, subsidy, builder_fee, penalty_fee, referral_fee, impact_charge, cost)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let n = 0;
  for (const e of events) {
    const j = e.json;
    const lo = big(j.lower_tick);
    const hi = big(j.higher_tick);
    n += Number(
      stmt.run(
        eventId(e),
        e.digest,
        e.checkpoint,
        Number(j.onchain_timestamp_ms),
        addr(j.owner),
        addr(e.sender),
        addr(j.expiry_market_id),
        String(j.order_id),
        String(j.position_root_id ?? j.order_id),
        lo.toString(),
        hi.toString(),
        sideOf(lo, hi),
        Number(big(j.entry_probability)),
        Number(big(j.quantity)),
        Number(big(j.premium)),
        Number(big(j.trading_fee)),
        Number(big(j.fee_incentive_subsidy)),
        Number(big(j.builder_fee)),
        Number(big(j.penalty_fee)),
        Number(big(j.referral_fee)),
        Number(big(j.inventory_impact_charge)),
        Number(mintCost(j)),
      ).changes,
    );
  }
  return n;
}

function insertExits(db: Db, events: ChainEvent[]): number {
  const stmt = db.prepare(`INSERT OR IGNORE INTO exits (event_id, digest, checkpoint, ts_ms, owner,
      market_id, root_id, quantity_closed, remaining, redeem_amount, trading_fee, builder_fee,
      penalty_fee, impact_rebate, proceeds)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let n = 0;
  for (const e of events) {
    const j = e.json;
    n += Number(
      stmt.run(
        eventId(e),
        e.digest,
        e.checkpoint,
        Number(j.onchain_timestamp_ms),
        addr(j.owner),
        addr(j.expiry_market_id),
        String(j.position_root_id ?? j.order_id),
        Number(big(j.quantity_closed)),
        Number(big(j.remaining_quantity)),
        Number(big(j.redeem_amount)),
        Number(big(j.trading_fee)),
        Number(big(j.builder_fee)),
        Number(big(j.penalty_fee)),
        Number(big(j.inventory_impact_rebate)),
        Number(redeemProceeds(j)),
      ).changes,
    );
  }
  return n;
}

function insertClaims(db: Db, events: ChainEvent[]): number {
  const stmt = db.prepare(`INSERT OR IGNORE INTO claims (event_id, digest, checkpoint, ts_ms, owner,
      market_id, root_id, payout) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  let n = 0;
  for (const e of events) {
    const j = e.json;
    n += Number(
      stmt.run(
        eventId(e),
        e.digest,
        e.checkpoint,
        Number(j.onchain_timestamp_ms),
        addr(j.owner),
        addr(j.expiry_market_id),
        String(j.position_root_id ?? j.order_id),
        Number(big(j.payout_amount)),
      ).changes,
    );
  }
  return n;
}

const INSERTERS: Record<EventName, (db: Db, e: ChainEvent[]) => number> = {
  OrderMinted: insertMints,
  LiveOrderRedeemed: insertExits,
  SettledOrderRedeemed: insertClaims,
};

async function syncStream(db: Db, name: EventName, maxPages: number): Promise<number> {
  const key = `cursor:${name}`;
  let cursor = getMeta(db, key);
  let added = 0;
  for (let page = 0; page < maxPages; page++) {
    const r = await eventPage(name, cursor);
    tx(db, () => {
      added += INSERTERS[name](db, r.events);
      const last = r.events.at(-1);
      if (last) {
        const prev = Number(getMeta(db, 'last_checkpoint') ?? 0);
        if (last.checkpoint > prev) {
          setMeta(db, 'last_checkpoint', String(last.checkpoint));
          setMeta(db, 'last_event_ms', String(last.json.onchain_timestamp_ms));
        }
      }
      if (r.nextCursor) setMeta(db, key, r.nextCursor);
    });
    cursor = r.nextCursor;
    if (!r.hasNextPage) break;
  }
  return added;
}

async function pool<T>(items: T[], size: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]!);
    }),
  );
}

/** Load immutable market fields (expiry, tick size, underlying) for new markets. */
async function discoverMarkets(db: Db): Promise<number> {
  const ids = (
    db
      .prepare(
        `SELECT DISTINCT market_id FROM (SELECT market_id FROM mints UNION SELECT market_id FROM exits)
         WHERE market_id NOT IN (SELECT market_id FROM markets)`,
      )
      .all() as Array<{ market_id: string }>
  ).map((r) => r.market_id);
  const ins = db.prepare(
    `INSERT OR IGNORE INTO markets (market_id, underlying, expiry_ms, tick_size) VALUES (?, ?, ?, ?)`,
  );
  let n = 0;
  await pool(ids, 4, async (id) => {
    const m = await readMarket(id);
    if (!m) return;
    ins.run(id, m.underlying, m.expiryMs, m.tickSizeRaw.toString());
    n++;
  });
  return n;
}

/**
 * Fetch settlement for markets that are past expiry and not yet settled.
 * A settlement is written only when BOTH hold at read time: now ≥ expiry and
 * the chain's `settlement_price` is set.
 */
async function resolveSettlements(db: Db, nowMs: number): Promise<number> {
  const ids = (
    db
      .prepare(
        `SELECT market_id FROM markets WHERE settlement_price IS NULL AND expiry_ms <= ?
         ORDER BY expiry_ms ASC LIMIT 2000`,
      )
      .all(nowMs) as Array<{ market_id: string }>
  ).map((r) => r.market_id);
  const upd = db.prepare(
    `UPDATE markets SET settlement_price = ?, settled_seen_ms = ? WHERE market_id = ? AND settlement_price IS NULL`,
  );
  let n = 0;
  await pool(ids, 4, async (id) => {
    const m = await readMarket(id);
    const readAt = Date.now();
    if (!m || m.settlementRaw == null || readAt < m.expiryMs) return;
    n += Number(upd.run(m.settlementRaw.toString(), readAt, id).changes);
  });
  return n;
}

export interface SyncResult {
  mints: number;
  exits: number;
  claims: number;
  markets: number;
  settled: number;
  ms: number;
}

let running: Promise<SyncResult> | null = null;

/** One indexing pass. Concurrent callers share the in-flight pass. */
export function syncOnce(db: Db, maxPages = 1000): Promise<SyncResult> {
  running ??= (async () => {
    const t0 = Date.now();
    // Mints before exits/claims only matters for display; rows join at read time.
    const mints = await syncStream(db, 'OrderMinted', maxPages);
    const exits = await syncStream(db, 'LiveOrderRedeemed', maxPages);
    const claims = await syncStream(db, 'SettledOrderRedeemed', maxPages);
    const markets = await discoverMarkets(db);
    const settled = await resolveSettlements(db, Date.now());
    setMeta(db, 'last_sync_ms', String(Date.now()));
    return { mints, exits, claims, markets, settled, ms: Date.now() - t0 };
  })().finally(() => {
    running = null;
  });
  return running;
}
