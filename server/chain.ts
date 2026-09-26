/**
 * Chain access — gRPC only.
 *
 * Sui retired JSON-RPC on its public fullnodes in July 2026, so every read
 * here goes through `SuiGrpcClient` against the public fullnode. No API key.
 *
 * Package ids, the event module and the underlying map all come from the
 * DeepBook Predict SDK's deployment record (`PredictClient.cfg`), which Mysten
 * regenerates each SDK release — nothing is hardcoded in this repo.
 */

import { SuiGrpcClient } from '@mysten/sui/grpc';
import { PredictClient, type PredictConfig } from '@mysten/deepbook-v3/predict';

export const NETWORK = 'mainnet' as const;
export const GRPC_URL = process.env.SUI_GRPC_URL || `https://fullnode.${NETWORK}.sui.io:443`;

let sui: SuiGrpcClient | undefined;
let predict: PredictClient | undefined;

export function suiClient(): SuiGrpcClient {
  sui ??= new SuiGrpcClient({ network: NETWORK, baseUrl: GRPC_URL });
  return sui;
}

export function sdkConfig(): PredictConfig {
  predict ??= new PredictClient({ network: NETWORK, client: suiClient() as never });
  return predict.cfg;
}

/** Retry transient gRPC failures (rate limits, resets) with jittered backoff. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 250 * 2 ** i + Math.random() * 250));
    }
  }
  throw last;
}

export type EventName = 'OrderMinted' | 'LiveOrderRedeemed' | 'SettledOrderRedeemed';

export function eventType(name: EventName): string {
  return `${sdkConfig().packages.predictV1}::order_events::${name}`;
}

export interface ChainEvent {
  digest: string;
  eventIndex: number;
  checkpoint: number;
  sender: string;
  json: Record<string, string | null>;
}

/** One ascending page of events after `cursor` (null = from the first event). */
export async function eventPage(
  name: EventName,
  cursor: string | null,
  limit = 50,
): Promise<{ events: ChainEvent[]; nextCursor: string | null; hasNextPage: boolean }> {
  const r = (await withRetry(() =>
    suiClient().listEvents({
      filter: { eventType: eventType(name) },
      limit,
      ...(cursor ? { after: cursor } : {}),
    } as never),
  )) as unknown as {
    events?: Array<{
      transactionDigest: string;
      eventIndex: number;
      checkpoint: string;
      sender: string;
      json?: Record<string, string | null>;
    }>;
    hasNextPage?: boolean;
    endCursor?: string | null;
  };
  return {
    events: (r.events ?? []).map((e) => ({
      digest: e.transactionDigest,
      eventIndex: Number(e.eventIndex),
      checkpoint: Number(e.checkpoint),
      sender: e.sender,
      json: e.json ?? {},
    })),
    nextCursor: r.endCursor ?? cursor,
    hasNextPage: !!r.hasNextPage,
  };
}

export interface MarketObject {
  expiryMs: number;
  /** Raw 1e9-scaled USD per tick. */
  tickSizeRaw: bigint;
  /** Raw 1e9-scaled settlement price; null while the market is unsettled. */
  settlementRaw: bigint | null;
  underlying: string;
}

/** Read an ExpiryMarket object. Null when unreadable after retries. */
export async function readMarket(marketId: string): Promise<MarketObject | null> {
  try {
    const res = await withRetry(() =>
      suiClient().getObject({ objectId: marketId, include: { json: true } }),
    );
    const j = res.object?.json as Record<string, unknown> | undefined;
    const se = j?.strike_exposure as Record<string, unknown> | undefined;
    if (!j || !se || j.expiry == null || se.tick_size == null) return null;
    const raw = se.settlement_price;
    const uid = Number(j.propbook_underlying_id);
    const underlying =
      Object.values(sdkConfig().underlyings).find((u) => u.propbookUnderlyingId === uid)?.symbol ??
      `#${uid}`;
    return {
      expiryMs: Number(j.expiry),
      tickSizeRaw: BigInt(String(se.tick_size)),
      settlementRaw: raw == null || raw === '' ? null : BigInt(String(raw)),
      underlying,
    };
  } catch {
    return null;
  }
}
