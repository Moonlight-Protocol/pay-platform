// deno-lint-ignore-file no-explicit-any
/**
 * PGlite-backed test database for integration tests.
 *
 * Uses PGlite (in-memory PostgreSQL via WASM) with Drizzle ORM, giving us
 * real SQL, real transactions, and real constraints without an external
 * PostgreSQL server.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/persistence/drizzle/entity/index.ts";

const MIGRATION = `
  CREATE TABLE IF NOT EXISTS pay_accounts (
    wallet_public_key TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    jurisdiction_country_code TEXT NOT NULL,
    display_name TEXT,
    opex_public_key TEXT,
    encrypted_opex_sk TEXT,
    fee_pct NUMERIC(5,2),
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT,
    updated_by TEXT,
    deleted_at TIMESTAMPTZ
  );
`;

type PGliteDrizzle = ReturnType<typeof drizzle<typeof schema>>;

let pg: PGlite;
let _drizzleClient: PGliteDrizzle;
let _initialized = false;

async function ensureInitialized() {
  if (_initialized) return;

  pg = new PGlite();
  await pg.exec(MIGRATION);

  _drizzleClient = drizzle({ client: pg, schema });
  _initialized = true;
}

// Lazy proxy so modules that import drizzleClient at load time work correctly.
const drizzleClientProxy: PGliteDrizzle = new Proxy({} as PGliteDrizzle, {
  get(_target, prop) {
    if (!_initialized) {
      throw new Error(
        "PGlite not initialized. Call ensureInitialized() before using drizzleClient.",
      );
    }
    const val = (_drizzleClient as any)[prop];
    return typeof val === "function" ? val.bind(_drizzleClient) : val;
  },
});

export const drizzleClient = drizzleClientProxy;
export type DrizzleClient = PGliteDrizzle;

export { ensureInitialized };

/** Truncate all tables. Call between tests for a clean slate. */
export async function resetDb(): Promise<void> {
  await ensureInitialized();
  await pg.exec(`TRUNCATE TABLE pay_accounts CASCADE;`);
}

/** Shut down PGlite. Call after all tests are done. */
export async function closeDb(): Promise<void> {
  if (_initialized) {
    await pg.close();
    _initialized = false;
  }
}
