import { type Context, Status } from "@oak/oak";
import { Keypair } from "stellar-sdk";
import { createWalletChallenge } from "@/core/service/auth/wallet-auth.ts";
import type { Logger } from "@/utils/logger/index.ts";
import { withSpan } from "@/core/tracing.ts";

export function handlePostChallenge(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("postChallenge");

  return (ctx) =>
    withSpan("P_AuthChallenge", async (span) => {
      log.info("postChallenge");
      try {
        const body = await ctx.request.body.json();
        const { publicKey } = body;

        if (!publicKey || typeof publicKey !== "string") {
          ctx.response.status = Status.BadRequest;
          ctx.response.body = { message: "publicKey is required" };
          return;
        }

        span.setAttribute("wallet.public_key", publicKey);
        log.debug("publicKey", publicKey);

        try {
          Keypair.fromPublicKey(publicKey);
        } catch {
          ctx.response.status = Status.BadRequest;
          ctx.response.body = { message: "Invalid Stellar public key format" };
          return;
        }

        const { nonce } = createWalletChallenge(publicKey, { log });

        ctx.response.status = Status.OK;
        ctx.response.body = {
          message: "Challenge created",
          data: { nonce },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("Too many pending challenges")) {
          ctx.response.status = 429;
          ctx.response.body = { message };
          return;
        }
        ctx.response.status = Status.InternalServerError;
        ctx.response.body = { message: "Failed to create challenge" };
      }
    });
}
