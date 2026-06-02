import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilRepository } from "@/persistence/drizzle/repository/council.repository.ts";
import { CouncilChannelRepository } from "@/persistence/drizzle/repository/council-channel.repository.ts";
import { CouncilPpRepository } from "@/persistence/drizzle/repository/council-pp.repository.ts";
import { PayAccountRepository } from "@/persistence/drizzle/repository/pay-account.repository.ts";
import { decryptSk } from "@/core/crypto/encrypt-sk.ts";
import { deriveUtxoPublicKey } from "@/core/crypto/utxo-derivation.ts";
import { getChannelClient } from "@/core/channel-client/index.ts";
import { findFreeUtxoIndexes } from "@/core/service/utxo/utxo-balance.ts";
import {
  SERVICE_AUTH_SECRET,
  STELLAR_NETWORK_PASSPHRASE,
} from "@/config/env.ts";
import type { Logger } from "@/utils/logger/index.ts";
import { withSpan } from "@/core/tracing.ts";

const councilRepo = new CouncilRepository(drizzleClient);
const channelRepo = new CouncilChannelRepository(drizzleClient);
const ppRepo = new CouncilPpRepository(drizzleClient);
const accountRepo = new PayAccountRepository(drizzleClient);

const MERCHANT_UTXO_DESTINATIONS = 5;

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

/**
 * POST /api/v1/pay/instant/prepare
 *
 * Body: { merchantWallet, amountXlm, customerWallet, assetCode?, payerJurisdiction? }
 *
 * Returns the council/channel config, a privacy provider URL, and the
 * merchant's next available receive UTXO public keys derived on demand
 * from the encrypted delegation key.
 */
export function handlePrepareInstant(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("prepareInstant");

  return (ctx) =>
    withSpan("P_PrepareInstant", async (span) => {
      log.info("prepareInstant");
      try {
        const body = await ctx.request.body.json().catch(() => ({}));
        const {
          merchantWallet,
          amountXlm,
          customerWallet,
          assetCode: requestedAsset,
          payerJurisdiction,
        } = body;

        if (!merchantWallet || !amountXlm || !customerWallet) {
          ctx.response.status = Status.BadRequest;
          ctx.response.body = {
            message:
              "merchantWallet, amountXlm, and customerWallet are required",
          };
          return;
        }

        span.setAttribute("merchant.public_key", merchantWallet);
        span.setAttribute("customer.public_key", customerWallet);

        const assetCode = requestedAsset || "XLM";
        span.setAttribute("asset.code", assetCode);

        const amount = parseFloat(amountXlm);
        if (isNaN(amount) || amount <= 0) {
          ctx.response.status = Status.BadRequest;
          ctx.response.body = {
            message: "amountXlm must be a positive number",
          };
          return;
        }

        const merchant = await accountRepo.findByPublicKey(merchantWallet);
        if (!merchant) {
          ctx.response.status = Status.NotFound;
          ctx.response.body = { message: "Merchant not found" };
          return;
        }
        if (!merchant.encryptedDelegationKey) {
          ctx.response.status = Status.ServiceUnavailable;
          ctx.response.body = {
            message: "Merchant has not finished onboarding",
          };
          return;
        }

        let councils;
        if (payerJurisdiction) {
          councils = await councilRepo.findByJurisdictionPair(
            payerJurisdiction,
            merchant.jurisdictionCountryCode,
          );
          if (councils.length === 0) {
            ctx.response.status = Status.UnprocessableEntity;
            ctx.response.body = {
              message:
                `No council available for ${payerJurisdiction} → ${merchant.jurisdictionCountryCode}`,
            };
            return;
          }
        } else {
          councils = await councilRepo.findByJurisdiction(
            merchant.jurisdictionCountryCode,
          );
          if (councils.length === 0) {
            ctx.response.status = Status.ServiceUnavailable;
            ctx.response.body = {
              message: "No council available for this merchant's jurisdiction",
            };
            return;
          }
        }

        let selectedCouncil = null;
        let selectedChannel = null;
        for (const c of councils) {
          const channel = await channelRepo.findByCouncilIdAndAsset(
            c.id,
            assetCode,
          );
          if (channel) {
            selectedCouncil = c;
            selectedChannel = channel;
            break;
          }
        }

        if (!selectedCouncil || !selectedChannel) {
          ctx.response.status = Status.ServiceUnavailable;
          ctx.response.body = {
            message:
              `No ${assetCode} channel available in any council for this jurisdiction`,
          };
          return;
        }
        span.setAttribute("council.id", selectedCouncil.id);
        span.setAttribute("channel.id", selectedChannel.id);

        const pps = await ppRepo.findActiveByCouncilId(selectedCouncil.id);
        if (pps.length === 0) {
          ctx.response.status = Status.ServiceUnavailable;
          ctx.response.body = {
            message: "No privacy provider available in the selected council",
          };
          return;
        }
        const pp = pps[Math.floor(Math.random() * pps.length)];
        span.setAttribute("pp.id", pp.id);

        const utxoRootBase64 = await decryptSk(
          merchant.encryptedDelegationKey,
          SERVICE_AUTH_SECRET,
        );
        const utxoRoot = Uint8Array.from(
          atob(utxoRootBase64),
          (c) => c.charCodeAt(0),
        );

        const channelClient = getChannelClient(
          selectedChannel.privacyChannelId,
          selectedCouncil.channelAuthId,
          selectedChannel.assetContractId,
        );

        const freeIndexes = await findFreeUtxoIndexes(
          channelClient,
          utxoRoot,
          MERCHANT_UTXO_DESTINATIONS,
          { log },
        );

        const merchantUtxos = await Promise.all(
          freeIndexes.map(async (index) => ({
            utxoPublicKey: bytesToBase64(
              await deriveUtxoPublicKey(utxoRoot, index),
            ),
            derivationIndex: index,
          })),
        );

        const amountStroops = BigInt(Math.round(amount * 1e7));
        span.setAttribute("amount.stroops", amountStroops.toString());

        log.event("instant payment prepared");

        ctx.response.body = {
          data: {
            council: {
              id: selectedCouncil.id,
              channelAuthId: selectedCouncil.channelAuthId,
              networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
            },
            channel: {
              id: selectedChannel.id,
              assetCode: selectedChannel.assetCode,
              assetContractId: selectedChannel.assetContractId,
              privacyChannelId: selectedChannel.privacyChannelId,
            },
            pp: {
              url: pp.url,
              publicKey: pp.publicKey,
            },
            opex: {
              publicKey: merchant.opexPublicKey ?? null,
              feePct: merchant.feePct ? Number(merchant.feePct) : null,
            },
            merchantUtxos,
            amountStroops: amountStroops.toString(),
          },
        };
      } catch (error) {
        log.error(error, "failed to prepare instant payment");
        ctx.response.status = Status.InternalServerError;
        ctx.response.body = { message: "Failed to prepare payment" };
      }
    });
}
