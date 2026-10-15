import { createVercelConfig } from "./src/deploy-config.js";

// Evaluated by Vercel before building the static Vite app.
export const config = createVercelConfig(process.env.RAILWAY_API_URL);
