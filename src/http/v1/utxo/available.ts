import { type RouterContext, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { ReceiveUtxoRepository } from "@/persistence/drizzle/repository/receive-utxo.repository.ts";
import { PayAccountRepository } from "@/persistence/drizzle/repository/pay-account.repository.ts";

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
export const getAvailableHandler = async (ctx: RouterContext<string>) => {
  const walletPublicKey = ctx.params.walletPublicKey;
  const countParam = ctx.request.url.searchParams.get("count");
  const count = Math.min(Math.max(parseInt(countParam ?? "5", 10) || 5, 1), 20);

  const account = await accountRepo.findByPublicKey(walletPublicKey);
  if (!account) {
    ctx.response.status = Status.NotFound;
    ctx.response.body = { message: "Account not found" };
    return;
  }

  const available = await utxoRepo.findAvailable(walletPublicKey, count);
  if (available.length === 0) {
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
};
