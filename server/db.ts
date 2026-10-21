/**
 * SQLite store (Node's built-in `node:sqlite`, no native build step).
 *
 * Every row is a verbatim copy of a public on-chain event or object field,
 * keyed by `digest:eventIndex` so re-indexing is idempotent. Amounts stay in
 * raw base units (USDC 1e6, probabilities and prices 1e9); conversion to
 * display units happens only at the edge. Delete the file and re-run the
 * indexer and you get the same database back.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS mints (
  event_id TEXT PRIMARY KEY,
  digest TEXT NOT NULL,
  checkpoint INTEGER NOT NULL,
  ts_ms INTEGER NOT NULL,
  owner TEXT NOT NULL,
  sender TEXT NOT NULL,
  market_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  root_id TEXT NOT NULL,
  lower_tick TEXT NOT NULL,
  higher_tick TEXT NOT NULL,
  side TEXT NOT NULL,
  entry_prob INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  premium INTEGER NOT NULL,
  trading_fee INTEGER NOT NULL,
  subsidy INTEGER NOT NULL,
  builder_fee INTEGER NOT NULL,
  penalty_fee INTEGER NOT NULL,
  referral_fee INTEGER NOT NULL,
  impact_charge INTEGER NOT NULL,
  cost INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_mints_owner ON mints(owner);
CREATE INDEX IF NOT EXISTS ix_mints_market ON mints(market_id);
CREATE INDEX IF NOT EXISTS ix_mints_root ON mints(market_id, root_id);

CREATE TABLE IF NOT EXISTS exits (
  event_id TEXT PRIMARY KEY,
  digest TEXT NOT NULL,
  checkpoint INTEGER NOT NULL,
  ts_ms INTEGER NOT NULL,
  owner TEXT NOT NULL,
  market_id TEXT NOT NULL,
  root_id TEXT NOT NULL,
  quantity_closed INTEGER NOT NULL,
  remaining INTEGER NOT NULL,
  redeem_amount INTEGER NOT NULL,
  trading_fee INTEGER NOT NULL,
  builder_fee INTEGER NOT NULL,
  penalty_fee INTEGER NOT NULL,
  impact_rebate INTEGER NOT NULL,
  proceeds INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_exits_root2 ON exits(market_id, root_id);

CREATE TABLE IF NOT EXISTS claims (
  event_id TEXT PRIMARY KEY,
  digest TEXT NOT NULL,
  checkpoint INTEGER NOT NULL,
  ts_ms INTEGER NOT NULL,
  owner TEXT NOT NULL,
  market_id TEXT NOT NULL,
  root_id TEXT NOT NULL,
  payout INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_claims_root2 ON claims(market_id, root_id);

CREATE TABLE IF NOT EXISTS markets (
  market_id TEXT PRIMARY KEY,
  underlying TEXT NOT NULL,
  expiry_ms INTEGER NOT NULL,
  tick_size TEXT NOT NULL,
  settlement_price TEXT,
  settled_seen_ms INTEGER
);

-- Predict accounts (the account package), mapped to their owners.
CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  created_ts_ms INTEGER
);
CREATE INDEX IF NOT EXISTS ix_accounts_owner ON accounts(owner);

-- Every USDC movement in or out of an account. kind: deposit | withdraw | settle.
-- Trade debits/credits are separated from real deposits at read time by
-- matching them against the trade events in the same transaction.
CREATE TABLE IF NOT EXISTS account_flows (
  event_id TEXT PRIMARY KEY,
  digest TEXT NOT NULL,
  checkpoint INTEGER NOT NULL,
  event_index INTEGER NOT NULL,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  amount INTEGER NOT NULL,
  new_balance INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_flows_account ON account_flows(account_id);
CREATE INDEX IF NOT EXISTS ix_flows_digest ON account_flows(digest);

-- Predict v4 queued orders (deepbook_predict_orders::queue_events).
-- An enqueue debits the trader's account (escrow + order fee) in their own
-- transaction; a keeper fills it later. kind: 0-2 mint, 4 sell.
CREATE TABLE IF NOT EXISTS enqueues (
  event_id TEXT PRIMARY KEY,
  digest TEXT NOT NULL,
  checkpoint INTEGER NOT NULL,
  ts_ms INTEGER NOT NULL,
  account_id TEXT NOT NULL,
  market_id TEXT NOT NULL,
  kind INTEGER NOT NULL,
  budget INTEGER NOT NULL,
  order_fee INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_enqueues_digest ON enqueues(digest);

-- A keeper fill: carries the order fee, which OrderMinted / LiveOrderRedeemed
-- don't, and the position it opened (order_id, root_id; zero after a full close).
CREATE TABLE IF NOT EXISTS queue_fills (
  event_id TEXT PRIMARY KEY,
  digest TEXT NOT NULL,
  checkpoint INTEGER NOT NULL,
  ts_ms INTEGER NOT NULL,
  account_id TEXT NOT NULL,
  market_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  kind INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  order_fee INTEGER NOT NULL,
  order_id TEXT NOT NULL,
  root_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_queue_fills_order ON queue_fills(market_id, order_id);
CREATE INDEX IF NOT EXISTS ix_queue_fills_digest ON queue_fills(digest, market_id);

-- Settlement payouts the keeper pays to each held record (zero for a loser).
-- Replaces SettledOrderRedeemed; keyed by the record's current order id.
CREATE TABLE IF NOT EXISTS record_settles (
  event_id TEXT PRIMARY KEY,
  digest TEXT NOT NULL,
  checkpoint INTEGER NOT NULL,
  ts_ms INTEGER NOT NULL,
  account_id TEXT NOT NULL,
  market_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  payout INTEGER NOT NULL
);

-- Every settlement payout, from either protocol version, keyed by position root.
CREATE VIEW IF NOT EXISTS all_claims AS
  SELECT digest, ts_ms, market_id, root_id, payout FROM claims
  UNION ALL
  SELECT s.digest, s.ts_ms, s.market_id, COALESCE(f.root_id, s.order_id), s.payout
  FROM record_settles s
  LEFT JOIN queue_fills f ON f.market_id = s.market_id AND f.order_id = s.order_id AND f.order_id <> '0';

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export type Db = DatabaseSync;

export function openDb(path = process.env.DB_PATH || 'data/predict.db'): Db {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  db.exec(SCHEMA);
  return db;
}

export function getMeta(db: Db, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setMeta(db: Db, key: string, value: string): void {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
