-- Flip the receive-UTXO model:
--   * Drop the pre-pool table + its enum.
--   * Add the encrypted delegation key column on pay_accounts so the backend
--     can derive merchant UTXO keypairs on demand.

DROP TABLE IF EXISTS "receive_utxos";
--> statement-breakpoint
DROP TYPE IF EXISTS "receive_utxo_status";
--> statement-breakpoint
ALTER TABLE "pay_accounts" ADD COLUMN "encrypted_delegation_key" text;
