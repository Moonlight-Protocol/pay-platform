import { Router } from "@oak/oak";
import { prepareInstantHandler } from "@/http/v1/pay/instant-prepare.ts";
import { submitInstantHandler } from "@/http/v1/pay/instant-submit.ts";

const payRouter = new Router();

/**
 * POST /pay/instant/prepare — returns council config, merchant receive UTXOs,
 * and current ledger info so the frontend can build the deposit operation.
 * Public endpoint — the customer isn't authenticated with pay-platform.
 */
payRouter.post("/pay/instant/prepare", prepareInstantHandler);

/**
 * POST /pay/instant/submit — receives the signed deposit MLXDR from the
 * frontend. pay-platform builds the remaining operations (temp CREATE,
 * SPEND, merchant CREATE), assembles the full bundle, and submits to
 * provider-platform.
 */
payRouter.post("/pay/instant/submit", submitInstantHandler);

export default payRouter;
