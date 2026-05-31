import { assertEquals, assertRejects } from "@std/assert";
import { Keypair } from "stellar-sdk";
import { Buffer } from "buffer";
import {
  createWalletChallenge,
  setChallengeTtlMs,
  verifyWalletChallenge,
  type WalletAuthConfig,
} from "./wallet-auth.ts";
import { newNoop } from "@/utils/logger/index.ts";

const TEST_TOKEN = "test-jwt-token";
const config: WalletAuthConfig = {
  generateToken: (_subject: string, _sessionId: string) =>
    Promise.resolve(TEST_TOKEN),
};
const deps = { log: newNoop() };

function signNonceRaw(kp: Keypair, nonce: string): string {
  // Raw format: sign the decoded nonce bytes (matches the wallet
  // signMessage path used by the moonlight-pay frontend).
  const rawNonce = Buffer.from(nonce, "base64");
  return Buffer.from(kp.sign(rawNonce)).toString("base64");
}

Deno.test("createWalletChallenge returns a base64 nonce", () => {
  const kp = Keypair.random();
  const { nonce } = createWalletChallenge(kp.publicKey(), deps);
  // 32 random bytes → 44 char base64 (with padding)
  assertEquals(nonce.length, 44);
});

Deno.test("verifyWalletChallenge succeeds with a valid raw signature", async () => {
  const kp = Keypair.random();
  const { nonce } = createWalletChallenge(kp.publicKey(), deps);
  const signature = signNonceRaw(kp, nonce);

  const { token } = await verifyWalletChallenge(
    nonce,
    signature,
    kp.publicKey(),
    config,
    deps,
  );
  assertEquals(token, TEST_TOKEN);
});

Deno.test("verifyWalletChallenge rejects an unknown nonce", async () => {
  const kp = Keypair.random();
  await assertRejects(
    () =>
      verifyWalletChallenge(
        "never-issued",
        "irrelevant",
        kp.publicKey(),
        config,
        deps,
      ),
    Error,
    "Challenge not found or expired",
  );
});

Deno.test("verifyWalletChallenge rejects on public key mismatch", async () => {
  // The challenge is bound to the public key it was issued for.
  // Submitting it with a different public key (even with that key's signature)
  // must be rejected before the signature check.
  const owner = Keypair.random();
  const attacker = Keypair.random();
  const { nonce } = createWalletChallenge(owner.publicKey(), deps);
  const signature = signNonceRaw(attacker, nonce);

  await assertRejects(
    () =>
      verifyWalletChallenge(
        nonce,
        signature,
        attacker.publicKey(),
        config,
        deps,
      ),
    Error,
    "Public key mismatch",
  );
});

Deno.test("verifyWalletChallenge rejects an invalid signature", async () => {
  const kp = Keypair.random();
  const other = Keypair.random();
  const { nonce } = createWalletChallenge(kp.publicKey(), deps);
  // Signature from a different key — should fail across all 3 verification formats.
  const badSignature = signNonceRaw(other, nonce);

  await assertRejects(
    () =>
      verifyWalletChallenge(
        nonce,
        badSignature,
        kp.publicKey(),
        config,
        deps,
      ),
    Error,
    "Invalid signature",
  );
});

Deno.test("verifyWalletChallenge rejects an expired challenge", async () => {
  setChallengeTtlMs(1); // 1ms TTL
  try {
    const kp = Keypair.random();
    const { nonce } = createWalletChallenge(kp.publicKey(), deps);
    await new Promise((r) => setTimeout(r, 5));
    const signature = signNonceRaw(kp, nonce);

    await assertRejects(
      () =>
        verifyWalletChallenge(nonce, signature, kp.publicKey(), config, deps),
      Error,
      "Challenge expired",
    );
  } finally {
    setChallengeTtlMs(5 * 60 * 1000); // restore default
  }
});

Deno.test("verifyWalletChallenge consumes the nonce on success (single-use)", async () => {
  const kp = Keypair.random();
  const { nonce } = createWalletChallenge(kp.publicKey(), deps);
  const signature = signNonceRaw(kp, nonce);

  // First call succeeds…
  await verifyWalletChallenge(nonce, signature, kp.publicKey(), config, deps);
  // …second call with the same nonce must fail (replay protection).
  await assertRejects(
    () => verifyWalletChallenge(nonce, signature, kp.publicKey(), config, deps),
    Error,
    "Challenge not found or expired",
  );
});

Deno.test("verifyWalletChallenge does NOT consume the nonce on a bad signature", async () => {
  const kp = Keypair.random();
  const other = Keypair.random();
  const { nonce } = createWalletChallenge(kp.publicKey(), deps);

  // First, fail with a bad signature.
  await assertRejects(
    () =>
      verifyWalletChallenge(
        nonce,
        signNonceRaw(other, nonce),
        kp.publicKey(),
        config,
        deps,
      ),
    Error,
    "Invalid signature",
  );
  // Then a valid signature on the same nonce must still succeed —
  // attackers shouldn't be able to burn valid challenges.
  const goodSignature = signNonceRaw(kp, nonce);
  const { token } = await verifyWalletChallenge(
    nonce,
    goodSignature,
    kp.publicKey(),
    config,
    deps,
  );
  assertEquals(token, TEST_TOKEN);
});
