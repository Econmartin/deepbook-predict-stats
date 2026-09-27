/**
 * Social share card (og.png, 1200×630), redrawn from the live snapshot on
 * every export so shared links unfurl with today's leaders and totals.
 * Satori lays it out to SVG (text as paths, so no system fonts needed) and
 * resvg rasterizes it.
 */
import { createElement as h, type ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import type { Snapshot, WalletStats } from './stats.js';

const require = createRequire(import.meta.url);
const font = (w: number) => readFileSync(require.resolve(`@fontsource/inter/files/inter-latin-${w}-normal.woff`));
const FONTS = [500, 600, 700, 800].map((weight) => ({ name: 'Inter', data: font(weight), weight: weight as 500, style: 'normal' as const }));

const C = {
  bg: '#000000',
  card: '#161618',
  line: 'rgba(255,255,255,0.10)',
  text: '#f5f5f7',
  text2: '#a1a1a6',
  pos: '#30d158',
  neg: '#ff453a',
  gold: '#ffd257',
  silver: '#c9d1d9',
  bronze: '#e39a64',
  blue: '#2997ff',
  violet: '#7d7aff',
  pink: '#bf5af2',
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const usd = (v: number) =>
  `${v < 0 ? '−' : v > 0 ? '+' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const compact = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(0)}`);

function avatar(address: string, size: number): ReactNode {
  const h1 = parseInt(address.slice(2, 8), 16) % 360;
  const h2 = (h1 + 40 + (parseInt(address.slice(8, 12), 16) % 120)) % 360;
  return h('div', {
    style: {
      width: size,
      height: size,
      borderRadius: size,
      backgroundImage: `linear-gradient(135deg, hsl(${h1}, 80%, 62%), hsl(${h2}, 75%, 52%))`,
      flexShrink: 0,
    },
  });
}

function leader(w: WalletStats, rank: number): ReactNode {
  const tone = [C.gold, C.silver, C.bronze][rank - 1]!;
  const first = rank === 1;
  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        padding: first ? '26px 28px' : '22px 24px',
        marginTop: first ? 0 : 26,
        borderRadius: 26,
        backgroundColor: C.card,
        backgroundImage: `linear-gradient(180deg, ${tone}26, ${tone}00 60%)`,
        border: `1.5px solid ${tone}${first ? '88' : '55'}`,
        boxShadow: first ? `0 20px 60px -20px ${tone}99` : 'none',
      },
    },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: first ? 40 : 34,
            height: first ? 40 : 34,
            borderRadius: 40,
            backgroundImage: `linear-gradient(135deg, #ffffff, ${tone})`,
            color: '#111',
            fontSize: first ? 20 : 17,
            fontWeight: 800,
          },
        },
        String(rank),
      ),
      avatar(w.owner, first ? 44 : 38),
    ),
    h('div', { style: { display: 'flex', marginTop: 18, fontSize: 20, color: C.text2, fontWeight: 500 } }, short(w.owner)),
    h(
      'div',
      {
        style: {
          display: 'flex',
          marginTop: 6,
          fontSize: first ? 50 : 40,
          fontWeight: 800,
          letterSpacing: -1.5,
          color: w.realizedPnl >= 0 ? C.pos : C.neg,
        },
      },
      usd(w.realizedPnl),
    ),
    h(
      'div',
      { style: { display: 'flex', marginTop: 4, fontSize: 18, color: C.text2, fontWeight: 500 } },
      `${w.positions} trades · ROI ${w.roi == null ? '—' : `${Math.round(w.roi * 100)}%`}`,
    ),
  );
}

function stat(label: string, value: string): ReactNode {
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column' } },
    h('div', { style: { display: 'flex', fontSize: 34, fontWeight: 800, color: C.text, letterSpacing: -1 } }, value),
    h('div', { style: { display: 'flex', fontSize: 17, color: C.text2, fontWeight: 500, marginTop: 2 } }, label),
  );
}

export async function renderOgCard(snap: Snapshot): Promise<Buffer> {
  const top = [...snap.wallets].sort((a, b) => b.realizedPnl - a.realizedPnl).slice(0, 3);
  const t = snap.overview.totals;
  // Podium order: #2, #1, #3.
  const podium = [top[1], top[0], top[2]].map((w, i) => (w ? leader(w, [2, 1, 3][i]!) : null));

  const tree = h(
    'div',
    {
      style: {
        width: 1200,
        height: 630,
        display: 'flex',
        flexDirection: 'column',
        padding: '52px 64px 48px',
        backgroundColor: C.bg,
        backgroundImage: `radial-gradient(900px 420px at 50% -10%, ${C.violet}33, transparent), radial-gradient(600px 300px at 100% 110%, ${C.blue}22, transparent)`,
        fontFamily: 'Inter',
        color: C.text,
      },
    },
    // Header
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center' } },
        h(
          'div',
          {
            style: {
              display: 'flex',
              width: 40,
              height: 40,
              borderRadius: 11,
              backgroundImage: `linear-gradient(135deg, ${C.blue}, ${C.violet})`,
              marginRight: 14,
            },
          },
          h(
            'svg',
            { width: 40, height: 40, viewBox: '0 0 64 64' },
            h('path', { d: 'M14 42 L26 30 L34 37 L50 20', fill: 'none', stroke: '#fff', strokeWidth: 5.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
            h('circle', { cx: 50, cy: 20, r: 4.5, fill: '#fff' }),
          ),
        ),
        h('div', { style: { display: 'flex', fontSize: 26, fontWeight: 700, letterSpacing: -0.5 } }, 'Predict Stats'),
      ),
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            fontSize: 18,
            fontWeight: 600,
            color: C.pos,
            backgroundColor: `${C.pos}1f`,
            padding: '8px 16px',
            borderRadius: 999,
          },
        },
        h('div', { style: { width: 10, height: 10, borderRadius: 10, backgroundColor: C.pos, marginRight: 10 } }),
        'Live · DeepBook Predict on Sui',
      ),
    ),
    // Headline
    h(
      'div',
      { style: { display: 'flex', marginTop: 30, fontSize: 64, fontWeight: 800, letterSpacing: -2.5, lineHeight: 1 } },
      h('span', { style: { marginRight: 18 } }, 'Who’s'),
      h(
        'span',
        {
          style: {
            backgroundImage: `linear-gradient(92deg, ${C.blue}, ${C.violet} 55%, ${C.pink})`,
            backgroundClip: 'text',
            color: 'transparent',
          },
        },
        'beating the market.',
      ),
    ),
    // Podium
    h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 22, marginTop: 34 } }, ...podium),
    // Footer stats
    h(
      'div',
      {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          marginTop: 'auto',
          paddingTop: 22,
          borderTop: `1px solid ${C.line}`,
        },
      },
      h(
        'div',
        { style: { display: 'flex', gap: 56 } },
        stat('volume traded', compact(t.volume)),
        stat('traders', t.wallets.toLocaleString('en-US')),
        stat('positions', t.positions.toLocaleString('en-US')),
      ),
      h(
        'div',
        { style: { display: 'flex', fontSize: 17, color: C.text2, fontWeight: 500 } },
        `Verified on-chain · ${new Date(snap.builtAtMs).toISOString().slice(0, 10)}`,
      ),
    ),
  );

  const svg = await satori(tree as never, { width: 1200, height: 630, fonts: FONTS });
  return new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
}
