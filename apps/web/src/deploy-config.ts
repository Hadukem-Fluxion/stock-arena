import type { VercelConfig } from "@vercel/config/v1";
import { z } from "zod";

const originSchema = z
  .string()
  .url()
  .transform((value, context) => {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Expected an HTTPS origin." });
      return z.NEVER;
    }
    return url.origin;
  });

/** Build-time only; never expose the upstream setting through VITE_* or client code. */
export function createVercelConfig(apiUrl: string | undefined): VercelConfig {
  const parsed = originSchema.safeParse(apiUrl);
  if (!parsed.success) throw new Error("Set RAILWAY_API_URL to the Railway API HTTPS origin.");
  return {
    framework: "vite",
    installCommand: "pnpm install --frozen-lockfile",
    buildCommand: "pnpm build",
    outputDirectory: "dist",
    rewrites: [
      { source: "/api/:path*", destination: `${parsed.data}/api/:path*` },
      { source: "/:path*", destination: "/index.html" },
    ],
  };
}
