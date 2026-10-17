import { z } from "zod";
import type { PricesView } from "@stock-arena/game-core";
import type { Session } from "../platform/types.js";
import { assetSchema } from "../checkin/client.js";

export const pricesSchema: z.ZodType<PricesView, z.ZodTypeDef, unknown> = z
  .object({
    serverTime: z.string().datetime(),
    catalog: z.record(assetSchema).refine((value) => Object.keys(value).length > 0),
    prices: z.array(
      z
        .object({
          ticker: z.string().min(1),
          priceUsd: z
            .string()
            .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0)
            .nullable(),
          takenAt: z.string().datetime().nullable(),
          change24hPct: z.number().finite().nullable(),
          state: z.enum(["live", "paused"]),
          reason: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict()
  .refine(
    (view) =>
      view.prices.every((price) => Boolean(view.catalog[price.ticker])) &&
      new Set(view.prices.map((price) => price.ticker)).size === view.prices.length,
  );
export class PriceStreamError extends Error {
  constructor(public readonly code: "session" | "network") {
    super(code);
  }
}

/** Fetch streams support bearer headers in both platform proxies; EventSource cannot. */
export async function readPrices(
  session: Session,
  onView: (view: PricesView) => void,
  signal: AbortSignal,
  request: typeof fetch = fetch,
) {
  const response = await request("/api/prices/stream", {
    headers: { Authorization: `Bearer ${session.token}`, Accept: "text/event-stream" },
    cache: "no-store",
    signal,
  });
  if (response.status === 401 || response.status === 403) throw new PriceStreamError("session");
  if (
    !response.ok ||
    !response.headers.get("content-type")?.startsWith("text/event-stream") ||
    !response.body
  )
    throw new Error("Price stream unavailable.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      if (buffer.length > 256 * 1024) throw new Error("Invalid price stream.");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const lines = frame.split("\n");
        if (!lines.some((line) => line === "event: prices")) continue;
        const data = lines
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        onView(pricesSchema.parse(JSON.parse(data) as unknown));
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
