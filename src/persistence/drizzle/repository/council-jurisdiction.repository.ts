import { eq, and } from "drizzle-orm";
import {
  councilJurisdiction,
  type CouncilJurisdiction,
  type NewCouncilJurisdiction,
} from "@/persistence/drizzle/entity/council-jurisdiction.entity.ts";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";

export class CouncilJurisdictionRepository {
  constructor(private readonly db: DrizzleClient) {}

  async findByCouncilId(councilId: string): Promise<CouncilJurisdiction[]> {
    return this.db
      .select()
      .from(councilJurisdiction)
      .where(eq(councilJurisdiction.councilId, councilId));
  }

  async create(data: NewCouncilJurisdiction): Promise<CouncilJurisdiction> {
    const [row] = await this.db
      .insert(councilJurisdiction)
      .values(data)
      .returning();
    return row;
  }

  async bulkCreate(
    rows: NewCouncilJurisdiction[],
  ): Promise<CouncilJurisdiction[]> {
    if (rows.length === 0) return [];
    return this.db
      .insert(councilJurisdiction)
      .values(rows)
      .returning();
  }

  async removeByCouncilId(councilId: string): Promise<number> {
    const result = await this.db
      .delete(councilJurisdiction)
      .where(eq(councilJurisdiction.councilId, councilId))
      .returning();
    return result.length;
  }

  async remove(councilId: string, countryCode: string): Promise<boolean> {
    const result = await this.db
      .delete(councilJurisdiction)
      .where(
        and(
          eq(councilJurisdiction.councilId, councilId),
          eq(councilJurisdiction.countryCode, countryCode),
        ),
      )
      .returning();
    return result.length > 0;
  }
}
