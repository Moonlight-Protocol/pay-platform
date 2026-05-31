import { type Context, Status } from "@oak/oak";
import {
  Address,
  Contract,
  Keypair,
  nativeToScVal,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import * as rpc from "@stellar/stellar-sdk/rpc";
import { MoonlightOperation } from "@moonlight/moonlight-sdk";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilRepository } from "@/persistence/drizzle/repository/council.repository.ts";
import { CouncilChannelRepository } from "@/persistence/drizzle/repository/council-channel.repository.ts";
import { CouncilPpRepository } from "@/persistence/drizzle/repository/council-pp.repository.ts";
import { ReceiveUtxoRepository } from "@/persistence/drizzle/repository/receive-utxo.repository.ts";
import { TransactionRepository } from "@/persistence/drizzle/repository/transaction.repository.ts";
import { PayAccountRepository } from "@/persistence/drizzle/repository/pay-account.repository.ts";
import { decryptSk } from "@/core/crypto/encrypt-sk.ts";
import { getProviderJwt } from "@/core/service/provider-auth.ts";
import {
  SERVICE_AUTH_SECRET,
  STELLAR_NETWORK_PASSPHRASE,
  STELLAR_RPC_URL,
} from "@/config/env.ts";
import type { Logger } from "@/utils/logger/index.ts";
import { withSpan } from "@/core/tracing.ts";

const councilRepo = new CouncilRepository(drizzleClient);
const channelRepo = new CouncilChannelRepository(drizzleClient);
const ppRepo = new CouncilPpRepository(drizzleClient);
const utxoRepo = new ReceiveUtxoRepository(drizzleClient);
const txRepo = new TransactionRepository(drizzleClient);
const accountRepo = new PayAccountRepository(drizzleClient);

/**
 * POST /api/v1/pay/instant/execute
 *
 * Instant payment flow: the customer has sent a standard Stellar payment
 * to the merchant's OpEx address. Pay-platform:
 *   1. Verifies the payment on-chain
 *   2. Deposits (SAC transfer) from OpEx to the privacy channel
 *   3. Builds the MLXDR bundle (CREATE + SPEND) and submits to provider-platform
 *   4. Records the transaction
 *
 * Body: {
 *   customerPaymentHash — Stellar tx hash of customer's payment to OpEx
 *   merchantWallet      — merchant's Moonlight Pay wallet
 *   amountStroops       — amount the customer sent (in stroops)
 *   assetCode?          — defaults to "XLM"
 *   description?        — optional payment description
 *   merchantUtxoIds     — reserved UTXO IDs from prepare
 * }
 */
