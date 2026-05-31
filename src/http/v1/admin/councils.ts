import { type Context, type RouterContext, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilRepository } from "@/persistence/drizzle/repository/council.repository.ts";
import { CouncilChannelRepository } from "@/persistence/drizzle/repository/council-channel.repository.ts";
import { CouncilJurisdictionRepository } from "@/persistence/drizzle/repository/council-jurisdiction.repository.ts";
import { CouncilPpRepository } from "@/persistence/drizzle/repository/council-pp.repository.ts";
import type { Logger } from "@/utils/logger/index.ts";

const councilRepo = new CouncilRepository(drizzleClient);
const channelRepo = new CouncilChannelRepository(drizzleClient);
const jurisdictionRepo = new CouncilJurisdictionRepository(drizzleClient);
const ppRepo = new CouncilPpRepository(drizzleClient);

// ─── Councils ───────────────────────────────────────────────

export function handleListCouncils(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("listCouncils");

  return async (ctx) => {
    log.info("listCouncils");
    const councils = await councilRepo.findAll();
    ctx.response.body = { data: councils };
  };
}

export function handleGetCouncil(
  deps: { log: Logger },
): (ctx: RouterContext<string>) => Promise<void> {
  const log = deps.log.scope("getCouncil");

  return async (ctx) => {
    log.info("getCouncil");
    const id = ctx.params.id;
    log.debug("id", id);
    const row = await councilRepo.findById(id);
    if (!row) {
      ctx.response.status = Status.NotFound;
      ctx.response.body = { message: "Council not found" };
      return;
    }
    const [channels, jurisdictions, pps] = await Promise.all([
      channelRepo.findByCouncilId(id),
      jurisdictionRepo.findByCouncilId(id),
      ppRepo.findByCouncilId(id),
    ]);
    ctx.response.body = {
      data: {
        ...row,
        channels,
        jurisdictions: jurisdictions.map((j) => j.countryCode),
        pps,
      },
    };
  };
}

export function handleCreateCouncil(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("createCouncil");

  return async (ctx) => {
    log.info("createCouncil");
    try {
      const body = await ctx.request.body.json();
      const { name, channelAuthId, channels, jurisdictions, active } = body;

      if (!name || !channelAuthId) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "name and channelAuthId are required" };
        return;
      }

      const row = await councilRepo.create({
        name,
        channelAuthId,
        active: active ?? true,
      });

      // Create channels if provided
      if (Array.isArray(channels) && channels.length > 0) {
        for (const ch of channels) {
          if (!ch.assetCode || !ch.assetContractId || !ch.privacyChannelId) {
            continue;
          }
          await channelRepo.create({
            councilId: row.id,
            assetCode: ch.assetCode,
            assetContractId: ch.assetContractId,
            privacyChannelId: ch.privacyChannelId,
            active: ch.active ?? true,
          });
        }
      }

      // Create jurisdictions if provided
      if (Array.isArray(jurisdictions) && jurisdictions.length > 0) {
        await jurisdictionRepo.bulkCreate(
          jurisdictions
            .filter((code: unknown) =>
              typeof code === "string" && code.length > 0
            )
            .map((code: string) => ({
              councilId: row.id,
              countryCode: code.trim(),
            })),
        );
      }

      // Create privacy providers if discovered from council-platform
      const providers: unknown[] = Array.isArray(body.providers)
        ? body.providers
        : [];
      for (const pp of providers) {
        const p = pp as Record<string, unknown>;
        if (!p.publicKey || !p.providerUrl) continue;
        await ppRepo.create({
          councilId: row.id,
          name: (typeof p.label === "string" && p.label) ||
            String(p.publicKey).substring(0, 8),
          url: String(p.providerUrl),
          publicKey: String(p.publicKey),
          active: true,
        });
      }

      log.debug("id", row.id);
      log.debug("name", name);
      log.event("council created");
      ctx.response.status = Status.Created;
      ctx.response.body = { data: row };
    } catch (error) {
      log.error(error, "failed to create council");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to create council" };
    }
  };
}

