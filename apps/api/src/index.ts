import { buildServer } from "./server.js";
import { readApiPort } from "./config.js";

async function main() {
  const port = readApiPort();
  const app = buildServer();
  try {
    await app.listen({ port, host: "0.0.0.0" });
  } catch {
    await app.close();
    throw new Error("API startup failed.");
  }
  const shutdown = () => {
    void app.close().catch(() => {
      console.error("[api] Shutdown failed.");
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

void main().catch(() => {
  console.error("[api] Startup failed. Check port configuration and service availability.");
  process.exitCode = 1;
});