export function handleExecuteInstant(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("executeInstant");

  return (ctx) =>
    withSpan("P_ExecuteInstant", async (span) => {
      log.info("executeInstant");
      let merchantUtxoIds: string[] | undefined;

      try {
        const body = await ctx.request.body.json().catch(() => ({}));
        const {
          customerPaymentHash,
          merchantWallet,
          amountStroops: amountStr,
          assetCode: requestedAsset,
          description,
        } = body;
        merchantUtxoIds = body.merchantUtxoIds;

        if (!customerPaymentHash || !merchantWallet || !amountStr) {
          ctx.response.status = Status.BadRequest;
          ctx.response.body = {
            message:
              "customerPaymentHash, merchantWallet, and amountStroops are required",
          };
          return;
        }

        const assetCode = requestedAsset || "XLM";
        const amountStroops = BigInt(amountStr);
        span.setAttribute("merchant.public_key", merchantWallet);
        span.setAttribute("asset.code", assetCode);
        span.setAttribute("amount.stroops", amountStroops.toString());
        span.setAttribute("customer.payment_hash", customerPaymentHash);

        log.debug("merchantWallet", merchantWallet);
        log.debug("assetCode", assetCode);
        log.debug("amountStroops", amountStroops.toString());
        log.debug("customerPaymentHash", customerPaymentHash);

        // ─── 1. Look up merchant and OpEx ──────────────────────
        const merchant = await accountRepo.findByPublicKey(merchantWallet);
        if (!merchant) {
          ctx.response.status = Status.NotFound;
          ctx.response.body = { message: "Merchant not found" };
          return;
        }
        if (!merchant.opexPublicKey || !merchant.encryptedOpexSk) {
          ctx.response.status = Status.UnprocessableEntity;
          ctx.response.body = {
            message: "Merchant has no OpEx account configured",
          };
          return;
        }
        const feePct = merchant.feePct ? Number(merchant.feePct) : 0;

        // ─── 2. Find council + channel + PP ────────────────────
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
          ctx.response.body = { message: `No ${assetCode} channel available` };
          if (merchantUtxoIds) await utxoRepo.release(merchantUtxoIds);
          return;
        }
        span.setAttribute("council.id", selectedCouncil.id);
        span.setAttribute("channel.id", selectedChannel.id);

        const pps = await ppRepo.findActiveByCouncilId(selectedCouncil.id);
        if (pps.length === 0) {
          ctx.response.status = Status.ServiceUnavailable;
          ctx.response.body = { message: "No privacy provider available" };
          if (merchantUtxoIds) await utxoRepo.release(merchantUtxoIds);
          return;
        }
        const pp = pps[Math.floor(Math.random() * pps.length)];
        span.setAttribute("pp.id", pp.id);

        // ─── 3. Verify customer payment on-chain ───────────────
        log.event("verifying customer payment on-chain");
        const horizonUrl = STELLAR_RPC_URL.includes("/soroban/rpc")
          ? STELLAR_RPC_URL.replace("/soroban/rpc", "")
          : STELLAR_RPC_URL;

        const txRes = await fetch(
          `${horizonUrl}/transactions/${customerPaymentHash}/operations`,
        );
        if (!txRes.ok) {
          ctx.response.status = Status.BadRequest;
          ctx.response.body = {
            message: "Customer payment not found on-chain",
          };
          if (merchantUtxoIds) await utxoRepo.release(merchantUtxoIds);
          return;
        }
        const txOps = await txRes.json();
        const paymentOp = txOps._embedded?.records?.find(
          (
            op: {
              type: string;
              to?: string;
              amount?: string;
              funder?: string;
              account?: string;
            },
          ) =>
            (op.type === "payment" && op.to === merchant.opexPublicKey) ||
            (op.type === "create_account" &&
              op.account === merchant.opexPublicKey),
        );
        if (!paymentOp) {
          ctx.response.status = Status.BadRequest;
          ctx.response.body = {
            message: "No payment to OpEx address found in transaction",
          };
          if (merchantUtxoIds) await utxoRepo.release(merchantUtxoIds);
          return;
        }
        const paidAmount = paymentOp.amount ?? paymentOp.starting_balance ??
          "0";
        const paidStroops = BigInt(Math.round(parseFloat(paidAmount) * 1e7));
        if (paidStroops < amountStroops) {
          ctx.response.status = Status.BadRequest;
          ctx.response.body = {
            message:
              `Insufficient payment: expected ${amountStroops}, got ${paidStroops}`,
          };
          if (merchantUtxoIds) await utxoRepo.release(merchantUtxoIds);
          return;
        }
        log.event("customer payment verified");

        // ─── 4. Calculate net amount ───────────────────────────
        const feeStroops = amountStroops * BigInt(Math.round(feePct * 100)) /
          10000n;
        const netStroops = amountStroops - feeStroops;
        span.setAttribute("net.stroops", netStroops.toString());
        span.setAttribute("fee.stroops", feeStroops.toString());

        // ─── 5. Decrypt OpEx SK and deposit into channel ───────
        log.event("depositing OpEx to privacy channel");
        const opexSk = await decryptSk(
          merchant.encryptedOpexSk,
          SERVICE_AUTH_SECRET,
        );
        const opexKeypair = Keypair.fromSecret(opexSk);
        const networkPassphrase = STELLAR_NETWORK_PASSPHRASE;

        const server = new rpc.Server(STELLAR_RPC_URL, {
          allowHttp: STELLAR_RPC_URL.startsWith("http://"),
        });

        const opexAccount = await server.getAccount(opexKeypair.publicKey());
        const sacContract = new Contract(selectedChannel.assetContractId);
        const depositTx = new TransactionBuilder(opexAccount, {
          fee: "10000000",
          networkPassphrase,
        })
          .addOperation(
            sacContract.call(
              "transfer",
              new Address(opexKeypair.publicKey()).toScVal(),
              new Address(selectedChannel.privacyChannelId).toScVal(),
              nativeToScVal(netStroops, { type: "i128" }),
            ),
          )
          .setTimeout(300)
          .build();

        const sim = await server.simulateTransaction(depositTx);
        if ("error" in sim && sim.error) {
          throw new Error(`Deposit simulation failed: ${sim.error}`);
        }
        const preparedDeposit = rpc.assembleTransaction(depositTx, sim).build();
        preparedDeposit.sign(opexKeypair);
        const depositResult = await server.sendTransaction(preparedDeposit);
        span.setAttribute("deposit.tx_hash", depositResult.hash);

        const deadline = Date.now() + 60000;
        while (Date.now() < deadline) {
          const status = await server.getTransaction(depositResult.hash);
          if (status.status === "SUCCESS") break;
          if (status.status === "FAILED") {
            throw new Error("Deposit transaction failed on-chain");
          }
          await new Promise((r) => setTimeout(r, 2000));
        }

        log.debug("txHash", depositResult.hash);
        log.event("deposit confirmed on-chain");

        // ─── 6. Build MLXDR bundle ─────────────────────────────
        const merchantUtxos = await utxoRepo.findByIds(
          Array.isArray(merchantUtxoIds) ? merchantUtxoIds : [],
        );

        const merchantAmounts = partitionAmount(
          netStroops,
          merchantUtxos.length,
        );
        const merchantCreateOps = merchantUtxos.map((u, i) =>
          MoonlightOperation.create(
            Uint8Array.from(atob(u.utxoPublicKey), (c) => c.charCodeAt(0)),
            merchantAmounts[i],
          )
        );

        const tempCount = merchantUtxos.length;
        const tempKeypairs: Array<
          { publicKey: Uint8Array; privateKey: Uint8Array }
        > = [];
        for (let i = 0; i < tempCount; i++) {
          const seed = crypto.getRandomValues(new Uint8Array(32));
          tempKeypairs.push(await deriveP256Keypair(seed));
        }

        const tempAmounts = partitionAmount(netStroops, tempCount);
        const tempCreateOps = tempKeypairs.map((kp, i) =>
          MoonlightOperation.create(kp.publicKey, tempAmounts[i])
        );

        const expirationLedger = 999999999;

        const depositOp = MoonlightOperation.deposit(
          opexKeypair.publicKey() as `G${string}`,
          netStroops,
        ).addConditions(tempCreateOps.map((op) => op.toCondition()));

        const spendOps = [];
        for (let i = 0; i < tempKeypairs.length; i++) {
          const spendOp = MoonlightOperation.spend(tempKeypairs[i].publicKey);
          for (const merchantCreate of merchantCreateOps) {
            spendOp.addCondition(merchantCreate.toCondition());
          }
          // deno-lint-ignore no-explicit-any
          const utxoAdapter: any = {
            publicKey: tempKeypairs[i].publicKey,
            signPayload: async (hash: Uint8Array) => {
              const hashBuf = new ArrayBuffer(hash.length);
              new Uint8Array(hashBuf).set(hash);
              const pkcs8 = buildPkcs8P256(tempKeypairs[i].privateKey);
              const key = await crypto.subtle.importKey(
                "pkcs8",
                pkcs8,
                { name: "ECDSA", namedCurve: "P-256" },
                false,
                ["sign"],
              );
              const sig = await crypto.subtle.sign(
                { name: "ECDSA", hash: "SHA-256" },
                key,
                hashBuf,
              );
              return new Uint8Array(sig);
            },
          };
          await spendOp.signWithUTXO(
            utxoAdapter,
            selectedChannel.privacyChannelId as `C${string}`,
            expirationLedger,
          );
          spendOps.push(spendOp);
        }

        const operationsMLXDR = [
          depositOp.toMLXDR(),
          ...tempCreateOps.map((op) => op.toMLXDR()),
          ...spendOps.map((op) => op.toMLXDR()),
          ...merchantCreateOps.map((op) => op.toMLXDR()),
        ];

        // ─── 7. Submit bundle to provider-platform ─────────────
        log.event("submitting bundle to provider-platform");
        const providerJwt = await getProviderJwt(pp.url, { log });
        const bundleRes = await fetch(
          `${pp.url}/api/v1/providers/${pp.publicKey}/bundles`,
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
          log.error(
            new Error(`HTTP ${bundleRes.status}`),
            "provider bundle submission failed",
          );
          ctx.response.status = Status.BadGateway;
          ctx.response.body = {
            message: "Payment processing failed — provider rejected the bundle",
          };
          if (merchantUtxoIds) await utxoRepo.release(merchantUtxoIds);
          return;
        }

        const bundleData = await bundleRes.json().catch(() => ({}));
        const bundleId = bundleData?.data?.operationsBundleId ?? null;
        if (bundleId) span.setAttribute("bundle.id", bundleId);

        // ─── 8. Record transactions ────────────────────────────
        if (Array.isArray(merchantUtxoIds) && merchantUtxoIds.length > 0) {
          await utxoRepo.markSpent(merchantUtxoIds);
        }

        const inTx = await txRepo.create({
          walletPublicKey: merchantWallet,
          direction: "IN",
          status: "COMPLETED",
          method: "CRYPTO_INSTANT",
          amountStroops: netStroops,
          feeStroops,
          counterparty: null,
          description: description ?? null,
          bundleId,
          completedAt: new Date(),
        });

        log.debug("netStroops", netStroops.toString());
        log.debug("feeStroops", feeStroops.toString());
        log.debug("bundleId", bundleId);
        log.debug("txId", inTx.id);
        log.event("instant payment completed");

        ctx.response.body = {
          data: {
            transactionId: inTx.id,
            bundleId,
            status: "COMPLETED",
          },
        };
      } catch (error) {
        log.error(error, "failed to execute instant payment");
        ctx.response.status = Status.InternalServerError;
        ctx.response.body = { message: "Failed to process payment" };
        if (merchantUtxoIds) {
          try {
            await utxoRepo.release(merchantUtxoIds);
          } catch { /* best effort */ }
        }
      }
    });
}

