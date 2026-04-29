import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { TransactionRepository } from "@/persistence/drizzle/repository/transaction.repository.ts";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";

const txRepo = new TransactionRepository(drizzleClient);

/**
 * GET /api/v1/transactions/balance
 *
 * Returns the authenticated user's balance in stroops and XLM.
 */
export const getBalanceHandler = async (ctx: Context) => {
  try {
    const session = ctx.state.session as JwtSessionData;
    const balanceStroops = await txRepo.getBalance(session.sub);

    ctx.response.body = {
      data: {
        balanceStroops: balanceStroops.toString(),
        balanceXlm: (Number(balanceStroops) / 1e7).toFixed(7),
      },
    };
  } catch (_error) {
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to get balance" };
  }
};
