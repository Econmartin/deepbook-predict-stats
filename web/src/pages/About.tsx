import { useApi, useExplorer, type AsOf } from '../lib';

interface Meta {
  asOf: AsOf;
  network: string;
  grpc: string;
  packages: Record<string, string>;
  eventModule: string;
  quoteCoin: string;
}

export default function About() {
  const { data } = useApi<Meta>('/api/meta', 0);
  const ex = useExplorer();
  return (
    <div className="prose">
      <div className="page-head fade-in">
        <h1>How it works</h1>
        <p>Every number here comes from public Sui mainnet data. Anyone can rebuild it — and check it.</p>
      </div>

      <h2>Data source</h2>
      <p>
        An indexer reads DeepBook Predict’s order events straight from the public Sui fullnode over gRPC — no API key,
        no private data. Package ids come from the official <code>@mysten/deepbook-v3</code> SDK’s deployment record, so
        nothing is hardcoded.
      </p>
      {data && (
        <ul>
          <li>
            Event module:{' '}
            <a href={ex.object(data.packages.predictV1 ?? '')} target="_blank" rel="noreferrer noopener">
              <code>{data.eventModule}</code>
            </a>
          </li>
          <li>
            Events: <code>OrderMinted</code>, <code>LiveOrderRedeemed</code>, <code>SettledOrderRedeemed</code>
          </li>
          <li>
            Endpoint: <code>{data.grpc}</code>
          </li>
        </ul>
      )}

      <h2>The rules we follow</h2>
      <ul>
        <li>
          <b>Owner, not sender.</b> Most Predict trades are signed by session keys. Every trade is attributed to the
          event’s <code>owner</code> field, never the transaction sender.
        </li>
        <li>
          <b>All fees netted.</b> A buy costs premium + trading fee − incentive subsidy + builder fee + congestion
          surcharge + inventory-impact charge. An early sell returns the redeem amount − trading fee − builder fee −
          surcharge + inventory-impact rebate. USDC amounts are ÷ 10⁶; prices and probabilities ÷ 10⁹.
        </li>
        <li>
          <b>Results only after settlement.</b> A held position is marked won or lost only once its market is past
          expiry <i>and</i> the market object carries an on-chain <code>settlement_price</code>. Until then it shows as
          open or settling — never guessed.
        </li>
        <li>
          <b>Win condition.</b> A position covers the strike range (lower, higher]. Lower tick 0 means −∞ (a “down”
          bet); higher tick 2³⁰ − 1 means +∞ (an “up” bet); anything else is a range.
        </li>
        <li>
          <b>Positions are per market.</b> Order ids restart in every market, so a position is identified by (market,
          position root id). Partial early sells accumulate against the same position.
        </li>
      </ul>

      <h2>What the stats mean</h2>
      <ul>
        <li>
          <b>Net PnL</b> — realized cash after every fee, over positions that are sold or settled. Open positions are
          excluded until they resolve.
        </li>
        <li>
          <b>Won vs implied</b> — for positions held to expiry, the realized win rate next to the average price paid
          (which is the market’s implied probability).
        </li>
        <li>
          <b>Skill (σ)</b> — (wins − Σ price paid) ÷ √Σ p(1 − p). Near 0 is what luck looks like. Beyond ±2σ over a
          decent sample is unlikely to be chance.
        </li>
      </ul>

      <h2>Check it yourself</h2>
      <p>
        Every wallet, market and trade links to {ex.name} (switch explorers in the footer). The overview reconciles our
        computed settlement payouts against every on-chain <code>SettledOrderRedeemed</code> claim. The indexer is open
        source — run it and you’ll get the same database.
      </p>
      <p className="faint" style={{ fontSize: 14, marginTop: 40 }}>
        A community project. Not affiliated with Mysten Labs or DeepBook. Read-only: it never signs or sends a
        transaction. Nothing here is financial advice.
      </p>
    </div>
  );
}
