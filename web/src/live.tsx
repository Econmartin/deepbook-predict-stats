/**
 * Live layer — the browser reads the chain directly over gRPC-web (the public
 * fullnode allows any origin), on top of the static snapshot:
 *
 *   - live markets + their board prices, straight from the Predict SDK
 *   - every OrderMinted newer than the snapshot's mint checkpoint
 *
 * Because the snapshot records exactly which checkpoint its mint stream was
 * paged through, snapshot + live never double counts or drops a trade.
 * The SDK is lazy-loaded so the first paint stays light.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useData, type AsOf, type MarketStats, type Position, type Side } from './lib';

const GRPC = 'https://fullnode.mainnet.sui.io:443';
const POS_INF = (1n << 30n) - 1n;
const EVENTS_EVERY_MS = 5_000;
const MARKETS_EVERY_MS = 10_000;

type Sdk = Awaited<ReturnType<typeof loadSdk>>;
async function loadSdk() {
  const [{ SuiGrpcClient }, { PredictClient }] = await Promise.all([
    import('@mysten/sui/grpc'),
    import('@mysten/deepbook-v3/predict'),
  ]);
  const sui = new SuiGrpcClient({ network: 'mainnet', baseUrl: GRPC });
  const predict = new PredictClient({ network: 'mainnet', client: sui as never });
  return { sui, predict, cfg: predict.cfg };
}
let sdkPromise: Promise<Sdk> | null = null;
const sdk = () => (sdkPromise ??= loadSdk());

interface MarketInfo {
  expiryMs: number;
  tickSizeRaw: bigint;
  underlying: string;
}
const marketInfoCache = new Map<string, Promise<MarketInfo | null>>();

function marketInfo(s: Sdk, id: string): Promise<MarketInfo | null> {
  let p = marketInfoCache.get(id);
  if (!p) {
    p = s.sui
      .getObject({ objectId: id, include: { json: true } })
      .then((r) => {
        const j = r.object?.json as Record<string, unknown> | undefined;
        const se = j?.strike_exposure as Record<string, unknown> | undefined;
        if (!j || !se) return null;
        const uid = Number(j.propbook_underlying_id);
        return {
          expiryMs: Number(j.expiry),
          tickSizeRaw: BigInt(String(se.tick_size)),
          underlying: Object.values(s.cfg.underlyings).find((u) => u.propbookUnderlyingId === uid)?.symbol ?? `#${uid}`,
        };
      })
      .catch(() => {
        marketInfoCache.delete(id);
        return null;
      });
    marketInfoCache.set(id, p);
  }
  return p;
}

export interface LiveMarket extends MarketStats {
  referencePrice: number | null;
  mintPaused: boolean;
  /** Live board price for the reference strike, per $1 payout. */
  board: { up: number; down: number } | null;
  inSnapshot: boolean;
}

interface LiveBase {
  asOf: AsOf & { mintCheckpoint: number | null };
  openMarkets: Array<MarketStats & { owners: string[] }>;
}

interface LiveState {
  status: 'connecting' | 'live' | 'error';
  updatedMs: number | null;
  /** Mints newer than the snapshot, newest first, shaped like snapshot positions. */
  trades: Position[];
  markets: LiveMarket[];
}

const Ctx = createContext<LiveState>({ status: 'connecting', updatedMs: null, trades: [], markets: [] });
export const useLive = () => useContext(Ctx);

type Json = Record<string, string | null>;
interface RawMint {
  id: string;
  checkpoint: number;
  digest: string;
  sender: string;
  j: Json;
}

const lower = (a: string | null | undefined) => String(a ?? '').toLowerCase();
const big = (v: string | null | undefined) => (v == null || v === '' ? 0n : BigInt(v));

