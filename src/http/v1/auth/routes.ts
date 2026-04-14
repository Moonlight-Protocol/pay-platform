import { Router } from "@oak/oak";
import { postChallengeHandler } from "./challenge.ts";
import { postVerifyHandler } from "./verify.ts";

const authRouter = new Router();

authRouter.post("/auth/challenge", postChallengeHandler);
authRouter.post("/auth/verify", postVerifyHandler);

export default authRouter;
