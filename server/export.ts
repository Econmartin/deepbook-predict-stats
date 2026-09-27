/**
 * Static export — writes every view the site needs as plain JSON files, so
 * the whole site can be served by any static host (GitHub Pages, a CDN, or
 * the bundled server).
 *
 *   data/meta.json            deployment + as-of info
 *   data/live-base.json       what the snapshot already counts for unexpired markets,
 *                             so browsers can add live chain events on top exactly
 *   data/overview.json        board stats, charts, calibration
 *   data/wallets.json         every wallet's stats (leaderboards filter client-side)
 *   data/wallet/<addr>.json   one wallet: stats, PnL curve, positions
 *   data/markets/<view>.json  recent / top-volume / top-traders market lists
 *   data/market/<id>.json     one market and its positions
 *   predict.db.gz             the full SQLite database, for anyone to verify
 *   og.png                    the social share card, redrawn from this snapshot
 *
 * Usage: `npm run export -- <outDir>` (default web/dist).
 */

import { mkdirSync, rmSync, writeFileSync, readFileSync, renameSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { GRPC_URL, NETWORK, sdkConfig } from './chain.js';
import type { Db } from './db.js';
import { pnlCurve, type Position, type Snapshot } from './stats.js';
import { renderOgCard } from './og.js';

/** Redraw the social share card from the snapshot. */
export async function writeOgCard(snap: Snapshot, outDir: string): Promise<void> {
  writeFileSync(join(outDir, 'og.png'), await renderOgCard(snap));
}

/** Keep the published site bounded (GitHub Pages caps a site at 1 GB). */
const MARKET_FILE_DAYS = 30;
const WALLET_POSITIONS = 2000;

/** Downsample a cumulative PnL curve to at most `n` points for sparklines. */
function spark(curve: Array<{ t: number; pnl: number }>, n = 40): number[] {
  if (curve.length <= n) return [0, ...curve.map((c) => c.pnl)];
  const out = [0];
  for (let i = 1; i <= n; i++) out.push(curve[Math.round((i / n) * (curve.length - 1))]!.pnl);
  return out;
}

const pos = (p: Position) => ({ ...p, id: `${p.marketId}:${p.rootId}`, viaSessionKey: p.sender !== p.owner });

function write(path: string, data: unknown) {
  writeFileSync(path, JSON.stringify(data));
}

export function exportStatic(snap: Snapshot, outDir: string, db?: Db): { files: number } {
  const asOf = { ...snap.asOf, builtAtMs: snap.builtAtMs };
  // Build into a temp dir and swap, so a server never serves a half-written set.
  const tmp = join(outDir, `.data-${process.pid}`);
  rmSync(tmp, { recursive: true, force: true });
  for (const d of ['wallet', 'market', 'markets']) mkdirSync(join(tmp, d), { recursive: true });
  let files = 0;
  const put = (rel: string, data: unknown) => {
    write(join(tmp, rel), data);
    files++;
  };

  put('meta.json', {
    asOf,
    network: NETWORK,
    grpc: GRPC_URL,
    packages: sdkConfig().packages,
    eventModule: `${sdkConfig().packages.predictV1}::order_events`,
    quoteCoin: sdkConfig().quoteCoinType,
  });

  // Markets still open at export time, with their trader sets, so the browser
  // can merge live mints (checkpoint > mintCheckpoint) without double counting.
  put('live-base.json', {
    asOf,
    openMarkets: snap.markets
      .filter((m) => m.expiryMs != null && m.expiryMs > snap.builtAtMs)
      .map((m) => ({ ...m, owners: [...new Set((snap.byMarket.get(m.marketId) ?? []).map((p) => p.owner))] })),
  });

  // Best of the last 24h: PnL realized (settled or sold) inside the window.
  const since = snap.builtAtMs - 86400_000;
  const day = new Map<string, { owner: string; pnl: number; resolved: number; wins: number; spent: number }>();
  for (const p of snap.positions) {
    if (p.pnl == null || p.resolvedAtMs == null || p.resolvedAtMs < since) continue;
    const d = day.get(p.owner) ?? { owner: p.owner, pnl: 0, resolved: 0, wins: 0, spent: 0 };
    day.set(p.owner, d);
    d.pnl += p.pnl;
    d.resolved++;
    d.spent += p.cost;
    if (p.status === 'won' || (p.status === 'exited' && p.pnl > 0)) d.wins++;
  }
  const top24h = [...day.values()]
    .filter((d) => d.pnl > 0)
    .sort((a, b) => b.pnl - a.pnl)
    .slice(0, 3)
    .map((d) => ({ ...d, roi: d.spent > 0 ? d.pnl / d.spent : null }));

  const byPnl = [...snap.wallets].sort((a, b) => b.realizedPnl - a.realizedPnl);
  put('overview.json', {
    asOf,
    ...snap.overview,
    top24h,
    topWinners: byPnl.slice(0, 10).map((w) => ({ ...w, spark: spark(pnlCurve(snap.byOwner.get(w.owner) ?? [])) })),
    // Skill board: held-to-expiry z-score, with a minimum sample so one lucky ticket can't top it.
    topSkill: snap.wallets
      .filter((w) => w.held.n >= 20 && w.held.z != null)
      .sort((a, b) => b.held.z! - a.held.z!)
      .slice(0, 10)
      .map((w) => ({ ...w, spark: spark(pnlCurve(snap.byOwner.get(w.owner) ?? [])) })),
    recent: snap.positions.slice(-12).reverse().map(pos),
    liveMarkets: snap.markets.filter((m) => m.status !== 'settled').slice(0, 8),
  });

  put('wallets.json', { asOf, rows: byPnl });

  byPnl.forEach((w, i) => {
    const ps = snap.byOwner.get(w.owner) ?? [];
    put(`wallet/${w.owner}.json`, {
      asOf,
      owner: w.owner,
      found: true,
      stats: w,
      rank: { pnl: i + 1, of: byPnl.length },
      sessionKeys: [...new Set(ps.map((p) => p.sender).filter((s) => s !== w.owner))],
      curve: pnlCurve(ps),
      positions: ps.slice(-WALLET_POSITIONS).reverse().map(pos),
    });
  });

  // Per-market pages for the last 30 days plus anything on a top list.
  const topVolume = [...snap.markets].sort((a, b) => b.volume - a.volume).slice(0, 500);
  const topTraders = [...snap.markets].sort((a, b) => b.traders - a.traders || b.volume - a.volume).slice(0, 500);
  const recent = snap.markets.slice(0, 1000);
  const keep = new Set([...topVolume, ...topTraders, ...recent].map((m) => m.marketId));
  const cutoff = snap.builtAtMs - MARKET_FILE_DAYS * 86400_000;
  for (const m of snap.markets) {
    if (!keep.has(m.marketId) && (m.expiryMs ?? 0) < cutoff) continue;
    put(`market/${m.marketId}.json`, {
      asOf,
      market: m,
      positions: (snap.byMarket.get(m.marketId) ?? []).slice().reverse().map(pos),
    });
  }
  put('markets/recent.json', { asOf, total: snap.markets.length, rows: recent });
  put('markets/top-volume.json', { asOf, total: snap.markets.length, rows: topVolume });
  put('markets/top-traders.json', { asOf, total: snap.markets.length, rows: topTraders });

  const dest = join(outDir, 'data');
  const old = join(outDir, `.data-old-${process.pid}`);
  if (existsSync(dest)) renameSync(dest, old);
  renameSync(tmp, dest);
  rmSync(old, { recursive: true, force: true });

  if (db) {
    // A consistent copy of the live DB, gzipped, published next to the site.
    const copy = join(outDir, `.predict-${process.pid}.db`);
    rmSync(copy, { force: true });
    db.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
    writeFileSync(join(outDir, 'predict.db.gz'), gzipSync(readFileSync(copy), { level: 9 }));
    rmSync(copy, { force: true });
    files++;
  }
  return { files };
}

// CLI: `npm run export -- web/dist`
if (import.meta.url === `file://${process.argv[1]}`) {
  const { openDb } = await import('./db.js');
  const { buildSnapshot } = await import('./stats.js');
  const outDir = process.argv[2] ?? 'web/dist';
  mkdirSync(outDir, { recursive: true });
  const db = openDb();
  const t0 = Date.now();
  const snap = buildSnapshot(db);
  const r = exportStatic(snap, outDir, db);
  await writeOgCard(snap, outDir);
  console.log(JSON.stringify({ ok: true, outDir, ...r, ms: Date.now() - t0 }));
}
