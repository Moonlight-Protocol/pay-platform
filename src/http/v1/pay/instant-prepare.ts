import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilRepository } from "@/persistence/drizzle/repository/council.repository.ts";
import { CouncilPpRepository } from "@/persistence/drizzle/repository/council-pp.repository.ts";
import { ReceiveUtxoRepository } from "@/persistence/drizzle/repository/receive-utxo.repository.ts";
import { PayAccountRepository } from "@/persistence/drizzle/repository/pay-account.repository.ts";
import { LOG } from "@/config/logger.ts";

const councilRepo = new CouncilRepository(drizzleClient);
const ppRepo = new CouncilPpRepository(drizzleClient);
const utxoRepo = new ReceiveUtxoRepository(drizzleClient);
const accountRepo = new PayAccountRepository(drizzleClient);

/**
 * POST /api/v1/pay/instant/prepare
 *
 * Body: { merchantWallet, amountXlm, customerWallet, payerJurisdiction? }
 *
 * Returns the council config, a privacy provider URL, and the merchant's
 * receive UTXO public keys so the frontend can build the deposit operation.
 * The frontend signs the deposit with Freighter, then calls /submit.
 */
export const prepareInstantHandler = async (ctx: Context) => {
  try {
    const body = await ctx.request.body.json().catch(() => ({}));
    const { merchantWallet, amountXlm, customerWallet, payerJurisdiction } =
      body;

    if (!merchantWallet || !amountXlm || !customerWallet) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = {
        message: "merchantWallet, amountXlm, and customerWallet are required",
      };
      return;
    }

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

    // Find a council covering both jurisdictions.
    // If payerJurisdiction is provided, check for a direct pair.
    // If not, pick any active council that covers the merchant's jurisdiction.
    let councils;
    if (payerJurisdiction) {
      councils = await councilRepo.findByJurisdictionPair(
        payerJurisdiction,
        merchant.jurisdictionCountryCode,
      );
      if (councils.length === 0) {
        ctx.response.status = Status.UnprocessableEntity;
        ctx.response.body = {
          message: `No council available for ${payerJurisdiction} → ${merchant.jurisdictionCountryCode}`,
        };
        return;
      }
    } else {
      councils = await councilRepo.findActive();
      // Filter to councils that at least cover the merchant's jurisdiction
      councils = councils.filter((c) =>
        c.jurisdictionCodes.includes(merchant.jurisdictionCountryCode)
      );
      if (councils.length === 0) {
        ctx.response.status = Status.ServiceUnavailable;
        ctx.response.body = {
          message: "No council available for this merchant's jurisdiction",
        };
        return;
      }
    }

    // Pick one council (first available — random/round-robin later)
    const council = councils[0];

    // Pick a privacy provider within the council
    const pps = await ppRepo.findActiveByCouncilId(council.id);
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
      amountStroops: amountStroops.toString(),
      councilId: council.id,
      ppId: pp.id,
    });

    ctx.response.body = {
      data: {
        council: {
          id: council.id,
          channelAuthId: council.channelAuthId,
          privacyChannelId: council.privacyChannelId,
          assetId: council.assetId,
          networkPassphrase: council.networkPassphrase,
        },
        pp: {
          url: pp.url,
          publicKey: pp.publicKey,
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
