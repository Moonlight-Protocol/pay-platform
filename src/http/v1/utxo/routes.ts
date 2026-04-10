import { Router } from "@oak/oak";
import { jwtMiddleware } from "@/http/middleware/auth/index.ts";
import { postUtxosHandler } from "@/http/v1/utxo/post.ts";
import { getAvailableHandler } from "@/http/v1/utxo/available.ts";

const utxoRouter = new Router();

/** POST /utxo/receive — store pre-generated receive UTXOs (called at onboarding). */
utxoRouter.post("/utxo/receive", jwtMiddleware, postUtxosHandler);

/** GET /utxo/receive/:walletPublicKey/available — fetch available receive UTXOs for a merchant (used by POS). */
utxoRouter.get("/utxo/receive/:walletPublicKey/available", getAvailableHandler);

export default utxoRouter;