export function handleUpdateCouncil(
  deps: { log: Logger },
): (ctx: RouterContext<string>) => Promise<void> {
  const log = deps.log.scope("updateCouncil");

  return async (ctx) => {
    log.info("updateCouncil");
    const id = ctx.params.id;
    log.debug("id", id);
    try {
      const body = await ctx.request.body.json();
      const { channels: _channels, jurisdictions, ...councilFields } = body;

      const row = await councilRepo.update(id, councilFields);
      if (!row) {
        ctx.response.status = Status.NotFound;
        ctx.response.body = { message: "Council not found" };
        return;
      }

      // Replace jurisdictions if provided
      if (Array.isArray(jurisdictions)) {
        await jurisdictionRepo.removeByCouncilId(id);
        if (jurisdictions.length > 0) {
          await jurisdictionRepo.bulkCreate(
            jurisdictions
              .filter((code: unknown) =>
                typeof code === "string" && code.length > 0
              )
              .map((code: string) => ({
                councilId: id,
                countryCode: code.trim(),
              })),
          );
        }
      }

      ctx.response.body = { data: row };
    } catch (error) {
      log.error(error, "failed to update council");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to update council" };
    }
  };
}

export function handleDeleteCouncil(
  deps: { log: Logger },
): (ctx: RouterContext<string>) => Promise<void> {
  const log = deps.log.scope("deleteCouncil");

  return async (ctx) => {
    log.info("deleteCouncil");
    const id = ctx.params.id;
    log.debug("id", id);
    const deleted = await councilRepo.remove(id);
    if (!deleted) {
      ctx.response.status = Status.NotFound;
      ctx.response.body = { message: "Council not found" };
      return;
    }
    ctx.response.status = Status.NoContent;
  };
}

/**
 * POST /admin/councils/discover
 * Proxy: fetches council info from a council-platform URL server-side.
 */
export function handleDiscoverCouncil(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("discoverCouncil");

  return async (ctx) => {
    log.info("discoverCouncil");
    try {
      const body = await ctx.request.body.json();
      const { councilUrl } = body;

      if (!councilUrl || typeof councilUrl !== "string") {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "councilUrl is required" };
        return;
      }

      let parsed: URL;
      try {
        parsed = new URL(councilUrl);
      } catch {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "Invalid URL" };
        return;
      }

      let councilId = parsed.searchParams.get("council");
      if (!councilId) {
        const hashMatch = councilUrl.match(/[#?&]council=([A-Z0-9]+)/);
        if (hashMatch) councilId = hashMatch[1];
      }

      const baseUrl = `${parsed.origin}`;
      const qs = councilId ? `?councilId=${encodeURIComponent(councilId)}` : "";

      const res = await fetch(`${baseUrl}/api/v1/public/council${qs}`);
      if (!res.ok) {
        ctx.response.status = res.status;
        ctx.response.body = {
          message: `Council platform returned ${res.status}`,
        };
        return;
      }

      const data = await res.json();
      ctx.response.body = data;
    } catch (error) {
      log.error(error, "failed to discover council");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to discover council" };
    }
  };
}

// ─── Council Channels ──────────────────────────────────────

export function handleListCouncilChannels(
  deps: { log: Logger },
): (ctx: RouterContext<string>) => Promise<void> {
  const log = deps.log.scope("listCouncilChannels");

  return async (ctx) => {
    log.info("listCouncilChannels");
    const councilId = ctx.params.councilId;
    const existing = await councilRepo.findById(councilId);
    if (!existing) {
      ctx.response.status = Status.NotFound;
      ctx.response.body = { message: "Council not found" };
      return;
    }
    const channels = await channelRepo.findByCouncilId(councilId);
    ctx.response.body = { data: channels };
  };
}

