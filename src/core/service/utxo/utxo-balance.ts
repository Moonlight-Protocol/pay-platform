/**
 * On-chain UTXO balance helpers.
 *
 * Calls the privacy-channel contract's `utxo_balances` view. Per
 * `soroban-core/modules/utxo-core/src/core.rs`:
 *   - balance > 0  → UTXO is funded and unspent
 *   - balance == 0 → UTXO was created and later spent (cannot be reused)
 *   - balance < 0  → no record exists (free to create)
 *
 * With a monotonic "always pick the lowest free index" assignment rule, the
 * funded-or-spent region is a contiguous prefix `0..N` and every index past
 * the prefix is free. We terminate the walk after seeing 3 consecutive
 * free indexes — defensive padding against transient race conditions.
 */
import { Buffer } from "buffer";
import {
  ChannelReadMethods,
  type PrivacyChannel,
} from "@moonlight/moonlight-sdk";
import type { Logger } from "@/utils/logger/index.ts";
import { deriveUtxoPublicKey } from "@/core/crypto/utxo-derivation.ts";

const DEFAULT_BATCH_SIZE = 50;
const FREE_RUN_TERMINATOR = 3;

export interface UtxoIndexBalance {
  index: number;
  balance: bigint;
}

export async function fetchUtxoBalances(
  channelClient: PrivacyChannel,
  publicKeys: Uint8Array[],
  deps: { log: Logger },
): Promise<bigint[]> {
  const log = deps.log.scope("fetchUtxoBalances");
  if (publicKeys.length === 0) return [];
  log.debug("count", publicKeys.length);

  const result = await channelClient.read({
    method: ChannelReadMethods.utxo_balances,
    methodArgs: { utxos: publicKeys.map((pk) => Buffer.from(pk)) },
  });

  return (result as Array<string | number | bigint>).map((b) => BigInt(b));
}

export async function fetchUtxoBalance(
  channelClient: PrivacyChannel,
  publicKey: Uint8Array,
  deps: { log: Logger },
): Promise<bigint> {
  const [b] = await fetchUtxoBalances(channelClient, [publicKey], deps);
  return b ?? -1n;
}

async function deriveKeyBatch(
  utxoRoot: Uint8Array,
  startIndex: number,
  batchSize: number,
): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for (let k = 0; k < batchSize; k++) {
    out.push(await deriveUtxoPublicKey(utxoRoot, startIndex + k));
  }
  return out;
}

/**
 * Walk derivation indexes from 0, summing positive balances. Stops after
 * FREE_RUN_TERMINATOR (3) consecutive free (-1) entries, confirming we are
 * past the funded prefix. Per-index records returned for the caller's use
 * (e.g. surfacing the spent UTXO history).
 */
export async function walkFundedBalances(
  channelClient: PrivacyChannel,
  utxoRoot: Uint8Array,
  deps: { log: Logger },
  opts?: { batchSize?: number },
): Promise<{ totalStroops: bigint; perIndex: UtxoIndexBalance[] }> {
  const batchSize = opts?.batchSize ?? DEFAULT_BATCH_SIZE;
  const log = deps.log.scope("walkFundedBalances");
  const perIndex: UtxoIndexBalance[] = [];
  let total = 0n;
  let i = 0;
  let freeRun = 0;

  while (freeRun < FREE_RUN_TERMINATOR) {
    const keys = await deriveKeyBatch(utxoRoot, i, batchSize);
    const balances = await fetchUtxoBalances(channelClient, keys, deps);
    for (let k = 0; k < balances.length; k++) {
      const balance = balances[k];
      const index = i + k;
      perIndex.push({ index, balance });
      if (balance < 0n) {
        freeRun++;
        if (freeRun >= FREE_RUN_TERMINATOR) break;
      } else {
        freeRun = 0;
        if (balance > 0n) total += balance;
      }
    }
    i += batchSize;
  }

  log.debug("totalStroops", total.toString());
  log.debug("scannedUpTo", i);
  return { totalStroops: total, perIndex };
}

/**
 * Receive-side precheck. For each of `proposedIndexes`, derive the public
 * key and query on-chain balance. If every proposed index is still free
 * (-1), return them as-is. If any is non-free (funded or spent), walk
 * forward and substitute with the next free index. Returns the validated
 * indexes paired with the public keys the caller should target.
 */
export async function validateReceiveDestinations(
  channelClient: PrivacyChannel,
  utxoRoot: Uint8Array,
  proposedIndexes: number[],
  deps: { log: Logger },
): Promise<{ indexes: number[]; publicKeys: Uint8Array[] }> {
  const log = deps.log.scope("validateReceiveDestinations");
  if (proposedIndexes.length === 0) return { indexes: [], publicKeys: [] };

  const proposedKeys = await Promise.all(
    proposedIndexes.map((i) => deriveUtxoPublicKey(utxoRoot, i)),
  );
  const balances = await fetchUtxoBalances(channelClient, proposedKeys, deps);

  const allFree = balances.every((b) => b < 0n);
  if (allFree) {
    log.debug("preflight", "all proposed indexes free");
    return { indexes: [...proposedIndexes], publicKeys: proposedKeys };
  }

  log.event("preflight rejected — re-deriving free destinations");
  const freshIndexes = await findFreeUtxoIndexes(
    channelClient,
    utxoRoot,
    proposedIndexes.length,
    { log },
  );
  const freshKeys = await Promise.all(
    freshIndexes.map((i) => deriveUtxoPublicKey(utxoRoot, i)),
  );
  return { indexes: freshIndexes, publicKeys: freshKeys };
}

/**
 * Walk derivation indexes from 0 and collect the first `count` free
 * (-1) indexes. Use for picking receive destinations.
 */
export async function findFreeUtxoIndexes(
  channelClient: PrivacyChannel,
  utxoRoot: Uint8Array,
  count: number,
  deps: { log: Logger },
  opts?: { batchSize?: number },
): Promise<number[]> {
  const batchSize = opts?.batchSize ?? DEFAULT_BATCH_SIZE;
  const log = deps.log.scope("findFreeUtxoIndexes");
  const out: number[] = [];
  let i = 0;
  let freeRun = 0;

  while (out.length < count) {
    const keys = await deriveKeyBatch(utxoRoot, i, batchSize);
    const balances = await fetchUtxoBalances(channelClient, keys, deps);
    for (let k = 0; k < balances.length; k++) {
      const index = i + k;
      if (balances[k] < 0n) {
        out.push(index);
        freeRun++;
        if (out.length >= count) break;
      } else {
        freeRun = 0;
      }
    }
    // Past the funded prefix every subsequent index is free, no need to
    // chain-query further — fill the remainder synthetically.
    if (freeRun >= FREE_RUN_TERMINATOR && out.length < count) {
      let nextIndex = out[out.length - 1] + 1;
      while (out.length < count) {
        out.push(nextIndex++);
      }
      break;
    }
    i += batchSize;
  }

  log.debug("freeIndexes", out.join(","));
  return out;
}
