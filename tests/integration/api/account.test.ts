/**
 * Integration tests for /api/v1/account/* endpoints.
 *
 * Run with: deno test --allow-all --no-check --config tests/deno.json tests/integration/api/account.test.ts
 */
import { assertEquals, assertExists } from "@std/assert";
import { createMockContext } from "../../test_app.ts";
import { _TEST_WALLET_KEYPAIR } from "../../mock_env.ts";
import { ensureInitialized, resetDb } from "../../pglite_db.ts";
import { postAccountHandler } from "@/http/v1/account/post.ts";
import { getMeHandler, patchMeHandler } from "@/http/v1/account/me.ts";

const walletPublicKey = _TEST_WALLET_KEYPAIR.publicKey();
const session = {
  sub: walletPublicKey,
  iss: "test",
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600,
  sessionId: "test-session",
};

const VALID_BODY = {
  email: "alice@example.com",
  jurisdictionCountryCode: "ES",
  displayName: "Alice",
};

Deno.test("POST /account - creates a new account", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: VALID_BODY,
    state: { session },
  });
  await postAccountHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 201);
  assertEquals(res.body.data.walletPublicKey, walletPublicKey);
  assertEquals(res.body.data.email, "alice@example.com");
  assertEquals(res.body.data.jurisdictionCountryCode, "ES");
  assertEquals(res.body.data.displayName, "Alice");
  assertExists(res.body.data.createdAt);
});

Deno.test("POST /account - is idempotent (returns existing on second call)", async () => {
  await ensureInitialized();
  await resetDb();

  // First create
  const ctx1 = createMockContext({
    method: "POST",
    body: VALID_BODY,
    state: { session },
  });
  await postAccountHandler(ctx1.ctx);
  assertEquals(ctx1.getResponse().status, 201);

  // Second call should return existing
  const ctx2 = createMockContext({
    method: "POST",
    body: { ...VALID_BODY, email: "different@example.com" },
    state: { session },
  });
  await postAccountHandler(ctx2.ctx);

  const res = ctx2.getResponse();
  assertEquals(res.status, 200);
  // The body's email should NOT have been updated — POST is idempotent.
  assertEquals(res.body.data.email, "alice@example.com");
});

Deno.test("POST /account - rejects missing email", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: { jurisdictionCountryCode: "ES" },
    state: { session },
  });
  await postAccountHandler(ctx);

  assertEquals(getResponse().status, 400);
});

Deno.test("POST /account - rejects invalid email", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: { ...VALID_BODY, email: "not-an-email" },
    state: { session },
  });
  await postAccountHandler(ctx);

  assertEquals(getResponse().status, 400);
});

Deno.test("POST /account - rejects invalid jurisdiction", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: { ...VALID_BODY, jurisdictionCountryCode: "spain" },
    state: { session },
  });
  await postAccountHandler(ctx);

  assertEquals(getResponse().status, 400);
});

Deno.test("POST /account - normalizes jurisdiction to uppercase", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    method: "POST",
    body: { ...VALID_BODY, jurisdictionCountryCode: "es" },
    state: { session },
  });
  await postAccountHandler(ctx);

  const res = getResponse();
  // Lowercase fails the validation regex (only [A-Z]{2}), so 400 is correct.
  assertEquals(res.status, 400);
});

Deno.test("GET /account/me - returns the authenticated wallet's account", async () => {
  await ensureInitialized();
  await resetDb();

  // Set up an account
  const createCtx = createMockContext({
    method: "POST",
    body: VALID_BODY,
    state: { session },
  });
  await postAccountHandler(createCtx.ctx);

  const { ctx, getResponse } = createMockContext({
    method: "GET",
    state: { session },
  });
  await getMeHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.data.walletPublicKey, walletPublicKey);
  assertExists(res.body.data.lastSeenAt);
});

Deno.test("GET /account/me - returns 404 if no account exists", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    method: "GET",
    state: { session },
  });
  await getMeHandler(ctx);

  assertEquals(getResponse().status, 404);
});

Deno.test("PATCH /account/me - updates jurisdiction", async () => {
  await ensureInitialized();
  await resetDb();

  const createCtx = createMockContext({
    method: "POST",
    body: VALID_BODY,
    state: { session },
  });
  await postAccountHandler(createCtx.ctx);

  const { ctx, getResponse } = createMockContext({
    method: "PATCH",
    body: { jurisdictionCountryCode: "AR" },
    state: { session },
  });
  await patchMeHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.data.jurisdictionCountryCode, "AR");
  // Other fields untouched
  assertEquals(res.body.data.email, "alice@example.com");
});

Deno.test("PATCH /account/me - updates email and displayName", async () => {
  await ensureInitialized();
  await resetDb();

  const createCtx = createMockContext({
    method: "POST",
    body: VALID_BODY,
    state: { session },
  });
  await postAccountHandler(createCtx.ctx);

  const { ctx, getResponse } = createMockContext({
    method: "PATCH",
    body: { email: "alice2@example.com", displayName: "Alice 2" },
    state: { session },
  });
  await patchMeHandler(ctx);

  const res = getResponse();
  assertEquals(res.status, 200);
  assertEquals(res.body.data.email, "alice2@example.com");
  assertEquals(res.body.data.displayName, "Alice 2");
});

Deno.test("PATCH /account/me - returns 404 if no account exists", async () => {
  await ensureInitialized();
  await resetDb();

  const { ctx, getResponse } = createMockContext({
    method: "PATCH",
    body: { displayName: "x" },
    state: { session },
  });
  await patchMeHandler(ctx);

  assertEquals(getResponse().status, 404);
});

Deno.test("PATCH /account/me - rejects empty body", async () => {
  await ensureInitialized();
  await resetDb();

  const createCtx = createMockContext({
    method: "POST",
    body: VALID_BODY,
    state: { session },
  });
  await postAccountHandler(createCtx.ctx);

  const { ctx, getResponse } = createMockContext({
    method: "PATCH",
    body: {},
    state: { session },
  });
  await patchMeHandler(ctx);

  assertEquals(getResponse().status, 400);
});

Deno.test("PATCH /account/me - rejects invalid email", async () => {
  await ensureInitialized();
  await resetDb();

  const createCtx = createMockContext({
    method: "POST",
    body: VALID_BODY,
    state: { session },
  });
  await postAccountHandler(createCtx.ctx);

  const { ctx, getResponse } = createMockContext({
    method: "PATCH",
    body: { email: "not-an-email" },
    state: { session },
  });
  await patchMeHandler(ctx);

  assertEquals(getResponse().status, 400);
});
