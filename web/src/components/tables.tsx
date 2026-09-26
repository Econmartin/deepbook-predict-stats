import { useState } from 'react';
import { fmt, pnlClass, strikeLabel, useRoute, type Position } from '../lib';
import { Addr, MarketLink, SidePill, StatusPill, TxLink } from './ui';

const PAGE = 50;

export function PositionsTable({ rows, showOwner = false, showMarket = true }: { rows: Position[]; showOwner?: boolean; showMarket?: boolean }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const view = rows.slice(page * PAGE, page * PAGE + PAGE);
  if (!rows.length) return <div className="empty">No trades yet.</div>;
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              {showOwner && <th>Wallet</th>}
              <th>Side</th>
              <th>Strike</th>
              <th className="r">Paid</th>
              <th className="r">Cost</th>
              <th className="r">Max payout</th>
              <th className="r">Time left</th>
              <th>Result</th>
              <th className="r">PnL</th>
              {showMarket && <th>Market</th>}
              <th>Tx</th>
            </tr>
          </thead>
          <tbody>
            {view.map((p) => (
              <tr key={p.id}>
                <td className="muted">{fmt.time(p.mintedAtMs)}</td>
                {showOwner && (
                  <td>
                    <Addr address={p.owner} />
                  </td>
                )}
                <td>
                  <SidePill side={p.side} />
                </td>
                <td className="num">{strikeLabel(p)}</td>
                <td className="r">{fmt.cents(p.entryProb)}</td>
                <td className="r">{fmt.usd(p.cost, true)}</td>
                <td className="r">{fmt.usd(p.quantity, true)}</td>
                <td className="r muted">{fmt.dur(p.secondsToExpiry)}</td>
                <td>
                  <StatusPill status={p.status} />
                  {p.status === 'exited' && p.lastExitDigest && (
                    <span style={{ marginLeft: 6 }}>
                      <TxLink digest={p.lastExitDigest}>sell</TxLink>
                    </span>
                  )}
                </td>
                <td className={`r ${pnlClass(p.pnl)}`} style={{ fontWeight: 600 }}>
                  {p.pnl == null ? <span className="faint">—</span> : fmt.signed(p.pnl)}
                </td>
                {showMarket && (
                  <td>
                    <MarketLink id={p.marketId} label={p.expiryMs ? `${p.underlying ?? ''} ${fmt.time(p.expiryMs)}` : undefined} />
                  </td>
                )}
                <td>
                  <TxLink digest={p.digest} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="pager">
          <span>
            {fmt.int(page * PAGE + 1)}–{fmt.int(Math.min(rows.length, (page + 1) * PAGE))} of {fmt.int(rows.length)}
          </span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button className="btn ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <button className="btn ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
              Next
            </button>
          </span>
        </div>
      )}
    </>
  );
}

export function useRowNav() {
  const { go } = useRoute();
  return (to: string) => (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('a,button')) return;
    go(to);
  };
}
