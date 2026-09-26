# Predict Stats

Community stats for **DeepBook Predict**, the on-chain prediction market on Sui:
trader leaderboards, market activity and a full record for any wallet. Every
number is computed from public on-chain data, and every wallet, market and
trade links to a block explorer.

It only reads. It never signs or sends a transaction, and it needs no keys or
secrets. Anyone can rebuild the whole database from the chain.

## Hosting: GitHub Pages (default)

The live site is a static build on GitHub Pages, refreshed by
`.github/workflows/pages.yml` about every 10 minutes:

1. Download the previous run's database from the live site (`predict.db.gz`).
   If there isn't one, backfill from the first Predict event.
2. `npm run sync`: page new events over gRPC and resolve settlements.
3. `npm test` and `npm run verify`. If any payout doesn't reconcile with the
   chain, the run fails and nothing is published.
4. Build the frontend and `npm run export` the stats to static JSON. This also
   publishes the database as `predict.db.gz`.
5. Deploy to Pages.

GitHub's cron is best-effort and often skips frequent schedules. Instead, each
run queues the next one about 8 minutes after it finishes. A `*/30` cron only
restarts the chain if it ever breaks. To pause publishing, disable the
*Publish* workflow in the Actions tab.

On a public repo this fits in GitHub's free tier: Actions minutes are free, and
the export caps keep the site far below Pages' 1 GB limit (see
`server/export.ts`).

To set it up on a fork, go to **Settings → Pages → Source: GitHub Actions**,
then run the *Publish* workflow once.

## Live data

The snapshot is refreshed about every 10 minutes. The live parts of the site
read the chain directly from the visitor's browser over gRPC-web, since the
public fullnode allows any origin. That covers open markets with their
countdowns and the protocol's live up/down quote, and every `OrderMinted` newer
than the snapshot. The snapshot records the checkpoint its mint stream was
indexed through (`data/live-base.json`). The browser adds only events after that
checkpoint, so snapshot plus live never double counts or drops a trade. Results
(won, lost, PnL) still come only from the indexed settlement.

## Running locally

```bash
npm install
npm run sync      # one-shot backfill from the first Predict event (~2 min)
npm run build     # build the frontend into web/dist
npm start         # site on http://localhost:8787, re-indexing every 15s
```

`npm run dev` runs the server on :8787 and Vite with hot reload on :5173.

| Script              | What it does                                                        |
| ------------------- | ------------------------------------------------------------------- |
| `npm run sync`      | Runs one indexing pass. Safe to call from cron.                     |
| `npm run export -- <dir>` | Writes the static JSON and `predict.db.gz` into `<dir>`.      |
| `npm start`         | Self-hosted mode: indexer, export and site in one process.          |
| `npm run verify`    | Checks computed payouts against on-chain claims. Exits 1 on any mismatch. |
| `npm test`          | Runs the correctness tests (`server/correctness.test.ts`).          |
| `npm run typecheck` | Type-checks the server and the web app.                             |

Environment variables (all optional):

| Var                | Default                                  |                                              |
| ------------------ | ---------------------------------------- | -------------------------------------------- |
| `PORT`             | `8787`                                   | HTTP port (self-hosted)                      |
| `DB_PATH`          | `data/predict.db`                        | SQLite file                                  |
| `EXPORT_DIR`       | `data/site`                              | Where self-hosted mode writes the JSON       |
| `SYNC_INTERVAL_MS` | `15000`                                  | In-process poll interval. `0` turns it off.  |
| `SUI_GRPC_URL`     | `https://fullnode.mainnet.sui.io:443`    | gRPC endpoint                                |
| `BASE_PATH`        | `/`                                      | Site base path at build time (`/<repo>/` on Pages) |

## Data source

- **Transport: gRPC only.** Sui retired JSON-RPC on its public fullnodes in
  July 2026. All reads use `SuiGrpcClient` from `@mysten/sui/grpc` against the
  public fullnode. No API key is needed.
- **Addresses come from the SDK.** Package ids and the underlying-asset map
  are read from `@mysten/deepbook-v3`'s `PredictClient.cfg`, which Mysten
  regenerates with each SDK release. Nothing in this repo is hardcoded. To
  follow a new deployment, bump the SDK.
- **Events** (`<predictV1>::order_events::*`):
  - `OrderMinted`: a position is opened.
  - `LiveOrderRedeemed`: a full or partial sale before expiry.
  - `SettledOrderRedeemed`: a payout is claimed after settlement. This is used
    for reconciliation only.
- **Market objects** (`ExpiryMarket`) supply the expiry, the tick size and
  `strike_exposure.settlement_price`.