export function handleCreateCouncilChannel(
  deps: { log: Logger },
): (ctx: RouterContext<string>) => Promise<void> {
  const log = deps.log.scope("createCouncilChannel");

  return async (ctx) => {
    log.info("createCouncilChannel");
    const councilId = ctx.params.councilId;
    try {
      const existing = await councilRepo.findById(councilId);
      if (!existing) {
        ctx.response.status = Status.NotFound;
        ctx.response.body = { message: "Council not found" };
        return;
      }

      const body = await ctx.request.body.json();
      const { assetCode, assetContractId, privacyChannelId, active } = body;

      if (!assetCode || !assetContractId || !privacyChannelId) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = {
          message:
            "assetCode, assetContractId, and privacyChannelId are required",
        };
        return;
      }

      const row = await channelRepo.create({
        councilId,
        assetCode,
        assetContractId,
        privacyChannelId,
        active: active ?? true,
      });
      log.debug("id", row.id);
      log.debug("councilId", councilId);
      log.debug("assetCode", assetCode);
      log.event("council channel created");
      ctx.response.status = Status.Created;
      ctx.response.body = { data: row };
    } catch (error) {
      log.error(error, "failed to create council channel");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to create channel" };
    }
  };
}

export function handleDeleteCouncilChannel(
  deps: { log: Logger },
): (ctx: RouterContext<string>) => Promise<void> {
  const log = deps.log.scope("deleteCouncilChannel");

  return async (ctx) => {
    log.info("deleteCouncilChannel");
    const id = ctx.params.channelId;
    const deleted = await channelRepo.remove(id);
    if (!deleted) {
      ctx.response.status = Status.NotFound;
      ctx.response.body = { message: "Channel not found" };
      return;
    }
    ctx.response.status = Status.NoContent;
  };
}

// ─── Council PPs ────────────────────────────────────────────

export function handleListCouncilPps(
  deps: { log: Logger },
): (ctx: RouterContext<string>) => Promise<void> {
  const log = deps.log.scope("listCouncilPps");

  return async (ctx) => {
    log.info("listCouncilPps");
    const councilId = ctx.params.councilId;
    const existing = await councilRepo.findById(councilId);
    if (!existing) {
      ctx.response.status = Status.NotFound;
      ctx.response.body = { message: "Council not found" };
      return;
    }
    const pps = await ppRepo.findByCouncilId(councilId);
    ctx.response.body = { data: pps };
  };
}

export function handleCreateCouncilPp(
  deps: { log: Logger },
): (ctx: RouterContext<string>) => Promise<void> {
  const log = deps.log.scope("createCouncilPp");

  return async (ctx) => {
    log.info("createCouncilPp");
    const councilId = ctx.params.councilId;
    try {
      const existing = await councilRepo.findById(councilId);
      if (!existing) {
        ctx.response.status = Status.NotFound;
        ctx.response.body = { message: "Council not found" };
        return;
      }

      const body = await ctx.request.body.json();
      const { name, url, publicKey, active } = body;

      if (!name || !url || !publicKey) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = {
          message: "name, url, and publicKey are required",
        };
        return;
      }

      const row = await ppRepo.create({
        councilId,
        name,
        url,
        publicKey,
        active: active ?? true,
      });
      log.debug("id", row.id);
      log.debug("councilId", councilId);
      log.debug("name", name);
      log.event("council PP created");
      ctx.response.status = Status.Created;
      ctx.response.body = { data: row };
    } catch (error) {
      log.error(error, "failed to create council PP");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to create PP" };
    }
  };
}

export function handleUpdateCouncilPp(
  deps: { log: Logger },
): (ctx: RouterContext<string>) => Promise<void> {
  const log = deps.log.scope("updateCouncilPp");

  return async (ctx) => {
    log.info("updateCouncilPp");
    const id = ctx.params.ppId;
    try {
      const body = await ctx.request.body.json();
      const row = await ppRepo.update(id, body);
      if (!row) {
        ctx.response.status = Status.NotFound;
        ctx.response.body = { message: "PP not found" };
        return;
      }
      ctx.response.body = { data: row };
    } catch (error) {
      log.error(error, "failed to update PP");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to update PP" };
    }
  };
}

export function handleDeleteCouncilPp(
  deps: { log: Logger },
): (ctx: RouterContext<string>) => Promise<void> {
  const log = deps.log.scope("deleteCouncilPp");

  return async (ctx) => {
    log.info("deleteCouncilPp");
    const id = ctx.params.ppId;
    const deleted = await ppRepo.remove(id);
    if (!deleted) {
      ctx.response.status = Status.NotFound;
      ctx.response.body = { message: "PP not found" };
      return;
    }
    ctx.response.status = Status.NoContent;
  };
}
