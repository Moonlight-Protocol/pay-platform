import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilRepository } from "@/persistence/drizzle/repository/council.repository.ts";
import { CouncilChannelRepository } from "@/persistence/drizzle/repository/council-channel.repository.ts";
import { CouncilPpRepository } from "@/persistence/drizzle/repository/council-pp.repository.ts";
import { TransactionRepository } from "@/persistence/drizzle/repository/transaction.repository.ts";
import { PayAccountRepository } from "@/persistence/drizzle/repository/pay-account.repository.ts";
import { getProviderJwt } from "@/core/service/provider-auth.ts";
import type { Logger } from "@/utils/logger/index.ts";
import { SpanStatusCode, withSpan } from "@/core/tracing.ts";
import { PlatformError } from "@/error/index.ts";
import { PIPE_APIError } from "@/http/pipelines/error-pipeline.ts";
import { providerBundleRejected } from "@/http/v1/pay/pay.errors.ts";

const councilRepo = new CouncilRepository(drizzleClient);
const channelRepo = new CouncilChannelRepository(drizzleClient);
const ppRepo = new CouncilPpRepository(drizzleClient);
const txRepo = new TransactionRepository(drizzleClient);
const accountRepo = new PayAccountRepository(drizzleClient);

/**
 * POST /api/v1/pay/instant/submit
 *
 * Self-custodial flow: the customer has built the full MLXDR bundle locally
 * using the merchant's UTXO public keys returned by /instant/prepare.
 * pay-platform forwards the bundle to provider-platform after looking up
 * the council/channel/PP for the merchant's jurisdiction.
 *
 * Body: {
 *   customerWallet,
 *   merchantWallet,
 *   amountStroops,
 *   assetCode,
 *   description?,
 *   operationsMLXDR,
 * }
 */
export function handleSubmitInstant(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("submitInstant");

  return (ctx) =>
    withSpan("P_SubmitInstant", async (span) => {
      log.info("submitInstant");
      try {
        const body = await ctx.request.body.json().catch(() => ({}));
        const {
          customerWallet,
          merchantWallet,
          amountStroops: amountStr,
          assetCode: requestedAsset,
          description,
          operationsMLXDR,
        } = body;

        if (
          !customerWallet || !merchantWallet || !amountStr ||
          !operationsMLXDR ||
          !Array.isArray(operationsMLXDR)
        ) {
          ctx.response.status = Status.BadRequest;
          ctx.response.body = { message: "Missing required fields" };
          return;
        }

        const assetCode = requestedAsset || "XLM";
        const amountStroops = BigInt(amountStr);
        span.setAttribute("merchant.public_key", merchantWallet);
        span.setAttribute("customer.public_key", customerWallet);
        span.setAttribute("asset.code", assetCode);
        span.setAttribute("amount.stroops", amountStroops.toString());

        const merchant = await accountRepo.findByPublicKey(merchantWallet);
        if (!merchant) {
          ctx.response.status = Status.NotFound;
          ctx.response.body = { message: "Merchant not found" };
          return;
        }

        const councils = await councilRepo.findByJurisdiction(
          merchant.jurisdictionCountryCode,
        );

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
            message: `No ${assetCode} channel available for this merchant`,
          };
          return;
        }
        span.setAttribute("council.id", selectedCouncil.id);
        span.setAttribute("channel.id", selectedChannel.id);

        const pps = await ppRepo.findActiveByCouncilId(selectedCouncil.id);
        if (pps.length === 0) {
          ctx.response.status = Status.ServiceUnavailable;
          ctx.response.body = { message: "No privacy provider available" };
          return;
        }
        const pp = pps[Math.floor(Math.random() * pps.length)];
        span.setAttribute("pp.id", pp.id);

        log.event("authenticating with provider-platform");
        const providerJwt = await getProviderJwt(pp.url, pp.publicKey, { log });

        log.event("submitting bundle to provider-platform");
        const bundleRes = await fetch(
          `${pp.url}/api/v1/providers/${pp.publicKey}/entity/bundles`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${providerJwt}`,
            },
            body: JSON.stringify({
              operationsMLXDR,
              channelContractId: selectedChannel.privacyChannelId,
            }),
          },
        );

        if (!bundleRes.ok) {
          const errBody = await bundleRes.text().catch(() => "");
          log.debug("status", bundleRes.status);
          log.debug("body", errBody);
          throw providerBundleRejected(bundleRes.status, errBody);
        }

        const bundleData = await bundleRes.json().catch(() => ({}));
        const bundleId = bundleData?.data?.operationsBundleId ??
          bundleData?.operationsBundleId ?? null;
        if (bundleId) span.setAttribute("bundle.id", bundleId);

        const inTx = await txRepo.create({
          walletPublicKey: merchantWallet,
          direction: "IN",
          status: "COMPLETED",
          method: "CRYPTO_INSTANT",
          amountStroops,
          feeStroops: 0n,
          counterparty: customerWallet,
          description: description ?? null,
          bundleId,
          completedAt: new Date(),
        });

        let outTxId: string | null = null;
        const customerAccount = await accountRepo.findByPublicKey(
          customerWallet,
        );
        if (customerAccount) {
          const outTx = await txRepo.create({
            walletPublicKey: customerWallet,
            direction: "OUT",
            status: "COMPLETED",
            method: "CRYPTO_INSTANT",
            amountStroops,
            feeStroops: 0n,
            counterparty: merchantWallet,
            description: description ?? null,
            bundleId,
            completedAt: new Date(),
          });
          outTxId = outTx.id;
        }

        log.debug("bundleId", bundleId);
        log.debug("inTxId", inTx.id);
        log.debug("outTxId", outTxId);
        log.event("instant payment completed");

        ctx.response.body = {
          data: {
            transactionId: inTx.id,
            bundleId,
            status: "COMPLETED",
          },
        };
      } catch (error) {
        log.error(error, "failed to submit instant payment");
        const platformError = PlatformError.fromUnknown(error, {
          source: "@http/v1/pay/instant-submit",
          details: "Failed to process the instant payment.",
        });
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: platformError.message,
        });
        span.recordException(
          error instanceof Error ? error : new Error(String(error)),
        );
        await PIPE_APIError(ctx, deps).run(platformError);
      }
    });
}
