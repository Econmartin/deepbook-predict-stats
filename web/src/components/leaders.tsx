/**
 * The front-page top 10: a podium for #1–#3 and a ranked list for #4–#10,
 * switchable between profit and skill. Wallets that traded in the last few
 * minutes (read live from the chain) get a "Trading now" pulse.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { fmt, Link, pnlClass, type WalletStats } from '../lib';
import { useLive, useNow } from '../live';
import { Avatar, Skeleton, ZMeter } from './ui';
import { useRowNav } from './tables';

type Leader = WalletStats & { spark: number[] };
type Board = 'pnl' | 'skill';

const TRADING_NOW_MS = 5 * 60_000;
const MEDAL = ['gold', 'silver', 'bronze'] as const;

export function Sparkline({ values, width = 120, height = 36, strokeWidth = 2 }: { values: number[]; width?: number; height?: number; strokeWidth?: number }) {
  const gid = useId().replace(/:/g, '');
  if (values.length < 2) return <svg width={width} height={height} />;
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = hi - lo || 1;
  const pad = strokeWidth + 2;
  const x = (i: number) => (i / (values.length - 1)) * (width - pad * 2) + pad;
  const y = (v: number) => pad + (1 - (v - lo) / span) * (height - pad * 2);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const last = values.at(-1)!;
  const color = last >= 0 ? 'var(--pos)' : 'var(--neg)';
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1={pad} x2={width - pad} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" strokeDasharray="2 3" />
      <path d={`${d}L${x(values.length - 1)},${y(lo)}L${x(0)},${y(lo)}Z`} fill={`url(#${gid})`} />
      <path d={d} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(last)} r={strokeWidth + 1.5} fill={color} />
    </svg>
  );
}

/** A sparkline that fills its container's width. */
function FluidSparkline({ values, height }: { values: number[]; height: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e!.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ height }}>
      {w > 0 && <Sparkline values={values} width={w} height={height} />}
    </div>
  );
}

function TradingNow() {
  return (
    <span className="trading-now">
      <span className="live-dot" /> Trading now
    </span>
  );
}

function headline(w: Leader, board: Board) {
  return board === 'pnl' ? (
    <span className={pnlClass(w.realizedPnl)}>{fmt.signed(w.realizedPnl)}</span>
  ) : (
    <span className={w.held.z != null && w.held.z >= 2 ? 'pos' : ''}>{fmt.z(w.held.z)}</span>
  );
}

function subline(w: Leader, board: Board) {
  return board === 'pnl' ? (
    <>
      ROI <b className={pnlClass(w.roi)}>{fmt.pct(w.roi, 0)}</b> · {fmt.int(w.positions)} trades
    </>
  ) : (
    <>
      Won <b>{fmt.pct(w.held.winRate, 0)}</b> vs {fmt.pct(w.held.implied, 0)} implied · {w.held.n} held
    </>
  );
}

function PodiumCard({ w, rank, board, active }: { w: Leader; rank: number; board: Board; active: boolean }) {
  const medal = MEDAL[rank - 1]!;
  return (
    <Link to={`/wallet/${w.owner}`} className={`podium-card ${medal} rank-${rank}`}>
      <div className="podium-top">
        <span className={`medal ${medal}`}>{rank}</span>
        {active && <TradingNow />}
      </div>
      <div className="podium-id">
        <Avatar address={w.owner} size={rank === 1 ? 64 : 52} />
        <span className="mono podium-addr">{fmt.short(w.owner)}</span>
      </div>
      <div className="podium-value num">{headline(w, board)}</div>
      <div className="podium-sub">{subline(w, board)}</div>
      <div className="podium-spark">
        <FluidSparkline values={w.spark} height={rank === 1 ? 60 : 46} />
      </div>
      <div className="podium-foot">
        {board === 'pnl' ? (
          <>
            <span>Won vs implied</span>
            <b>
              {w.held.n ? `${fmt.pct(w.held.winRate, 0)} / ${fmt.pct(w.held.implied, 0)}` : '—'}
            </b>
          </>
        ) : (
          <>
            <span>Net PnL</span>
            <b className={pnlClass(w.realizedPnl)}>{fmt.signed(w.realizedPnl)}</b>
          </>
        )}
      </div>
    </Link>
  );
}

