import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
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

  const defaultCa = fileURLToPath(new URL("../certs/supabase-ca.crt", import.meta.url));
  const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const caPath = process.env.DATABASE_SSL_CA
    ? resolve(repositoryRoot, process.env.DATABASE_SSL_CA)
    : defaultCa;
  const ca = readFileSync(caPath, "utf8");
  // pg connection-string SSL parameters override the explicit ssl object.
  // Always use the configured CA and require certificate/hostname verification.
  const connectionUrl = new URL(databaseUrl);
  for (const parameter of ["sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"]) {
    connectionUrl.searchParams.delete(parameter);
  }
  const client = new pg.Pool({
    connectionString: connectionUrl.toString(),
    ssl: { ca, rejectUnauthorized: true },
  });
  const db = drizzlePostgres(client, { schema });
  return {
    kind: "postgres" as const,
    db,
    migrate: () => migratePostgres(db, { migrationsFolder }),
    close: () => client.end(),
  };
}

export type DatabaseConnection = ReturnType<typeof createDatabase>;
