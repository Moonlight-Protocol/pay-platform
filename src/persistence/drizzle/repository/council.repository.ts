import { eq, and, sql } from "drizzle-orm";
import {
  council,
  type Council,
  type NewCouncil,
} from "@/persistence/drizzle/entity/council.entity.ts";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";

export class CouncilRepository {
  constructor(private readonly db: DrizzleClient) {}

  async findById(id: string): Promise<Council | undefined> {
    const [row] = await this.db
      .select()
      .from(council)
      .where(eq(council.id, id))
      .limit(1);
    return row;
  }

  async findAll(): Promise<Council[]> {
    return this.db.select().from(council);
  }

  async findActive(): Promise<Council[]> {
    return this.db
      .select()
      .from(council)
      .where(eq(council.active, true));
  }

  /**
   * Find active councils that serve BOTH the payer and receiver jurisdictions.
   * jurisdiction_codes is a comma-separated string; we check that both codes
   * appear in it.
   */
  async findByJurisdictionPair(
    payerCode: string,
    receiverCode: string,
  ): Promise<Council[]> {
    return this.db
      .select()
      .from(council)
      .where(
        and(
          eq(council.active, true),
          sql`${council.jurisdictionCodes} LIKE ${"%" + payerCode + "%"}`,
          sql`${council.jurisdictionCodes} LIKE ${"%" + receiverCode + "%"}`,
        ),
      );
  }

  async create(data: NewCouncil): Promise<Council> {
    const [row] = await this.db.insert(council).values(data).returning();
    return row;
  }

  async update(
    id: string,
    data: Partial<Omit<NewCouncil, "id">>,
  ): Promise<Council | undefined> {
    const [row] = await this.db
      .update(council)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(council.id, id))
      .returning();
    return row;
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.db
      .delete(council)
      .where(eq(council.id, id))
      .returning();
    return result.length > 0;
  }
}
