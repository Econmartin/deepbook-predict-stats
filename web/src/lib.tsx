import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

// ── API types (mirror server/stats.ts) ─────────────────────────────────────

export type Side = 'up' | 'down' | 'range';
export type Status = 'open' | 'settling' | 'exited' | 'won' | 'lost';

export interface AsOf {
  checkpoint: number | null;
  lastEventMs: number | null;
  lastSyncMs: number | null;
  builtAtMs: number;
}

export interface Position {
  id: string;
  rootId: string;
  owner: string;
  sender: string;
  viaSessionKey: boolean;
  marketId: string;
  underlying: string | null;
  digest: string;
  mintedAtMs: number;
  expiryMs: number | null;
  side: Side;
  strikeLow: number | null;
  strikeHigh: number | null;
  entryProb: number;
  quantity: number;
  cost: number;
  mintFees: number;
  exitProceeds: number;
  exitQuantity: number;
  exitFees: number;
  exits: number;
  lastExitMs: number | null;
  lastExitDigest: string | null;
  settlement: number | null;
  status: Status;
  settledValue: number | null;
  claimed: number | null;
  claimDigest: string | null;
  pnl: number | null;
  resolvedAtMs: number | null;
  secondsToExpiry: number | null;
}

export interface WalletStats {
  owner: string;
  positions: number;
  open: number;
  openCost: number;
  volume: number;
  notional: number;
  feesPaid: number;
  realizedPnl: number;
  resolvedSpent: number;
  roi: number | null;
  earlyExitRate: number;
  avgEntryProb: number;
  avgSecondsToExpiry: number | null;
  held: { n: number; wins: number; expected: number; winRate: number | null; implied: number | null; z: number | null };
  sides: Record<Side, number>;
  firstMs: number;
  lastMs: number;
}

export interface MarketStats {
  marketId: string;
  underlying: string | null;
  expiryMs: number | null;
  status: 'open' | 'settling' | 'settled';
  settlement: number | null;
  positions: number;
  traders: number;
  volume: number;
  notional: number;
  sides: Record<Side, number>;
  exits: number;
  traderPnl: number | null;
  firstMintMs: number;
}

export interface Bucket {
  t: number;
  volume: number;
  positions: number;
  wallets: number;
  up: number;
  down: number;
  range: number;
  fees: number;
  traderPnl: number;
}

export interface CalBucket {
  label: string;
  n: number;
  winRate: number | null;
  implied: number | null;
  z: number | null;
}

export interface Overview {
  asOf: AsOf;
  totals: {
    volume: number;
    notional: number;
    positions: number;
    wallets: number;
    markets: number;
    settledMarkets: number;
    openMarkets: number;
    exitRate: number;
    volume24h: number;
    active24h: number;
    active7d: number;
    traderPnl: number;
    resolvedPositions: number;
    profitableWallets: number;
    walletsWithResults: number;
  };
  sides: Record<Side, number>;
  fees: {
    trading: number;
    mintTrading: number;
    exitTrading: number;
    subsidy: number;
    builder: number;
    penalty: number;
    referral: number;
    impactCharged: number;
    impactRebated: number;
    total: number;
  };
  reconciliation: { claimChecked: number; claimMatched: number; exitEvents: number; claimEvents: number };
  daily: Bucket[];
  hourly: Bucket[];
  calibrationByProb: CalBucket[];
  calibrationByTime: CalBucket[];
  topWinners: WalletStats[];
  recent: Position[];
  liveMarkets: MarketStats[];
}

// ── fetching ───────────────────────────────────────────────────────────────

export function useApi<T>(path: string | null, refreshMs = 30_000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setData(null);
    setError(null);
    const load = () =>
      fetch(path)
        .then(async (r) => {
          const j = await r.json();
          if (!r.ok) throw new Error(j.error ?? r.statusText);
          if (alive) setData(j as T);
        })
        .catch((e) => alive && setError(String(e.message ?? e)));
    void load();
    const t = refreshMs ? setInterval(load, refreshMs) : undefined;
    return () => {
      alive = false;
      if (t) clearInterval(t);
    };
  }, [path, refreshMs]);
  return { data, error };
}

// ── formatting ─────────────────────────────────────────────────────────────

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat('en-US');

