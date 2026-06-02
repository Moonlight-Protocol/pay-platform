import { assertEquals, assertNotEquals } from "@std/assert";
import type { Buffer } from "buffer";
import {
  fetchUtxoBalances,
  findFreeUtxoIndexes,
  validateReceiveDestinations,
  walkFundedBalances,
} from "./utxo-balance.ts";
import { deriveUtxoPublicKey } from "@/core/crypto/utxo-derivation.ts";

function makeUtxoRoot(seed: number): Uint8Array {
  const buf = new Uint8Array(32);
  for (let i = 0; i < 32; i++) buf[i] = (seed + i) & 0xff;
  return buf;
}

const silentLog = {
  scope: () => silentLog,
  info: () => {},
  debug: () => {},
  event: () => {},
  error: () => {},
  // deno-lint-ignore no-explicit-any
} as any;

interface MockReadCall {
  method: unknown;
  // deno-lint-ignore no-explicit-any
  methodArgs: any;
}

function mockChannelClient(balances: Map<string, bigint>) {
  const calls: MockReadCall[] = [];
  const client = {
    read(args: MockReadCall): Promise<bigint[]> {
      calls.push(args);
      const utxos = args.methodArgs.utxos as Buffer[];
      const out = utxos.map((buf) => {
        const key = Array.from(buf).map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        return balances.has(key) ? balances.get(key)! : -1n;
      });
      return Promise.resolve(out);
    },
    // deno-lint-ignore no-explicit-any
  } as any;
  return { client, calls };
}

function hexOf(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.test("fetchUtxoBalances forwards bigints from the SDK", async () => {
  const utxoRoot = makeUtxoRoot(1);
  const pubA = await deriveUtxoPublicKey(utxoRoot, 0);
  const pubB = await deriveUtxoPublicKey(utxoRoot, 1);
  const balances = new Map<string, bigint>([
    [hexOf(pubA), 100n],
    [hexOf(pubB), 0n],
  ]);
  const { client } = mockChannelClient(balances);

  const result = await fetchUtxoBalances(client, [pubA, pubB], {
    log: silentLog,
  });

  assertEquals(result, [100n, 0n]);
});

Deno.test("walkFundedBalances sums positives, ignores spent (0), terminates on 3 free", async () => {
  const utxoRoot = makeUtxoRoot(2);
  const pub0 = await deriveUtxoPublicKey(utxoRoot, 0);
  const pub1 = await deriveUtxoPublicKey(utxoRoot, 1);
  const pub2 = await deriveUtxoPublicKey(utxoRoot, 2);
  const balances = new Map<string, bigint>([
    [hexOf(pub0), 500n], // funded
    [hexOf(pub1), 0n], // spent — not counted
    [hexOf(pub2), 200n], // funded
    // indexes 3+ are -1 (free) by default
  ]);
  const { client, calls } = mockChannelClient(balances);

  const { totalStroops, perIndex } = await walkFundedBalances(
    client,
    utxoRoot,
    { log: silentLog },
    { batchSize: 6 },
  );

  assertEquals(totalStroops, 700n);
  assertEquals(perIndex[0].balance, 500n);
  assertEquals(perIndex[1].balance, 0n);
  assertEquals(perIndex[2].balance, 200n);
  assertEquals(perIndex[3].balance, -1n);
  assertEquals(perIndex[4].balance, -1n);
  assertEquals(perIndex[5].balance, -1n);
  assertEquals(calls.length, 1);
});

Deno.test("findFreeUtxoIndexes skips funded + spent, picks first free indexes", async () => {
  const utxoRoot = makeUtxoRoot(3);
  const pub0 = await deriveUtxoPublicKey(utxoRoot, 0);
  const pub1 = await deriveUtxoPublicKey(utxoRoot, 1);
  const balances = new Map<string, bigint>([
    [hexOf(pub0), 50n], // funded
    [hexOf(pub1), 0n], // spent
    // 2,3,4,5,... → -1 (free)
  ]);
  const { client } = mockChannelClient(balances);

  const indexes = await findFreeUtxoIndexes(
    client,
    utxoRoot,
    3,
    { log: silentLog },
    { batchSize: 6 },
  );

  assertEquals(indexes, [2, 3, 4]);
});

Deno.test("validateReceiveDestinations passes through when all proposed are free", async () => {
  const utxoRoot = makeUtxoRoot(4);
  const { client, calls } = mockChannelClient(new Map());

  const { indexes, publicKeys } = await validateReceiveDestinations(
    client,
    utxoRoot,
    [7, 8, 9],
    { log: silentLog },
  );

  assertEquals(indexes, [7, 8, 9]);
  assertEquals(publicKeys.length, 3);
  // Single chain query for the precheck; no fallback walk needed.
  assertEquals(calls.length, 1);
});

Deno.test("validateReceiveDestinations rejects a non-zero-balance destination and re-derives", async () => {
  const utxoRoot = makeUtxoRoot(5);
  const proposed = [0, 1, 2];
  const proposedKeys = await Promise.all(
    proposed.map((i) => deriveUtxoPublicKey(utxoRoot, i)),
  );

  // Index 1 has been funded between prepare and execute; the precheck must
  // reject the proposed set and substitute fresh free indexes.
  const balances = new Map<string, bigint>([
    [hexOf(proposedKeys[1]), 42n],
  ]);
  const { client } = mockChannelClient(balances);

  const { indexes, publicKeys } = await validateReceiveDestinations(
    client,
    utxoRoot,
    proposed,
    { log: silentLog },
  );

  assertEquals(publicKeys.length, proposed.length);
  // The replacement set must NOT include the funded index 1.
  for (const idx of indexes) assertNotEquals(idx, 1);
});

Deno.test("validateReceiveDestinations rejects a spent (balance == 0) destination", async () => {
  const utxoRoot = makeUtxoRoot(6);
  const proposed = [4, 5];
  const proposedKeys = await Promise.all(
    proposed.map((i) => deriveUtxoPublicKey(utxoRoot, i)),
  );
  const balances = new Map<string, bigint>([
    [hexOf(proposedKeys[0]), 0n], // spent — must reject
  ]);
  const { client } = mockChannelClient(balances);

  const { indexes } = await validateReceiveDestinations(
    client,
    utxoRoot,
    proposed,
    { log: silentLog },
  );

  for (const idx of indexes) assertNotEquals(idx, 4);
});
