import { expect, it } from "vitest";
import { mantle as canonicalMantle } from "viem/chains";
import { mantle } from "./mantle.js";
it("preserves the exact pinned viem Mantle network and multicall metadata", () => {
  for (const key of [
    "id",
    "name",
    "nativeCurrency",
    "rpcUrls",
    "blockExplorers",
    "contracts",
  ] as const)
    expect(mantle[key]).toEqual(canonicalMantle[key]);
});
