import { eq, and, inArray, sql } from "drizzle-orm";
import {
  receiveUtxo,
  type NewReceiveUtxo,
  type ReceiveUtxo,
} from "@/persistence/drizzle/entity/receive-utxo.entity.ts";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";

export class ReceiveUtxoRepository {
  constructor(private readonly db: DrizzleClient) {}

  async bulkCreate(rows: NewReceiveUtxo[]): Promise<ReceiveUtxo[]> {
    if (rows.length === 0) return [];
    return this.db.insert(receiveUtxo).values(rows).returning();
  }

  async countByWallet(walletPublicKey: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(receiveUtxo)
      .where(eq(receiveUtxo.walletPublicKey, walletPublicKey));
    return row?.count ?? 0;
  }

  async findAvailable(
    walletPublicKey: string,
    limit: number,
  ): Promise<ReceiveUtxo[]> {
    return this.db
      .select()
      .from(receiveUtxo)
      .where(
        and(
          eq(receiveUtxo.walletPublicKey, walletPublicKey),
          eq(receiveUtxo.status, "AVAILABLE"),
        ),
      )
      .limit(limit);
  }

  async reserve(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .update(receiveUtxo)
      .set({ status: "RESERVED", updatedAt: new Date() })
      .where(inArray(receiveUtxo.id, ids));
  }

  async markSpent(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .update(receiveUtxo)
      .set({ status: "SPENT", updatedAt: new Date() })
      .where(inArray(receiveUtxo.id, ids));
  }

  async release(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .update(receiveUtxo)
      .set({ status: "AVAILABLE", updatedAt: new Date() })
      .where(inArray(receiveUtxo.id, ids));
  }
}
