import { expect, it } from "vitest";
import { getAddress as canonicalAddress } from "viem/utils";
import { getAddress } from "./address.js";
it("keeps the original viem checksum behavior behind the validated narrow boundary", () => {
  for (const address of [
    "0x52908400098527886e0f7030069857d2e4169ee7",
    "0xde709f2102306220921060314715629080e2fb77",
    "0x8617E340B3D01FA5F11F306F4090FD50E238070D",
  ]) {
    expect(getAddress(address)).toBe(canonicalAddress(address));
  }
  expect(() => getAddress("invalid")).toThrow();
});
