import { Router } from "@oak/oak";
import type { Logger } from "@/utils/logger/index.ts";
import { adminMiddleware } from "@/http/middleware/admin/index.ts";
import {
  handleCreateCouncil,
  handleCreateCouncilChannel,
  handleCreateCouncilPp,
  handleDeleteCouncil,
  handleDeleteCouncilChannel,
  handleDeleteCouncilPp,
  handleDiscoverCouncil,
  handleGetCouncil,
  handleListCouncilChannels,
  handleListCouncilPps,
  handleListCouncils,
  handleUpdateCouncil,
  handleUpdateCouncilPp,
} from "@/http/v1/admin/councils.ts";

export function buildAdminRouter(deps: { log: Logger }): Router {
  const adminRouter = new Router({ prefix: "/admin" });

  // All admin routes require JWT + wallet in ADMIN_WALLETS allowlist
  adminRouter.use(adminMiddleware(deps));

  // Councils
  adminRouter.post("/councils/discover", handleDiscoverCouncil(deps));
  adminRouter.get("/councils", handleListCouncils(deps));
  adminRouter.post("/councils", handleCreateCouncil(deps));
  adminRouter.get("/councils/:id", handleGetCouncil(deps));
  adminRouter.patch("/councils/:id", handleUpdateCouncil(deps));
  adminRouter.delete("/councils/:id", handleDeleteCouncil(deps));

  // Council Channels (nested under council)
  adminRouter.get(
    "/councils/:councilId/channels",
    handleListCouncilChannels(deps),
  );
  adminRouter.post(
    "/councils/:councilId/channels",
    handleCreateCouncilChannel(deps),
  );
  adminRouter.delete(
    "/councils/:councilId/channels/:channelId",
    handleDeleteCouncilChannel(deps),
  );

  // Council PPs (nested under council)
  adminRouter.get("/councils/:councilId/pps", handleListCouncilPps(deps));
  adminRouter.post("/councils/:councilId/pps", handleCreateCouncilPp(deps));
  adminRouter.patch(
    "/councils/:councilId/pps/:ppId",
    handleUpdateCouncilPp(deps),
  );
  adminRouter.delete(
    "/councils/:councilId/pps/:ppId",
    handleDeleteCouncilPp(deps),
  );

  return adminRouter;
}
