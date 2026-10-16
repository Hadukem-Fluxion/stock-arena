import { registerDiscordCommands } from "./register-commands.js";

try {
  console.info(`Discord commands registered: ${await registerDiscordCommands(process.env)}.`);
} catch {
  console.error("Discord command registration failed. Check credentials and Discord access.");
  process.exitCode = 1;
}
