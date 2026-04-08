import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";

/**
 * pay_accounts: one row per Moonlight Pay user.
 *
 * The user's wallet public key (Stellar G-address) is the primary key.
 * No surrogate UUID — the wallet identity is the canonical identifier.
 */
export const payAccount = pgTable("pay_accounts", {
  walletPublicKey: text("wallet_public_key").primaryKey(),
  email: text("email").notNull(),
  jurisdictionCountryCode: text("jurisdiction_country_code").notNull(),
  displayName: text("display_name"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  ...createBaseColumns(),
});

export type PayAccount = typeof payAccount.$inferSelect;
export type NewPayAccount = typeof payAccount.$inferInsert;
