import { Router } from "@oak/oak";
import { jwtMiddleware } from "@/http/middleware/auth/index.ts";
import { postAccountHandler } from "./post.ts";
import { getMeHandler, patchMeHandler } from "./me.ts";
import { postOpexHandler } from "./opex.ts";

const accountRouter = new Router();

accountRouter.post("/account", jwtMiddleware, postAccountHandler);
accountRouter.get("/account/me", jwtMiddleware, getMeHandler);
accountRouter.patch("/account/me", jwtMiddleware, patchMeHandler);
accountRouter.post("/account/opex", jwtMiddleware, postOpexHandler);

export default accountRouter;
