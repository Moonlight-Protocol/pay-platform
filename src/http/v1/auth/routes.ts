import { Router } from "@oak/oak";
import type { Logger } from "@/utils/logger/index.ts";
import { handlePostChallenge } from "./challenge.ts";
import { handlePostVerify } from "./verify.ts";

export function buildAuthRouter(deps: { log: Logger }): Router {
  const authRouter = new Router();
  authRouter.post("/auth/challenge", handlePostChallenge(deps));
  authRouter.post("/auth/verify", handlePostVerify(deps));
  return authRouter;
}
