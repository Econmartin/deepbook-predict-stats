/**
 * Trade inspector — breaks one Predict transaction into where every cent
 * went, straight from the chain in the browser:
 *
 *   buys    fair price (premium), trading fee split into base + late-entry
 *           surcharge (recomputed with the market's own fee policy and
 *           checked against the chain), incentive subsidy, congestion
 *           surcharge, price impact, builder fee, referral share, gas
 *   sells   sale value, fees, impact refund, net proceeds
 *   claims  settlement payout
 *
 * Nothing here is estimated from our snapshot: amounts are the event fields,
 * USDC ÷ 1e6, probabilities and prices ÷ 1e9.
 */
import { sdk } from './live';

type Json = Record<string, string | null>;
const USDC = 1e6;
const FP = 1e9;
const POS_INF = (1n << 30n) - 1n;
const big = (v: string | null | undefined) => (v == null || v === '' ? 0n : BigInt(v));
const usd = (v: string | null | undefined) => Number(big(v)) / USDC;

export interface MarketInfo {
  id: string;
  underlying: string;
  expiryMs: number;
  tickUsd: number;
  settlement: number | null;
  feePolicy: Record<string, bigint> | null;
}

export interface BuyBreakdown {
  kind: 'buy';
  owner: string;
  market: MarketInfo;
  rootId: string;
  side: 'up' | 'down' | 'range';
  strikeLow: number | null;
  strikeHigh: number | null;
  atMs: number;
  secondsToExpiry: number;
  contracts: number;
  entryProb: number;
  premium: number;
  tradingFee: number;
  /** Trading fee split, when our recomputation matches the chain exactly. */
  baseFee: number | null;
  lateSurcharge: number | null;
  feeCheck: 'exact' | 'mismatch' | 'unavailable';
  subsidy: number;
  congestion: number;
  impact: number;
  builder: number;
  referral: number;
  cost: number;
  allInPerContract: number;
  oracleAgeMs: { pyth: number | null; blockScholes: number | null };
  outcome: { status: 'open' | 'awaiting' | 'won' | 'lost'; settlement: number | null; payout: number | null };
}

export interface SellBreakdown {
  kind: 'sell';
  owner: string;
  market: MarketInfo;
  rootId: string;
  atMs: number;
  secondsToExpiry: number;
  contractsClosed: number;
  remaining: number;
  saleValue: number;
  tradingFee: number;
  congestion: number;
  builder: number;
  impactRefund: number;
  proceeds: number;
  pricePerContract: number;
}

export interface ClaimBreakdown {
  kind: 'claim';
  owner: string;
  market: MarketInfo;
  rootId: string;
  atMs: number;
  payout: number;
}

export type Breakdown = BuyBreakdown | SellBreakdown | ClaimBreakdown;

export interface TxInspection {
  digest: string;
  sender: string;
  timestampMs: number;
  checkpoint: string;
  success: boolean;
  gasSui: number;
  items: Breakdown[];
}

async function marketInfo(id: string): Promise<MarketInfo> {
  const s = await sdk();
  const res = await s.sui.getObject({ objectId: id, include: { json: true } });
  const j = res.object?.json as Record<string, unknown> | undefined;
  const se = j?.strike_exposure as Record<string, unknown> | undefined;
  if (!j || !se) throw new Error(`Couldn't read market ${id}`);
  const c = se.config as Record<string, unknown> | undefined;
  const uid = Number(j.propbook_underlying_id);
  const b = (v: unknown) => (v == null ? null : BigInt(String(v)));
  const policy = c
    ? {
        baseFee: b(c.base_fee),
        minFee: b(c.min_fee),
        expiryFeeWindowMs: b(c.expiry_fee_window_ms),
        expiryFeeMaxMultiplier: b(c.expiry_fee_max_multiplier),
        minEntryProbability: b(c.min_entry_probability),
        maxEntryProbability: b(c.max_entry_probability),
        inventoryImpactMaxRate: b(c.inventory_impact_max_rate),
        inventoryImpactScale: b(se.inventory_impact_scale),
        backingBufferLambda: b(c.backing_buffer_lambda),
      }
    : null;
  const expiryMs = Number(j.expiry);
  const raw = se.settlement_price;
  return {
    id,
    underlying: Object.values(s.cfg.underlyings).find((u) => u.propbookUnderlyingId === uid)?.symbol ?? `#${uid}`,
    expiryMs,
    tickUsd: Number(se.tick_size) / FP,
    // Only a past-expiry market with a written price counts as settled.
    settlement: raw != null && Date.now() >= expiryMs ? Number(raw) / FP : null,
    feePolicy: policy && Object.values(policy).every((v) => v != null) ? (policy as Record<string, bigint>) : null,
  };
}

