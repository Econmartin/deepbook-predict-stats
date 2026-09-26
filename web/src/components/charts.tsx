/**
 * Hand-rolled SVG charts. Responsive via ResizeObserver, hover guides with a
 * floating tooltip, and colors pulled from CSS variables so light/dark just work.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { fmt, type CalBucket } from '../lib';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e!.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

function Tooltip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <div className="tooltip" style={{ left: x, top: y }}>
      {children}
    </div>
  );
}

// ── stacked bars ─────────────────────────────────────────────────────────

export interface Series<T> {
  key: string;
  label: string;
  color: string;
  value: (d: T) => number;
}

export function StackedBars<T>({
  data,
  series,
  x,
  xLabel,
  height = 240,
  yFormat = fmt.usdCompact,
  tooltipExtra,
}: {
  data: T[];
  series: Series<T>[];
  x: (d: T) => number;
  xLabel: (t: number) => string;
  height?: number;
  yFormat?: (v: number) => string;
  tooltipExtra?: (d: T) => ReactNode;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 44, r: 4, t: 10, b: 26 };
  const iw = Math.max(0, width - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const max = niceMax(Math.max(0, ...data.map((d) => series.reduce((a, s) => a + s.value(d), 0))));
  const bw = data.length ? iw / data.length : 0;
  const gap = Math.min(6, bw * 0.28);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(iw / 64))));

  return (
    <div className="chart" ref={ref} onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg height={height} viewBox={`0 0 ${width} ${height}`}>
          <g className="axis">
            {ticks.map((t) => (
              <g key={t} transform={`translate(0 ${pad.t + ih - t * ih})`}>
                <line className="grid-line" x1={pad.l} x2={width - pad.r} strokeDasharray={t === 0 ? undefined : '2 4'} />
                <text x={pad.l - 10} dy="0.32em" textAnchor="end">
                  {yFormat(max * t)}
                </text>
              </g>
            ))}
            {data.map((d, i) =>
              i % labelEvery === 0 ? (
                <text key={i} x={pad.l + i * bw + bw / 2} y={height - 6} textAnchor="middle">
                  {xLabel(x(d))}
                </text>
              ) : null,
            )}
          </g>
          {data.map((d, i) => {
            let y0 = pad.t + ih;
            const bx = pad.l + i * bw + gap / 2;
            const w = Math.max(1, bw - gap);
            const total = series.reduce((a, s) => a + s.value(d), 0);
            return (
              <g key={i} opacity={hover == null || hover === i ? 1 : 0.45} style={{ transition: 'opacity .2s' }}>
                {series.map((s, si) => {
                  const h = (s.value(d) / max) * ih;
                  y0 -= h;
                  const isTop = si === series.length - 1 || series.slice(si + 1).every((n) => n.value(d) === 0);
                  const r = isTop ? Math.min(4, w / 2, h) : 0;
                  return h > 0 ? (
                    <path
                      key={s.key}
                      fill={s.color}
                      d={`M${bx},${y0 + h} V${y0 + r} Q${bx},${y0} ${bx + r},${y0} H${bx + w - r} Q${bx + w},${y0} ${bx + w},${y0 + r} V${y0 + h} Z`}
                    />
                  ) : null;
                })}
                <rect x={pad.l + i * bw} y={pad.t} width={bw} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} />
                {total === 0 && null}
              </g>
            );
          })}
        </svg>
      )}
      {hover != null && data[hover] && (
        <Tooltip
          x={Math.min(Math.max(pad.l + hover * bw + bw / 2, 80), width - 80)}
          y={pad.t + ih - (series.reduce((a, s) => a + s.value(data[hover]!), 0) / max) * ih}
        >
          <div className="t-head">{xLabel(x(data[hover]!))}</div>
          {series.map((s) => (
            <div className="t-row" key={s.key}>
              <span>
                <span className="swatch" style={{ background: s.color, marginRight: 6 }} />
                {s.label}
              </span>
              <b>{yFormat(s.value(data[hover]!))}</b>
            </div>
          ))}
          {tooltipExtra?.(data[hover]!)}
        </Tooltip>
      )}
    </div>
  );
}

// ── line / area ──────────────────────────────────────────────────────────

export function AreaLine({
  points,
  height = 220,
  yFormat = fmt.usdCompact,
  xFormat = fmt.time,
  color,
  signed = false,
  domain,
  refLine,
  refLabel,
}: {
  points: Array<{ t: number; v: number }>;
  height?: number;
  yFormat?: (v: number) => string;
  xFormat?: (t: number) => string;
  color?: string;
  /** Color by sign of the last value and draw a zero line. */
  signed?: boolean;
  domain?: [number, number];
  refLine?: number;
  refLabel?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId().replace(/:/g, '');
  const pad = { l: 52, r: 8, t: 12, b: 26 };
  const iw = Math.max(0, width - pad.l - pad.r);
  const ih = height - pad.t - pad.b;

  const { lo, hi, t0, t1, ticks } = useMemo(() => {
    const vs = points.map((p) => p.v);
    let lo = domain?.[0] ?? Math.min(0, ...vs);
    let hi = domain?.[1] ?? Math.max(0, ...vs);
    let ticks: number[];
    if (domain) {
      ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + f * (hi - lo));
    } else {
      // Round ticks: pick a 1/2/2.5/5 step so the axis reads cleanly.
      const step = niceMax((hi - lo || 1) / 4);
      lo = Math.floor(lo / step) * step;
      hi = Math.ceil(hi / step) * step;
      if (hi === lo) hi = lo + step;
      ticks = [];
      for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
    }
    return { lo, hi, t0: points[0]?.t ?? 0, t1: points.at(-1)?.t ?? 1, ticks };
  }, [points, domain]);

  const sx = (t: number) => pad.l + (t1 === t0 ? iw / 2 : ((t - t0) / (t1 - t0)) * iw);
  const sy = (v: number) => pad.t + ih - ((v - lo) / (hi - lo || 1)) * ih;
  const last = points.at(-1)?.v ?? 0;
  const stroke = color ?? (signed ? (last >= 0 ? 'var(--pos)' : 'var(--neg)') : 'var(--accent)');
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.t).toFixed(1)},${sy(p.v).toFixed(1)}`).join('');
  const base = sy(signed ? 0 : lo);
  const area = points.length ? `${line}L${sx(t1)},${base}L${sx(t0)},${base}Z` : '';

  function onMove(e: React.MouseEvent) {
    if (!points.length) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const t = t0 + ((e.clientX - r.left - pad.l) / iw) * (t1 - t0);
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(points[i]!.t - t) < Math.abs(points[best]!.t - t)) best = i;
    setHover(best);
  }

  const hp = hover != null ? points[hover] : undefined;
  return (
    <div className="chart" ref={ref} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg height={height} viewBox={`0 0 ${width} ${height}`}>
          <defs>
            <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={stroke} stopOpacity="0.24" />
              <stop offset="1" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          <g className="axis">
            {ticks.map((v, i) => (
              <g key={i} transform={`translate(0 ${sy(v)})`}>
                <line className="grid-line" x1={pad.l} x2={width - pad.r} strokeDasharray="2 4" />
                <text x={pad.l - 10} dy="0.32em" textAnchor="end">
                  {yFormat(v)}
                </text>
              </g>
            ))}
            {points.length > 1 &&
              [0, 0.5, 1].map((f) => {
                const t = t0 + f * (t1 - t0);
                return (
                  <text key={f} x={sx(t)} y={height - 6} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}>
                    {xFormat(t)}
                  </text>
                );
              })}
          </g>
          {signed && lo < 0 && <line x1={pad.l} x2={width - pad.r} y1={sy(0)} y2={sy(0)} stroke="var(--line-strong)" />}
          {refLine != null && (
            <g>
              <line x1={pad.l} x2={width - pad.r} y1={sy(refLine)} y2={sy(refLine)} stroke="var(--text-3)" strokeDasharray="4 4" />
              {refLabel && (
                <text x={width - pad.r} y={sy(refLine) - 6} textAnchor="end" fontSize="11" fill="var(--text-3)">
                  {refLabel}
                </text>
              )}
            </g>
          )}
          <path d={area} fill={`url(#${gid})`} />
          <path d={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {hp && (
            <g>
              <line x1={sx(hp.t)} x2={sx(hp.t)} y1={pad.t} y2={pad.t + ih} stroke="var(--line-strong)" />
              <circle cx={sx(hp.t)} cy={sy(hp.v)} r="5" fill="var(--bg-elev)" stroke={stroke} strokeWidth="2.5" />
            </g>
          )}
        </svg>
      )}
      {hp && (
        <Tooltip x={Math.min(Math.max(sx(hp.t), 80), width - 80)} y={sy(hp.v)}>
          <div className="t-head">{yFormat(hp.v)}</div>
          <div className="faint">{xFormat(hp.t)}</div>
        </Tooltip>
      )}
    </div>
  );
}

