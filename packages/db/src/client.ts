import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/node-postgres";
import { migrate as migratePostgres } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import pg from "pg";
import * as schema from "./schema.js";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const localDataDir = fileURLToPath(new URL("../.local/pglite", import.meta.url));

/** Isolated in-memory by default; pass a directory for persistent local storage. */
export function createLocalDatabase(dataDir = "memory://") {
  if (dataDir !== "memory://") mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzlePglite(client, { schema });
  return {
    kind: "pglite" as const,
    db,
    migrate: () => migratePglite(db, { migrationsFolder }),
    close: () => client.close(),
  };
}

/** Explicit empty databaseUrl selects the local fallback, even when the env is set. */
export function createDatabase(options: { databaseUrl?: string; dataDir?: string } = {}) {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) return createLocalDatabase(options.dataDir ?? localDataDir);

  const client = new pg.Pool({ connectionString: databaseUrl });
  const db = drizzlePostgres(client, { schema });
  return {
    kind: "postgres" as const,
    db,
    migrate: () => migratePostgres(db, { migrationsFolder }),
    close: () => client.end(),
  };
}

export type DatabaseConnection = ReturnType<typeof createDatabase>;
