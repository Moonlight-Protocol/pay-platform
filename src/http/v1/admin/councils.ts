import { type Context, type RouterContext, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilRepository } from "@/persistence/drizzle/repository/council.repository.ts";
import { CouncilPpRepository } from "@/persistence/drizzle/repository/council-pp.repository.ts";
import { LOG } from "@/config/logger.ts";

const councilRepo = new CouncilRepository(drizzleClient);
const ppRepo = new CouncilPpRepository(drizzleClient);

// ─── Councils ───────────────────────────────────────────────

export const listCouncils = async (ctx: Context) => {
  const councils = await councilRepo.findAll();
  ctx.response.body = { data: councils };
};

export const getCouncil = async (ctx: RouterContext<string>) => {
  const id = ctx.params.id;
  const row = await councilRepo.findById(id);
  if (!row) {
    ctx.response.status = Status.NotFound;
    ctx.response.body = { message: "Council not found" };
    return;
  }
  const pps = await ppRepo.findByCouncilId(id);
  ctx.response.body = { data: { ...row, pps } };
};

export const createCouncil = async (ctx: Context) => {
  try {
    const body = await ctx.request.body.json();
    const { name, channelAuthId, privacyChannelId, assetId, networkPassphrase, jurisdictionCodes, active } = body;

    if (!name || !channelAuthId || !privacyChannelId || !assetId || !networkPassphrase || !jurisdictionCodes) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "name, channelAuthId, privacyChannelId, assetId, networkPassphrase, and jurisdictionCodes are required" };
      return;
    }

    const row = await councilRepo.create({
      name,
      channelAuthId,
      privacyChannelId,
      assetId,
      networkPassphrase,
      jurisdictionCodes,
      active: active ?? true,
    });
    LOG.info("Council created", { id: row.id, name });
    ctx.response.status = Status.Created;
    ctx.response.body = { data: row };
  } catch (error) {
    LOG.error("Failed to create council", { error: error instanceof Error ? error.message : String(error) });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to create council" };
  }
};

export const updateCouncil = async (ctx: RouterContext<string>) => {
  const id = ctx.params.id;
  try {
    const body = await ctx.request.body.json();
    const row = await councilRepo.update(id, body);
    if (!row) {
      ctx.response.status = Status.NotFound;
      ctx.response.body = { message: "Council not found" };
      return;
    }
    ctx.response.body = { data: row };
  } catch (error) {
    LOG.error("Failed to update council", { error: error instanceof Error ? error.message : String(error) });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to update council" };
  }
};

export const deleteCouncil = async (ctx: RouterContext<string>) => {
  const id = ctx.params.id;
  const deleted = await councilRepo.remove(id);
  if (!deleted) {
    ctx.response.status = Status.NotFound;
    ctx.response.body = { message: "Council not found" };
    return;
  }
  ctx.response.status = Status.NoContent;
};

// ─── Council PPs ────────────────────────────────────────────

export const listCouncilPps = async (ctx: RouterContext<string>) => {
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

export const createCouncilPp = async (ctx: RouterContext<string>) => {
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
      ctx.response.body = { message: "name, url, and publicKey are required" };
      return;
    }

    const row = await ppRepo.create({
      councilId,
      name,
      url,
      publicKey,
      active: active ?? true,
    });
    LOG.info("Council PP created", { id: row.id, councilId, name });
    ctx.response.status = Status.Created;
    ctx.response.body = { data: row };
  } catch (error) {
    LOG.error("Failed to create council PP", { error: error instanceof Error ? error.message : String(error) });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to create PP" };
  }
};

export const updateCouncilPp = async (ctx: RouterContext<string>) => {
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
    LOG.error("Failed to update PP", { error: error instanceof Error ? error.message : String(error) });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to update PP" };
  }
};

export const deleteCouncilPp = async (ctx: RouterContext<string>) => {
  const id = ctx.params.ppId;
  const deleted = await ppRepo.remove(id);
  if (!deleted) {
    ctx.response.status = Status.NotFound;
    ctx.response.body = { message: "PP not found" };
    return;
  }
  ctx.response.status = Status.NoContent;
};