function toPosition(m: RawMint, info: MarketInfo | null): Position {
  const j = m.j;
  const lo = big(j.lower_tick);
  const hi = big(j.higher_tick);
  const side: Side = lo === 0n ? 'down' : hi === POS_INF ? 'up' : 'range';
  const cost =
    Number(big(j.premium) + big(j.trading_fee) - big(j.fee_incentive_subsidy) + big(j.builder_fee) + big(j.penalty_fee) + big(j.inventory_impact_charge)) / 1e6;
  const tickUsd = info ? Number(info.tickSizeRaw) / 1e9 : null;
  const ts = Number(j.onchain_timestamp_ms);
  const owner = lower(j.owner);
  const marketId = lower(j.expiry_market_id);
  const expiryMs = info?.expiryMs ?? null;
  return {
    id: `${marketId}:${j.position_root_id}`,
    rootId: String(j.position_root_id),
    owner,
    sender: lower(m.sender),
    viaSessionKey: lower(m.sender) !== owner,
    marketId,
    underlying: info?.underlying ?? null,
    digest: m.digest,
    mintedAtMs: ts,
    expiryMs,
    side,
    strikeLow: lo === 0n || tickUsd == null ? null : Number(lo) * tickUsd,
    strikeHigh: hi === POS_INF || tickUsd == null ? null : Number(hi) * tickUsd,
    entryProb: Number(big(j.entry_probability)) / 1e9,
    quantity: Number(big(j.quantity)) / 1e6,
    cost,
    mintFees: Number(big(j.trading_fee) - big(j.fee_incentive_subsidy) + big(j.builder_fee) + big(j.penalty_fee)) / 1e6,
    exitProceeds: 0,
    exitQuantity: 0,
    exitFees: 0,
    exits: 0,
    lastExitMs: null,
    lastExitDigest: null,
    settlement: null,
    // Live rows never carry a result — that only comes from the indexed settlement.
    status: expiryMs != null && Date.now() >= expiryMs ? 'settling' : 'open',
    settledValue: null,
    claimed: null,
    claimDigest: null,
    pnl: null,
    resolvedAtMs: null,
    secondsToExpiry: expiryMs == null ? null : (expiryMs - ts) / 1000,
    live: true,
  };
}

