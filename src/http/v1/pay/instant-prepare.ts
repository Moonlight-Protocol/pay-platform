import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilRepository } from "@/persistence/drizzle/repository/council.repository.ts";
import { CouncilChannelRepository } from "@/persistence/drizzle/repository/council-channel.repository.ts";
import { CouncilPpRepository } from "@/persistence/drizzle/repository/council-pp.repository.ts";
import { ReceiveUtxoRepository } from "@/persistence/drizzle/repository/receive-utxo.repository.ts";
import { PayAccountRepository } from "@/persistence/drizzle/repository/pay-account.repository.ts";
import { LOG } from "@/config/logger.ts";
import { STELLAR_NETWORK_PASSPHRASE } from "@/config/env.ts";

const councilRepo = new CouncilRepository(drizzleClient);
const channelRepo = new CouncilChannelRepository(drizzleClient);
const ppRepo = new CouncilPpRepository(drizzleClient);
const utxoRepo = new ReceiveUtxoRepository(drizzleClient);
const accountRepo = new PayAccountRepository(drizzleClient);

/**
 * POST /api/v1/pay/instant/prepare
 *
 * Body: { merchantWallet, amountXlm, customerWallet, assetCode?, payerJurisdiction? }
 *
 * Returns the council config (including the channel for the requested asset),
 * a privacy provider URL, and the merchant's receive UTXO public keys so
 * the frontend can build the deposit operation.
 */
export const prepareInstantHandler = async (ctx: Context) => {
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
        message: "merchantWallet, amountXlm, and customerWallet are required",
      };
      return;
    }

    const assetCode = requestedAsset || "XLM";

    const amount = parseFloat(amountXlm);
    if (isNaN(amount) || amount <= 0) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "amountXlm must be a positive number" };
      return;
    }

    // Look up the merchant
    const merchant = await accountRepo.findByPublicKey(merchantWallet);
    if (!merchant) {
      ctx.response.status = Status.NotFound;
      ctx.response.body = { message: "Merchant not found" };
      return;
    }

    // Find a council covering the merchant's jurisdiction
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

    // Find a council that has the requested asset channel
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

    // Pick a privacy provider within the council
    const pps = await ppRepo.findActiveByCouncilId(selectedCouncil.id);
    if (pps.length === 0) {
      ctx.response.status = Status.ServiceUnavailable;
      ctx.response.body = {
        message: "No privacy provider available in the selected council",
      };
      return;
    }
    const pp = pps[Math.floor(Math.random() * pps.length)];

    // Get merchant's available receive UTXOs (5 for privacy distribution)
    const merchantUtxos = await utxoRepo.findAvailable(merchantWallet, 5);
    if (merchantUtxos.length === 0) {
      ctx.response.status = Status.ServiceUnavailable;
      ctx.response.body = {
        message: "Merchant has no available receive addresses",
      };
      return;
    }

    // Reserve the UTXOs so they're not used by concurrent payments
    await utxoRepo.reserve(merchantUtxos.map((u) => u.id));

    const amountStroops = BigInt(Math.round(amount * 1e7));

    LOG.info("Instant payment prepared", {
      customerWallet,
      merchantWallet,
      assetCode,
      amountStroops: amountStroops.toString(),
      councilId: selectedCouncil.id,
      channelId: selectedChannel.id,
      ppId: pp.id,
    });

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
        merchantUtxos: merchantUtxos.map((u) => ({
          id: u.id,
          utxoPublicKey: u.utxoPublicKey,
          derivationIndex: u.derivationIndex,
        })),
        amountStroops: amountStroops.toString(),
      },
    };
  } catch (error) {
    LOG.error("Failed to prepare instant payment", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to prepare payment" };
  }
};
