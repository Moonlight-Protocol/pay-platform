import { integer, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";
import { payAccount } from "@/persistence/drizzle/entity/pay-account.entity.ts";

/**
 * UTXO availability status.
 * AVAILABLE — ready to be assigned to an incoming payment.
 * RESERVED  — assigned to a pending payment, waiting for confirmation.
 * SPENT     — payment confirmed, UTXO has been used.
 */
export const receiveUtxoStatusEnum = pgEnum("receive_utxo_status", [
  "AVAILABLE",
  "RESERVED",
  "SPENT",
]);

/**
 * receive_utxos: pre-generated P256 public keys for receiving payments.
 *
 * Generated at onboarding from HKDF(master_seed, salt=email) → StellarDerivator.
 * Only public keys are stored — private keys are derived client-side and
 * never leave the user's device.
 */
export const receiveUtxo = pgTable("receive_utxos", {
  id: uuid("id").defaultRandom().primaryKey(),
  walletPublicKey: text("wallet_public_key")
    .notNull()
    .references(() => payAccount.walletPublicKey, { onDelete: "cascade" }),
  /** The P256 (secp256r1) public key in base64 — used in CREATE operations. */
  utxoPublicKey: text("utxo_public_key").notNull(),
  /** Derivation index used to generate this key. Allows re-derivation. */
  derivationIndex: integer("derivation_index").notNull(),
  status: receiveUtxoStatusEnum("status").notNull().default("AVAILABLE"),
  ...createBaseColumns(),
});

export type ReceiveUtxo = typeof receiveUtxo.$inferSelect;
export type NewReceiveUtxo = typeof receiveUtxo.$inferInsert;
