import { type RouterContext, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { ReceiveUtxoRepository } from "@/persistence/drizzle/repository/receive-utxo.repository.ts";
import { PayAccountRepository } from "@/persistence/drizzle/repository/pay-account.repository.ts";
import type { Logger } from "@/utils/logger/index.ts";

const utxoRepo = new ReceiveUtxoRepository(drizzleClient);
const accountRepo = new PayAccountRepository(drizzleClient);

/**
 * GET /api/v1/utxo/receive/:walletPublicKey/available
 *
 * Returns available receive UTXO public keys for a merchant.
 * Used by POS to build CREATE operations targeting the merchant's addresses.
 *
 * Public endpoint — no auth required. The POS customer needs to know
 * where to send without being authenticated as the merchant.
 *
 * Query params:
 *   count — number of UTXOs to return (default 5, max 20)
 */
export function handleGetAvailable(
  deps: { log: Logger },
): (ctx: RouterContext<string>) => Promise<void> {
  const log = deps.log.scope("getAvailableUtxos");

  return async (ctx) => {
    log.info("getAvailableUtxos");
    const walletPublicKey = ctx.params.walletPublicKey;
    const countParam = ctx.request.url.searchParams.get("count");
    const count = Math.min(
      Math.max(parseInt(countParam ?? "5", 10) || 5, 1),
      20,
    );

    log.debug("walletPublicKey", walletPublicKey);
    log.debug("count", count);

    log.event("looking up merchant account");
    const account = await accountRepo.findByPublicKey(walletPublicKey);
    if (!account) {
      log.event("merchant account not found");
      ctx.response.status = Status.NotFound;
      ctx.response.body = { message: "Account not found" };
      return;
    }

    log.event("fetching available receive UTXOs");
    const available = await utxoRepo.findAvailable(walletPublicKey, count);
    log.debug("availableCount", available.length);
    if (available.length === 0) {
      log.event("no receive addresses available");
      ctx.response.status = Status.ServiceUnavailable;
      ctx.response.body = {
        message: "No receive addresses available for this merchant",
      };
      return;
    }

    ctx.response.body = {
      data: {
        merchant: {
          walletPublicKey: account.walletPublicKey,
          displayName: account.displayName,
          jurisdictionCountryCode: account.jurisdictionCountryCode,
        },
        utxos: available.map((u) => ({
          id: u.id,
          utxoPublicKey: u.utxoPublicKey,
          derivationIndex: u.derivationIndex,
        })),
      },
    };
    log.event("available UTXOs response assembled");
  };
}
