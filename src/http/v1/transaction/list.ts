import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { TransactionRepository } from "@/persistence/drizzle/repository/transaction.repository.ts";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";

const txRepo = new TransactionRepository(drizzleClient);

/**
 * GET /api/v1/transactions
 *
 * Returns the authenticated user's transaction history.
 * No UTXO details, bundle IDs, or channel internals — the user sees
 * direction, amount, status, counterparty, description, and timestamps.
 *
 * Query params:
 *   direction — "IN" | "OUT" (optional, default: all)
 *   limit — number (default 50, max 100)
 *   offset — number (default 0)
 */
export const listTransactionsHandler = async (ctx: Context) => {
  try {
    const session = ctx.state.session as JwtSessionData;
    const params = ctx.request.url.searchParams;
    const direction = params.get("direction") as "IN" | "OUT" | null;
    const limit = Math.min(
      parseInt(params.get("limit") ?? "50", 10) || 50,
      100,
    );
    const offset = parseInt(params.get("offset") ?? "0", 10) || 0;

    const rows = await txRepo.findByWallet(session.sub, {
      direction: direction ?? undefined,
      limit,
      offset,
    });

    ctx.response.body = {
      data: rows.map((tx) => ({
        id: tx.id,
        direction: tx.direction,
        status: tx.status,
        method: tx.method,
        amountStroops: tx.amountStroops.toString(),
        amountXlm: (Number(tx.amountStroops) / 1e7).toFixed(7),
        feeStroops: tx.feeStroops.toString(),
        counterparty: tx.counterparty,
        description: tx.description,
        createdAt: tx.createdAt.toISOString(),
        completedAt: tx.completedAt?.toISOString() ?? null,
      })),
    };
  } catch (_error) {
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to list transactions" };
  }
};
