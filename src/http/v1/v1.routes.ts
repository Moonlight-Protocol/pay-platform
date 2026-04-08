import { Router } from "@oak/oak";
import healthRouter from "@/http/v1/health/routes.ts";
import authRouter from "@/http/v1/auth/routes.ts";
import accountRouter from "@/http/v1/account/routes.ts";

const apiRouter = new Router();

apiRouter.use("/api/v1", healthRouter.routes(), healthRouter.allowedMethods());
apiRouter.use("/api/v1", authRouter.routes(), authRouter.allowedMethods());
apiRouter.use("/api/v1", accountRouter.routes(), accountRouter.allowedMethods());

export default apiRouter;
