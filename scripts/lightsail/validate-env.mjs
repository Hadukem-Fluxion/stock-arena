import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import console from "node:console";
import { resolve } from "node:path";

export function validateEnvironment(role, env) {
  if (!["api", "worker", "migrate"].includes(role)) throw new Error("Invalid service.");
  let url;
  try {
    url = new URL(env.DATABASE_URL ?? "");
  } catch {
    throw new Error("Invalid database configuration.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname)
    throw new Error("Postgres is required.");
  const secret = /^[A-Za-z0-9_-]{48}$/;
  if (
    role === "api" &&
    (!secret.test(env.SESSION_SECRET ?? "") ||
      (env.TELEGRAM_BOT_TOKEN && !secret.test(env.TELEGRAM_WEBHOOK_SECRET ?? "")))
  )
    throw new Error("Invalid service configuration.");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    validateEnvironment(process.argv[2], process.env);
  } catch {
    console.error("Hosting environment is incomplete or invalid; no values displayed.");
    process.exitCode = 1;
  }
}
