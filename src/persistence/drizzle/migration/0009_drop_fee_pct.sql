-- Merchant-fee concept removed from the instant-payment flow. Drop the
-- fee_pct column from pay_accounts; the bundle's fee is a fixed
-- BUNDLE_FEE applied server-side at execute time, not per-merchant.

ALTER TABLE "pay_accounts" DROP COLUMN IF EXISTS "fee_pct";
