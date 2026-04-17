import { pgTable, text, boolean, uuid } from "drizzle-orm/pg-core";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";

/**
 * councils: top-level council record.
 *
 * A council is identified by its on-chain Channel Auth contract. It can
 * have multiple asset channels (council_channels), serve multiple
 * jurisdictions (council_jurisdictions), and have multiple privacy
 * providers (council_pps).
 */
export const council = pgTable("councils", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  channelAuthId: text("channel_auth_id").notNull(),
  active: boolean("active").notNull().default(true),
  ...createBaseColumns(),
});

export type Council = typeof council.$inferSelect;
export type NewCouncil = typeof council.$inferInsert;
