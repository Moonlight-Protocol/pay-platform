import { Router } from "@oak/oak";
import { adminMiddleware } from "@/http/middleware/admin/index.ts";
import {
  createCouncil,
  createCouncilChannel,
  createCouncilPp,
  deleteCouncil,
  deleteCouncilChannel,
  deleteCouncilPp,
  discoverCouncil,
  getCouncil,
  listCouncilChannels,
  listCouncilPps,
  listCouncils,
  updateCouncil,
  updateCouncilPp,
} from "@/http/v1/admin/councils.ts";

const adminRouter = new Router({ prefix: "/admin" });

// All admin routes require JWT + wallet in ADMIN_WALLETS allowlist
adminRouter.use(adminMiddleware);

// Councils
adminRouter.post("/councils/discover", discoverCouncil);
adminRouter.get("/councils", listCouncils);
adminRouter.post("/councils", createCouncil);
adminRouter.get("/councils/:id", getCouncil);
adminRouter.patch("/councils/:id", updateCouncil);
adminRouter.delete("/councils/:id", deleteCouncil);

// Council Channels (nested under council)
adminRouter.get("/councils/:councilId/channels", listCouncilChannels);
adminRouter.post("/councils/:councilId/channels", createCouncilChannel);
adminRouter.delete("/councils/:councilId/channels/:channelId", deleteCouncilChannel);

// Council PPs (nested under council)
adminRouter.get("/councils/:councilId/pps", listCouncilPps);
adminRouter.post("/councils/:councilId/pps", createCouncilPp);
adminRouter.patch("/councils/:councilId/pps/:ppId", updateCouncilPp);
adminRouter.delete("/councils/:councilId/pps/:ppId", deleteCouncilPp);

export default adminRouter;
