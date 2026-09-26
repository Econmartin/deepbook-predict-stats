import type { ReactNode } from 'react';
import { fmt, Link, useExplorer, type AsOf, type Side, type Status } from '../lib';

export function ExtIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M4.5 2.5H2.75a.75.75 0 0 0-.75.75v6c0 .41.34.75.75.75h6c.41 0 .75-.34.75-.75V7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M7 2h3v3M10 2 5.5 6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Ext({ href, label, children }: { href: string; label: string; children?: ReactNode }) {
  return (
    <a className="ext" href={href} target="_blank" rel="noreferrer noopener" title={label} aria-label={label} onClick={(e) => e.stopPropagation()}>
      {children}
      <ExtIcon />
    </a>
  );
}

/** Deterministic two-tone gradient from an address — no external identicon service. */
export function Avatar({ address, size = 22 }: { address: string; size?: number }) {
  const h1 = parseInt(address.slice(2, 8), 16) % 360;
  const h2 = (h1 + 40 + (parseInt(address.slice(8, 12), 16) % 120)) % 360;
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, background: `linear-gradient(135deg, hsl(${h1} 80% 62%), hsl(${h2} 75% 52%))` }}
    />
  );
}

export function Addr({ address, link = true, full = false }: { address: string; link?: boolean; full?: boolean }) {
  const ex = useExplorer();
  const label = full ? address : fmt.short(address);
  return (
    <span className="addr">
      <Avatar address={address} />
      {link ? <Link to={`/wallet/${address}`}>{label}</Link> : <span>{label}</span>}
      <Ext href={ex.account(address)} label={`Open account on ${ex.name}`} />
    </span>
  );
}

export function TxLink({ digest, children }: { digest: string; children?: ReactNode }) {
  const ex = useExplorer();
  return (
    <a className="mono" href={ex.tx(digest)} target="_blank" rel="noreferrer noopener" title={`View transaction on ${ex.name}`} onClick={(e) => e.stopPropagation()}>
      {children ?? `${digest.slice(0, 6)}…`}
    </a>
  );
}

export function MarketLink({ id, label }: { id: string; label?: ReactNode }) {
  const ex = useExplorer();
  return (
    <span className="addr">
      <Link to={`/market/${id}`}>{label ?? fmt.short(id)}</Link>
      <Ext href={ex.object(id)} label={`Open market object on ${ex.name}`} />
    </span>
  );
}

const SIDE_LABEL: Record<Side, string> = { up: 'Up', down: 'Down', range: 'Range' };
export function SidePill({ side }: { side: Side }) {
  return (
    <span className={`pill ${side}`}>
      {side === 'up' ? '↑' : side === 'down' ? '↓' : '↔'} {SIDE_LABEL[side]}
    </span>
  );
}

const STATUS_LABEL: Record<Status | 'settled', string> = {
  open: 'Open',
  settling: 'Settling',
  exited: 'Sold early',
  won: 'Won',
  lost: 'Lost',
  settled: 'Settled',
};
export function StatusPill({ status }: { status: Status | 'settled' }) {
  return <span className={`pill ${status === 'settled' ? '' : status}`}>{STATUS_LABEL[status]}</span>;
}

export function AsOfBadge({ asOf }: { asOf: AsOf | undefined }) {
  const ex = useExplorer();
  if (!asOf) return null;
  return (
    <span className="asof">
      <span className="live-dot" />
      Indexed through{' '}
      {asOf.checkpoint ? (
        <a href={ex.checkpoint(asOf.checkpoint)} target="_blank" rel="noreferrer noopener" className="num">
          checkpoint {fmt.int(asOf.checkpoint)}
        </a>
      ) : (
        '—'
      )}
      <span className="faint sync">·</span>
      <span className="sync">synced {fmt.ago(asOf.lastSyncMs)}</span>
    </span>
  );
}

export function Stat({ label, value, foot, className }: { label: ReactNode; value: ReactNode; foot?: ReactNode; className?: string }) {
  return (
    <div className={`stat ${className ?? ''}`}>
      <div className="card-title">{label}</div>
      <div className="value">{value}</div>
      {foot && <div className="foot">{foot}</div>}
    </div>
  );
}

export function SideBar({ sides, total }: { sides: Record<Side, number>; total?: number }) {
  const t = total ?? sides.up + sides.down + sides.range;
  if (!t) return <div className="bar-track" />;
  return (
    <div className="bar-track" role="img" aria-label={`Up ${fmt.pct(sides.up / t)}, Down ${fmt.pct(sides.down / t)}, Range ${fmt.pct(sides.range / t)}`}>
      <div style={{ width: `${(sides.up / t) * 100}%`, background: 'var(--up)' }} />
      <div style={{ width: `${(sides.down / t) * 100}%`, background: 'var(--down)' }} />
      {sides.range > 0 && <div style={{ width: `${(sides.range / t) * 100}%`, background: 'var(--range)' }} />}
    </div>
  );
}

/** A σ gauge: bar grows right (green) for beating the odds, left (red) for trailing them. */
export function ZMeter({ z }: { z: number | null }) {
  if (z == null) return <span className="faint">—</span>;
  const w = Math.min(Math.abs(z) / 4, 1) * 50;
  return (
    <span className="z-meter">
      <span className="track">
        <i style={{ left: z >= 0 ? '50%' : `${50 - w}%`, width: `${w}%`, background: z >= 0 ? 'var(--pos)' : 'var(--neg)' }} />
      </span>
      <b className={`num ${z >= 2 ? 'pos' : z <= -2 ? 'neg' : ''}`} style={{ fontWeight: 600 }}>
        {fmt.z(z)}
      </b>
    </span>
  );
}

export function Skeleton({ h = 120, style }: { h?: number; style?: React.CSSProperties }) {
  return <div className="skeleton" style={{ height: h, ...style }} />;
}

export function ErrorNote({ error }: { error: string }) {
  return <div className="card empty">Couldn’t load data — {error}</div>;
}
