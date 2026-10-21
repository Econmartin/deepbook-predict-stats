/**
 * SuiNS names — each wallet's default name (the reverse record its owner
 * chose), shown in place of the bare address. Display only: nothing is
 * attributed by name, and a wallet without a default name just shows its
 * address. Expired names resolve to nothing.
 */

import { suiClient, withRetry } from './chain.js';

/** The public fullnode rate-limits name lookups; stay well under it. */
const CONCURRENCY = 8;

export async function resolveNames(addresses: string[]): Promise<Record<string, string>> {
  const sui = suiClient();
  const out: Record<string, string> = {};
  const queue = [...new Set(addresses)];
  const worker = async () => {
    for (let a = queue.pop(); a; a = queue.pop()) {
      try {
        const { data } = await withRetry(() => sui.defaultNameServiceName({ address: a }));
        if (data.name) out[a] = data.name;
      } catch (e) {
        // One failed lookup just leaves that wallet showing its address.
        console.warn('[names]', a, e instanceof Error ? e.message : e);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return out;
}
