import { boolean, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createBaseColumns } from "@/persistence/drizzle/entity/base.entity.ts";
import { council } from "@/persistence/drizzle/entity/council.entity.ts";

/**
 * council_pps: Privacy Providers registered within a council.
 *
 * A council can have multiple PPs. When Moonlight Pay picks a council for
 * a transaction, it picks a PP within that council at random (or round-
 * robin in future). The PP's URL is the endpoint bundles are submitted to;
 * the public key is used for challenge-response auth with the PP.
 */
export const councilPp = pgTable("council_pps", {
  id: uuid("id").defaultRandom().primaryKey(),
  councilId: uuid("council_id")
    .notNull()
    .references(() => council.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  publicKey: text("public_key").notNull(),
  active: boolean("active").notNull().default(true),
  ...createBaseColumns(),
});

export type CouncilPp = typeof councilPp.$inferSelect;
export type NewCouncilPp = typeof councilPp.$inferInsert;
