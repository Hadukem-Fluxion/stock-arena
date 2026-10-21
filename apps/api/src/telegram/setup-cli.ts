import { setupTelegram } from "./setup.js";

try {
  console.info(`Telegram setup complete: ${await setupTelegram(process.env)} settings applied.`);
} catch {
  console.error(
    "Telegram setup failed. Check bot credentials, webhook secret and Telegram access.",
  );
  process.exitCode = 1;
}