// ── calibration: implied vs realized ─────────────────────────────────────

/**
 * Each bucket: implied probability (what traders paid) on x, realized win
 * rate on y. On the diagonal = fairly priced. Above = underdogs win more
 * often than the price says. Bubble area ∝ sample size.
 */
export function Calibration({ buckets, height = 300 }: { buckets: CalBucket[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 44, r: 12, t: 12, b: 34 };
  const size = Math.max(0, Math.min(width - pad.l - pad.r, height - pad.t - pad.b));
  const ih = height - pad.t - pad.b;
  const iw = Math.max(0, width - pad.l - pad.r);
  const sx = (v: number) => pad.l + v * iw;
  const sy = (v: number) => pad.t + ih - v * ih;
  const pts = buckets.filter((b) => b.n > 0 && b.implied != null && b.winRate != null);
  const maxN = Math.max(1, ...pts.map((b) => b.n));
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const hb = hover != null ? pts[hover] : undefined;
  return (
    <div className="chart" ref={ref} onMouseLeave={() => setHover(null)}>
      {width > 0 && size > 0 && (
        <svg height={height} viewBox={`0 0 ${width} ${height}`}>
          <g className="axis">
            {ticks.map((t) => (
              <g key={t}>
                <line className="grid-line" x1={pad.l} x2={width - pad.r} y1={sy(t)} y2={sy(t)} strokeDasharray="2 4" />
                <text x={pad.l - 10} y={sy(t)} dy="0.32em" textAnchor="end">
                  {Math.round(t * 100)}%
                </text>
                <text x={sx(t)} y={height - 14} textAnchor="middle">
                  {Math.round(t * 100)}¢
                </text>
              </g>
            ))}
            <text x={pad.l + iw / 2} y={height} textAnchor="middle">
              Price paid (implied probability)
            </text>
          </g>
          <line x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)} stroke="var(--text-3)" strokeDasharray="5 5" />
          <text x={sx(0.97)} y={sy(0.97) + 16} textAnchor="end" fontSize="11" fill="var(--text-3)">
            fair
          </text>
          <path
            d={pts.map((b, i) => `${i ? 'L' : 'M'}${sx(b.implied!)},${sy(b.winRate!)}`).join('')}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinejoin="round"
            opacity="0.5"
          />
          {pts.map((b, i) => {
            const r = 4 + 12 * Math.sqrt(b.n / maxN);
            const beat = b.winRate! > b.implied!;
            return (
              <g key={b.label} onMouseEnter={() => setHover(i)} style={{ cursor: 'default' }}>
                <line x1={sx(b.implied!)} x2={sx(b.implied!)} y1={sy(b.implied!)} y2={sy(b.winRate!)} stroke={beat ? 'var(--pos)' : 'var(--neg)'} strokeWidth="1.5" opacity="0.5" />
                <circle
                  cx={sx(b.implied!)}
                  cy={sy(b.winRate!)}
                  r={r}
                  fill="var(--accent)"
                  fillOpacity={hover === i ? 0.5 : 0.22}
                  stroke="var(--accent)"
                  strokeWidth="1.5"
                />
              </g>
            );
          })}
        </svg>
      )}
      {hb && (
        <Tooltip x={Math.min(Math.max(sx(hb.implied!), 90), width - 90)} y={sy(hb.winRate!) - 8}>
          <div className="t-head">Paid {hb.label}</div>
          <div className="t-row">
            <span>Positions</span>
            <b>{fmt.int(hb.n)}</b>
          </div>
          <div className="t-row">
            <span>Implied</span>
            <b>{fmt.pct(hb.implied)}</b>
          </div>
          <div className="t-row">
            <span>Actually won</span>
            <b>{fmt.pct(hb.winRate)}</b>
          </div>
          <div className="t-row">
            <span>Surprise</span>
            <b>{fmt.z(hb.z)}</b>
          </div>
        </Tooltip>
      )}
    </div>
  );
}

