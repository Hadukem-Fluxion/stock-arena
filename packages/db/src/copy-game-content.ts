import { createDatabase } from "./client.js";
import type { DatabaseConnection } from "./client.js";
import { copyGameContent, gameContentUrls } from "./game-content.js";

/** Never loads .env implicitly, migrates a database or serializes bank content. */
async function main() {
  if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== "--dry-run"))
    throw new Error();
  const [oldUrl, newUrl] = gameContentUrls(process.env);
  const connections: DatabaseConnection[] = [];
  try {
    for (const databaseUrl of [oldUrl!, newUrl!]) {
      const connection = createDatabase({ databaseUrl, connectTimeoutMs: 10000 });
      connections.push(connection);
      if (connection.kind === "postgres")
        connection.db.$client.on("error", () => {
          console.error("Content copy connection failed; no values displayed.");
          process.exitCode = 1;
        });
    }
    const counts = await copyGameContent(
      connections[0]!,
      connections[1]!,
      process.argv[2] === "--dry-run",
    );
    if (!process.exitCode) console.info(JSON.stringify(counts));
  } finally {
    await Promise.allSettled(connections.map((connection) => connection.close()));
  }
}
try {
  await main();
} catch {
  console.error(
    "Game content copy failed. Check configuration, migrations and fresh destination; no values displayed.",
  );
  process.exitCode = 1;
}
