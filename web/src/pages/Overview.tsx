import { useMemo, useState } from 'react';
import { AreaLine, Calibration, CompareRows, StackedBars } from '../components/charts';
import { PositionsTable } from '../components/tables';
import { Leaders } from '../components/leaders';
import { AsOfBadge, ErrorNote, Ext, SideBar, Skeleton, Stat } from '../components/ui';
import { useLive, useNow, type LiveMarket } from '../live';
import { fmt, Link, pnlClass, useData, useExplorer, type Bucket, type Overview as O } from '../lib';

const SIDE_SERIES = [
  { key: 'up', label: 'Up', color: 'var(--up)', value: (d: Bucket) => d.up },
  { key: 'down', label: 'Down', color: 'var(--down)', value: (d: Bucket) => d.down },
  { key: 'range', label: 'Range', color: 'var(--range)', value: (d: Bucket) => d.range },
];

export default function Overview() {
  const { data, error } = useData<O>('overview.json');
  const [grain, setGrain] = useState<'daily' | 'hourly'>('daily');
  const live = useLive();
  const latest = useMemo(() => {
    const seen = new Set<string>();
    return [...live.trades, ...(data?.recent ?? [])].filter((p) => !seen.has(p.id) && !!seen.add(p.id)).slice(0, 12);
  }, [live.trades, data]);
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
      <div className="hero compact fade-in">
        <div className="eyebrow">DeepBook Predict · Sui mainnet</div>
        <h1>
          Who’s <span className="grad">beating the market.</span>
        </h1>
        <p className="lede">
          The top traders on DeepBook’s on-chain prediction market, ranked from public chain data after every fee.
        </p>
        <AsOfBadge asOf={data?.asOf} />
      </div>

      <Leaders winners={data?.topWinners} skill={data?.topSkill} />

      {!data ? (
        <Skeleton h={128} style={{ marginTop: 56 }} />
      ) : (
        <div className="hero-stats fade-in" style={{ marginTop: 56 }}>
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

      <LiveNow />

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
          <h2>Where the money goes</h2>
          <Link to="/leaderboard">Full leaderboard ›</Link>
        </div>
        <div className="grid g2">
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
          <div className="card">
            <div className="card-title">How traders are doing</div>
            {data ? (
              <>
                <div className="stat">
                  <div className="value">
                    {fmt.int(t!.profitableWallets)}
                    <span className="muted" style={{ fontSize: '0.5em', fontWeight: 600 }}>
                      {' '}
                      of {fmt.int(t!.walletsWithResults)}
                    </span>
                  </div>
                  <div className="foot">wallets are in profit after fees</div>
                </div>
                <div className="bar-track" style={{ marginTop: 16, height: 12 }}>
                  <div style={{ width: `${(t!.profitableWallets / Math.max(1, t!.walletsWithResults)) * 100}%`, background: 'var(--pos)' }} />
                  <div style={{ flex: 1, background: 'var(--neg)', opacity: 0.8 }} />
                </div>
                <div className="divider" />
                <dl className="kv">
                  <dt>Traders’ combined result</dt>
                  <dd className={pnlClass(traderResult)}>{fmt.signed(traderResult)}</dd>
                  <dt>Fees as a share of volume</dt>
                  <dd>{fmt.pct(data.fees.total / Math.max(1, t!.volume))}</dd>
                  <dt>Positions sold before expiry</dt>
                  <dd>{fmt.pct(t!.exitRate)}</dd>
                  <dt>Markets settled</dt>
                  <dd>{fmt.int(t!.settledMarkets)}</dd>
                </dl>
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
          {live.trades.length > 0 && (
            <span className="sub">
              <span className="live-dot" style={{ display: 'inline-block', width: 7, height: 7, marginRight: 8 }} />
              {live.trades.length} since the last snapshot
            </span>
          )}
          <Link to="/markets">All markets ›</Link>
        </div>
        <div className="card flush">{data ? <PositionsTable rows={latest} showOwner /> : <Skeleton h={300} style={{ margin: 20 }} />}</div>
      </section>

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

function countdown(ms: number) {
  if (ms <= 0) return '0:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function LiveCard({ m, now }: { m: LiveMarket; now: number }) {
  const ex = useExplorer();
  const left = (m.expiryMs ?? 0) - now;
  const closing = left > 0 && left < 60_000;
  const state = left <= 0 ? 'Settling' : m.mintPaused ? 'Paused' : 'Trading';
  return (
    <div className="card pad-sm live-card">
      <div className="card-title">
        <span>
          {m.underlying ?? '—'} · {m.expiryMs ? new Date(m.expiryMs).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—'}
        </span>
        <span className={`pill ${state === 'Trading' ? 'won' : 'open'}`}>
          {state === 'Trading' && <span className="dot" />}
          {state}
        </span>
      </div>
      <div className="stat">
        <div className={`value countdown ${closing ? 'neg' : ''}`}>{countdown(left)}</div>
        <div className="foot">{m.referencePrice == null ? 'Strike not set yet' : `Strike ${fmt.price(m.referencePrice)}`}</div>
      </div>
      {m.board ? (
        <div style={{ marginTop: 14 }}>
          <div className="odds">
            <span className="pos">↑ Up {fmt.cents(m.board.up)}</span>
            <span className="neg">{fmt.cents(m.board.down)} Down ↓</span>
          </div>
          <div className="bar-track" style={{ marginTop: 6 }}>
            <div style={{ width: `${(m.board.up / (m.board.up + m.board.down)) * 100}%`, background: 'var(--up)' }} />
            <div style={{ flex: 1, background: 'var(--down)' }} />
          </div>
        </div>
      ) : (
        <div className="foot faint" style={{ marginTop: 14, fontSize: 13 }}>
          {left <= 0 ? 'Waiting for the settlement price' : m.referencePrice == null ? 'Odds appear once the strike is set' : 'No live quote right now'}
        </div>
      )}
      <div className="divider" style={{ margin: '14px 0 12px' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, alignItems: 'center' }}>
        <span className="muted">
          <b style={{ color: 'var(--text)' }}>{fmt.usd(m.volume)}</b> · {m.traders} {m.traders === 1 ? 'trader' : 'traders'}
        </span>
        <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
          <Link to={`/market/${m.marketId}`}>Details ›</Link>
          <Ext href={ex.object(m.marketId)} label={`Open market on ${ex.name}`} />
        </span>
      </div>
    </div>
  );
}

function LiveNow() {
  const live = useLive();
  const now = useNow(1000);
  const markets = live.markets.filter((m) => (m.expiryMs ?? 0) > now - 120_000);
  return (
    <section>
      <div className="section-head">
        <div>
          <h2>Live now</h2>
          <div className="sub" style={{ marginTop: 6 }}>
            Read straight from the chain in your browser. Odds are the protocol’s own quote at each market’s strike.
          </div>
        </div>
      </div>
      {live.status === 'connecting' && !markets.length ? (
        <div className="grid g4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} h={230} />
          ))}
        </div>
      ) : markets.length === 0 ? (
        <div className="card empty">{live.status === 'error' ? 'Couldn’t reach the Sui fullnode.' : 'No markets are open right now.'}</div>
      ) : (
        <div className="grid g4">
          {markets.map((m) => (
            <LiveCard key={m.marketId} m={m} now={now} />
          ))}
        </div>
      )}
    </section>
  );
}
