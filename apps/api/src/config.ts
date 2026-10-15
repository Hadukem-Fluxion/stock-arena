import { z } from "zod";

const portSchema = z.coerce.number().int().min(1).max(65_535);

export function readApiPort(env: { PORT?: string; API_PORT?: string } = process.env): number {
  const parsed = portSchema.safeParse(env.PORT ?? env.API_PORT ?? 8787);
  if (!parsed.success) throw new Error("Invalid API port configuration.");
  return parsed.data;
}
