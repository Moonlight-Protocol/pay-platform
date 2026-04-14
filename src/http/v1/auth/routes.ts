import { Router } from "@oak/oak";
import { postChallengeHandler } from "./challenge.ts";
import { postVerifyHandler } from "./verify.ts";

const authRouter = new Router();


export default authRouter;