export function Leaders({ winners, skill }: { winners: Leader[] | undefined; skill: Leader[] | undefined }) {
  const [board, setBoard] = useState<Board>('pnl');
  const live = useLive();
  const now = useNow(15_000);
  const nav = useRowNav();
  const active = useMemo(
    () => new Set(live.trades.filter((t) => now - t.mintedAtMs < TRADING_NOW_MS).map((t) => t.owner)),
    [live.trades, now],
  );
  const rows = board === 'pnl' ? winners : skill;

  return (
    <section className="leaders">
      <div className="leaders-head">
        <div className="segmented">
          <button className={board === 'pnl' ? 'on' : ''} onClick={() => setBoard('pnl')}>
            Top profit
          </button>
          <button className={board === 'skill' ? 'on' : ''} onClick={() => setBoard('skill')}>
            Beating the odds
          </button>
        </div>
        <span className="sub">
          {board === 'pnl'
            ? 'Realized cash after every fee.'
            : 'Wins beyond what the prices implied, held-to-expiry, 20+ positions.'}
        </span>
      </div>

      {!rows ? (
        <Skeleton h={420} />
      ) : (
        <>
          <div className="podium">
            {rows.slice(0, 3).map((w, i) => (
              <PodiumCard key={`${board}-${w.owner}`} w={w} rank={i + 1} board={board} active={active.has(w.owner)} />
            ))}
          </div>

          <div className="card flush runners-up">
            {rows.slice(3, 10).map((w, i) => (
              <div key={`${board}-${w.owner}`} className="runner clickable" onClick={nav(`/wallet/${w.owner}`)}>
                <span className="runner-rank">{i + 4}</span>
                <Avatar address={w.owner} size={32} />
                <span className="runner-id">
                  <Link to={`/wallet/${w.owner}`} className="mono">
                    {fmt.short(w.owner)}
                  </Link>
                  <span className="runner-sub">
                    {subline(w, board)}
                    {active.has(w.owner) && <TradingNow />}
                  </span>
                </span>
                <span className="runner-spark">
                  <Sparkline values={w.spark} width={110} height={30} strokeWidth={1.75} />
                </span>
                <span className="runner-skill">{board === 'pnl' ? <ZMeter z={w.held.z} /> : <span className={pnlClass(w.realizedPnl)}>{fmt.signed(w.realizedPnl)}</span>}</span>
                <span className="runner-value num">{headline(w, board)}</span>
              </div>
            ))}
            <div className="runners-foot">
              <Link to="/leaderboard">See the full leaderboard ›</Link>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

type DayLeader = { owner: string; pnl: number; resolved: number; wins: number; roi: number | null };

/** Compact "best of the last 24 hours" panel: three cards, no podium. */
export function Top24h({ rows }: { rows: DayLeader[] | undefined }) {
  const live = useLive();
  const now = useNow(15_000);
  const active = useMemo(
    () => new Set(live.trades.filter((t) => now - t.mintedAtMs < TRADING_NOW_MS).map((t) => t.owner)),
    [live.trades, now],
  );
  return (
    <section className="day-panel">
      <div className="section-head">
        <div>
          <h2>Best of the last 24 hours</h2>
          <div className="sub" style={{ marginTop: 6 }}>
            Rolling 24 hours: profit realized (positions settled or sold) in the last 24 hours, after fees.
          </div>
        </div>
      </div>
      {!rows ? (
        <Skeleton h={150} />
      ) : rows.length === 0 ? (
        <div className="card empty">No profitable results in the last 24 hours yet.</div>
      ) : (
        <div className="grid g3">
          {rows.map((d, i) => (
            <Link key={d.owner} to={`/wallet/${d.owner}`} className="card pad-sm day-card">
              <div className="day-top">
                <span className="day-rank">#{i + 1}</span>
                {active.has(d.owner) && <TradingNow />}
              </div>
              <div className="day-id">
                <Avatar address={d.owner} size={36} />
                <span className="mono">{fmt.short(d.owner)}</span>
              </div>
              <div className="day-value num pos">{fmt.signed(d.pnl)}</div>
              <div className="day-sub">
                {d.resolved} {d.resolved === 1 ? 'result' : 'results'} · {d.wins} won · ROI{' '}
                <b className={pnlClass(d.roi)}>{fmt.pct(d.roi, 0)}</b>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
