import { Router } from "@oak/oak";
import { prepareInstantHandler } from "@/http/v1/pay/instant-prepare.ts";
import { submitInstantHandler } from "@/http/v1/pay/instant-submit.ts";
import { executeInstantHandler } from "@/http/v1/pay/instant-execute.ts";

const payRouter = new Router();

/**
 * POST /pay/instant/prepare — returns council config, merchant receive UTXOs,
 * OpEx address, and fee info so the frontend can build the payment.
 * Public endpoint — the customer isn't authenticated with pay-platform.
 */
payRouter.post("/pay/instant/prepare", prepareInstantHandler);

/**
 * POST /pay/instant/submit — receives the frontend-built MLXDR bundle
 * (used by the self-custodial flow). Pay-platform forwards to provider-platform.
 */
payRouter.post("/pay/instant/submit", submitInstantHandler);

/**
 * POST /pay/instant/execute — instant payment: customer paid to OpEx,
 * pay-platform verifies, deposits to channel, builds MLXDR, submits bundle.
 */
payRouter.post("/pay/instant/execute", executeInstantHandler);

export default payRouter;
