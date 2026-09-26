/**
 * `npm run verify` — reconcile the local database against the chain's own
 * accounting. For every position claimed on-chain (SettledOrderRedeemed), the
 * payout we compute from the market's settlement price must match to the
 * base unit. Exits non-zero on any mismatch.
 */
import { openDb } from './db.js';
import { buildSnapshot } from './stats.js';

const snap = buildSnapshot(openDb());
const bad = snap.positions.filter(
  (p) => p.claimed != null && p.settledValue != null && Math.abs(p.claimed - p.settledValue) >= 1e-6,
);
const r = snap.overview.reconciliation;
console.log(
  JSON.stringify(
    {
      asOf: snap.asOf,
      positions: snap.positions.length,
      claimsChecked: r.claimChecked,
      claimsMatched: r.claimMatched,
      mismatches: bad.slice(0, 20).map((p) => ({ market: p.marketId, root: p.rootId, computed: p.settledValue, claimed: p.claimed, mint: p.digest })),
    },
    null,
    2,
  ),
);
process.exit(bad.length ? 1 : 0);