export const fmt = {
  usd: (v: number, precise = false) => (precise || Math.abs(v) < 1000 ? usd2 : usd0).format(v),
  usdCompact: (v: number) =>
    Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e4 ? `$${(v / 1e3).toFixed(1)}K` : usd0.format(v),
  signed: (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${usd2.format(Math.abs(v))}`,
  int: (v: number) => int.format(v),
  pct: (v: number | null, d = 1) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`),
  cents: (p: number) => `${(p * 100).toFixed(1)}¢`,
  price: (v: number | null) => (v == null ? '—' : `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`),
  z: (z: number | null) => (z == null ? '—' : `${z >= 0 ? '+' : '−'}${Math.abs(z).toFixed(2)}σ`),
  dur: (s: number | null) => {
    if (s == null) return '—';
    const a = Math.abs(s);
    if (a < 90) return `${Math.round(s)}s`;
    if (a < 5400) return `${Math.round(s / 60)}m`;
    if (a < 172800) return `${(s / 3600).toFixed(1)}h`;
    return `${(s / 86400).toFixed(1)}d`;
  },
  ago: (ms: number | null) => {
    if (!ms) return '—';
    const s = (Date.now() - ms) / 1000;
    if (s < 0) return `in ${fmt.dur(-s)}`;
    if (s < 45) return 'just now';
    return `${fmt.dur(s)} ago`;
  },
  time: (ms: number) =>
    new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
  date: (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  short: (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`,
};

export const pnlClass = (v: number | null) => (v == null || Math.abs(v) < 0.005 ? '' : v > 0 ? 'pos' : 'neg');

export function strikeLabel(p: Pick<Position, 'side' | 'strikeLow' | 'strikeHigh'>) {
  if (p.side === 'up') return `> ${fmt.price(p.strikeLow)}`;
  if (p.side === 'down') return `≤ ${fmt.price(p.strikeHigh)}`;
  return `${fmt.price(p.strikeLow)} – ${fmt.price(p.strikeHigh)}`;
}

// ── explorer ───────────────────────────────────────────────────────────────

export type Explorer = 'suivision' | 'suiscan';
const EXPLORERS: Record<Explorer, { name: string; account: string; tx: string; object: string; checkpoint: string }> = {
  suivision: {
    name: 'SuiVision',
    account: 'https://suivision.xyz/account/',
    tx: 'https://suivision.xyz/txblock/',
    object: 'https://suivision.xyz/object/',
    checkpoint: 'https://suivision.xyz/checkpoint/',
  },
  suiscan: {
    name: 'Suiscan',
    account: 'https://suiscan.xyz/mainnet/account/',
    tx: 'https://suiscan.xyz/mainnet/tx/',
    object: 'https://suiscan.xyz/mainnet/object/',
    checkpoint: 'https://suiscan.xyz/mainnet/checkpoint/',
  },
};

const ExplorerCtx = createContext<{ explorer: Explorer; setExplorer: (e: Explorer) => void }>({
  explorer: 'suivision',
  setExplorer: () => {},
});

export function ExplorerProvider({ children }: { children: ReactNode }) {
  const [explorer, set] = useState<Explorer>(() => {
    try {
      return localStorage.getItem('explorer') === 'suiscan' ? 'suiscan' : 'suivision';
    } catch {
      return 'suivision';
    }
  });
  const setExplorer = useCallback((e: Explorer) => {
    set(e);
    try {
      localStorage.setItem('explorer', e);
    } catch {
      /* private mode */
    }
  }, []);
  return <ExplorerCtx.Provider value={{ explorer, setExplorer }}>{children}</ExplorerCtx.Provider>;
}

export function useExplorer() {
  const { explorer, setExplorer } = useContext(ExplorerCtx);
  const e = EXPLORERS[explorer];
  return {
    explorer,
    setExplorer,
    name: e.name,
    account: (a: string) => e.account + a,
    tx: (d: string) => e.tx + d,
    object: (id: string) => e.object + id,
    checkpoint: (n: number) => e.checkpoint + n,
  };
}

// ── router (history API, no dependency) ────────────────────────────────────

const RouteCtx = createContext<{ path: string; go: (to: string) => void }>({ path: '/', go: () => {} });

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(() => location.pathname + location.search);
  useEffect(() => {
    const on = () => setPath(location.pathname + location.search);
    addEventListener('popstate', on);
    return () => removeEventListener('popstate', on);
  }, []);
  const go = useCallback((to: string) => {
    if (to === location.pathname + location.search) return;
    history.pushState(null, '', to);
    setPath(to);
    scrollTo({ top: 0 });
  }, []);
  return <RouteCtx.Provider value={{ path, go }}>{children}</RouteCtx.Provider>;
}

export const useRoute = () => useContext(RouteCtx);

export function Link({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  const { go } = useRoute();
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        go(to);
      }}
    >
      {children}
    </a>
  );
}
