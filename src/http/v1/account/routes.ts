import { Router } from "@oak/oak";
import { jwtMiddleware } from "@/http/middleware/auth/index.ts";
import { postAccountHandler } from "./post.ts";
import { getMeHandler, patchMeHandler } from "./me.ts";

const accountRouter = new Router();

accountRouter.post("/account", jwtMiddleware, postAccountHandler);
accountRouter.get("/account/me", jwtMiddleware, getMeHandler);
accountRouter.patch("/account/me", jwtMiddleware, patchMeHandler);

export default accountRouter;
