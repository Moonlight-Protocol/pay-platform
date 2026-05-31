import { Application } from "@oak/oak";

import { buildApiRouter } from "@/http/v1/v1.routes.ts";
import { appendRequestIdMiddleware } from "@/http/middleware/append-request-id.ts";
import { appendResponseHeadersMiddleware } from "@/http/middleware/append-response-headers.ts";
import { corsMiddleware } from "@/http/middleware/cors.ts";
import { traceContextMiddleware } from "@/http/middleware/trace-context.ts";
import { MODE, PORT, SERVICE_AUTH_SECRET } from "@/config/env.ts";
import { createLogger } from "@/config/logger.ts";

async function bootstrap() {
  const rootLog = createLogger();
  const log = rootLog.scope("bootstrap");
  log.info("bootstrap");

  // Dev-mode notice: SERVICE_AUTH_SECRET unset means a random secret is in
  // use and JWTs reset on restart. Production already throws (env.ts).
  if (
    MODE !== "production" &&
    (!SERVICE_AUTH_SECRET || SERVICE_AUTH_SECRET.trim().length === 0)
  ) {
    log.event(
      "SERVICE_AUTH_SECRET unset — using random secret (dev only, JWTs reset on restart)",
    );
  }

  const deps = { log: rootLog };

  try {
    const app = new Application();

    app.use(corsMiddleware);
    app.use(traceContextMiddleware);
    app.use(appendRequestIdMiddleware(deps));
    app.use(appendResponseHeadersMiddleware);
    const apiV1 = buildApiRouter(deps);
    app.use(apiV1.routes());
    app.use(apiV1.allowedMethods());

    log.debug("port", PORT);
    log.event(`Pay Platform running on http://localhost:${PORT}`);

    const shutdown = () => {
      log.event("shutting down server");
      Deno.exit(0);
    };

    Deno.addSignalListener("SIGINT", shutdown);
    Deno.addSignalListener("SIGTERM", shutdown);

    await app.listen({ port: Number(PORT) });
  } catch (error) {
    log.error(error, "failed to start server");
    Deno.exit(1);
  }
}

bootstrap();
