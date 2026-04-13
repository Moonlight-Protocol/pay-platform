import { eq, and } from "drizzle-orm";
import {
  councilPp,
  type CouncilPp,
  type NewCouncilPp,
} from "@/persistence/drizzle/entity/council-pp.entity.ts";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";

export class CouncilPpRepository {
  constructor(private readonly db: DrizzleClient) {}

  async findById(id: string): Promise<CouncilPp | undefined> {
    const [row] = await this.db
      .select()
      .from(councilPp)
      .where(eq(councilPp.id, id))
      .limit(1);
    return row;
  }

  async findByCouncilId(councilId: string): Promise<CouncilPp[]> {
    return this.db
      .select()
      .from(councilPp)
      .where(eq(councilPp.councilId, councilId));
  }

  async findActiveByCouncilId(councilId: string): Promise<CouncilPp[]> {
    return this.db
      .select()
      .from(councilPp)
      .where(
        and(eq(councilPp.councilId, councilId), eq(councilPp.active, true)),
      );
  }

  async findAll(): Promise<CouncilPp[]> {
    return this.db.select().from(councilPp);
  }

  async create(data: NewCouncilPp): Promise<CouncilPp> {
    const [row] = await this.db.insert(councilPp).values(data).returning();
    return row;
  }

  async update(
    id: string,
    data: Partial<Omit<NewCouncilPp, "id">>,
  ): Promise<CouncilPp | undefined> {
    const [row] = await this.db
      .update(councilPp)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(councilPp.id, id))
      .returning();
    return row;
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.db
      .delete(councilPp)
      .where(eq(councilPp.id, id))
      .returning();
    return result.length > 0;
  }
}
