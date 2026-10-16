import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createDatabase } from "./client.js";
import { seedQuizBank } from "./quiz-bank.js";

async function main() {
  const args = process.argv.slice(2);
  const path = args[0] ?? process.env.QUIZ_BANK_PATH;
  if (!path || args.length > 1) throw new Error("Missing quiz bank path.");
  const source = await readFile(resolve(path), "utf8");
  const connection = createDatabase();
  if (connection.kind === "postgres")
    connection.db.$client.on("error", () => {
      console.error("Quiz seed database connection failed.");
      process.exitCode = 1;
    });
  try {
    // Migrations are explicit; the seed only upserts the private bank.
    console.info(await seedQuizBank(connection, source));
  } finally {
    await connection.close();
  }
}
try {
  await main();
} catch {
  console.error("Quiz seed failed. Check the input file, migrations and database access.");
  process.exitCode = 1;
}
