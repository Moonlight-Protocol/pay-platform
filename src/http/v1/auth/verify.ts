import { type Context, Status } from "@oak/oak";
import { verifyWalletChallenge } from "@/core/service/auth/wallet-auth.ts";
import generateJwt from "@/core/service/auth/generate-jwt.ts";
import { LOG } from "@/config/logger.ts";

/**
 * POST /api/v1/auth/verify
 *
 * Verifies a signed wallet challenge and returns a JWT.
 *
 * Note: this endpoint does NOT create a pay account on its own. The wallet
 * is authenticated, but the user is not yet "in" Moonlight Pay until they
 * complete signup via POST /api/v1/account.
 */
export const postVerifyHandler = async (ctx: Context) => {
  try {
    const body = await ctx.request.body.json();
    const { nonce, signature, publicKey } = body;

    if (!nonce || !signature || !publicKey) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "nonce, signature, and publicKey are required" };
      return;
    }

    const { token } = await verifyWalletChallenge(nonce, signature, publicKey, {
      generateToken: (subject, sessionId) => generateJwt(subject, sessionId),
    });

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Authentication successful",
      data: { token },
    };
  } catch (error) {
    LOG.warn("Wallet auth failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.Unauthorized;
    ctx.response.body = { message: "Authentication failed" };
  }
};
