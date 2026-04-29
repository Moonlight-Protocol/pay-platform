import { boolean, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";
import { council } from "@/persistence/drizzle/entity/council.entity.ts";

/**
 * council_channels: one privacy channel per asset per council.
 *
 * Each row represents an asset enabled on a council — the privacy channel
 * contract that handles that asset's private transactions. A council
 * with XLM and USDC has two rows here.
 */
export const councilChannel = pgTable("council_channels", {
  id: uuid("id").defaultRandom().primaryKey(),
  councilId: uuid("council_id")
    .notNull()
    .references(() => council.id, { onDelete: "cascade" }),
  assetCode: text("asset_code").notNull(),
  assetContractId: text("asset_contract_id").notNull(),
  privacyChannelId: text("privacy_channel_id").notNull(),
  active: boolean("active").notNull().default(true),
  ...createBaseColumns(),
});

export type CouncilChannel = typeof councilChannel.$inferSelect;
export type NewCouncilChannel = typeof councilChannel.$inferInsert;
