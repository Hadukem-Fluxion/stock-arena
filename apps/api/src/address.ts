import { createRequire } from "node:module";
import { z } from "zod";

// The API needs only this documented runtime function, not viem's utility-wide
// declaration graph. Validate the boundary; keep the original checksum algorithm.
const utilities: unknown = createRequire(import.meta.url)("viem/utils");
export const getAddress = z
  .object({
    getAddress: z
      .function()
      .args(z.string())
      .returns(z.string().regex(/^0x[\da-fA-F]{40}$/)),
  })
  .parse(utilities).getAddress;
