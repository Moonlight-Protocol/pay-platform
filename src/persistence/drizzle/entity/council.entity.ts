import { pgTable, text, boolean, uuid } from "drizzle-orm/pg-core";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";

/**
 * councils: Moonlight Pay's view of which councils serve which jurisdictions.
 *
 * Each row represents a council the system can route transactions through.
 * The jurisdiction_codes column is a comma-separated list of ISO 3166-1
 * alpha-2 codes the council covers. Transaction routing finds a council
 * whose jurisdiction_codes include both the payer and receiver jurisdictions.
 */
export const council = pgTable("councils", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  channelAuthId: text("channel_auth_id").notNull(),
  privacyChannelId: text("privacy_channel_id").notNull(),
  assetId: text("asset_id").notNull(),
  networkPassphrase: text("network_passphrase").notNull(),
  jurisdictionCodes: text("jurisdiction_codes").notNull(),
  active: boolean("active").notNull().default(true),
  ...createBaseColumns(),
});

export type Council = typeof council.$inferSelect;
export type NewCouncil = typeof council.$inferInsert;
