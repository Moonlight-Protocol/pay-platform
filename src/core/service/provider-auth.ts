/**
 * Server-side authentication with provider-platform.
 *
 * Pay-platform authenticates using its own service keypair (PAY_SERVICE_SK)
 * via the provider's transaction-based challenge-response flow. The JWT is
 * cached in memory and re-obtained when it expires.
 *
 * This keeps the customer out of the provider auth flow entirely —
 * the customer interacts only with pay-platform.
 */
import { Keypair, Transaction } from "stellar-sdk";
import { PAY_SERVICE_SK } from "@/config/env.ts";
import type { Logger } from "@/utils/logger/index.ts";
import { withSpan } from "@/core/tracing.ts";

interface CachedAuth {
  jwt: string;
  expiresAt: number; // epoch ms
}

/** Cache of JWTs, keyed by `${ppUrl}|${ppPublicKey}` (tokens are PP-scoped). */
const cache = new Map<string, CachedAuth>();

/** Re-auth 60s before actual expiry to avoid edge-case failures. */
const EXPIRY_BUFFER_MS = 60_000;

/** Default JWT lifetime assumption if we can't parse it (30 min). */
const DEFAULT_TTL_MS = 30 * 60_000;

function getKeypair(): Keypair {
  if (!PAY_SERVICE_SK) {
    throw new Error(
      "PAY_SERVICE_SK is not configured. Pay-platform cannot authenticate with provider-platform.",
    );
  }
  return Keypair.fromSecret(PAY_SERVICE_SK);
}

/** Parse JWT expiry from the payload. Returns epoch ms. */
function parseJwtExpiry(jwt: string): number {
  try {
    const payload = JSON.parse(atob(jwt.split(".")[1]));
    if (typeof payload.exp === "number") {
      return payload.exp * 1000;
    }
  } catch { /* fall through */ }
  return Date.now() + DEFAULT_TTL_MS;
}

/**
 * Get a valid JWT for the given provider-platform URL + PP.
 * Returns a cached JWT if still valid, otherwise authenticates fresh.
 *
 * `ppPublicKey` identifies which PP we're authenticating for: provider's
 * SEP-10 verify is PP-aware (it scopes the issued JWT + entity status to that
 * PP), so the token is cached per (ppUrl, ppPublicKey) — a token minted for
 * one PP must not be reused for another served by the same provider URL.
 */
export function getProviderJwt(
  ppUrl: string,
  ppPublicKey: string,
  deps: { log: Logger },
): Promise<string> {
  const log = deps.log.scope("getProviderJwt");
  log.info("getProviderJwt");
  log.debug("ppUrl", ppUrl);
  log.debug("ppPublicKey", ppPublicKey);

  const cacheKey = `${ppUrl}|${ppPublicKey}`;

  return withSpan("ProviderAuth.getJwt", async (span) => {
    span.setAttribute("provider.url", ppUrl);
    span.setAttribute("provider.pp_public_key", ppPublicKey);
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + EXPIRY_BUFFER_MS) {
      span.setAttribute("provider.jwt.cache_hit", true);
      return cached.jwt;
    }
    span.setAttribute("provider.jwt.cache_hit", false);

    const keypair = getKeypair();
    const publicKey = keypair.publicKey();
    span.setAttribute("provider.public_key", publicKey);

    log.debug("publicKey", publicKey);
    log.event("requesting challenge");

    // 1. Get challenge
    const challengeRes = await fetch(
      `${ppUrl}/api/v1/stellar/auth?account=${publicKey}`,
    );
    if (!challengeRes.ok) {
      throw new Error(
        `Provider auth challenge failed: ${challengeRes.status} ${await challengeRes
          .text()}`,
      );
    }
    const { data: challengeData } = await challengeRes.json();
    const challengeXdr = challengeData?.challenge;
    if (!challengeXdr) {
      throw new Error("Provider returned no challenge XDR");
    }

    log.event("challenge received");

    // 2. Co-sign the challenge transaction
    // The provider uses "Standalone Network ; February 2017" for local,
    // but we parse the XDR without needing the passphrase for signing —
    // we just need to add our signature to the envelope.
    const tx = new Transaction(
      challengeXdr,
      challengeData.networkPassphrase ?? "Standalone Network ; February 2017",
    );
    tx.sign(keypair);
    const signedXdr = tx.toXDR();

    log.event("submitting signed challenge");

    // 3. Submit co-signed challenge
    const verifyRes = await fetch(`${ppUrl}/api/v1/stellar/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signedChallenge: signedXdr, ppPublicKey }),
    });
    if (!verifyRes.ok) {
      throw new Error(
        `Provider auth verify failed: ${verifyRes.status} ${await verifyRes
          .text()}`,
      );
    }
    const { data: verifyData } = await verifyRes.json();
    const jwt = verifyData?.jwt;
    if (!jwt) {
      throw new Error("Provider returned no JWT");
    }

    cache.set(cacheKey, { jwt, expiresAt: parseJwtExpiry(jwt) });
    log.event("authenticated with provider-platform");

    return jwt;
  });
}
