import { useMemo, useState } from 'react';
import { useRowNav } from '../components/tables';
import { Addr, AsOfBadge, ErrorNote, SideBar, Skeleton, ZMeter } from '../components/ui';
import { fmt, pnlClass, useData, type AsOf, type WalletStats } from '../lib';

interface Resp {
  asOf: AsOf;
  rows: WalletStats[];
}

export default function Leaderboard() {
  const [by, setBy] = useState<'pnl' | 'skill'>('pnl');
  const [dir, setDir] = useState<'desc' | 'asc'>('desc');
  const [min, setMin] = useState(by === 'skill' ? 20 : 0);
  const { data: all, error } = useData<Resp>('wallets.json');
  const data = useMemo(() => {
    if (!all) return null;
    const sign = dir === 'asc' ? 1 : -1;
    const rows =
      by === 'skill'
        ? all.rows.filter((w) => w.held.n >= min && w.held.z != null).sort((a, b) => sign * (a.held.z! - b.held.z!))
        : all.rows.filter((w) => w.positions - w.open >= min).sort((a, b) => sign * (a.realizedPnl - b.realizedPnl));
    return { asOf: all.asOf, total: rows.length, rows: rows.slice(0, 200) };
  }, [all, by, dir, min]);
  const nav = useRowNav();

  function switchTo(b: 'pnl' | 'skill') {
    setBy(b);
    setMin(b === 'skill' ? 20 : 0);
  }

  return (
    <>
      <div className="page-head fade-in">
        <h1>Leaderboard</h1>
        <p>
          {by === 'pnl'
            ? 'Ranked by realized cash result after every fee. Open positions don’t count until they close or settle.'
            : 'Ranked by how much more often a wallet wins than the prices it paid implied — held-to-expiry positions only. A z-score beyond +2σ is hard to explain with luck.'}
        </p>
        <AsOfBadge asOf={data?.asOf} />
      </div>

      <div className="toolbar">
        <div className="segmented">
          <button className={by === 'pnl' ? 'on' : ''} onClick={() => switchTo('pnl')}>
            Profit
          </button>
          <button className={by === 'skill' ? 'on' : ''} onClick={() => switchTo('skill')}>
            Skill
          </button>
        </div>
        <div className="segmented">
          <button className={dir === 'desc' ? 'on' : ''} onClick={() => setDir('desc')}>
            {by === 'pnl' ? 'Top' : 'Beating odds'}
          </button>
          <button className={dir === 'asc' ? 'on' : ''} onClick={() => setDir('asc')}>
            {by === 'pnl' ? 'Bottom' : 'Trailing odds'}
          </button>
        </div>
        <label>
          Min. {by === 'skill' ? 'held positions' : 'closed trades'}
          <select value={min} onChange={(e) => setMin(Number(e.target.value))}>
            {/* Profit defaults to everyone, matching the front page and wallet ranks. */}
            {(by === 'skill' ? [10, 20, 50, 100] : [0, 5, 20, 50]).map((n) => (
              <option key={n} value={n}>
                {n === 0 ? 'Any' : n}
              </option>
            ))}
          </select>
        </label>
        {data && <span className="faint" style={{ fontSize: 13, marginLeft: 'auto' }}>{fmt.int(data.total)} wallets qualify</span>}
      </div>

      {error && <ErrorNote error={error} />}
      <div className="card flush fade-in">
        {!data ? (
          <Skeleton h={480} style={{ margin: 20 }} />
        ) : data.rows.length === 0 ? (
          <div className="empty">No wallets meet this threshold yet.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Wallet</th>
                  <th className="r">Net PnL</th>
                  <th className="r">ROI</th>
                  <th className="r">Trades</th>
                  <th className="r" title="Held-to-expiry wins / implied by price paid">Won vs implied</th>
                  <th>Skill</th>
                  <th className="r">Sold early</th>
                  <th className="r">Avg price</th>
                  <th className="r">Avg time left</th>
                  <th>Sides</th>
                  <th className="r">Fees paid</th>
                  <th className="r">Last trade</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((w, i) => (
                  <tr key={w.owner} className="clickable" onClick={nav(`/wallet/${w.owner}`)}>
                    <td className="rank">{i + 1}</td>
                    <td>
                      <Addr address={w.owner} />
                    </td>
                    <td className={`r ${pnlClass(w.realizedPnl)}`} style={{ fontWeight: 600 }}>
                      {fmt.signed(w.realizedPnl)}
                    </td>
                    <td className={`r ${pnlClass(w.roi)}`}>{fmt.pct(w.roi)}</td>
                    <td className="r">{fmt.int(w.positions)}</td>
                    <td className="r">
                      {w.held.n ? (
                        <>
                          {fmt.pct(w.held.winRate, 0)} <span className="faint">vs {fmt.pct(w.held.implied, 0)}</span>
                        </>
                      ) : (
                        <span className="faint">—</span>
                      )}
                    </td>
                    <td>
                      <ZMeter z={w.held.z} />
                    </td>
                    <td className="r">{fmt.pct(w.earlyExitRate, 0)}</td>
                    <td className="r">{fmt.cents(w.avgEntryProb)}</td>
                    <td className="r">{fmt.dur(w.avgSecondsToExpiry)}</td>
                    <td style={{ minWidth: 80 }}>
                      <SideBar sides={w.sides} />
                    </td>
                    <td className="r muted">{fmt.usd(w.feesPaid)}</td>
                    <td className="r muted">{fmt.ago(w.lastMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
