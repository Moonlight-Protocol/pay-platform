import { pgEnum, pgTable, text, uuid, bigint, timestamp } from "drizzle-orm/pg-core";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";
import { payAccount } from "@/persistence/drizzle/entity/pay-account.entity.ts";

export const txDirectionEnum = pgEnum("tx_direction", ["IN", "OUT"]);

export const txStatusEnum = pgEnum("tx_status", [
  "PENDING",
  "COMPLETED",
  "FAILED",
]);

export const txMethodEnum = pgEnum("tx_method", [
  "CRYPTO_INSTANT",
]);

/**
 * transactions: user-facing transaction log.
 *
 * One row per payment. The user sees their balance (sum of completed IN
 * minus sum of completed OUT) and a list of incoming/outgoing transactions.
 * No UTXO details, bundle IDs, or channel internals — those are PP-side
 * concerns.
 */
export const transaction = pgTable("transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  /** The account this transaction belongs to. */
  walletPublicKey: text("wallet_public_key")
    .notNull()
    .references(() => payAccount.walletPublicKey, { onDelete: "cascade" }),
  direction: txDirectionEnum("direction").notNull(),
  status: txStatusEnum("status").notNull().default("PENDING"),
  method: txMethodEnum("method").notNull(),
  /** Amount in stroops (10^-7 XLM). */
  amountStroops: bigint("amount_stroops", { mode: "bigint" }).notNull(),
  /** Fee in stroops charged for the transaction. */
  feeStroops: bigint("fee_stroops", { mode: "bigint" }).notNull().default(0n),
  /** Counterparty wallet address (who you paid / who paid you). */
  counterparty: text("counterparty"),
  /** Human-readable description (from POS link or user input). */
  description: text("description"),
  /** PP bundle ID — for backend reconciliation, not shown to the user. */
  bundleId: text("bundle_id"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  ...createBaseColumns(),
});

export type Transaction = typeof transaction.$inferSelect;
export type NewTransaction = typeof transaction.$inferInsert;
