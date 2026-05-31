import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { TransactionRepository } from "@/persistence/drizzle/repository/transaction.repository.ts";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";
import type { Logger } from "@/utils/logger/index.ts";

const txRepo = new TransactionRepository(drizzleClient);

/**
 * GET /api/v1/transactions/balance
 *
 * Returns the authenticated user's balance in stroops and XLM.
 */
export function handleGetBalance(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("getBalance");

  return async (ctx) => {
    log.info("getBalance");
    try {
      const session = ctx.state.session as JwtSessionData;
      log.debug("accountId", session.sub);

      log.event("fetching account balance");
      const balanceStroops = await txRepo.getBalance(session.sub);
      log.debug("balanceStroops", balanceStroops.toString());

      ctx.response.body = {
        data: {
          balanceStroops: balanceStroops.toString(),
          balanceXlm: (Number(balanceStroops) / 1e7).toFixed(7),
        },
      };
      log.event("balance response assembled");
    } catch (error) {
      log.error(error, "get balance failed");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to get balance" };
    }
  };
}
