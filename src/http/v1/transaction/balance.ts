import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { PayAccountRepository } from "@/persistence/drizzle/repository/pay-account.repository.ts";
import { CouncilRepository } from "@/persistence/drizzle/repository/council.repository.ts";
import { CouncilChannelRepository } from "@/persistence/drizzle/repository/council-channel.repository.ts";
import { decryptSk } from "@/core/crypto/encrypt-sk.ts";
import { SERVICE_AUTH_SECRET } from "@/config/env.ts";
import { getChannelClient } from "@/core/channel-client/index.ts";
import { walkFundedBalances } from "@/core/service/utxo/utxo-balance.ts";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";
import type { Logger } from "@/utils/logger/index.ts";

const accountRepo = new PayAccountRepository(drizzleClient);
const councilRepo = new CouncilRepository(drizzleClient);
const channelRepo = new CouncilChannelRepository(drizzleClient);

const DEFAULT_ASSET_CODE = "XLM";

/**
 * GET /api/v1/transactions/balance
 *
 * Returns the authenticated user's on-chain balance for their jurisdiction's
 * XLM channel — the sum of every UTXO funded under the user's delegation
 * key. The walk terminates after 3 consecutive free (-1) indexes per
 * core/service/utxo/utxo-balance.ts.
 *
 * Returns 0 when:
 *   - the user has not yet handed over a delegation key, or
 *   - no council/XLM channel covers their jurisdiction.
 */
export function handleGetBalance(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("getBalance");

  return async (ctx) => {
    log.info("getBalance");
    try {
      const session = ctx.state.session as JwtSessionData;
      const account = await accountRepo.findByPublicKey(session.sub);
      if (!account) {
        ctx.response.status = Status.NotFound;
        ctx.response.body = { message: "Account not found" };
        return;
      }
      if (!account.encryptedDelegationKey) {
        ctx.response.body = {
          data: { balanceStroops: "0", balanceXlm: "0.0000000" },
        };
        return;
      }

      const councils = await councilRepo.findByJurisdiction(
        account.jurisdictionCountryCode,
      );
      let selectedCouncil = null;
      let selectedChannel = null;
      for (const c of councils) {
        const ch = await channelRepo.findByCouncilIdAndAsset(
          c.id,
          DEFAULT_ASSET_CODE,
        );
        if (ch) {
          selectedCouncil = c;
          selectedChannel = ch;
          break;
        }
      }
      if (!selectedCouncil || !selectedChannel) {
        ctx.response.body = {
          data: { balanceStroops: "0", balanceXlm: "0.0000000" },
        };
        return;
      }

      const utxoRootBase64 = await decryptSk(
        account.encryptedDelegationKey,
        SERVICE_AUTH_SECRET,
      );
      const utxoRoot = Uint8Array.from(
        atob(utxoRootBase64),
        (ch) => ch.charCodeAt(0),
      );

      const channelClient = getChannelClient(
        selectedChannel.privacyChannelId,
        selectedCouncil.channelAuthId,
        selectedChannel.assetContractId,
      );
      const { totalStroops } = await walkFundedBalances(
        channelClient,
        utxoRoot,
        { log },
      );

      ctx.response.body = {
        data: {
          balanceStroops: totalStroops.toString(),
          balanceXlm: (Number(totalStroops) / 1e7).toFixed(7),
        },
      };
      log.event("balance response assembled");
    } catch (error) {
      log.error(error, "get balance failed");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to get balance" };
    }
  };
}
