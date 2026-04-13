import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilRepository } from "@/persistence/drizzle/repository/council.repository.ts";
import { CouncilChannelRepository } from "@/persistence/drizzle/repository/council-channel.repository.ts";
import { CouncilPpRepository } from "@/persistence/drizzle/repository/council-pp.repository.ts";
import { ReceiveUtxoRepository } from "@/persistence/drizzle/repository/receive-utxo.repository.ts";
import { TransactionRepository } from "@/persistence/drizzle/repository/transaction.repository.ts";
import { PayAccountRepository } from "@/persistence/drizzle/repository/pay-account.repository.ts";
import { getProviderJwt } from "@/core/service/provider-auth.ts";
import { LOG } from "@/config/logger.ts";

const councilRepo = new CouncilRepository(drizzleClient);
const channelRepo = new CouncilChannelRepository(drizzleClient);
const ppRepo = new CouncilPpRepository(drizzleClient);
const utxoRepo = new ReceiveUtxoRepository(drizzleClient);
const txRepo = new TransactionRepository(drizzleClient);
const accountRepo = new PayAccountRepository(drizzleClient);

/**
 * POST /api/v1/pay/instant/submit
 *
 * Body: {
 *   customerWallet,
 *   merchantWallet,
 *   amountStroops,
 *   assetCode,
 *   description?,
 *   operationsMLXDR,       — all operations built by the frontend
 *   merchantUtxoIds,       — IDs to mark as SPENT
 * }
 *
 * The frontend builds ALL operations (deposit + temp creates + temp spends +
 * merchant creates) because it holds the customer's signing context.
 *
 * Pay-platform's job:
 *   1. Look up the council + channel + PP from the asset code and merchant jurisdiction
 *   2. Authenticate with provider-platform server-side (PAY_SERVICE_SK)
 *   3. Submit the bundle to provider-platform
 *   4. Record the transaction
 *   5. Mark merchant UTXOs as SPENT
 */
export const submitInstantHandler = async (ctx: Context) => {
  try {
    const body = await ctx.request.body.json().catch(() => ({}));
    const {
      customerWallet,
      merchantWallet,
      amountStroops: amountStr,
      assetCode: requestedAsset,
      description,
      operationsMLXDR,
      merchantUtxoIds,
    } = body;

    if (
      !customerWallet || !merchantWallet || !amountStr || !operationsMLXDR ||
      !Array.isArray(operationsMLXDR)
    ) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Missing required fields" };
      return;
    }

    const assetCode = requestedAsset || "XLM";
    const amountStroops = BigInt(amountStr);

    // Look up merchant to get jurisdiction
    const merchant = await accountRepo.findByPublicKey(merchantWallet);
    if (!merchant) {
      ctx.response.status = Status.NotFound;
      ctx.response.body = { message: "Merchant not found" };
      return;
    }

    // Find a council covering the merchant's jurisdiction with the requested asset
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
      if (Array.isArray(merchantUtxoIds)) {
        await utxoRepo.release(merchantUtxoIds);
      }
      return;
    }

    // Pick a PP
    const pps = await ppRepo.findActiveByCouncilId(selectedCouncil.id);
    if (pps.length === 0) {
      ctx.response.status = Status.ServiceUnavailable;
      ctx.response.body = { message: "No privacy provider available" };
      if (Array.isArray(merchantUtxoIds)) {
        await utxoRepo.release(merchantUtxoIds);
      }
      return;
    }
    const pp = pps[Math.floor(Math.random() * pps.length)];

    // Authenticate with provider-platform server-side
    const providerJwt = await getProviderJwt(pp.url);

    // Submit the bundle to provider-platform
    const bundleRes = await fetch(`${pp.url}/api/v1/bundle`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${providerJwt}`,
      },
      body: JSON.stringify({
        operationsMLXDR,
        channelContractId: selectedChannel.privacyChannelId,
      }),
    });

    if (!bundleRes.ok) {
      const errBody = await bundleRes.text().catch(() => "");
      LOG.error("Provider-platform bundle submission failed", {
        status: bundleRes.status,
        body: errBody,
      });
      ctx.response.status = Status.BadGateway;
      ctx.response.body = {
        message: "Payment processing failed — provider rejected the bundle",
      };
      if (Array.isArray(merchantUtxoIds)) {
        await utxoRepo.release(merchantUtxoIds);
      }
      return;
    }

    const bundleData = await bundleRes.json().catch(() => ({}));
    const bundleId = bundleData?.data?.operationsBundleId ??
      bundleData?.operationsBundleId ?? null;

    // Mark merchant UTXOs as SPENT
    if (Array.isArray(merchantUtxoIds) && merchantUtxoIds.length > 0) {
      await utxoRepo.markSpent(merchantUtxoIds);
    }

    // Record merchant IN transaction
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

    // Record customer OUT transaction only if they have a pay-platform account
    let outTxId: string | null = null;
    const customerAccount = await accountRepo.findByPublicKey(customerWallet);
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

    LOG.info("Instant payment completed", {
      customerWallet,
      merchantWallet,
      assetCode,
      amountStroops: amountStroops.toString(),
      bundleId,
      inTxId: inTx.id,
      outTxId,
    });

    ctx.response.body = {
      data: {
        transactionId: inTx.id,
        bundleId,
        status: "COMPLETED",
      },
    };
  } catch (error) {
    LOG.error("Failed to submit instant payment", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to process payment" };
  }
};
