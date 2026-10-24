import { createVercelConfigFromEnv } from "./src/deploy-config.js";

// Evaluated by Vercel before building the static Vite app.
export const config = createVercelConfigFromEnv(process.env);
