import { Router } from "@oak/oak";
import type { Logger } from "@/utils/logger/index.ts";
import { jwtMiddleware } from "@/http/middleware/auth/index.ts";
import { handleGetBalance } from "@/http/v1/transaction/balance.ts";
import { handleListTransactions } from "@/http/v1/transaction/list.ts";

export function buildTransactionRouter(deps: { log: Logger }): Router {
  const transactionRouter = new Router();
  transactionRouter.get(
    "/transactions/balance",
    jwtMiddleware(deps),
    handleGetBalance(deps),
  );
  transactionRouter.get(
    "/transactions",
    jwtMiddleware(deps),
    handleListTransactions(deps),
  );
  return transactionRouter;
}
