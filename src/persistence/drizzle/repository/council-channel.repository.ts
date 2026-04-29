import { and, eq } from "drizzle-orm";
import {
  type CouncilChannel,
  councilChannel,
  type NewCouncilChannel,
} from "@/persistence/drizzle/entity/council-channel.entity.ts";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";

export class CouncilChannelRepository {
  constructor(private readonly db: DrizzleClient) {}

  findByCouncilId(councilId: string): Promise<CouncilChannel[]> {
    return this.db
      .select()
      .from(councilChannel)
      .where(eq(councilChannel.councilId, councilId));
  }

  findActiveByCouncilId(councilId: string): Promise<CouncilChannel[]> {
    return this.db
      .select()
      .from(councilChannel)
      .where(
        and(
          eq(councilChannel.councilId, councilId),
          eq(councilChannel.active, true),
        ),
      );
  }

  async findByCouncilIdAndAsset(
    councilId: string,
    assetCode: string,
  ): Promise<CouncilChannel | undefined> {
    const [row] = await this.db
      .select()
      .from(councilChannel)
      .where(
        and(
          eq(councilChannel.councilId, councilId),
          eq(councilChannel.assetCode, assetCode),
          eq(councilChannel.active, true),
        ),
      )
      .limit(1);
    return row;
  }

  async create(data: NewCouncilChannel): Promise<CouncilChannel> {
    const [row] = await this.db
      .insert(councilChannel)
      .values(data)
      .returning();
    return row;
  }

  async update(
    id: string,
    data: Partial<Omit<NewCouncilChannel, "id">>,
  ): Promise<CouncilChannel | undefined> {
    const [row] = await this.db
      .update(councilChannel)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(councilChannel.id, id))
      .returning();
    return row;
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.db
      .delete(councilChannel)
      .where(eq(councilChannel.id, id))
      .returning();
    return result.length > 0;
  }
}
