import { Router } from "@oak/oak";
import { jwtMiddleware } from "@/http/middleware/auth/index.ts";
import { getBalanceHandler } from "@/http/v1/transaction/balance.ts";
import { listTransactionsHandler } from "@/http/v1/transaction/list.ts";

const transactionRouter = new Router();

/** GET /transactions/balance — user's balance (sum of completed IN - OUT). */
transactionRouter.get("/transactions/balance", jwtMiddleware, getBalanceHandler);

/** GET /transactions — user's transaction history (with direction filter). */
transactionRouter.get("/transactions", jwtMiddleware, listTransactionsHandler);

export default transactionRouter;
