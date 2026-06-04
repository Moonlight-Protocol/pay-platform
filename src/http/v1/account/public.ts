import { type RouterContext, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PayAccountRepository } from "@/persistence/drizzle/repository/pay-account.repository.ts";
import type { Logger } from "@/utils/logger/index.ts";

const accountRepo = new PayAccountRepository(drizzleClient);

/**
 * GET /api/v1/account/:walletPublicKey/public
 *
 * Public profile lookup. Used by the POS view to confirm a merchant exists
 * and is set up to receive (has a delegation key registered), and to
 * render their display name.
 *
 *   200 { data: { walletPublicKey, displayName, jurisdictionCountryCode } }
 *   404 — no account for that wallet
 *   503 — account exists but no delegation key set yet ("not set up")
 */
export function handleGetPublic(
  deps: { log: Logger },
): (ctx: RouterContext<string>) => Promise<void> {
  const log = deps.log.scope("getAccountPublic");

  return async (ctx) => {
    log.info("getAccountPublic");
    const walletPublicKey = ctx.params.walletPublicKey;
    log.debug("walletPublicKey", walletPublicKey);

    const account = await accountRepo.findByPublicKey(walletPublicKey);
    if (!account) {
      ctx.response.status = Status.NotFound;
      ctx.response.body = { message: "Account not found" };
      return;
    }

    if (!account.encryptedDelegationKey) {
      ctx.response.status = Status.ServiceUnavailable;
      ctx.response.body = {
        message: "Merchant has not finished onboarding",
      };
      return;
    }

    ctx.response.status = Status.OK;
    ctx.response.body = {
      data: {
        walletPublicKey: account.walletPublicKey,
        displayName: account.displayName,
        jurisdictionCountryCode: account.jurisdictionCountryCode,
      },
    };
  };
}
