import { createLocalDatabase } from "./client.js";

/** Fresh migrated Postgres engine for tests; never reads DATABASE_URL. */
export async function createTestDatabase() {
  const connection = createLocalDatabase();
  try {
    await connection.migrate();
    return connection;
  } catch (error) {
    await connection.close();
    throw error;
  }
}
