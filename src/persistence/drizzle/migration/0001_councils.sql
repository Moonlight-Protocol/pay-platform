-- UC4: councils and council PPs for jurisdiction-based transaction routing.
-- Moonlight Pay picks a council that covers both payer and receiver
-- jurisdictions, then picks a PP within that council to submit bundles to.

CREATE TABLE IF NOT EXISTS "councils" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "channel_auth_id" text NOT NULL,
  "privacy_channel_id" text NOT NULL,
  "asset_id" text NOT NULL,
  "network_passphrase" text NOT NULL,
  "jurisdiction_codes" text NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_by" text,
  "updated_by" text,
  "deleted_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "council_pps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "council_id" uuid NOT NULL REFERENCES "councils" ("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "url" text NOT NULL,
  "public_key" text NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_by" text,
  "updated_by" text,
  "deleted_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "council_pps_council_id_idx" ON "council_pps" ("council_id");
