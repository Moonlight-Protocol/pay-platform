-- Remove CRYPTO_SELF_CUSTODIAL from tx_method enum.
-- PostgreSQL does not support ALTER TYPE ... REMOVE VALUE, so we swap types.

ALTER TYPE "tx_method" RENAME TO "tx_method_old";

CREATE TYPE "tx_method" AS ENUM ('CRYPTO_INSTANT');

ALTER TABLE "transactions"
  ALTER COLUMN "method" TYPE "tx_method"
  USING "method"::text::"tx_method";

DROP TYPE "tx_method_old";
