import { Router } from "@oak/oak";
import type { Logger } from "@/utils/logger/index.ts";
import { handlePrepareInstant } from "@/http/v1/pay/instant-prepare.ts";
import { handleSubmitInstant } from "@/http/v1/pay/instant-submit.ts";
import { handleExecuteInstant } from "@/http/v1/pay/instant-execute.ts";

export function buildPayRouter(deps: { log: Logger }): Router {
  const payRouter = new Router();

  /**
   * POST /pay/instant/prepare — returns council config, merchant receive UTXOs,
   * OpEx address, and fee info so the frontend can build the payment.
   * Public endpoint — the customer isn't authenticated with pay-platform.
   */
  payRouter.post("/pay/instant/prepare", handlePrepareInstant(deps));

  /**
   * POST /pay/instant/submit — receives a frontend-built MLXDR bundle
   * and forwards it to provider-platform.
   */
  payRouter.post("/pay/instant/submit", handleSubmitInstant(deps));

  /**
   * POST /pay/instant/execute — instant payment: customer paid to OpEx,
   * pay-platform verifies, deposits to channel, builds MLXDR, submits bundle.
   */
  payRouter.post("/pay/instant/execute", handleExecuteInstant(deps));

  return payRouter;
}
