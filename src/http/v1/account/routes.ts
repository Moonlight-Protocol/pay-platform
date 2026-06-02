import { Router } from "@oak/oak";
import type { Logger } from "@/utils/logger/index.ts";
import { jwtMiddleware } from "@/http/middleware/auth/index.ts";
import { handlePostAccount } from "./post.ts";
import { handleGetMe, handlePatchMe } from "./me.ts";
import { handleDeleteMe } from "./delete.ts";
import { handlePostOpex } from "./opex.ts";
import { handlePostDelegationKey } from "./delegation-key.ts";
import { handleGetPublic } from "./public.ts";

export function buildAccountRouter(deps: { log: Logger }): Router {
  const accountRouter = new Router();
  accountRouter.post("/account", jwtMiddleware(deps), handlePostAccount(deps));
  accountRouter.get("/account/me", jwtMiddleware(deps), handleGetMe(deps));
  accountRouter.patch("/account/me", jwtMiddleware(deps), handlePatchMe(deps));
  accountRouter.delete(
    "/account/me",
    jwtMiddleware(deps),
    handleDeleteMe(deps),
  );
  accountRouter.post(
    "/account/opex",
    jwtMiddleware(deps),
    handlePostOpex(deps),
  );
  accountRouter.post(
    "/account/delegation-key",
    jwtMiddleware(deps),
    handlePostDelegationKey(deps),
  );
  accountRouter.get(
    "/account/:walletPublicKey/public",
    handleGetPublic(deps),
  );
  return accountRouter;
}
