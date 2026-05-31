import type { Context } from "@oak/oak";
import {
  jwtMiddleware,
  type JwtSessionData,
} from "@/http/middleware/auth/index.ts";
import type { Logger } from "@/utils/logger/index.ts";
import { loadOptionalEnv } from "@/utils/env/loadEnv.ts";
import { MODE } from "@/config/env.ts";

/**
 * Admin allowlist: wallet public keys that are allowed to access /admin routes.
 *
 * For now this is stored in the ADMIN_WALLETS env var as a comma-separated
 * list of Stellar G-addresses. The user updates DB records manually until
 * a proper ACL is needed (if ever).
 *
 * Example: ADMIN_WALLETS=GABC...,GDEF...
 */
function getAdminWallets(): Set<string> {
  const raw = loadOptionalEnv("ADMIN_WALLETS") ?? "";
  const wallets = new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
  return wallets;
}

/**
 * Middleware that enforces admin access: valid JWT + wallet in the allowlist.
 * Runs jwtMiddleware first to verify the token, then checks the subject
 * against the allowlist.
 */
export function adminMiddleware(
  deps: { log: Logger },
): (ctx: Context, next: () => Promise<unknown>) => Promise<void> {
  const log = deps.log.scope("adminMiddleware");

  return async (ctx, next) => {
    // First verify the JWT is valid
    await jwtMiddleware(deps)(ctx, async () => {
      // JWT verified — check if the wallet is in the admin allowlist
      const session = ctx.state.session as JwtSessionData;
      const adminWallets = getAdminWallets();

      if (adminWallets.size === 0) {
        log.error(
          new Error("ADMIN_WALLETS empty"),
          "admin access attempted but ADMIN_WALLETS is empty",
        );
        ctx.response.status = 403;
        ctx.response.body = { message: "Admin access not configured" };
        return;
      }

      // In development mode, skip the allowlist check
      if (MODE === "development") {
        await next();
        return;
      }

      if (!adminWallets.has(session.sub)) {
        log.debug("wallet", session.sub);
        log.error(new Error("not in allowlist"), "admin access denied");
        ctx.response.status = 403;
        ctx.response.body = { message: "Forbidden" };
        return;
      }

      await next();
    });
  };
}
