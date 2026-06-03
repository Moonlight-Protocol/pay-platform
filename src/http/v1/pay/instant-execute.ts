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
import { TransactionRepository } from "@/persistence/drizzle/repository/transaction.repository.ts";
import { PayAccountRepository } from "@/persistence/drizzle/repository/pay-account.repository.ts";
import { decryptSk } from "@/core/crypto/encrypt-sk.ts";
import { getProviderJwt } from "@/core/service/provider-auth.ts";
import { getChannelClient } from "@/core/channel-client/index.ts";
import { validateReceiveDestinations } from "@/core/service/utxo/utxo-balance.ts";
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
const txRepo = new TransactionRepository(drizzleClient);
const accountRepo = new PayAccountRepository(drizzleClient);

export function handleExecuteInstant(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("executeInstant");

  return (ctx) =>
    withSpan("P_ExecuteInstant", async (span) => {
      log.info("executeInstant");

      try {
        const body = await ctx.request.body.json().catch(() => ({}));
        const {
          customerPaymentHash,
          merchantWallet,
          amountStroops: amountStr,
          assetCode: requestedAsset,
          description,
          merchantUtxoIndexes,
        } = body;

        if (!customerPaymentHash || !merchantWallet || !amountStr) {
          ctx.response.status = Status.BadRequest;
          ctx.response.body = {
            message:
              "customerPaymentHash, merchantWallet, and amountStroops are required",
          };
          return;
        }
        if (
          !Array.isArray(merchantUtxoIndexes) ||
          merchantUtxoIndexes.length === 0 ||
          !merchantUtxoIndexes.every((i: unknown) => typeof i === "number")
        ) {
          ctx.response.status = Status.BadRequest;
          ctx.response.body = {
            message: "merchantUtxoIndexes must be a non-empty array of numbers",
          };
          return;
        }

        const assetCode = requestedAsset || "XLM";
        const amountStroops = BigInt(amountStr);
        span.setAttribute("merchant.public_key", merchantWallet);
        span.setAttribute("asset.code", assetCode);
        span.setAttribute("amount.stroops", amountStroops.toString());
        span.setAttribute("customer.payment_hash", customerPaymentHash);

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
        if (!merchant.encryptedDelegationKey) {
          ctx.response.status = Status.UnprocessableEntity;
          ctx.response.body = {
            message: "Merchant has not finished onboarding",
          };
          return;
        }
        // Merchant fee concept is being reworked — hardcode to 0 for now.
        const feePct = 0;

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
          return;
        }
        log.event("customer payment verified");

        const feeStroops = amountStroops * BigInt(Math.round(feePct * 100)) /
          10000n;
        const netStroops = amountStroops - feeStroops;
        span.setAttribute("net.stroops", netStroops.toString());
        span.setAttribute("fee.stroops", feeStroops.toString());

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
        const merchantDestinations = await validateReceiveDestinations(
          channelClient,
          utxoRoot,
          merchantUtxoIndexes,
          { log },
        );

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

        // The SAC transfer to the channel must match the bundle's deposit op
        // (netStroops + BUNDLE_FEE). Otherwise the channel rejects the bundle
        // for inflow/outflow mismatch.
        const BUNDLE_FEE = 500_000n;
        const depositTotalStroops = netStroops + BUNDLE_FEE;
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
              nativeToScVal(depositTotalStroops, { type: "i128" }),
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
        log.event("deposit confirmed on-chain");

        // Bundle is shaped like browser-wallet's deposit flow:
        //   deposit(opex, netStroops + BUNDLE_FEE)  +  merchant CREATEs(netStroops)
        // No temp-hop. provider-platform's classifier sees inflows = deposit,
        // outflows = merchant creates, fee = BUNDLE_FEE (positive).
        const merchantAmounts = partitionAmount(
          netStroops,
          merchantDestinations.publicKeys.length,
        );
        const merchantCreateOps = merchantDestinations.publicKeys.map((pk, i) =>
          MoonlightOperation.create(pk, merchantAmounts[i])
        );

        // Sign the deposit op with the OpEx Ed25519 key — browser-wallet's
        // deposit pattern requires the depositor's signature on the deposit
        // op (separate from the SAC transfer that moves XLM).
        // Expiration must be `<= latestLedger + maxOffset` per the channel
        // contract — match lifecycle's lib/client/deposit.ts: latest + 1000.
        const latestLedger = await server.getLatestLedger();
        const expirationLedger = latestLedger.sequence + 1000;
        const depositOp = await MoonlightOperation.deposit(
          opexKeypair.publicKey() as `G${string}`,
          depositTotalStroops,
        )
          .addConditions(merchantCreateOps.map((op) => op.toCondition()))
          .signWithEd25519(
            opexKeypair,
            expirationLedger,
            selectedChannel.privacyChannelId as `C${string}`,
            selectedChannel.assetContractId as `C${string}`,
            networkPassphrase,
          );

        const operationsMLXDR = [
          depositOp.toMLXDR(),
          ...merchantCreateOps.map((op) => op.toMLXDR()),
        ];

        log.event("submitting bundle to provider-platform");
        const providerJwt = await getProviderJwt(pp.url, { log });
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
          log.error(
            new Error(`HTTP ${bundleRes.status}`),
            "provider bundle submission failed",
          );
          ctx.response.status = Status.BadGateway;
          ctx.response.body = {
            message: "Payment processing failed — provider rejected the bundle",
          };
          return;
        }

        const bundleData = await bundleRes.json().catch(() => ({}));
        const bundleId = bundleData?.data?.operationsBundleId ?? null;
        if (bundleId) span.setAttribute("bundle.id", bundleId);

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
      }
    });
}

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

