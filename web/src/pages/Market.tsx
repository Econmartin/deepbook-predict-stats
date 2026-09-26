import { PositionsTable } from '../components/tables';
import { useLive } from '../live';
import { AsOfBadge, ErrorNote, Ext, SideBar, Skeleton, Stat, StatusPill } from '../components/ui';
import { fmt, normalizeAddress, pnlClass, useData, useExplorer, type AsOf, type MarketStats, type Position } from '../lib';

interface Resp {
  asOf: AsOf;
  market: MarketStats;
  positions: Position[];
}

export default function Market({ id }: { id: string }) {
  const mid = normalizeAddress(id);
  const { data, error, notFound } = useData<Resp>(mid ? `market/${mid}.json` : null);
  const ex = useExplorer();
  const live = useLive();
  const liveTrades = live.trades.filter((p) => p.marketId === mid);
  if (!mid || notFound) {
    const lm = live.markets.find((m) => m.marketId === mid);
    return (
      <div className="page-head fade-in">
        <h1>{lm || liveTrades.length ? 'New market' : 'Market not published'}</h1>
        <p>
          {lm || liveTrades.length
            ? 'This market is newer than the last snapshot. Its trades are shown live from the chain.'
            : 'Per-market pages cover the last 30 days plus the busiest markets.'}{' '}
          {mid && (
            <a href={ex.object(mid)} target="_blank" rel="noreferrer noopener">
              View this object on {ex.name} ›
            </a>
          )}
        </p>
        {liveTrades.length > 0 && (
          <section>
            <div className="card flush">
              <PositionsTable rows={liveTrades} showOwner showMarket={false} />
            </div>
          </section>
        )}
      </div>
    );
  }
  if (error) return <div className="page-head"><ErrorNote error={error} /></div>;
  if (!data) return <div className="page-head"><Skeleton h={420} /></div>;
  const m = data.market;
  const seen = new Set<string>();
  const rows = [...liveTrades, ...data.positions].filter((p) => !seen.has(p.id) && !!seen.add(p.id));
  const left = m.expiryMs ? (m.expiryMs - Date.now()) / 1000 : null;

  return (
    <>
      <div className="page-head fade-in">
        <div className="eyebrow" style={{ gap: 10 }}>
          {m.underlying} market <StatusPill status={m.status} />
        </div>
        <h1 style={{ fontSize: 'clamp(30px, 4.4vw, 48px)' }}>Expires {m.expiryMs ? fmt.time(m.expiryMs) : '—'}</h1>
        <p className="mono" style={{ wordBreak: 'break-all', fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
          {m.marketId}
          <Ext href={ex.object(m.marketId)} label={`Open on ${ex.name}`}>
            {ex.name}&nbsp;
          </Ext>
        </p>
        <AsOfBadge asOf={data.asOf} />
      </div>

      <div className="hero-stats fade-in">
        <div>
          <Stat
            label="Settlement price"
            value={m.settlement == null ? '—' : fmt.price(m.settlement)}
            foot={m.status === 'settled' ? 'read from the market object' : left != null && left > 0 ? `expires in ${fmt.dur(left)}` : 'waiting for the chain to settle'}
          />
        </div>
        <div>
          <Stat label="Volume" value={fmt.usd(m.volume)} foot={<>{fmt.usd(m.notional)} max payout</>} />
        </div>
        <div>
          <Stat label="Traders" value={fmt.int(m.traders)} foot={<>{fmt.int(m.positions)} {m.positions === 1 ? 'trade' : 'trades'} · {m.exits} sold early</>} />
        </div>
        <div>
          <Stat
            label="Traders’ net result"
            value={m.traderPnl == null ? '—' : <span className={pnlClass(m.traderPnl)}>{fmt.signed(m.traderPnl)}</span>}
            foot={<SideBar sides={m.sides} />}
          />
        </div>
      </div>

      <section>
        <div className="section-head">
          <h2>Trades</h2>
        </div>
        <div className="card flush">
          <PositionsTable rows={rows} showOwner showMarket={false} />
        </div>
      </section>
    </>
  );
}
