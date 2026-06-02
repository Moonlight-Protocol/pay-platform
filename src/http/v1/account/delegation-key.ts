import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PayAccountRepository } from "@/persistence/drizzle/repository/pay-account.repository.ts";
import { encryptSk } from "@/core/crypto/encrypt-sk.ts";
import { SERVICE_AUTH_SECRET } from "@/config/env.ts";
import type { Logger } from "@/utils/logger/index.ts";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";

const accountRepo = new PayAccountRepository(drizzleClient);

const UTXO_ROOT_BYTES = 32;
const UTXO_ROOT_BASE64_LEN = 44; // 32-byte payload, base64-encoded

/**
 * POST /api/v1/account/delegation-key
 *
 * Hand-off of the user's UTXO derivation root. The client computes
 * `utxoRoot = HKDF-SHA256(masterSeed, salt="moonlight-pay",
 * info="moonlight-pay-utxo-v1", 32)` once at signup and sends the 32-byte
 * root over TLS. The platform encrypts it with SERVICE_AUTH_SECRET and
 * stores the ciphertext on the user's pay_accounts row. The masterSeed
 * never leaves the device.
 *
 * Body: { utxoRoot: string }   // 32 raw bytes, base64-encoded
 *
 * Idempotent: a subsequent call overwrites the stored ciphertext (used
 * when the user wipes + re-derives).
 */
export function handlePostDelegationKey(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("postDelegationKey");

  return async (ctx) => {
    log.info("postDelegationKey");
    try {
      const session = ctx.state.session as JwtSessionData;
      const walletPublicKey = session.sub;

      const body = await ctx.request.body.json().catch(() => ({}));
      const { utxoRoot } = body;

      if (
        typeof utxoRoot !== "string" || utxoRoot.length !== UTXO_ROOT_BASE64_LEN
      ) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = {
          message: `utxoRoot must be ${UTXO_ROOT_BYTES} bytes, base64-encoded`,
        };
        return;
      }

      let rootBytes: Uint8Array;
      try {
        rootBytes = Uint8Array.from(atob(utxoRoot), (c) => c.charCodeAt(0));
      } catch {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "utxoRoot is not valid base64" };
        return;
      }
      if (rootBytes.length !== UTXO_ROOT_BYTES) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = {
          message: `utxoRoot must decode to exactly ${UTXO_ROOT_BYTES} bytes`,
        };
        return;
      }

      const existing = await accountRepo.findByPublicKey(walletPublicKey);
      if (!existing) {
        ctx.response.status = Status.NotFound;
        ctx.response.body = { message: "Account not found" };
        return;
      }

      const encryptedDelegationKey = await encryptSk(
        utxoRoot,
        SERVICE_AUTH_SECRET,
      );
      const updated = await accountRepo.update(walletPublicKey, {
        encryptedDelegationKey,
      });
      if (!updated) {
        ctx.response.status = Status.InternalServerError;
        ctx.response.body = { message: "Failed to store delegation key" };
        return;
      }

      log.event("delegation key stored");
      ctx.response.status = Status.NoContent;
    } catch (error) {
      if (error instanceof SyntaxError) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "Invalid request body" };
        return;
      }
      log.error(error, "failed to store delegation key");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to store delegation key" };
    }
  };
}
