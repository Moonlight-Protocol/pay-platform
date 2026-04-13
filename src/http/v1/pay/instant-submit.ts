import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { ReceiveUtxoRepository } from "@/persistence/drizzle/repository/receive-utxo.repository.ts";
import { TransactionRepository } from "@/persistence/drizzle/repository/transaction.repository.ts";
import { PayAccountRepository } from "@/persistence/drizzle/repository/pay-account.repository.ts";
import { LOG } from "@/config/logger.ts";

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
 *   description?,
 *   signedDepositMLXDR,        — the customer-signed deposit operation
 *   tempCreateMLXDRs,          — CREATE ops at temp keys (built by frontend)
 *   tempSpendMLXDRs,           — SPEND ops from temp keys (signed by frontend with temp keys)
 *   merchantCreateMLXDRs,      — CREATE ops at merchant's receive UTXOs
 *   merchantUtxoIds,           — IDs to mark as SPENT
 *   ppUrl,                     — where to submit the bundle
 *   ppAuthToken,               — JWT for provider-platform
 *   channelContractId,         — privacy channel contract ID
 * }
 *
 * The frontend has already built ALL operations (deposit + temp creates +
 * temp spends + merchant creates) because it holds the customer's signing
 * context. pay-platform's job here is:
 *   1. Assemble the operations into a bundle
 *   2. Submit to provider-platform
 *   3. Record the transaction
 *   4. Mark merchant UTXOs as SPENT
 */
export const submitInstantHandler = async (ctx: Context) => {
  try {
    const body = await ctx.request.body.json().catch(() => ({}));
    const {
      customerWallet,
      merchantWallet,
      amountStroops: amountStr,
      description,
      operationsMLXDR,
      merchantUtxoIds,
      ppUrl,
      ppAuthToken,
      channelContractId,
    } = body;

    if (
      !customerWallet || !merchantWallet || !amountStr || !operationsMLXDR ||
      !ppUrl || !ppAuthToken || !channelContractId
    ) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Missing required fields" };
      return;
    }

    const amountStroops = BigInt(amountStr);

    // Submit the bundle to provider-platform
    const bundleRes = await fetch(`${ppUrl}/api/v1/bundle`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${ppAuthToken}`,
      },
      body: JSON.stringify({
        operationsMLXDR,
        channelContractId,
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
      // Release the reserved UTXOs
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

    // Record merchant IN transaction (merchant always has a pay-platform account)
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

    // Record customer OUT transaction only if they have a pay-platform account.
    // POS customers pay without registering — they just connect a wallet.
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
