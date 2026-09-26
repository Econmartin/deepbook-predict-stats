import { useState } from 'react';
import { AreaLine, Calibration, CompareRows, StackedBars } from '../components/charts';
import { PositionsTable } from '../components/tables';
import { Addr, AsOfBadge, ErrorNote, MarketLink, SideBar, Skeleton, Stat, StatusPill } from '../components/ui';
import { fmt, Link, pnlClass, useApi, type Bucket, type Overview as O } from '../lib';

const SIDE_SERIES = [
  { key: 'up', label: 'Up', color: 'var(--up)', value: (d: Bucket) => d.up },
  { key: 'down', label: 'Down', color: 'var(--down)', value: (d: Bucket) => d.down },
  { key: 'range', label: 'Range', color: 'var(--range)', value: (d: Bucket) => d.range },
];

export default function Overview() {
  const { data, error } = useApi<O>('/api/overview', 20_000);
  const [grain, setGrain] = useState<'daily' | 'hourly'>('daily');
  if (error) return <ErrorNote error={error} />;

  const t = data?.totals;
  const buckets = data ? data[grain] : [];
  const skew = buckets
    .filter((b) => b.positions >= 5 && b.up + b.down > 0)
    .map((b) => ({ t: b.t, v: b.up / (b.up + b.down) }));
  const sidesTotal = data ? data.sides.up + data.sides.down + data.sides.range : 0;
  const traderResult = t?.traderPnl ?? 0;

  return (
    <>
      <div className="hero fade-in">
        <div className="eyebrow">DeepBook Predict · Sui mainnet</div>
        <h1>
          Every trade. <span className="grad">Every result.</span>
        </h1>
        <p className="lede">
          Leaderboards, markets and wallet records for DeepBook’s on-chain prediction market — rebuilt from public chain
          events, reconciled to the cent, and linked to the explorer.
        </p>
        <AsOfBadge asOf={data?.asOf} />
      </div>

      {!data ? (
        <Skeleton h={128} />
      ) : (
        <div className="hero-stats fade-in">
          <div>
            <Stat label="Volume traded" value={fmt.usdCompact(t!.volume)} foot={<>{fmt.usdCompact(t!.volume24h)} in the last 24h</>} />
          </div>
          <div>
            <Stat label="Positions" value={fmt.int(t!.positions)} foot={<>{fmt.usdCompact(t!.notional)} max payout minted</>} />
          </div>
          <div>
            <Stat label="Traders" value={fmt.int(t!.wallets)} foot={<>{fmt.int(t!.active24h)} active 24h · {fmt.int(t!.active7d)} 7d</>} />
          </div>
          <div>
            <Stat
              label="Traders’ net result"
              value={<span className={pnlClass(traderResult)}>{fmt.signed(traderResult)}</span>}
              foot={<>after all fees · {fmt.int(t!.profitableWallets)} of {fmt.int(t!.walletsWithResults)} wallets in profit</>}
            />
          </div>
        </div>
      )}

      <section>
        <div className="section-head">
          <h2>Activity</h2>
          <div className="segmented" role="tablist">
            <button className={grain === 'daily' ? 'on' : ''} onClick={() => setGrain('daily')}>
              Daily
            </button>
            <button className={grain === 'hourly' ? 'on' : ''} onClick={() => setGrain('hourly')}>
              Hourly · 7d
            </button>
          </div>
        </div>
        <div className="grid g3">
          <div className="card span2">
            <div className="card-title">
              <span>Volume by side</span>
              <span className="legend">
                {SIDE_SERIES.map((s) => (
                  <span key={s.key}>
                    <i className="swatch" style={{ background: s.color }} />
                    {s.label}
                  </span>
                ))}
              </span>
            </div>
            {data ? (
              <StackedBars
                data={buckets}
                series={SIDE_SERIES}
                x={(d) => d.t}
                xLabel={grain === 'daily' ? fmt.date : (ms) => new Date(ms).toLocaleString('en-US', { weekday: 'short', hour: 'numeric' })}
                tooltipExtra={(d) => (
                  <>
                    <div className="divider" style={{ margin: '6px 0' }} />
                    <div className="t-row">
                      <span>Traders</span>
                      <b>{fmt.int(d.wallets)}</b>
                    </div>
                    <div className="t-row">
                      <span>Positions</span>
                      <b>{fmt.int(d.positions)}</b>
                    </div>
                    <div className="t-row">
                      <span>Fees</span>
                      <b>{fmt.usd(d.fees)}</b>
                    </div>
                  </>
                )}
              />
            ) : (
              <Skeleton h={240} />
            )}
          </div>
          <div className="card">
            <div className="card-title">Bullish share</div>
            <div className="card-sub" style={{ marginBottom: 10 }}>
              Up volume as a share of up + down, per {grain === "daily" ? "day" : "hour"} with 5+ trades. Dashed line is 50/50.
            </div>
            {data ? (
              <AreaLine
                points={skew}
                height={196}
                domain={[0, 1]}
                refLine={0.5}
                yFormat={(v) => `${Math.round(v * 100)}%`}
                xFormat={grain === 'daily' ? fmt.date : fmt.time}
              />
            ) : (
              <Skeleton h={196} />
            )}
          </div>
        </div>
      </section>

      <section>
        <div className="section-head">
          <div>
            <h2>Is the price right?</h2>
            <div className="sub" style={{ marginTop: 6 }}>
              Held-to-expiry positions, grouped by the price paid. On the dashed line, the market priced it fairly.
            </div>
          </div>
        </div>
        <div className="grid g2">
          <div className="card">
            <div className="card-title">Implied vs. realized win rate</div>
            {data ? <Calibration buckets={data.calibrationByProb} /> : <Skeleton h={300} />}
          </div>
          <div className="card">
            <div className="card-title">
              <span>By time left at entry</span>
              <span className="legend">
                <span>
                  <i className="swatch" style={{ background: 'var(--accent)' }} />
                  Won
                </span>
                <span>
                  <i className="swatch" style={{ background: 'var(--text)', width: 2 }} />
                  Implied
                </span>
              </span>
            </div>
            <div className="card-sub" style={{ marginBottom: 18 }}>
              Blue bar is how often they won; the tick is what the price implied. σ is how surprising the gap is — beyond
              ±2σ is unlikely to be luck.
            </div>
            {data ? <CompareRows buckets={data.calibrationByTime} /> : <Skeleton h={220} />}
          </div>
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2>Top traders</h2>
          <Link to="/leaderboard">Full leaderboard ›</Link>
        </div>
        <div className="grid g3">
          <div className="card flush span2">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Wallet</th>
                    <th className="r">Net PnL</th>
                    <th className="r">Trades</th>
                    <th className="r">ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.topWinners ?? []).map((w, i) => (
                    <tr key={w.owner}>
                      <td className="rank">{i + 1}</td>
                      <td>
                        <Addr address={w.owner} />
                      </td>
                      <td className={`r ${pnlClass(w.realizedPnl)}`} style={{ fontWeight: 600 }}>
                        {fmt.signed(w.realizedPnl)}
                      </td>
                      <td className="r">{fmt.int(w.positions)}</td>
                      <td className={`r ${pnlClass(w.roi)}`}>{fmt.pct(w.roi)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data && <Skeleton h={220} style={{ margin: 20 }} />}
            </div>
          </div>
          <div className="card">
            <div className="card-title">Where the money goes</div>
            {data ? (
              <>
                <div className="stat">
                  <div className="value">{fmt.usd(data.fees.total)}</div>
                  <div className="foot">fees paid by traders</div>
                </div>
                <div className="divider" />
                <dl className="kv">
                  <dt>Trading fee · mint</dt>
                  <dd>{fmt.usd(data.fees.mintTrading)}</dd>
                  <dt className="faint">&ensp;of which to referrers</dt>
                  <dd className="faint">{fmt.usd(data.fees.referral)}</dd>
                  <dt>Trading fee · early sell</dt>
                  <dd>{fmt.usd(data.fees.exitTrading)}</dd>
                  <dt>Congestion surcharge</dt>
                  <dd>{fmt.usd(data.fees.penalty)}</dd>
                  <dt>Builder fees</dt>
                  <dd>{fmt.usd(data.fees.builder)}</dd>
                  <dt className="faint">Fees sponsored by incentives</dt>
                  <dd className="faint">{fmt.usd(data.fees.subsidy)}</dd>
                  <dt className="faint">Inventory impact, net</dt>
                  <dd className="faint">{fmt.usd(data.fees.impactCharged - data.fees.impactRebated)}</dd>
                </dl>
                <div className="divider" />
                <div className="card-title">Side mix by volume</div>
                <SideBar sides={data.sides} />
                <div className="legend" style={{ marginTop: 10 }}>
                  <span>
                    <i className="swatch" style={{ background: 'var(--up)' }} />
                    Up {fmt.pct(data.sides.up / sidesTotal, 0)}
                  </span>
                  <span>
                    <i className="swatch" style={{ background: 'var(--down)' }} />
                    Down {fmt.pct(data.sides.down / sidesTotal, 0)}
                  </span>
                  {data.sides.range > 0 && (
                    <span>
                      <i className="swatch" style={{ background: 'var(--range)' }} />
                      Range {fmt.pct(data.sides.range / sidesTotal, 0)}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <Skeleton h={300} />
            )}
          </div>
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2>Latest trades</h2>
          <Link to="/markets">All markets ›</Link>
        </div>
        <div className="card flush">{data ? <PositionsTable rows={data.recent} showOwner /> : <Skeleton h={300} style={{ margin: 20 }} />}</div>
      </section>

      {data && data.liveMarkets.length > 0 && (
        <section>
          <div className="section-head">
            <h2>Live now</h2>
          </div>
          <div className="grid g4">
            {data.liveMarkets.map((m) => (
              <div className="card pad-sm" key={m.marketId}>
                <div className="card-title">
                  <span>{m.underlying} · {m.expiryMs ? fmt.time(m.expiryMs) : '—'}</span>
                  <StatusPill status={m.status} />
                </div>
                <div className="stat">
                  <div className="value" style={{ fontSize: 26 }}>
                    {fmt.usd(m.volume)}
                  </div>
                  <div className="foot">
                    {m.traders} traders · expires {fmt.ago(m.expiryMs)}
                  </div>
                </div>
                <div style={{ marginTop: 12 }}>
                  <SideBar sides={m.sides} />
                </div>
                <div style={{ marginTop: 12, fontSize: 13 }}>
                  <MarketLink id={m.marketId} label="Details" />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {data && (
        <section>
          <div className="callout">
            <b>Reconciled to chain.</b> Of {fmt.int(data.reconciliation.claimChecked)} settled positions claimed on-chain,
            the payout we compute from the market’s settlement price matches the{' '}
            <code className="mono">SettledOrderRedeemed</code> payout to the base unit for{' '}
            {data.reconciliation.claimMatched === data.reconciliation.claimChecked
              ? 'every one'
              : `${fmt.int(data.reconciliation.claimMatched)} of them`}
            . <Link to="/about">How it works ›</Link>
          </div>
        </section>
      )}
    </>
  );
}
