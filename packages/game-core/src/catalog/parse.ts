import { z } from "zod";
import type { ReferenceAsset, ReferenceCatalog } from "../assets.js";
const address = z.custom<`0x${string}`>((v) => typeof v === "string" && /^0x[\da-f]{40}$/i.test(v));
const asset: z.ZodType<ReferenceAsset> = z
  .object({
    name: z.string().min(1),
    provider: z.literal("xstocks"),
    symbol: z.string().min(1),
    priceSymbol: z.string().min(1).optional(),
    referenceTicker: z.string().min(1),
    logo: z.string().url(),
    tradeUrl: z.string().url(),
    primaryColor: z
      .string()
      .regex(/^#[\da-f]{6}$/i)
      .optional(),
    token: address.optional(),
    wrapped: address.optional(),
    pool: address.optional(),
  })
  .strict();
const schema = z
  .object({
    version: z.string().min(1),
    metadata: z
      .object({
        asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        constituentRevision: z.string().regex(/^[\da-f]{40}$/),
        constituents: z.number().int().positive(),
        availableAssets: z.number().int().positive(),
        matchedStocks: z.number().int().positive(),
      })
      .strict(),
    assets: z.record(asset),
  })
  .strict();
export function parseCatalog(input: unknown): {
  version: string;
  metadata: z.infer<typeof schema>["metadata"];
  assets: ReferenceCatalog;
} {
  const parsed = schema.parse(input);
  if (
    Object.keys(parsed.assets).length !== parsed.metadata.matchedStocks ||
    Object.entries(parsed.assets).some(([ticker, a]) => a.referenceTicker !== ticker)
  )
    throw new Error("Invalid generated catalog.");
  return parsed;
}
