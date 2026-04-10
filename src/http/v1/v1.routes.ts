import { Router } from "@oak/oak";
import healthRouter from "@/http/v1/health/routes.ts";
import authRouter from "@/http/v1/auth/routes.ts";
import accountRouter from "@/http/v1/account/routes.ts";
import adminRouter from "@/http/v1/admin/routes.ts";
import utxoRouter from "@/http/v1/utxo/routes.ts";
import transactionRouter from "@/http/v1/transaction/routes.ts";

const apiRouter = new Router();

apiRouter.use("/api/v1", healthRouter.routes(), healthRouter.allowedMethods());
apiRouter.use("/api/v1", authRouter.routes(), authRouter.allowedMethods());
apiRouter.use("/api/v1", accountRouter.routes(), accountRouter.allowedMethods());
apiRouter.use("/api/v1", adminRouter.routes(), adminRouter.allowedMethods());
apiRouter.use("/api/v1", utxoRouter.routes(), utxoRouter.allowedMethods());
apiRouter.use("/api/v1", transactionRouter.routes(), transactionRouter.allowedMethods());

export default apiRouter;
