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

// ── Migration runner ──────────────────────────────────────────────────
// Read migration files from the drizzle migration folder at runtime,
// using _journal.json for ordering. This keeps tests in sync with the
// actual schema without maintaining hardcoded SQL.

const MIGRATION_FOLDER = new URL(
  "../src/persistence/drizzle/migration",
  import.meta.url,
).pathname;

interface JournalEntry {
  idx: number;
  tag: string;
}

async function runMigrations(pg: PGlite): Promise<void> {
  const journalRaw = await Deno.readTextFile(
    `${MIGRATION_FOLDER}/meta/_journal.json`,
  );
  const journal = JSON.parse(journalRaw);
  const entries: JournalEntry[] = journal.entries;

  for (const entry of entries) {
    const sql = await Deno.readTextFile(
      `${MIGRATION_FOLDER}/${entry.tag}.sql`,
    );
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s: string) => s.trim())
      .filter(Boolean);

    for (const stmt of statements) {
      await pg.exec(stmt);
    }
  }
}

type PGliteDrizzle = ReturnType<typeof drizzle<typeof schema>>;

let pg: PGlite;
let _drizzleClient: PGliteDrizzle;
let _initialized = false;

async function ensureInitialized() {
  if (_initialized) return;

  pg = new PGlite();
  await runMigrations(pg);

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
