import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import console from "node:console";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

export function validateOhioEnvironment(env) {
  let database;
  try {
    database = new URL(env.DATABASE_URL ?? "");
  } catch {
    throw new Error("Invalid Ohio configuration.");
  }
  const filled = (value) =>
    typeof value === "string" &&
    value.length > 0 &&
    !/CHANGE_ME|GENERATE_WITH|SUA.SENHA|PLACEHOLDER/i.test(value);
  if (
    database.hostname !== "aws-0-us-east-2.pooler.supabase.com" ||
    database.username !== "postgres.fhslaelrgoiibblgfinu" ||
    database.port !== "5432" ||
    database.pathname !== "/postgres" ||
    database.searchParams.get("sslmode") !== "require" ||
    !filled(database.password) ||
    env.DISCORD_CLIENT_ID !== "1560368721216938175" ||
    !filled(env.DISCORD_CLIENT_SECRET) ||
    !/^[a-fA-F0-9]{64}$/.test(env.DISCORD_PUBLIC_KEY ?? "") ||
    !/^\d+:[A-Za-z0-9_-]+$/.test(env.TELEGRAM_BOT_TOKEN ?? "") ||
    env.TELEGRAM_BOT_USERNAME !== "mStocksArenaBot" ||
    env.ADMIN_WEB_ORIGIN !== "https://mstocks-arena.vercel.app" ||
    env.OWNER_DISCORD_ID !== "1225988280596824094" ||
    env.TELEGRAM_WEBHOOK_URL !== "https://77-114-44-78.sslip.io/api/telegram/webhook"
  )
    throw new Error("Invalid Ohio configuration.");
}

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
    const args = process.argv.slice(2);
    let env = process.env;
    if (args.length === 3 && args[1] === "--file") env = parseEnv(readFileSync(args[2], "utf8"));
    else if (args.length !== 1) throw new Error("Invalid arguments.");
    validateEnvironment(args[0], env);
    if (args.length === 3) validateOhioEnvironment(env);
    console.info("Hosting environment valid; no values displayed.");
  } catch {
    console.error("Hosting environment is incomplete or invalid; no values displayed.");
    process.exitCode = 1;
  }
}
