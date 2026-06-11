import { Router } from "@oak/oak";
import type { Logger } from "@/utils/logger/index.ts";
import healthRouter from "@/http/v1/health/routes.ts";
import { buildWaitlistRouter } from "@/http/v1/waitlist/routes.ts";
import { buildAuthRouter } from "@/http/v1/auth/routes.ts";
import { buildAccountRouter } from "@/http/v1/account/routes.ts";
import { buildAdminRouter } from "@/http/v1/admin/routes.ts";
import { buildTransactionRouter } from "@/http/v1/transaction/routes.ts";
import { buildPayRouter } from "@/http/v1/pay/routes.ts";
import { buildRpcRouter } from "@/http/v1/rpc/routes.ts";

export function buildApiRouter(deps: { log: Logger }): Router {
  const apiRouter = new Router();

  const authRouter = buildAuthRouter(deps);
  const accountRouter = buildAccountRouter(deps);
  const adminRouter = buildAdminRouter(deps);
  const payRouter = buildPayRouter(deps);
  const transactionRouter = buildTransactionRouter(deps);
  const rpcRouter = buildRpcRouter(deps);
  const waitlistRouter = buildWaitlistRouter(deps);

  apiRouter.use(
    "/api/v1",
    healthRouter.routes(),
    healthRouter.allowedMethods(),
  );
  apiRouter.use("/api/v1", authRouter.routes(), authRouter.allowedMethods());
  apiRouter.use(
    "/api/v1",
    accountRouter.routes(),
    accountRouter.allowedMethods(),
  );
  apiRouter.use("/api/v1", adminRouter.routes(), adminRouter.allowedMethods());
  apiRouter.use(
    "/api/v1",
    transactionRouter.routes(),
    transactionRouter.allowedMethods(),
  );
  apiRouter.use("/api/v1", payRouter.routes(), payRouter.allowedMethods());
  apiRouter.use("/api/v1", rpcRouter.routes(), rpcRouter.allowedMethods());
  apiRouter.use(
    "/api/v1",
    waitlistRouter.routes(),
    waitlistRouter.allowedMethods(),
  );

  return apiRouter;
}