Each event stream is paged in ascending order from the first event. The gRPC
cursor is saved after every page as the watermark. Each row is keyed by
`txDigest:eventIndex`, so replaying a page does nothing. Amounts are stored as
raw integers and converted only for display.

## Correctness rules

These are what a naive script gets wrong. Each one is covered by a test in
`server/correctness.test.ts`.

1. **Owner, not sender.** Most Predict trades are signed by session keys, so
   every event is attributed by its `owner` field. The tx sender is used only to
   list a wallet's session keys. Addresses are normalized and lowercased.
2. **All fees are netted.**
   - Mint cost = `premium + trading_fee − fee_incentive_subsidy + builder_fee + penalty_fee + inventory_impact_charge`
   - Early-sell proceeds = `redeem_amount − trading_fee − builder_fee − penalty_fee + inventory_impact_rebate`
   - USDC is ÷ 1e6. Probabilities, prices and tick sizes are ÷ 1e9.
3. **Results only after settlement.** A held position is marked won or lost only
   when `now ≥ expiry` **and** the market object has a non-null
   `settlement_price`. The indexer writes a settlement only when both are true
   at read time, and the stats layer checks expiry again. Before that, a
   position shows as *open* or *settling*.
4. **Side.** `lower_tick == 0` is **down**, `higher_tick == 2³⁰ − 1` is **up**,
   and anything else is **range**. A position wins when
   `lower·tick < settlement ≤ higher·tick`. This is compared as exact integers.
5. **Order ids are per market.** `order_id` and `position_root_id` restart in
   every market, so a position is identified by `(market_id, position_root_id)`.
   Joining on the root id alone mixes positions from different markets. Early
   sells accumulate against the root, and only the unsold remainder pays out at
   settlement.

## How to check the numbers

- **Payouts match the chain.** `npm run verify` compares the payout we compute
  from each market's settlement price with every on-chain
  `SettledOrderRedeemed.payout_amount`. The overview page shows the same check.
- **"As of" is shown everywhere.** Each page shows the last indexed checkpoint,
  which links to the explorer, and the time of the last sync.
- **Everything links out.** Wallets, market objects and mint/sell transactions
  all link to SuiVision or Suiscan. The footer has a toggle between the two.
- **Rebuild it yourself.** Delete `data/predict.db`, run `npm run sync`, and you
  get the same database.

## What the stats mean

- **Net PnL**: realized cash after all fees, over positions that were sold or
  settled. Open positions don't count until they resolve.
- **Won vs implied**: for positions held to expiry, the realized win rate
  compared with the average price paid, which is the implied probability.
- **Skill (σ)**: `(wins − Σp) / √Σp(1−p)` over held-to-expiry positions. Around
  0 is what luck looks like. Beyond ±2σ on a decent sample is unlikely to be
  chance.
- **Fees**: what traders paid, which is the trading fee net of incentive
  subsidies, plus builder fees and the congestion surcharge. Referral payouts
  are a share of the trading fee, not an extra charge.

## Data files

The site reads plain JSON, and so can anything else. Paths are relative to the
site root:

- `data/overview.json`: totals, daily and hourly series, fees, calibration
- `data/wallets.json`: stats for every wallet
- `data/wallet/<address>.json`: one wallet's stats, PnL curve and newest 2,000 trades
- `data/markets/{recent,top-volume,top-traders}.json`: market lists
- `data/market/<id>.json`: one market and its trades (last 30 days plus top markets)
- `data/meta.json`: package ids, gRPC endpoint and as-of info
- `predict.db.gz`: the full SQLite database

## Self-hosting instead

The `Dockerfile` runs indexer, export and site in one container. Mount a volume
at `/data` and expose port 8787. The health check is `/health`. This works on
Coolify or any Docker host. For a bare server, `deploy/` has a systemd unit and
a Caddyfile.

## Layout

```
server/chain.ts     gRPC client, SDK address book, event paging, market reads
server/indexer.ts   event → SQLite, market discovery, settlement resolution
server/stats.ts     positions, wallet/market stats, overview, calibration
server/export.ts    snapshot → static JSON (+ gzipped DB)
server/server.ts    self-hosted mode: poller + export + static server
.github/workflows/  scheduled index → verify → build → GitHub Pages
web/                Vite + React frontend, hand-drawn SVG charts
```

## Scope

This covers Predict only. It does not read the DeepBook spot order book. There
are no curated wallet lists: every stat covers every wallet.

This is a community project and is not affiliated with Mysten Labs or DeepBook.
Nothing here is financial advice.

## License

[MIT](LICENSE)
