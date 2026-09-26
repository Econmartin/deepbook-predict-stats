# Predict Stats

Community stats for **DeepBook Predict**, the on-chain prediction market on Sui:
trader leaderboards, market activity and a full record for any wallet. Every
number is computed from public on-chain data, and every wallet, market and
trade links to a block explorer.

It only reads. It never signs or sends a transaction, and it needs no keys or
secrets. Anyone can rebuild the whole database from the chain.

## Quick start

```bash
npm install
npm run sync      # one-shot backfill from the first Predict event (~2 min)
npm run build     # build the frontend into web/dist
npm start         # API + site on http://localhost:8787, re-indexing every 15s
```

To develop with hot reload, run `npm run dev` (API on :8787, Vite on :5173).

| Script              | What it does                                                        |
| ------------------- | ------------------------------------------------------------------- |
| `npm run sync`      | Runs one indexing pass. Safe to call from cron.                     |
| `npm start`         | Serves the API and static site, with the indexer running in-process. |
| `npm run verify`    | Checks computed payouts against on-chain claims. Exits 1 on any mismatch. |
| `npm test`          | Runs the correctness tests (`server/correctness.test.ts`).          |
| `npm run typecheck` | Type-checks the server and the web app.                             |

Environment variables (all optional):

| Var                | Default                                  |                                              |
| ------------------ | ---------------------------------------- | -------------------------------------------- |
| `PORT`             | `8787`                                   | HTTP port                                    |
| `DB_PATH`          | `data/predict.db`                        | SQLite file                                  |
| `SYNC_INTERVAL_MS` | `15000`                                  | In-process poll interval. `0` turns it off and leaves syncing to cron. |
| `SUI_GRPC_URL`     | `https://fullnode.mainnet.sui.io:443`    | gRPC endpoint                                |

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

## API

All endpoints are read-only JSON: `GET /api/overview`,
`/api/leaderboard?by=pnl|skill&dir=desc|asc&min=N`, `/api/wallet/:address`,
`/api/markets?status=open|settling|settled&sort=expiry|volume|traders`,
`/api/market/:id`, `/api/meta`, `/api/health`.

## Deploying on your own server

`deploy/predict-stats.service` is a hardened systemd unit that runs the API
with the indexer in-process. `deploy/Caddyfile` is a reverse proxy with
automatic HTTPS. Point it at your own domain.

```bash
npm ci && npm run build
sudo cp deploy/predict-stats.service /etc/systemd/system/
sudo systemctl enable --now predict-stats
```

## Layout

```
server/chain.ts     gRPC client, SDK address book, event paging, market reads
server/indexer.ts   event → SQLite, market discovery, settlement resolution
server/stats.ts     positions, wallet/market stats, overview, calibration
server/server.ts    Hono read API + static site + poller
web/                Vite + React frontend, hand-drawn SVG charts
```

## Scope

This covers Predict only. It does not read the DeepBook spot order book. There
are no curated wallet lists: every stat covers every wallet.

This is a community project and is not affiliated with Mysten Labs or DeepBook.
Nothing here is financial advice.

## License

[MIT](LICENSE)
