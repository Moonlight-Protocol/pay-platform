import { numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";

/**
 * pay_accounts: one row per Moonlight Pay user.
 *
 * The user's wallet public key (Stellar G-address) is the primary key.
 * No surrogate UUID — the wallet identity is the canonical identifier.
 *
 * OpEx fields: the operational account used for the instant payment flow.
 * The customer pays to opex_public_key; pay-platform decrypts the SK to
 * execute the moonlight deposit + send on behalf of the customer.
 */
export const payAccount = pgTable("pay_accounts", {
  walletPublicKey: text("wallet_public_key").primaryKey(),
  email: text("email").notNull(),
  jurisdictionCountryCode: text("jurisdiction_country_code").notNull(),
  displayName: text("display_name"),
  opexPublicKey: text("opex_public_key"),
  encryptedOpexSk: text("encrypted_opex_sk"),
  feePct: numeric("fee_pct", { precision: 5, scale: 2 }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  ...createBaseColumns(),
});

export type PayAccount = typeof payAccount.$inferSelect;
export type NewPayAccount = typeof payAccount.$inferInsert;
