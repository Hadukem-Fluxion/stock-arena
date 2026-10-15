import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiPort = process.env.API_PORT ?? "8787";

export default defineConfig({
  plugins: [react()],
  envDir: "../..",
  server: {
    port: 5173,
    // Needed when the dev server is reached through a tunnel (Discord / Telegram testing).
    allowedHosts: true,
    // The app always calls relative /api paths; Discord's proxy maps /api the same way in production.
    proxy: {
      "/api": { target: `http://localhost:${apiPort}`, changeOrigin: true },
    },
  },
});
