import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { ReceiveUtxoRepository } from "@/persistence/drizzle/repository/receive-utxo.repository.ts";
import { LOG } from "@/config/logger.ts";
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
export const postUtxosHandler = async (ctx: Context) => {
  try {
    const session = ctx.state.session as JwtSessionData;
    const walletPublicKey = session.sub;

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

    LOG.info("Receive UTXOs stored", {
      walletPublicKey,
      count: rows.length,
    });

    ctx.response.status = Status.Created;
    ctx.response.body = {
      message: "Receive UTXOs stored",
      data: { count: rows.length },
    };
  } catch (error) {
    LOG.error("Failed to store receive UTXOs", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to store receive UTXOs" };
  }
};
