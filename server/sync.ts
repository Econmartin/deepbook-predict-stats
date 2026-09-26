/** One-shot indexing pass: `npm run sync`. Safe to run from cron. */
import { openDb } from './db.js';
import { syncOnce } from './indexer.js';

const db = openDb();
const r = await syncOnce(db, Number(process.env.MAX_PAGES ?? 100_000));
console.log(JSON.stringify({ ok: true, ...r }));
