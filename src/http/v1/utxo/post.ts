import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { ReceiveUtxoRepository } from "@/persistence/drizzle/repository/receive-utxo.repository.ts";
import type { Logger } from "@/utils/logger/index.ts";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";

const utxoRepo = new ReceiveUtxoRepository(drizzleClient);

/**
 * POST /api/v1/utxo/receive
 *
 * Stores pre-generated receive UTXO public keys for the authenticated user.
 * Called by the moonlight-pay frontend at onboarding after deriving keys
 * from HKDF(master_seed, salt=email).
 *
 * Body: { utxos: Array<{ utxoPublicKey: string, derivationIndex: number }> }
 *
 * Idempotent: if the user already has UTXOs, returns 200 with the count.
 */
export function handlePostUtxos(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("postUtxos");

  return async (ctx) => {
    log.info("postUtxos");
    try {
      const session = ctx.state.session as JwtSessionData;
      const walletPublicKey = session.sub;
      log.debug("walletPublicKey", walletPublicKey);

      const existing = await utxoRepo.countByWallet(walletPublicKey);
      if (existing > 0) {
        ctx.response.status = Status.OK;
        ctx.response.body = {
          message: "Receive UTXOs already generated",
          data: { count: existing },
        };
        return;
      }

      const body = await ctx.request.body.json().catch(() => ({}));
      const { utxos } = body;

      if (!Array.isArray(utxos) || utxos.length === 0) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "utxos array is required" };
        return;
      }

      for (const u of utxos) {
        if (
          typeof u.utxoPublicKey !== "string" ||
          typeof u.derivationIndex !== "number"
        ) {
          ctx.response.status = Status.BadRequest;
          ctx.response.body = {
            message:
              "Each utxo must have utxoPublicKey (string) and derivationIndex (number)",
          };
          return;
        }
      }

      const rows = await utxoRepo.bulkCreate(
        utxos.map((u: { utxoPublicKey: string; derivationIndex: number }) => ({
          walletPublicKey,
          utxoPublicKey: u.utxoPublicKey,
          derivationIndex: u.derivationIndex,
        })),
      );

      log.debug("count", rows.length);
      log.event("receive UTXOs stored");

      ctx.response.status = Status.Created;
      ctx.response.body = {
        message: "Receive UTXOs stored",
        data: { count: rows.length },
      };
    } catch (error) {
      log.error(error, "failed to store receive UTXOs");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to store receive UTXOs" };
    }
  };
}
