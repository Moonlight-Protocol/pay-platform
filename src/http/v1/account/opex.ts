import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PayAccountRepository } from "@/persistence/drizzle/repository/pay-account.repository.ts";
import { encryptSk } from "@/core/crypto/encrypt-sk.ts";
import { SERVICE_AUTH_SECRET } from "@/config/env.ts";
import { LOG } from "@/config/logger.ts";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";

const accountRepo = new PayAccountRepository(drizzleClient);

/**
 * POST /api/v1/account/opex
 *
 * Registers the OpEx account for instant payments. The frontend derives
 * the keypair deterministically from the master seed, funds it, and sends
 * the secret key here for server-side storage.
 *
 * Body: { secretKey, publicKey, feePct }
 */
export const postOpexHandler = async (ctx: Context) => {
  try {
    const session = ctx.state.session as JwtSessionData;
    const walletPublicKey = session.sub;

    const body = await ctx.request.body.json().catch(() => ({}));
    const { secretKey, publicKey, feePct } = body;

    if (typeof secretKey !== "string" || !secretKey.startsWith("S")) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Invalid secretKey" };
      return;
    }
    if (typeof publicKey !== "string" || !publicKey.startsWith("G")) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Invalid publicKey" };
      return;
    }
    if (typeof feePct !== "number" || feePct < 0 || feePct > 100) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "feePct must be a number between 0 and 100" };
      return;
    }

    const account = await accountRepo.findByPublicKey(walletPublicKey);
    if (!account) {
      ctx.response.status = Status.NotFound;
      ctx.response.body = { message: "Account not found. Create an account first." };
      return;
    }

    const encrypted = await encryptSk(secretKey, SERVICE_AUTH_SECRET);

    await accountRepo.update(walletPublicKey, {
      opexPublicKey: publicKey,
      encryptedOpexSk: encrypted,
      feePct: String(feePct),
    });

    LOG.info("OpEx account registered", { walletPublicKey, opexPublicKey: publicKey, feePct });

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "OpEx account registered",
      data: { opexPublicKey: publicKey, feePct },
    };
  } catch (error) {
    LOG.error("Failed to register OpEx account", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to register OpEx account" };
  }
};
