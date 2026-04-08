import { Router } from "@oak/oak";
import { lowRateLimitMiddleware } from "@/http/middleware/rate-limit/index.ts";
import { postChallengeHandler } from "./challenge.ts";
import { postVerifyHandler } from "./verify.ts";

const authRouter = new Router();

authRouter.post("/auth/challenge", lowRateLimitMiddleware, postChallengeHandler);
authRouter.post("/auth/verify", lowRateLimitMiddleware, postVerifyHandler);

export default authRouter;
