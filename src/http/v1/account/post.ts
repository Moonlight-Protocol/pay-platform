import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PayAccountRepository } from "@/persistence/drizzle/repository/pay-account.repository.ts";
import { LOG } from "@/config/logger.ts";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";
import {
  validateEmail,
  validateJurisdiction,
  validateDisplayName,
} from "./helpers.ts";

const accountRepo = new PayAccountRepository(drizzleClient);

/**
 * POST /api/v1/account
 *
 * Creates a Moonlight Pay account for the authenticated wallet.
 * Idempotent: if the account already exists, returns the existing one
 * (200 OK with existing data) instead of erroring.
 *
 * Body: { email, jurisdictionCountryCode, displayName? }
 */
export const postAccountHandler = async (ctx: Context) => {
  try {
    const session = ctx.state.session as JwtSessionData;
    const walletPublicKey = session.sub;

    const body = await ctx.request.body.json().catch(() => ({}));
    const { email, jurisdictionCountryCode, displayName } = body;

    const emailErr = validateEmail(email);
    if (emailErr) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: emailErr };
      return;
    }
    const jurisdictionErr = validateJurisdiction(jurisdictionCountryCode);
    if (jurisdictionErr) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: jurisdictionErr };
      return;
    }
    const displayNameErr = validateDisplayName(displayName);
    if (displayNameErr) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: displayNameErr };
      return;
    }

    // Idempotent: if the account exists, return it.
    const existing = await accountRepo.findByPublicKey(walletPublicKey);
    if (existing) {
      await accountRepo.updateLastSeen(walletPublicKey);
      ctx.response.status = Status.OK;
      ctx.response.body = {
        message: "Account already exists",
        data: formatAccount(existing),
      };
      return;
    }

    const now = new Date();
    const created = await accountRepo.create({
      walletPublicKey,
      email: (email as string).trim(),
      jurisdictionCountryCode: (jurisdictionCountryCode as string).toUpperCase(),
      displayName: typeof displayName === "string" ? displayName.trim() : null,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });

    LOG.info("Pay account created", { walletPublicKey });

    ctx.response.status = Status.Created;
    ctx.response.body = {
      message: "Account created",
      data: formatAccount(created),
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Invalid request body" };
      return;
    }
    LOG.error("Failed to create account", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to create account" };
  }
};

function formatAccount(row: {
  walletPublicKey: string;
  email: string;
  jurisdictionCountryCode: string;
  displayName: string | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    walletPublicKey: row.walletPublicKey,
    email: row.email,
    jurisdictionCountryCode: row.jurisdictionCountryCode,
    displayName: row.displayName,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export { formatAccount };