/** Newest-first mints with checkpoint > `after`. Pages back until it reaches the snapshot. */
async function mintsAfter(s: Sdk, after: number): Promise<RawMint[]> {
  const type = `${s.cfg.packages.predictV1}::order_events::OrderMinted`;
  const out: RawMint[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const r = (await s.sui.listEvents({
      filter: { eventType: type },
      limit: 50,
      ...(cursor ? { before: cursor } : { order: 'descending' }),
    } as never)) as unknown as {
      events?: Array<{ transactionDigest: string; eventIndex: number; checkpoint: string; sender: string; json?: Json }>;
      hasNextPage?: boolean;
      endCursor?: string;
    };
    let reached = false;
    for (const e of r.events ?? []) {
      const cp = Number(e.checkpoint);
      if (cp <= after) {
        reached = true;
        break;
      }
      const j = e.json ?? {};
      // Only original mints open a position (partial-close replacements share the root).
      if (String(j.position_root_id) !== String(j.order_id)) continue;
      out.push({ id: `${e.transactionDigest}:${e.eventIndex}`, checkpoint: cp, digest: e.transactionDigest, sender: e.sender, j });
    }
    if (reached || !r.hasNextPage || !r.endCursor) break;
    cursor = r.endCursor;
  }
  return out;
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const { data: base } = useData<LiveBase>('live-base.json', 60_000);
  const [status, setStatus] = useState<LiveState['status']>('connecting');
  const [updatedMs, setUpdatedMs] = useState<number | null>(null);
  const [raw, setRaw] = useState<RawMint[]>([]);
  const [infos, setInfos] = useState<Map<string, MarketInfo | null>>(new Map());
  const [active, setActive] = useState<
    Array<{ id: string; underlying: string | null; expiryMs: number; referencePrice: number | null; mintPaused: boolean; board: LiveMarket['board'] }>
  >([]);
  const after = base?.asOf.mintCheckpoint ?? null;
  const afterRef = useRef(after);
  afterRef.current = after;

  // Trades: poll new mints since the snapshot.
  useEffect(() => {
    if (after == null) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const s = await sdk();
        const mints = await mintsAfter(s, afterRef.current ?? after);
        if (!alive) return;
        const ids = [...new Set(mints.map((m) => lower(m.j.expiry_market_id)))];
        const resolved = await Promise.all(ids.map(async (id) => [id, await marketInfo(s, id)] as const));
        if (!alive) return;
        setInfos((prev) => {
          const next = new Map(prev);
          for (const [id, i] of resolved) next.set(id, i);
          return next;
        });
        setRaw(mints);
        setStatus('live');
        setUpdatedMs(Date.now());
      } catch {
        if (alive) setStatus('error');
      }
      if (alive) timer = setTimeout(tick, document.hidden ? EVENTS_EVERY_MS * 6 : EVENTS_EVERY_MS);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [after]);

  // Markets: the SDK's active list plus live board prices at each reference strike.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const s = await sdk();
        const ms = await s.predict.read.markets();
        const rows = await Promise.all(
          ms.map(async (m) => {
            const expiryMs = Number(m.expiryMs);
            const info = await marketInfo(s, m.id);
            let board: LiveMarket['board'] = null;
            if (info && expiryMs > Date.now() && m.referencePrice != null) {
              board = await s.predict.read
                .price({ underlying: info.underlying, expiryMs, marketId: m.id, strike: 'reference' })
                .then((p) => (Number.isFinite(p.up) && Number.isFinite(p.down) ? { up: p.up, down: p.down } : null))
                .catch(() => null);
            }
            return {
              id: m.id.toLowerCase(),
              underlying: info?.underlying ?? null,
              expiryMs,
              referencePrice: m.referencePrice,
              mintPaused: m.mintPaused,
              board,
            };
          }),
        );
        if (alive) {
          setActive(rows);
          setStatus('live');
          setUpdatedMs(Date.now());
        }
      } catch {
        if (alive) setStatus((s) => (s === 'live' ? s : 'error'));
      }
      if (alive) timer = setTimeout(tick, document.hidden ? MARKETS_EVERY_MS * 6 : MARKETS_EVERY_MS);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  const value = useMemo<LiveState>(() => {
    const trades = raw.map((m) => toPosition(m, infos.get(lower(m.j.expiry_market_id)) ?? null));
    const snap = new Map((base?.openMarkets ?? []).map((m) => [m.marketId, m]));
    const markets: LiveMarket[] = active
      .map((a) => {
        const s = snap.get(a.id);
        const owners = new Set(s?.owners ?? []);
        const sides = { up: s?.sides.up ?? 0, down: s?.sides.down ?? 0, range: s?.sides.range ?? 0 };
        let volume = s?.volume ?? 0;
        let notional = s?.notional ?? 0;
        let positions = s?.positions ?? 0;
        for (const t of trades) {
          if (t.marketId !== a.id) continue;
          owners.add(t.owner);
          sides[t.side]++;
          volume += t.cost;
          notional += t.quantity;
          positions++;
        }
        const info = infos.get(a.id);
        return {
          marketId: a.id,
          underlying: a.underlying ?? info?.underlying ?? s?.underlying ?? null,
          expiryMs: a.expiryMs,
          status: (Date.now() >= a.expiryMs ? 'settling' : 'open') as LiveMarket['status'],
          settlement: null,
          positions,
          traders: owners.size,
          volume,
          notional,
          sides,
          exits: s?.exits ?? 0,
          traderPnl: null,
          firstMintMs: s?.firstMintMs ?? 0,
          referencePrice: a.referencePrice,
          mintPaused: a.mintPaused,
          board: a.board,
          inSnapshot: !!s,
        };
      })
      .sort((x, y) => (x.expiryMs ?? 0) - (y.expiryMs ?? 0));
    return { status, updatedMs, trades, markets };
  }, [raw, infos, active, base, status, updatedMs]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Re-render every `ms` — for countdowns. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
