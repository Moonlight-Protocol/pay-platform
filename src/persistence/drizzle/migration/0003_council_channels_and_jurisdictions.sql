-- Normalize councils: extract channels and jurisdictions into proper tables.
-- A council can have multiple assets (one channel per asset) and serve
-- multiple jurisdictions. The old schema had these as single columns
-- (privacy_channel_id, asset_id, jurisdiction_codes) which limited
-- a council to one asset and used comma-separated jurisdiction codes.

-- New table: one row per asset channel per council
CREATE TABLE IF NOT EXISTS "council_channels" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "council_id" uuid NOT NULL REFERENCES "councils" ("id") ON DELETE CASCADE,
  "asset_code" text NOT NULL,
  "asset_contract_id" text NOT NULL,
  "privacy_channel_id" text NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_by" text,
  "updated_by" text,
  "deleted_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "council_channels_council_id_idx" ON "council_channels" ("council_id");

-- New table: one row per jurisdiction per council
CREATE TABLE IF NOT EXISTS "council_jurisdictions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "council_id" uuid NOT NULL REFERENCES "councils" ("id") ON DELETE CASCADE,
  "country_code" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "council_jurisdictions_council_id_idx" ON "council_jurisdictions" ("council_id");
CREATE UNIQUE INDEX IF NOT EXISTS "council_jurisdictions_unique" ON "council_jurisdictions" ("council_id", "country_code");

-- Migrate existing data from councils to the new tables
INSERT INTO "council_channels" ("council_id", "asset_code", "asset_contract_id", "privacy_channel_id")
SELECT "id", 'XLM', "asset_id", "privacy_channel_id"
FROM "councils"
WHERE "privacy_channel_id" IS NOT NULL AND "asset_id" IS NOT NULL;

-- Split comma-separated jurisdiction_codes into rows
INSERT INTO "council_jurisdictions" ("council_id", "country_code")
SELECT c."id", trim(j.code)
FROM "councils" c,
     unnest(string_to_array(c."jurisdiction_codes", ',')) AS j(code)
WHERE c."jurisdiction_codes" IS NOT NULL AND c."jurisdiction_codes" != '';

-- Drop old columns from councils
ALTER TABLE "councils" DROP COLUMN IF EXISTS "privacy_channel_id";
ALTER TABLE "councils" DROP COLUMN IF EXISTS "asset_id";
ALTER TABLE "councils" DROP COLUMN IF EXISTS "jurisdiction_codes";
