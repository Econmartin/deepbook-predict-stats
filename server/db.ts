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
