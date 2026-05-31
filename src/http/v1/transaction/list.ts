import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { TransactionRepository } from "@/persistence/drizzle/repository/transaction.repository.ts";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";
import type { Logger } from "@/utils/logger/index.ts";

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
export function handleListTransactions(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("listTransactions");

  return async (ctx) => {
    log.info("listTransactions");
    try {
      const session = ctx.state.session as JwtSessionData;
      const params = ctx.request.url.searchParams;
      const direction = params.get("direction") as "IN" | "OUT" | null;
      const limit = Math.min(
        parseInt(params.get("limit") ?? "50", 10) || 50,
        100,
      );
      const offset = parseInt(params.get("offset") ?? "0", 10) || 0;

      log.debug("accountId", session.sub);
      log.debug("direction", direction);
      log.debug("limit", limit);
      log.debug("offset", offset);

      log.event("querying transaction history");
      const rows = await txRepo.findByWallet(session.sub, {
        direction: direction ?? undefined,
        limit,
        offset,
      });
      log.debug("rowCount", rows.length);

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
      log.event("transaction list response assembled");
    } catch (error) {
      log.error(error, "list transactions failed");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to list transactions" };
    }
  };
}
