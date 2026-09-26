import { useState } from 'react';
import { useRowNav } from '../components/tables';
import { AsOfBadge, ErrorNote, Ext, SideBar, Skeleton, StatusPill } from '../components/ui';
import { fmt, pnlClass, useApi, useExplorer, type AsOf, type MarketStats } from '../lib';

interface Resp {
  asOf: AsOf;
  total: number;
  rows: MarketStats[];
}

const LIMIT = 100;

export default function Markets() {
  const [status, setStatus] = useState<'' | 'open' | 'settling' | 'settled'>('');
  const [sort, setSort] = useState<'expiry' | 'volume' | 'traders'>('expiry');
  const [offset, setOffset] = useState(0);
  const { data, error } = useApi<Resp>(`/api/markets?status=${status}&sort=${sort}&limit=${LIMIT}&offset=${offset}`);
  const nav = useRowNav();
  const ex = useExplorer();

  return (
    <>
      <div className="page-head fade-in">
        <h1>Markets</h1>
        <p>
          Every expiry market that has seen a trade. Results appear only once a market is past expiry and its settlement
          price is on-chain.
        </p>
        <AsOfBadge asOf={data?.asOf} />
      </div>

      <div className="toolbar">
        <div className="segmented">
          {(['', 'open', 'settling', 'settled'] as const).map((s) => (
            <button
              key={s}
              className={status === s ? 'on' : ''}
              onClick={() => {
                setStatus(s);
                setOffset(0);
              }}
            >
              {s === '' ? 'All' : s[0]!.toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <label>
          Sort
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as typeof sort);
              setOffset(0);
            }}
          >
            <option value="expiry">Newest expiry</option>
            <option value="volume">Volume</option>
            <option value="traders">Traders</option>
          </select>
        </label>
        {data && <span className="faint" style={{ fontSize: 13, marginLeft: 'auto' }}>{fmt.int(data.total)} markets</span>}
      </div>

      {error && <ErrorNote error={error} />}
      <div className="card flush fade-in">
        {!data ? (
          <Skeleton h={480} style={{ margin: 20 }} />
        ) : data.rows.length === 0 ? (
          <div className="empty">No markets here.</div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Expiry</th>
                    <th>Asset</th>
                    <th>Status</th>
                    <th className="r">Settlement</th>
                    <th className="r">Volume</th>
                    <th className="r">Traders</th>
                    <th className="r">Trades</th>
                    <th>Sides</th>
                    <th className="r">Traders’ PnL</th>
                    <th>Object</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((m) => (
                    <tr key={m.marketId} className="clickable" onClick={nav(`/market/${m.marketId}`)}>
                      <td>
                        {m.expiryMs ? fmt.time(m.expiryMs) : '—'}
                        <span className="faint" style={{ marginLeft: 8, fontSize: 12 }}>
                          {m.expiryMs && m.expiryMs > Date.now() ? `in ${fmt.dur((m.expiryMs - Date.now()) / 1000)}` : ''}
                        </span>
                      </td>
                      <td>{m.underlying ?? '—'}</td>
                      <td>
                        <StatusPill status={m.status} />
                      </td>
                      <td className="r">{fmt.price(m.settlement)}</td>
                      <td className="r" style={{ fontWeight: 600 }}>
                        {fmt.usd(m.volume)}
                      </td>
                      <td className="r">{m.traders}</td>
                      <td className="r">{m.positions}</td>
                      <td style={{ minWidth: 80 }}>
                        <SideBar sides={m.sides} />
                      </td>
                      <td className={`r ${pnlClass(m.traderPnl)}`}>{m.traderPnl == null ? <span className="faint">—</span> : fmt.signed(m.traderPnl)}</td>
                      <td>
                        <Ext href={ex.object(m.marketId)} label={`Open on ${ex.name}`}>
                          <span className="mono">{fmt.short(m.marketId)}</span>&nbsp;
                        </Ext>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.total > LIMIT && (
              <div className="pager">
                <span>
                  {fmt.int(offset + 1)}–{fmt.int(Math.min(data.total, offset + LIMIT))} of {fmt.int(data.total)}
                </span>
                <span style={{ display: 'flex', gap: 8 }}>
                  <button className="btn ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>
                    Previous
                  </button>
                  <button className="btn ghost" disabled={offset + LIMIT >= data.total} onClick={() => setOffset(offset + LIMIT)}>
                    Next
                  </button>
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
