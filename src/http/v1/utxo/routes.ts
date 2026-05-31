import { Router } from "@oak/oak";
import type { Logger } from "@/utils/logger/index.ts";
import { jwtMiddleware } from "@/http/middleware/auth/index.ts";
import { handlePostUtxos } from "@/http/v1/utxo/post.ts";
import { handleGetAvailable } from "@/http/v1/utxo/available.ts";

export function buildUtxoRouter(deps: { log: Logger }): Router {
  const utxoRouter = new Router();

  /** POST /utxo/receive — store pre-generated receive UTXOs (called at onboarding). */
  utxoRouter.post("/utxo/receive", jwtMiddleware(deps), handlePostUtxos(deps));

  /** GET /utxo/receive/:walletPublicKey/available — fetch available receive UTXOs for a merchant (used by POS). */
  utxoRouter.get(
    "/utxo/receive/:walletPublicKey/available",
    handleGetAvailable(deps),
  );

  return utxoRouter;
}