// ─── Helpers ───────────────────────────────────────────────────

function partitionAmount(total: bigint, parts: number): bigint[] {
  if (parts <= 0) return [];
  if (parts === 1) return [total];
  const result: bigint[] = [];
  let remaining = total;
  for (let i = 0; i < parts - 1; i++) {
    const maxForThis = remaining - BigInt(parts - i - 1);
    const portion = 1n +
      BigInt(Math.floor(Math.random() * Number(maxForThis - 1n)));
    result.push(portion);
    remaining -= portion;
  }
  result.push(remaining);
  return result;
}

async function deriveP256Keypair(
  seed: Uint8Array,
): Promise<{ publicKey: Uint8Array; privateKey: Uint8Array }> {
  const seedBuf = new ArrayBuffer(seed.length);
  new Uint8Array(seedBuf).set(seed);
  const expandKey = await crypto.subtle.importKey(
    "raw",
    seedBuf,
    "HKDF",
    false,
    ["deriveBits"],
  );
  const expanded = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: new TextEncoder().encode("moonlight-p256"),
    },
    expandKey,
    384,
  );
  const privateKeyBytes = new Uint8Array(expanded).slice(0, 32);

  const { p256 } = await import("@noble/curves/p256");
  const publicKey = p256.ProjectivePoint.fromPrivateKey(privateKeyBytes)
    .toRawBytes(false);

  return { publicKey: new Uint8Array(publicKey), privateKey: privateKeyBytes };
}

function buildPkcs8P256(rawPrivateKey: Uint8Array): ArrayBuffer {
  const header = new Uint8Array([
    0x30,
    0x41,
    0x02,
    0x01,
    0x00,
    0x30,
    0x13,
    0x06,
    0x07,
    0x2a,
    0x86,
    0x48,
    0xce,
    0x3d,
    0x02,
    0x01,
    0x06,
    0x08,
    0x2a,
    0x86,
    0x48,
    0xce,
    0x3d,
    0x03,
    0x01,
    0x07,
    0x04,
    0x27,
    0x30,
    0x25,
    0x02,
    0x01,
    0x01,
    0x04,
    0x20,
  ]);
  const result = new Uint8Array(header.length + 32);
  result.set(header);
  result.set(rawPrivateKey, header.length);
  return result.buffer as ArrayBuffer;
}
