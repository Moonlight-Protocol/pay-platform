CREATE TABLE IF NOT EXISTS "pay_accounts" (
	"wallet_public_key" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"jurisdiction_country_code" text NOT NULL,
	"display_name" text,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone
);
