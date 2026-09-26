import { AreaLine } from '../components/charts';
import { useLive } from '../live';
import { PositionsTable } from '../components/tables';
import { Addr, AsOfBadge, Avatar, ErrorNote, Ext, SideBar, Skeleton, Stat, ZMeter } from '../components/ui';
import { fmt, normalizeAddress, pnlClass, useData, useExplorer, type AsOf, type Position, type WalletStats } from '../lib';

interface Resp {
  asOf: AsOf;
  owner: string;
  found: boolean;
  stats: WalletStats;
  rank: { pnl: number; of: number } | null;
  sessionKeys: string[];
  curve: Array<{ t: number; pnl: number }>;
  positions: Position[];
}

export default function Wallet({ address }: { address: string }) {
  const owner = normalizeAddress(address);
  const { data, error, notFound } = useData<Resp>(owner ? `wallet/${owner}.json` : null);
  const ex = useExplorer();
  const live = useLive();
  const liveTrades = live.trades.filter((p) => p.owner === owner);
  if (!owner) return <div className="page-head"><h1>Not a Sui address</h1></div>;
  if (notFound)
    return (
      <div className="page-head fade-in">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Avatar address={owner} size={56} />
          <h1 style={{ fontSize: 'clamp(28px, 4vw, 44px)' }}>{fmt.short(owner)}</h1>
        </div>
        <p className="mono" style={{ wordBreak: 'break-all', fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
          {owner}
          <Ext href={ex.account(owner)} label={`Open on ${ex.name}`}>
            {ex.name}&nbsp;
          </Ext>
        </p>
        {liveTrades.length ? (
          <section>
            <div className="section-head">
              <h2>New trades</h2>
              <span className="sub">live from the chain · full stats arrive with the next snapshot</span>
            </div>
            <div className="card flush">
              <PositionsTable rows={liveTrades} />
            </div>
          </section>
        ) : (
          <div className="card empty" style={{ marginTop: 28 }}>
            This address hasn’t traded on DeepBook Predict yet.
          </div>
        )}
      </div>
    );
  if (error) return <div className="page-head"><ErrorNote error={error} /></div>;
  if (!data) return <div className="page-head"><Skeleton h={420} /></div>;
  const s = data.stats;
  const seen = new Set<string>();
  const rows = [...liveTrades, ...data.positions].filter((p) => !seen.has(p.id) && !!seen.add(p.id));
  const sideTotal = s.sides.up + s.sides.down + s.sides.range;

  return (
    <>
      <div className="page-head fade-in">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <Avatar address={data.owner} size={56} />
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow" style={{ margin: 0 }}>
              Wallet{data.rank ? ` · #${data.rank.pnl} of ${fmt.int(data.rank.of)} by profit` : ''}
            </div>
            <h1 style={{ fontSize: 'clamp(28px, 4vw, 44px)' }} className="num">
              {fmt.short(data.owner)}
            </h1>
          </div>
        </div>
        <p className="mono" style={{ wordBreak: 'break-all', fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
          {data.owner}
          <Ext href={ex.account(data.owner)} label={`Open on ${ex.name}`}>
            {ex.name}&nbsp;
          </Ext>
        </p>
        <AsOfBadge asOf={data.asOf} />
      </div>

      {!data.found ? (
        <div className="card empty">This address hasn’t traded on DeepBook Predict yet.</div>
      ) : (
        <>
          <div className="hero-stats fade-in">
            <div>
              <Stat
                label="Net PnL"
                value={<span className={pnlClass(s.realizedPnl)}>{fmt.signed(s.realizedPnl)}</span>}
                foot={<>ROI {fmt.pct(s.roi)} on {fmt.usd(s.resolvedSpent)} resolved</>}
              />
            </div>
            <div>
              <Stat label="Trades" value={fmt.int(s.positions)} foot={<>{fmt.int(s.open)} open · {fmt.usd(s.openCost)} at risk</>} />
            </div>
            <div>
              <Stat
                label="Won vs implied"
                value={s.held.n ? `${fmt.pct(s.held.winRate, 0)}` : '—'}
                foot={
                  s.held.n ? (
                    <>
                      price implied {fmt.pct(s.held.implied, 0)} · {s.held.wins}/{s.held.n} held
                    </>
                  ) : (
                    'no held-to-expiry results yet'
                  )
                }
              />
            </div>
            <div>
              <Stat label="Skill" value={<ZMeter z={s.held.z} />} foot={<>{s.held.wins} wins vs {s.held.expected.toFixed(1)} expected</>} />
            </div>
          </div>

          <section>
            <div className="grid g3">
              <div className="card span2">
                <div className="card-title">Cumulative realized PnL</div>
                {data.curve.length > 1 ? (
                  <AreaLine points={data.curve.map((c) => ({ t: c.t, v: c.pnl }))} signed height={420} yFormat={(v) => (Math.abs(v) >= 1000 ? fmt.usdCompact(v) : fmt.usd(v))} />
                ) : (
                  <div className="empty">Not enough resolved trades to chart yet.</div>
                )}
              </div>
              <div className="card">
                <div className="card-title">Profile</div>
                <dl className="kv">
                  <dt>Volume</dt>
                  <dd>{fmt.usd(s.volume)}</dd>
                  <dt>Max payout minted</dt>
                  <dd>{fmt.usd(s.notional)}</dd>
                  <dt>Fees paid</dt>
                  <dd>{fmt.usd(s.feesPaid)}</dd>
                  <dt>Avg price paid</dt>
                  <dd>{fmt.cents(s.avgEntryProb)}</dd>
                  <dt>Avg time left at entry</dt>
                  <dd>{fmt.dur(s.avgSecondsToExpiry)}</dd>
                  <dt>Sold early</dt>
                  <dd>{fmt.pct(s.earlyExitRate, 0)}</dd>
                  <dt>First trade</dt>
                  <dd>{fmt.time(s.firstMs)}</dd>
                  <dt>Last trade</dt>
                  <dd>{fmt.ago(s.lastMs)}</dd>
                </dl>
                <div className="divider" />
                <div className="card-title">Side mix</div>
                <SideBar sides={s.sides} />
                <div className="legend" style={{ marginTop: 10 }}>
                  <span>
                    <i className="swatch" style={{ background: 'var(--up)' }} />
                    Up {s.sides.up} · {fmt.pct(s.sides.up / sideTotal, 0)}
                  </span>
                  <span>
                    <i className="swatch" style={{ background: 'var(--down)' }} />
                    Down {s.sides.down} · {fmt.pct(s.sides.down / sideTotal, 0)}
                  </span>
                  {s.sides.range > 0 && (
                    <span>
                      <i className="swatch" style={{ background: 'var(--range)' }} />
                      Range {s.sides.range}
                    </span>
                  )}
                </div>
                {data.sessionKeys.length > 0 && (
                  <>
                    <div className="divider" />
                    <div className="card-title">Trades via session keys</div>
                    <div className="card-sub" style={{ marginBottom: 8 }}>
                      Signed by these keys, attributed here by the event’s <code className="mono">owner</code>.
                    </div>
                    <div style={{ display: 'grid', gap: 6 }}>
                      {data.sessionKeys.slice(0, 5).map((k) => (
                        <Addr key={k} address={k} link={false} />
                      ))}
                      {data.sessionKeys.length > 5 && <span className="faint">+{data.sessionKeys.length - 5} more</span>}
                    </div>
                  </>
                )}
              </div>
            </div>
          </section>

          <section>
            <div className="section-head">
              <h2>Trades</h2>
              <span className="sub">
                {liveTrades.length > 0 && (
                  <>
                    <span className="live-dot" style={{ display: 'inline-block', width: 7, height: 7, marginRight: 8 }} />
                    {liveTrades.length} new live ·{' '}
                  </>
                )}
                {fmt.int(data.positions.length)} {data.positions.length < s.positions ? `of ${fmt.int(s.positions)} ` : ''}· newest first
              </span>
            </div>
            <div className="card flush">
              <PositionsTable rows={rows} />
            </div>
          </section>
        </>
      )}
    </>
  );
}
