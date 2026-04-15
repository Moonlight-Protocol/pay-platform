-- Add OpEx account and fee configuration to pay_accounts.
-- The OpEx address receives customer payments for the instant flow;
-- pay-platform uses the encrypted SK to execute moonlight sends.

ALTER TABLE pay_accounts
  ADD COLUMN opex_public_key TEXT,
  ADD COLUMN encrypted_opex_sk TEXT,
  ADD COLUMN fee_pct NUMERIC(5,2);
