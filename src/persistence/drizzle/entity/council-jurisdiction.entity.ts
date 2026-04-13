import { pgTable, text, uuid, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { council } from "@/persistence/drizzle/entity/council.entity.ts";

/**
 * council_jurisdictions: which jurisdictions a council serves.
 *
 * One row per (council, country_code) pair. Transaction routing finds
 * councils that serve both the payer and receiver jurisdictions by
 * intersecting this table.
 */
export const councilJurisdiction = pgTable("council_jurisdictions", {
  id: uuid("id").defaultRandom().primaryKey(),
  councilId: uuid("council_id")
    .notNull()
    .references(() => council.id, { onDelete: "cascade" }),
  countryCode: text("country_code").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CouncilJurisdiction = typeof councilJurisdiction.$inferSelect;
export type NewCouncilJurisdiction = typeof councilJurisdiction.$inferInsert;
