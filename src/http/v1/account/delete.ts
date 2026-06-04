import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PayAccountRepository } from "@/persistence/drizzle/repository/pay-account.repository.ts";
import type { Logger } from "@/utils/logger/index.ts";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";

const accountRepo = new PayAccountRepository(drizzleClient);

/**
 * DELETE /api/v1/account/me
 *
 * Hard-deletes the authenticated user's pay_accounts row. The transactions
 * FK cascades (`transaction.entity.ts:37` — onDelete: "cascade"), so the
 * user's payment log is wiped along with the account. No tombstone.
 */
export function handleDeleteMe(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("deleteMe");

  return async (ctx) => {
    log.info("deleteMe");
    try {
      const session = ctx.state.session as JwtSessionData;
      const walletPublicKey = session.sub;

      const removed = await accountRepo.deleteByPublicKey(walletPublicKey);
      if (!removed) {
        ctx.response.status = Status.NotFound;
        ctx.response.body = { message: "Account not found" };
        return;
      }

      log.event("pay account deleted");
      ctx.response.status = Status.NoContent;
    } catch (error) {
      log.error(error, "failed to delete account");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to delete account" };
    }
  };
}