/** The SDK's exact trading fee for this mint at `nowMs` (null if it refuses). */
async function tradingFeeAt(
  m: MarketInfo,
  j: Json,
  side: 'up' | 'down' | 'range',
  nowMs: number,
): Promise<number | null> {
  if (!m.feePolicy) return null;
  const { cost, probabilityToRaw } = await import('@mysten/deepbook-v3/predict');
  const p = Number(big(j.entry_probability)) / FP;
  const raw = (x: number) => probabilityToRaw(Number(x.toFixed(9)));
  const probabilities =
    side === 'up'
      ? { lowerUp: raw(p), higherUp: null }
      : side === 'down'
        ? { lowerUp: null, higherUp: raw(1 - p) }
        : { lowerUp: raw(p), higherUp: raw(0) };
  try {
    const r = cost.mintCost({
      fees: m.feePolicy,
      expiryMs: m.expiryMs,
      nowMs,
      quantity: Number(big(j.quantity)) / USDC,
      probabilities,
    } as never) as unknown as { fees: { trading: number } };
    return r.fees.trading;
  } catch {
    return null;
  }
}

async function buy(j: Json, m: MarketInfo): Promise<BuyBreakdown> {
  const lo = big(j.lower_tick);
  const hi = big(j.higher_tick);
  const side = lo === 0n ? 'down' : hi === POS_INF ? 'up' : 'range';
  const atMs = Number(j.onchain_timestamp_ms);
  const contracts = Number(big(j.quantity)) / USDC;
  const tradingFee = usd(j.trading_fee);
  const subsidy = usd(j.fee_incentive_subsidy);
  const cost =
    usd(j.premium) + tradingFee - subsidy + usd(j.builder_fee) + usd(j.penalty_fee) + usd(j.inventory_impact_charge);

  // Recompute the fee at the trade's timestamp; if it matches the chain to the
  // base unit, recompute again a day before expiry (no late-entry ramp) to split it.
  let baseFee: number | null = null;
  let lateSurcharge: number | null = null;
  let feeCheck: BuyBreakdown['feeCheck'] = 'unavailable';
  const atTrade = await tradingFeeAt(m, j, side, atMs);
  if (atTrade != null) {
    if (Math.abs(atTrade - tradingFee) < 1.5 / USDC) {
      feeCheck = 'exact';
      const noRamp = await tradingFeeAt(m, j, side, m.expiryMs - 86_400_000);
      if (noRamp != null) {
        baseFee = Math.min(tradingFee, noRamp);
        lateSurcharge = Math.max(0, tradingFee - noRamp);
      }
    } else {
      feeCheck = 'mismatch';
    }
  }

  const age = (src: string | null) => {
    const v = Number(big(src));
    return v > 0 ? atMs - v : null;
  };
  const bs = [j.block_scholes_spot_source_timestamp_ms, j.block_scholes_forward_source_timestamp_ms, j.block_scholes_svi_source_timestamp_ms]
    .map((x) => Number(big(x)))
    .filter((x) => x > 0);

  let outcome: BuyBreakdown['outcome'] = { status: Date.now() >= m.expiryMs ? 'awaiting' : 'open', settlement: null, payout: null };
  if (m.settlement != null) {
    const s = BigInt(Math.round(m.settlement * FP));
    const tick = BigInt(Math.round(m.tickUsd * FP));
    const won = (lo === 0n || s > lo * tick) && (hi === POS_INF || s <= hi * tick);
    outcome = { status: won ? 'won' : 'lost', settlement: m.settlement, payout: won ? contracts : 0 };
  }

  return {
    kind: 'buy',
    owner: String(j.owner).toLowerCase(),
    market: m,
    rootId: String(j.position_root_id ?? j.order_id),
    side,
    strikeLow: lo === 0n ? null : Number(lo) * m.tickUsd,
    strikeHigh: hi === POS_INF ? null : Number(hi) * m.tickUsd,
    atMs,
    secondsToExpiry: (m.expiryMs - atMs) / 1000,
    contracts,
    entryProb: Number(big(j.entry_probability)) / FP,
    premium: usd(j.premium),
    tradingFee,
    baseFee,
    lateSurcharge,
    feeCheck,
    subsidy,
    congestion: usd(j.penalty_fee),
    impact: usd(j.inventory_impact_charge),
    builder: usd(j.builder_fee),
    referral: usd(j.referral_fee),
    cost,
    allInPerContract: contracts ? cost / contracts : 0,
    oracleAgeMs: { pyth: age(j.pyth_spot_source_timestamp_ms), blockScholes: bs.length ? atMs - Math.min(...bs) : null },
    outcome,
  };
}

