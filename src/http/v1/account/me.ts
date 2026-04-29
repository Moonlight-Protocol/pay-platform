import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PayAccountRepository } from "@/persistence/drizzle/repository/pay-account.repository.ts";
import { LOG } from "@/config/logger.ts";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";
import {
  validateDisplayName,
  validateEmail,
  validateJurisdiction,
} from "./helpers.ts";
import { formatAccount } from "./post.ts";

const accountRepo = new PayAccountRepository(drizzleClient);

/**
 * GET /api/v1/account/me
 *
 * Returns the authenticated wallet's pay account.
 * 404 if the wallet has not yet completed signup.
 */
export const getMeHandler = async (ctx: Context) => {
  try {
    const session = ctx.state.session as JwtSessionData;
    const account = await accountRepo.findByPublicKey(session.sub);
    if (!account) {
      ctx.response.status = Status.NotFound;
      ctx.response.body = { message: "Account not found" };
      return;
    }
    await accountRepo.updateLastSeen(session.sub);
    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Account retrieved",
      data: formatAccount(account),
    };
  } catch (error) {
    LOG.error("Failed to get account", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to retrieve account" };
  }
};

/**
 * PATCH /api/v1/account/me
 *
 * Updates one or more editable fields on the authenticated wallet's account.
 * Editable: email, jurisdictionCountryCode, displayName.
 * walletPublicKey is immutable.
 */
export const patchMeHandler = async (ctx: Context) => {
  try {
    const session = ctx.state.session as JwtSessionData;
    const walletPublicKey = session.sub;

    const existing = await accountRepo.findByPublicKey(walletPublicKey);
    if (!existing) {
      ctx.response.status = Status.NotFound;
      ctx.response.body = { message: "Account not found" };
      return;
    }

    const body = await ctx.request.body.json().catch(() => ({}));
    const updates: Record<string, unknown> = {};

    if (body.email !== undefined) {
      const err = validateEmail(body.email);
      if (err) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: err };
        return;
      }
      updates.email = (body.email as string).trim();
    }

    if (body.jurisdictionCountryCode !== undefined) {
      const err = validateJurisdiction(body.jurisdictionCountryCode);
      if (err) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: err };
        return;
      }
      updates.jurisdictionCountryCode = (body.jurisdictionCountryCode as string)
        .toUpperCase();
    }

    if (body.displayName !== undefined) {
      const err = validateDisplayName(body.displayName);
      if (err) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: err };
        return;
      }
      updates.displayName = body.displayName === null
        ? null
        : (body.displayName as string).trim();
    }

    if (Object.keys(updates).length === 0) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "No editable fields provided" };
      return;
    }

    const updated = await accountRepo.update(walletPublicKey, updates);
    if (!updated) {
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to update account" };
      return;
    }

    LOG.info("Pay account updated", {
      walletPublicKey,
      fields: Object.keys(updates),
    });

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Account updated",
      data: formatAccount(updated),
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Invalid request body" };
      return;
    }
    LOG.error("Failed to update account", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to update account" };
  }
};
