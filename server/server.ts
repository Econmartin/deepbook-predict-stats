/**
 * Self-hosted mode: the indexer runs in-process and re-exports the static
 * JSON after every pass, and this server hosts the site plus that export —
 * the exact same files the GitHub Pages build publishes.
 *
 *   PORT              (default 8787)
 *   DB_PATH           (default data/predict.db)
 *   EXPORT_DIR        (default data/site)
 *   SYNC_INTERVAL_MS  (default 15000; 0 disables the in-process poller)
 *
 * Everything served is derived from public chain data. No secrets, no keys,
 * no write endpoints.
 */

import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { openDb } from './db.js';
import { syncOnce } from './indexer.js';
import { buildSnapshot } from './stats.js';
import { exportStatic, writeOgCard } from './export.js';

const db = openDb();
const exportDir = process.env.EXPORT_DIR || 'data/site';
mkdirSync(exportDir, { recursive: true });

const DB_EXPORT_EVERY_MS = 10 * 60_000;
let lastDbExport = 0;

function publish() {
  const withDb = Date.now() - lastDbExport > DB_EXPORT_EVERY_MS;
  const snap = buildSnapshot(db);
  exportStatic(snap, exportDir, withDb ? db : undefined);
  if (withDb) {
    lastDbExport = Date.now();
    // The share card changes slowly and takes a moment to draw.
    writeOgCard(snap, exportDir).catch((e) => console.error('[og] failed', e));
  }
}

async function loop(intervalMs: number) {
  for (;;) {
    try {
      const r = await syncOnce(db);
      publish();
      if (r.mints || r.exits || r.claims || r.settled) console.log('[sync]', JSON.stringify(r));
    } catch (e) {
      console.error('[sync] failed', e instanceof Error ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

publish();
const interval = Number(process.env.SYNC_INTERVAL_MS ?? 15_000);
if (interval > 0) void loop(interval);

const app = new Hono();
app.use('/data/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'public, max-age=10');
  c.header('Access-Control-Allow-Origin', '*');
});
app.use('/data/*', serveStatic({ root: exportDir }));
app.use('/predict.db.gz', serveStatic({ root: exportDir }));
app.use('/og.png', serveStatic({ root: exportDir }));
app.get('/health', (c) => c.json({ ok: true }));

const dist = 'web/dist';
if (existsSync(dist)) {
  app.use('/*', serveStatic({ root: dist }));
  // SPA fallback; re-read so a rebuild never serves stale asset hashes.
  app.get('*', (c) => c.html(readFileSync(`${dist}/index.html`, 'utf8')));
}

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`predict-stats on http://localhost:${port}`));
