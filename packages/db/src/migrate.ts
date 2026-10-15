import { createDatabase } from "./client.js";

async function main() {
  const connection = createDatabase();
  try {
    await connection.migrate();
    console.info(`Database migrations applied (${connection.kind}).`);
  } finally {
    await connection.close();
  }
}

try {
  await main();
} catch {
  // Database errors can contain connection strings or SQL parameters.
  console.error("Database migration failed. Check database access and migration files.");
  process.exitCode = 1;
}
