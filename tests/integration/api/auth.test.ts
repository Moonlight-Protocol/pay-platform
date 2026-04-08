/**
 * Integration tests for /api/v1/auth/* endpoints.
 *
 * Run with: deno test --allow-all --no-check --config tests/deno.json tests/integration/api/auth.test.ts
 */
import { assertEquals, assertExists } from "@std/assert";
import { Buffer } from "buffer";
import { createMockContext } from "../../test_app.ts";
import { _TEST_WALLET_KEYPAIR } from "../../mock_env.ts";
import { ensureInitialized, resetDb } from "../../pglite_db.ts";
import { postChallengeHandler } from "@/http/v1/auth/challenge.ts";
import { postVerifyHandler } from "@/http/v1/auth/verify.ts";

async function getNonce(publicKey: string): Promise<string> {
  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: { publicKey },
  });
  await postChallengeHandler(ctx);
  const res = getResponse();
  assertEquals(res.status, 200);
  return res.body.data.nonce as string;
}

function signNonceSep53(nonce: string): string {
  const nonceBytes = Buffer.from(nonce, "utf-8");
  const sep53Prefix = "Stellar Signed Message:\n";
  const sep53Payload = Buffer.concat([Buffer.from(sep53Prefix, "utf-8"), nonceBytes]);
  return Promise.resolve().then(async () => {
    const hash = Buffer.from(await crypto.subtle.digest("SHA-256", sep53Payload));
    return _TEST_WALLET_KEYPAIR.sign(hash).toString("base64");
  }) as unknown as string;
}

async function signSep53(nonce: string): Promise<string> {
  const nonceBytes = Buffer.from(nonce, "utf-8");
  const sep53Prefix = "Stellar Signed Message:\n";
  const sep53Payload = Buffer.concat([Buffer.from(sep53Prefix, "utf-8"), nonceBytes]);
  const hash = Buffer.from(await crypto.subtle.digest("SHA-256", sep53Payload));
  return _TEST_WALLET_KEYPAIR.sign(hash).toString("base64");
}

Deno.test("POST /auth/challenge - returns a nonce for a valid public key", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: { publicKey: _TEST_WALLET_KEYPAIR.publicKey() },
  });
  await postChallengeHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertExists(res.body.data.nonce);
});

Deno.test("POST /auth/challenge - rejects missing publicKey", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: {},
  });
  await postChallengeHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 400);
});

Deno.test("POST /auth/challenge - rejects invalid public key format", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: { publicKey: "not-a-valid-key" },
  });
  await postChallengeHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 400);
});

Deno.test("POST /auth/verify - returns a JWT for a valid SEP-53 signature", async () => {
  await ensureInitialized();
  await resetDb();

  const publicKey = _TEST_WALLET_KEYPAIR.publicKey();
  const nonce = await getNonce(publicKey);
  const signature = await signSep53(nonce);

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: { nonce, signature, publicKey },
  });
  await postVerifyHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertExists(res.body.data.token);
});

Deno.test("POST /auth/verify - rejects an invalid signature", async () => {
  await ensureInitialized();
  await resetDb();

  const publicKey = _TEST_WALLET_KEYPAIR.publicKey();
  const nonce = await getNonce(publicKey);

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: { nonce, signature: "AAAA", publicKey },
  });
  await postVerifyHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 401);
});

Deno.test("POST /auth/verify - rejects nonce that was never issued", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: {
      nonce: "fake-nonce",
      signature: "AAAA",
      publicKey: _TEST_WALLET_KEYPAIR.publicKey(),
    },
  });
  await postVerifyHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 401);
});
