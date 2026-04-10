-- UC4: receive UTXOs (pre-generated at onboarding) and transaction log.

CREATE TYPE "receive_utxo_status" AS ENUM ('AVAILABLE', 'RESERVED', 'SPENT');
CREATE TYPE "tx_direction" AS ENUM ('IN', 'OUT');
CREATE TYPE "tx_status" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');
CREATE TYPE "tx_method" AS ENUM ('CRYPTO_INSTANT', 'CRYPTO_SELF_CUSTODIAL');

CREATE TABLE IF NOT EXISTS "receive_utxos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "wallet_public_key" text NOT NULL REFERENCES "pay_accounts" ("wallet_public_key") ON DELETE CASCADE,
  "utxo_public_key" text NOT NULL,
  "derivation_index" integer NOT NULL,
  "status" "receive_utxo_status" NOT NULL DEFAULT 'AVAILABLE',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_by" text,
  "updated_by" text,
  "deleted_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "receive_utxos_wallet_status_idx"
  ON "receive_utxos" ("wallet_public_key", "status");

CREATE TABLE IF NOT EXISTS "transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "wallet_public_key" text NOT NULL REFERENCES "pay_accounts" ("wallet_public_key") ON DELETE CASCADE,
  "direction" "tx_direction" NOT NULL,
  "status" "tx_status" NOT NULL DEFAULT 'PENDING',
  "method" "tx_method" NOT NULL,
  "amount_stroops" bigint NOT NULL,
  "fee_stroops" bigint NOT NULL DEFAULT 0,
  "counterparty" text,
  "description" text,
  "bundle_id" text,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_by" text,
  "updated_by" text,
  "deleted_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "transactions_wallet_direction_idx"
  ON "transactions" ("wallet_public_key", "direction");
CREATE INDEX IF NOT EXISTS "transactions_wallet_created_idx"
  ON "transactions" ("wallet_public_key", "created_at" DESC);
