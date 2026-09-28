import { useEffect, useState } from 'react';
import { Addr, Ext, MarketLink, SidePill, Skeleton } from '../components/ui';
import { inspectTransaction, isDigest, type BuyBreakdown, type ClaimBreakdown, type SellBreakdown, type TxInspection } from '../inspect';
import { fmt, Link, normalizeAddress, pnlClass, strikeLabel, useData, useExplorer, useRoute, type Overview } from '../lib';

const c = (usdPerContract: number) => `${(usdPerContract * 100).toFixed(2)}¢`;

// ── search ────────────────────────────────────────────────────────────────

export function InspectHome() {
  const { go } = useRoute();
  const { data } = useData<Overview>('overview.json', 0);
  const [q, setQ] = useState('');
  const [bad, setBad] = useState(false);
  const submit = (v: string) => {
    const s = v.trim();
    if (isDigest(s)) return go(`/tx/${s}`);
    const a = normalizeAddress(s);
    if (a) return go(`/wallet/${a}`);
    setBad(true);
  };
  return (
    <>
      <div className="page-head fade-in">
        <h1>Inspect a trade</h1>
        <p>
          Paste any DeepBook Predict transaction to see where every cent went: the fair price, the trading fee and its
          late-entry surcharge, congestion, price impact, gas, and what you need to win to break even. Read straight from
          the chain.
        </p>
      </div>
      <form
        className="inspect-search"
        onSubmit={(e) => {
          e.preventDefault();
          submit(q);
        }}
      >
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setBad(false);
          }}
          placeholder="Transaction digest (e.g. GdxnmFiq…) or wallet address"
          spellCheck={false}
          autoFocus
          style={bad ? { boxShadow: '0 0 0 2px var(--neg)' } : undefined}
        />
        <button className="btn" type="submit">
          Inspect
        </button>
      </form>
      {bad && <p className="neg" style={{ fontSize: 14 }}>That isn’t a transaction digest or a Sui address.</p>}
      {data && (
        <section>
          <div className="section-head">
            <h2>Or pick a recent trade</h2>
          </div>
          <div className="grid g3">
            {data.recent.slice(0, 6).map((p) => (
              <Link key={p.id} to={`/tx/${p.digest}`} className="card pad-sm day-card">
                <div className="day-top">
                  <SidePill side={p.side} />
                  <span className="faint" style={{ fontSize: 12 }}>
                    {fmt.ago(p.mintedAtMs)}
                  </span>
                </div>
                <div className="day-value num" style={{ fontSize: 22 }}>
                  {fmt.usd(p.cost, true)}
                </div>
                <div className="day-sub">
                  {fmt.cents(p.entryProb)} quoted · {c(p.cost / p.quantity)} all-in
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

// ── result ────────────────────────────────────────────────────────────────

export function InspectTx({ digest }: { digest: string }) {
  const ex = useExplorer();
  const [tx, setTx] = useState<TxInspection | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setTx(null);
    setErr(null);
    inspectTransaction(digest)
      .then((t) => alive && setTx(t))
      .catch((e) => alive && setErr(String(e?.message ?? e)));
    return () => {
      alive = false;
    };
  }, [digest]);

  return (
    <>
      <div className="page-head fade-in">
        <div className="eyebrow">
          <Link to="/inspect">Inspect</Link> · Transaction
        </div>
        <h1 className="mono" style={{ fontSize: 'clamp(24px, 3.4vw, 36px)', letterSpacing: 0, wordBreak: 'break-all' }}>
          {fmt.short(digest)}
        </h1>
        <p className="mono" style={{ fontSize: 13, wordBreak: 'break-all', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {digest}
          <Ext href={ex.tx(digest)} label={`Open on ${ex.name}`}>
            {ex.name}&nbsp;
          </Ext>
        </p>
        {tx && (
          <div className="tx-meta">
            <span>{new Date(tx.timestampMs).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'medium' })}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              Signed by <Addr address={tx.sender} link={false} />
            </span>
            <span>
              {tx.gasSui >= 0
                ? `Gas ${tx.gasSui.toFixed(5)} SUI`
                : `Gas refund ${Math.abs(tx.gasSui).toFixed(5)} SUI (freed storage)`}
            </span>
            {!tx.success && <span className="neg">Failed transaction</span>}
          </div>
        )}
      </div>
      {err ? (
        <div className="card empty">Couldn’t read this transaction — {err}</div>
      ) : !tx ? (
        <Skeleton h={420} />
      ) : tx.items.length === 0 ? (
        <div className="card empty">This transaction has no DeepBook Predict trades in it.</div>
      ) : (
        tx.items.map((it, i) =>
          it.kind === 'buy' ? (
            <BuyCard key={i} b={it} sender={tx.sender} gasSui={i === 0 ? tx.gasSui : 0} />
          ) : it.kind === 'sell' ? (
            <SellCard key={i} s={it} />
          ) : (
            <ClaimCard key={i} c={it} />
          ),
        )
      )}
    </>
  );
}

// ── buy ───────────────────────────────────────────────────────────────────

interface Line {
  key: string;
  label: string;
  note: string;
  amount: number;
  color: string;
}

function BuyCard({ b, sender, gasSui }: { b: BuyBreakdown; sender: string; gasSui: number }) {
  const [expected, setExpected] = useState('');
  const exp = Number(expected) / 100;
  const slippage = expected !== '' && Number.isFinite(exp) ? (b.entryProb - exp) * b.contracts : null;
  const fees = b.cost - b.premium;
  const lines: Line[] = [
    { key: 'fair', label: 'Fair price', note: `${fmt.cents(b.entryProb)} × ${b.contracts.toFixed(2)} contracts`, amount: b.premium, color: 'var(--accent)' },
    ...(b.baseFee != null
      ? [
          { key: 'base', label: 'Trading fee · base', note: 'what this fee would be with plenty of time left', amount: b.baseFee, color: 'var(--warn)' },
          { key: 'late', label: 'Trading fee · late-entry surcharge', note: `buying ${fmt.dur(b.secondsToExpiry)} before expiry`, amount: b.lateSurcharge ?? 0, color: 'var(--neg)' },
        ]
      : [{ key: 'fee', label: 'Trading fee', note: 'includes any late-entry surcharge', amount: b.tradingFee, color: 'var(--warn)' }]),
    { key: 'cong', label: 'Congestion surcharge', note: 'charged when Sui gas is busy', amount: b.congestion, color: 'var(--range)' },
    { key: 'impact', label: 'Price impact', note: 'size charge, partly refunded if you sell early', amount: b.impact, color: 'var(--accent-2)' },
    { key: 'builder', label: 'Builder fee', note: 'to the app that built the trade', amount: b.builder, color: 'var(--text-3)' },
  ];
  const shown = lines.filter((l) => l.amount > 0 || l.key === 'fair');
  const gross = shown.reduce((a, l) => a + l.amount, 0);
  const pnlIfHeld = b.outcome.payout != null ? b.outcome.payout - b.cost : null;

  return (
    <section className="card inspect-card fade-in">
      <div className="inspect-head">
        <div>
          <div className="card-title" style={{ justifyContent: 'flex-start', gap: 10 }}>
            <span>Buy</span>
            <SidePill side={b.side} />
            <span className="muted">
              {b.market.underlying} {strikeLabel(b)} · expires {fmt.time(b.market.expiryMs)}
            </span>
          </div>
          <div className="inspect-owner">
            Position of <Addr address={b.owner} />
            {sender && sender !== b.owner && <span className="faint"> · via session key</span>}
            <span className="faint"> · </span>
            <MarketLink id={b.market.id} label="market" />
          </div>
        </div>
        <OutcomePill o={b.outcome} />
      </div>

      <div className="inspect-hero">
        <div>
          <div className="inspect-big num">{c(b.allInPerContract)}</div>
          <div className="muted">all-in per contract</div>
        </div>
        <div className="inspect-vs">vs</div>
        <div>
          <div className="inspect-big num muted">{fmt.cents(b.entryProb)}</div>
          <div className="muted">quoted price</div>
        </div>
        <div className="inspect-callout">
          Fees added <b>{c(fees / b.contracts)}</b> per contract, <b>{fmt.pct(fees / b.premium, 0)}</b> on top of the price.
          <br />
          To break even, positions like this must win <b>{fmt.pct(b.allInPerContract, 1)}</b> of the time.
        </div>
      </div>

      <div className="stack-bar" role="img" aria-label="Cost breakdown">
        {shown.map((l) => (
          <div key={l.key} title={`${l.label}: ${fmt.usd(l.amount, true)}`} style={{ width: `${(l.amount / gross) * 100}%`, background: l.color }} />
        ))}
      </div>

      <table className="inspect-table">
        <tbody>
          {shown.map((l) => (
            <tr key={l.key}>
              <td>
                <span className="swatch" style={{ background: l.color, marginRight: 10 }} />
                <b>{l.label}</b>
                <div className="faint inspect-note">{l.note}</div>
              </td>
              <td className="r num">{c(l.amount / b.contracts)}</td>
              <td className="r num">{fmt.pct(l.amount / gross, 0)}</td>
              <td className="r num">
                <b>{fmt.usd(l.amount, true)}</b>
              </td>
            </tr>
          ))}
          {b.subsidy > 0 && (
            <tr>
              <td>
                <b>Incentive subsidy</b>
                <div className="faint inspect-note">part of the fee paid by a sponsor, not you</div>
              </td>
              <td className="r num pos">−{c(b.subsidy / b.contracts)}</td>
              <td />
              <td className="r num pos">−{fmt.usd(b.subsidy, true)}</td>
            </tr>
          )}
          <tr className="inspect-total">
            <td>Total paid</td>
            <td className="r num">{c(b.allInPerContract)}</td>
            <td />
            <td className="r num">{fmt.usd(b.cost, true)}</td>
          </tr>
          {b.referral > 0 && (
            <tr>
              <td className="faint" colSpan={4}>
                {fmt.usd(b.referral, true)} of the trading fee went to a referrer.
              </td>
            </tr>
          )}
          {gasSui !== 0 && (
            <tr>
              <td className="faint" colSpan={4}>
                {gasSui > 0
                  ? `Plus ${gasSui.toFixed(5)} SUI network gas for the whole transaction.`
                  : `The transaction refunded ${Math.abs(gasSui).toFixed(5)} SUI of storage, net of gas.`}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className={`fee-check ${b.feeCheck}`}>
        {b.feeCheck === 'exact'
          ? '✓ Fee recomputed from the market’s own fee policy — matches the chain to the last unit.'
          : b.feeCheck === 'mismatch'
            ? 'Our recomputed fee doesn’t match the chain for this trade, so the base / late split is hidden.'
            : 'Fee policy unavailable, so the base / late split is hidden.'}
      </div>

      <div className="grid g4 inspect-stats">
        <Mini label="Contracts" value={b.contracts.toFixed(2)} foot={`pays ${fmt.usd(b.contracts, true)} if it wins`} />
        <Mini label="Payout multiple" value={`${(1 / b.allInPerContract).toFixed(2)}×`} foot="payout ÷ total paid" />
        <Mini label="Time left at entry" value={fmt.dur(b.secondsToExpiry)} foot={b.market.expiryMs ? `expiry ${fmt.time(b.market.expiryMs)}` : ''} />
        <Mini
          label="Price feed age"
          value={b.oracleAgeMs.pyth != null ? `${(b.oracleAgeMs.pyth / 1000).toFixed(2)}s` : '—'}
          foot={b.oracleAgeMs.blockScholes != null ? `vol surface ${(b.oracleAgeMs.blockScholes / 1000).toFixed(1)}s old` : 'Pyth spot'}
        />
      </div>

      <div className="slippage">
        <label>
          Price you expected
          <input
            inputMode="decimal"
            value={expected}
            onChange={(e) => setExpected(e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder={(b.entryProb * 100).toFixed(1)}
          />
          ¢
        </label>
        <span className="muted">
          {slippage == null ? (
            'The chain records the price you got, not the one you saw. Enter it to measure slippage.'
          ) : (
            <>
              Slippage <b className={pnlClass(-slippage)}>{slippage >= 0 ? '+' : '−'}{c(Math.abs(slippage) / b.contracts)}</b> per contract ={' '}
              <b className={pnlClass(-slippage)}>{fmt.usd(Math.abs(slippage), true)}</b> {slippage >= 0 ? 'worse' : 'better'} than expected.
            </>
          )}
        </span>
      </div>

      {pnlIfHeld != null && (
        <div className="inspect-result">
          Settled at <b>{fmt.price(b.outcome.settlement)}</b> — held to expiry this position{' '}
          {b.outcome.status === 'won' ? 'paid' : 'paid nothing'}
          {b.outcome.status === 'won' && <b> {fmt.usd(b.outcome.payout!, true)}</b>}, a result of{' '}
          <b className={pnlClass(pnlIfHeld)}>{fmt.signed(pnlIfHeld)}</b>
          <span className="faint"> (before any early sale — see the wallet page for the full record).</span>
        </div>
      )}
    </section>
  );
}

function Mini({ label, value, foot }: { label: string; value: string; foot: string }) {
  return (
    <div className="stat">
      <div className="card-title">{label}</div>
      <div className="value" style={{ fontSize: 22 }}>
        {value}
      </div>
      <div className="foot">{foot}</div>
    </div>
  );
}

function OutcomePill({ o }: { o: BuyBreakdown['outcome'] }) {
  const text = { open: 'Open', awaiting: 'Awaiting settlement', won: 'Won', lost: 'Lost' }[o.status];
  const cls = { open: 'open', awaiting: 'settling', won: 'won', lost: 'lost' }[o.status];
  return <span className={`pill ${cls}`}>{text}</span>;
}

// ── sell / claim ──────────────────────────────────────────────────────────

function SellCard({ s }: { s: SellBreakdown }) {
  const rows = [
    { label: 'Sale value', note: `${c(s.pricePerContract)} × ${s.contractsClosed.toFixed(2)} contracts`, amount: s.saleValue, sign: 1 },
    { label: 'Trading fee', note: '', amount: s.tradingFee, sign: -1 },
    { label: 'Congestion surcharge', note: '', amount: s.congestion, sign: -1 },
    { label: 'Builder fee', note: '', amount: s.builder, sign: -1 },
    { label: 'Price-impact refund', note: 'part of the impact charge paid at purchase', amount: s.impactRefund, sign: 1 },
  ].filter((r) => r.amount > 0 || r.label === 'Sale value');
  return (
    <section className="card inspect-card fade-in">
      <div className="inspect-head">
        <div>
          <div className="card-title" style={{ justifyContent: 'flex-start', gap: 10 }}>
            <span>Sold early</span>
            <span className="muted">
              {s.market.underlying} · {fmt.dur(s.secondsToExpiry)} before expiry
            </span>
          </div>
          <div className="inspect-owner">
            Position of <Addr address={s.owner} /> <span className="faint">·</span> <MarketLink id={s.market.id} label="market" />
          </div>
        </div>
        <span className="pill exited">{s.remaining > 0 ? `Partial · ${s.remaining.toFixed(2)} left` : 'Fully closed'}</span>
      </div>
      <table className="inspect-table">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>
                <b>{r.label}</b>
                {r.note && <div className="faint inspect-note">{r.note}</div>}
              </td>
              <td className={`r num ${r.sign < 0 ? 'neg' : ''}`}>
                {r.sign < 0 ? '−' : ''}
                {fmt.usd(r.amount, true)}
              </td>
            </tr>
          ))}
          <tr className="inspect-total">
            <td>Received</td>
            <td className="r num">{fmt.usd(s.proceeds, true)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function ClaimCard({ c: cl }: { c: ClaimBreakdown }) {
  return (
    <section className="card inspect-card fade-in">
      <div className="inspect-head">
        <div>
          <div className="card-title" style={{ justifyContent: 'flex-start', gap: 10 }}>
            <span>Claimed after settlement</span>
            <span className="muted">{cl.market.underlying}</span>
          </div>
          <div className="inspect-owner">
            Position of <Addr address={cl.owner} /> <span className="faint">·</span> <MarketLink id={cl.market.id} label="market" />
          </div>
        </div>
        <span className={`pill ${cl.payout > 0 ? 'won' : 'lost'}`}>{cl.payout > 0 ? 'Winning claim' : 'Nothing to claim'}</span>
      </div>
      <div className="inspect-hero">
        <div>
          <div className="inspect-big num">{fmt.usd(cl.payout, true)}</div>
          <div className="muted">paid out · settled at {fmt.price(cl.market.settlement)}</div>
        </div>
      </div>
    </section>
  );
}
