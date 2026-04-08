import { eq } from "drizzle-orm";
import {
  payAccount,
  type PayAccount,
  type NewPayAccount,
} from "@/persistence/drizzle/entity/pay-account.entity.ts";
import type { DrizzleClient } from "@/persistence/drizzle/config.ts";

export class PayAccountRepository {
  constructor(private readonly db: DrizzleClient) {}

  async findByPublicKey(walletPublicKey: string): Promise<PayAccount | undefined> {
    const [row] = await this.db
      .select()
      .from(payAccount)
      .where(eq(payAccount.walletPublicKey, walletPublicKey))
      .limit(1);
    return row;
  }

  async create(data: NewPayAccount): Promise<PayAccount> {
    const [row] = await this.db
      .insert(payAccount)
      .values(data)
      .returning();
    return row;
  }

  async update(
    walletPublicKey: string,
    data: Partial<Omit<NewPayAccount, "walletPublicKey">>,
  ): Promise<PayAccount | undefined> {
    const [row] = await this.db
      .update(payAccount)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(payAccount.walletPublicKey, walletPublicKey))
      .returning();
    return row;
  }

  async updateLastSeen(walletPublicKey: string): Promise<void> {
    await this.db
      .update(payAccount)
      .set({ lastSeenAt: new Date() })
      .where(eq(payAccount.walletPublicKey, walletPublicKey));
  }
}
