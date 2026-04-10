import { eq, desc, and, sql } from "drizzle-orm";
import {
  transaction,
  type NewTransaction,
  type Transaction,
} from "@/persistence/drizzle/entity/transaction.entity.ts";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";

export class TransactionRepository {
  constructor(private readonly db: DrizzleClient) {}

  async create(data: NewTransaction): Promise<Transaction> {
    const [row] = await this.db.insert(transaction).values(data).returning();
    return row;
  }

  async findById(id: string): Promise<Transaction | undefined> {
    const [row] = await this.db
      .select()
      .from(transaction)
      .where(eq(transaction.id, id))
      .limit(1);
    return row;
  }

  async findByWallet(
    walletPublicKey: string,
    opts?: { direction?: "IN" | "OUT"; limit?: number; offset?: number },
  ): Promise<Transaction[]> {
    const conditions = [eq(transaction.walletPublicKey, walletPublicKey)];
    if (opts?.direction) {
      conditions.push(eq(transaction.direction, opts.direction));
    }
    return this.db
      .select()
      .from(transaction)
      .where(and(...conditions))
      .orderBy(desc(transaction.createdAt))
      .limit(opts?.limit ?? 50)
      .offset(opts?.offset ?? 0);
  }

  /** Sum of completed IN minus completed OUT, in stroops. */
  async getBalance(walletPublicKey: string): Promise<bigint> {
    const [row] = await this.db
      .select({
        balance: sql<string>`
          COALESCE(
            SUM(CASE WHEN direction = 'IN' AND status = 'COMPLETED' THEN amount_stroops ELSE 0 END) -
            SUM(CASE WHEN direction = 'OUT' AND status = 'COMPLETED' THEN amount_stroops + fee_stroops ELSE 0 END),
            0
          )`,
      })
      .from(transaction)
      .where(eq(transaction.walletPublicKey, walletPublicKey));
    return BigInt(row?.balance ?? "0");
  }

  async updateStatus(
    id: string,
    status: "PENDING" | "COMPLETED" | "FAILED",
    bundleId?: string,
  ): Promise<Transaction | undefined> {
    const updates: Partial<NewTransaction> & { updatedAt: Date; completedAt?: Date } = {
      status,
      updatedAt: new Date(),
    };
    if (bundleId) updates.bundleId = bundleId;
    if (status === "COMPLETED") updates.completedAt = new Date();
    const [row] = await this.db
      .update(transaction)
      .set(updates)
      .where(eq(transaction.id, id))
      .returning();
    return row;
  }
}