function sell(j: Json, m: MarketInfo): SellBreakdown {
  const atMs = Number(j.onchain_timestamp_ms);
  const closed = Number(big(j.quantity_closed)) / USDC;
  const saleValue = usd(j.redeem_amount);
  const tradingFee = usd(j.trading_fee);
  const congestion = usd(j.penalty_fee);
  const builder = usd(j.builder_fee);
  const impactRefund = usd(j.inventory_impact_rebate);
  return {
    kind: 'sell',
    owner: String(j.owner).toLowerCase(),
    market: m,
    rootId: String(j.position_root_id ?? j.order_id),
    atMs,
    secondsToExpiry: (m.expiryMs - atMs) / 1000,
    contractsClosed: closed,
    remaining: Number(big(j.remaining_quantity)) / USDC,
    saleValue,
    tradingFee,
    congestion,
    builder,
    impactRefund,
    proceeds: saleValue - tradingFee - builder - congestion + impactRefund,
    pricePerContract: closed ? saleValue / closed : 0,
  };
}

export async function inspectTransaction(digest: string): Promise<TxInspection> {
  const s = await sdk();
  const res = (await s.sui.getTransaction({ digest, include: { events: true, effects: true } } as never)) as unknown as {
    Transaction?: {
      digest: string;
      timestampMs?: string;
      checkpoint?: string;
      transaction?: { sender?: string };
      effects?: { status?: { success?: boolean }; gasUsed?: Record<string, string> };
      events?: Array<{ eventType: string; sender?: string; json?: Json }>;
    };
  };
  const t = res.Transaction;
  if (!t) throw new Error('Transaction not found');
  const pkg = s.cfg.packages.predictV1;
  const events = (t.events ?? []).filter((e) => e.eventType.startsWith(`${pkg}::order_events::`));
  const markets = new Map<string, Promise<MarketInfo>>();
  const market = (id: string) => {
    let p = markets.get(id);
    if (!p) markets.set(id, (p = marketInfo(id)));
    return p;
  };
  const items: Breakdown[] = [];
  for (const e of events) {
    const j = e.json ?? {};
    const m = await market(String(j.expiry_market_id).toLowerCase());
    const name = e.eventType.split('::').pop();
    if (name === 'OrderMinted') {
      // Partial-close replacements re-emit a mint for the remainder; only originals are buys.
      if (String(j.position_root_id) === String(j.order_id)) items.push(await buy(j, m));
    } else if (name === 'LiveOrderRedeemed') {
      items.push(sell(j, m));
    } else if (name === 'SettledOrderRedeemed') {
      items.push({
        kind: 'claim',
        owner: String(j.owner).toLowerCase(),
        market: m,
        rootId: String(j.position_root_id ?? j.order_id),
        atMs: Number(j.onchain_timestamp_ms),
        payout: usd(j.payout_amount),
      });
    }
  }
  const g = t.effects?.gasUsed ?? {};
  const gas = Number(big(g.computationCost)) + Number(big(g.storageCost)) - Number(big(g.storageRebate));
  return {
    digest: t.digest,
    // Every event carries the signer; that avoids fetching the whole transaction body.
    sender: String(t.transaction?.sender ?? t.events?.[0]?.sender ?? '').toLowerCase(),
    timestampMs: Number(t.timestampMs ?? 0),
    checkpoint: String(t.checkpoint ?? ''),
    success: t.effects?.status?.success !== false,
    gasSui: gas / FP,
    items,
  };
}

/** Sui digests are base58, 43–44 characters. */
export const isDigest = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(s.trim());
