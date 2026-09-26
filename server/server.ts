/**
 * Read API + static frontend, with the indexer running in-process.
 *
 *   PORT          (default 8787)
 *   DB_PATH       (default data/predict.db)
 *   SYNC_INTERVAL_MS  (default 15000; 0 disables the in-process poller,
 *                      e.g. when a cron job runs `npm run sync` instead)
 *
 * Everything served here is derived from public chain data. There are no
 * secrets, no keys, and no write endpoints.
 */

import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { normalizeSuiAddress, isValidSuiAddress } from '@mysten/sui/utils';
import { existsSync, readFileSync } from 'node:fs';
import { openDb } from './db.js';
import { syncOnce } from './indexer.js';
import { buildSnapshot, pnlCurve, walletStats, type Position, type Snapshot } from './stats.js';
import { GRPC_URL, NETWORK, sdkConfig } from './chain.js';

const db = openDb();
let snap: Snapshot = buildSnapshot(db);

function refresh() {
  snap = buildSnapshot(db);
}

async function loop(intervalMs: number) {
  for (;;) {
    try {
      const r = await syncOnce(db);
      refresh();
      if (r.mints || r.exits || r.claims || r.settled) console.log('[sync]', JSON.stringify(r));
    } catch (e) {
      console.error('[sync] failed', e instanceof Error ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

const interval = Number(process.env.SYNC_INTERVAL_MS ?? 15_000);
if (interval > 0) void loop(interval);
// With an external cron doing the syncing, still pick up its writes.
else setInterval(refresh, 30_000);

const asOf = () => ({ ...snap.asOf, builtAtMs: snap.builtAtMs });

function pos(p: Position) {
  return { ...p, id: `${p.marketId}:${p.rootId}`, viaSessionKey: p.sender !== p.owner };
}

const app = new Hono();
app.use('/api/*', cors());
app.use('/api/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'public, max-age=10');
});

app.get('/api/meta', (c) =>
  c.json({
    asOf: asOf(),
    network: NETWORK,
    grpc: GRPC_URL,
    packages: sdkConfig().packages,
    eventModule: `${sdkConfig().packages.predictV1}::order_events`,
    quoteCoin: sdkConfig().quoteCoinType,
  }),
);

app.get('/api/overview', (c) => {
  const top = [...snap.wallets].sort((a, b) => b.realizedPnl - a.realizedPnl);
  return c.json({
    asOf: asOf(),
    ...snap.overview,
    topWinners: top.slice(0, 10),
    recent: snap.positions.slice(-12).reverse().map(pos),
    liveMarkets: snap.markets.filter((m) => m.status !== 'settled').slice(0, 8),
  });
});

app.get('/api/leaderboard', (c) => {
  const by = c.req.query('by') === 'skill' ? 'skill' : 'pnl';
  const min = Math.max(1, Number(c.req.query('min') ?? (by === 'skill' ? 20 : 5)) || 1);
  const dir = c.req.query('dir') === 'asc' ? 1 : -1;
  const limit = Math.min(500, Number(c.req.query('limit') ?? 100) || 100);
  let rows = snap.wallets;
  if (by === 'skill') {
    rows = rows
      .filter((w) => w.held.n >= min && w.held.z != null)
      .sort((a, b) => dir * (a.held.z! - b.held.z!));
  } else {
    rows = rows
      .filter((w) => w.positions - w.open >= min)
      .sort((a, b) => dir * (a.realizedPnl - b.realizedPnl));
  }
  return c.json({ asOf: asOf(), by, min, total: rows.length, rows: rows.slice(0, limit) });
});

app.get('/api/wallet/:addr', (c) => {
  const raw = c.req.param('addr').trim();
  if (!isValidSuiAddress(normalizeSuiAddress(raw))) return c.json({ error: 'invalid address' }, 400);
  const owner = normalizeSuiAddress(raw).toLowerCase();
  const ps = snap.byOwner.get(owner) ?? [];
  const w = walletStats(owner, ps);
  const rank = [...snap.wallets].sort((a, b) => b.realizedPnl - a.realizedPnl).findIndex((x) => x.owner === owner);
  const sessionKeys = [...new Set(ps.map((p) => p.sender).filter((s) => s !== owner))];
  return c.json({
    asOf: asOf(),
    owner,
    found: ps.length > 0,
    stats: w,
    rank: rank >= 0 ? { pnl: rank + 1, of: snap.wallets.length } : null,
    sessionKeys,
    curve: pnlCurve(ps),
    positions: ps.slice().reverse().slice(0, 2000).map(pos),
  });
});

app.get('/api/markets', (c) => {
  const status = c.req.query('status');
  const limit = Math.min(500, Number(c.req.query('limit') ?? 100) || 100);
  const offset = Math.max(0, Number(c.req.query('offset') ?? 0) || 0);
  const sort = c.req.query('sort') ?? 'expiry';
  let rows = status ? snap.markets.filter((m) => m.status === status) : snap.markets;
  if (sort === 'volume') rows = [...rows].sort((a, b) => b.volume - a.volume);
  if (sort === 'traders') rows = [...rows].sort((a, b) => b.traders - a.traders);
  return c.json({ asOf: asOf(), total: rows.length, rows: rows.slice(offset, offset + limit) });
});

app.get('/api/market/:id', (c) => {
  const id = normalizeSuiAddress(c.req.param('id')).toLowerCase();
  const m = snap.markets.find((x) => x.marketId === id);
  if (!m) return c.json({ error: 'not found' }, 404);
  return c.json({ asOf: asOf(), market: m, positions: (snap.byMarket.get(id) ?? []).slice().reverse().map(pos) });
});

app.get('/api/health', (c) => c.json({ ok: true, asOf: asOf() }));

// Static frontend (built by `npm run build`), with SPA fallback.
const dist = 'web/dist';
if (existsSync(dist)) {
  app.use('/*', serveStatic({ root: dist }));
  // Re-read per request so a rebuild never serves stale asset hashes.
  app.get('*', (c) => c.html(readFileSync(`${dist}/index.html`, 'utf8')));
}

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`predict-stats on http://localhost:${port}`));