// ── horizontal comparison bars ───────────────────────────────────────────

export function CompareRows({ buckets }: { buckets: CalBucket[] }) {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {buckets.map((b) => (
        <div key={b.label} style={{ display: 'grid', gridTemplateColumns: '72px 1fr 64px', gap: 14, alignItems: 'center', fontSize: 13 }}>
          <span className="muted">{b.label}</span>
          <div style={{ position: 'relative', height: 20 }}>
            <div className="bar-track" style={{ height: 8, position: 'absolute', top: 6, left: 0, right: 0 }}>
              <div style={{ width: `${(b.winRate ?? 0) * 100}%`, background: 'var(--accent)', borderRadius: 999 }} />
            </div>
            {b.implied != null && (
              <div
                title={`Implied ${fmt.pct(b.implied)}`}
                style={{ position: 'absolute', left: `calc(${b.implied * 100}% - 1px)`, top: 1, width: 2, height: 18, borderRadius: 2, background: 'var(--text)' }}
              />
            )}
          </div>
          <span className="num" style={{ textAlign: 'right' }}>
            {b.n ? <span className={b.z != null && b.z >= 2 ? 'pos' : b.z != null && b.z <= -2 ? 'neg' : ''}>{fmt.z(b.z)}</span> : <span className="faint">—</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
