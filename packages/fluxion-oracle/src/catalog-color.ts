import { PNG } from "pngjs";
import { NEUTRAL_ASSET_COLOR } from "@stock-arena/game-core";

/** Generator-only PNG extraction; runtime rendering never decodes remote pixels. */
export function logoColor(bytes: Uint8Array): string {
  try {
    const buffer = Buffer.from(bytes);
    if (
      buffer.length < 24 ||
      buffer.length > 1024 * 1024 ||
      buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
    )
      return NEUTRAL_ASSET_COLOR;
    if (buffer.readUInt32BE(16) > 1024 || buffer.readUInt32BE(20) > 1024)
      return NEUTRAL_ASSET_COLOR;
    const image = PNG.sync.read(buffer),
      bins = new Map<number, { weight: number; r: number; g: number; b: number }>();
    for (let i = 0; i < image.data.length; i += 4) {
      const r = image.data[i]!,
        g = image.data[i + 1]!,
        b = image.data[i + 2]!,
        a = image.data[i + 3]!,
        max = Math.max(r, g, b),
        min = Math.min(r, g, b);
      if (a < 180 || max - min < 30 || max < 45 || min > 225) continue;
      const key = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4),
        weight = (max - min) * a,
        bin = bins.get(key) ?? { weight: 0, r: 0, g: 0, b: 0 };
      bin.weight += weight;
      bin.r += r * weight;
      bin.g += g * weight;
      bin.b += b * weight;
      bins.set(key, bin);
    }
    const best = [...bins.values()].sort((a, b) => b.weight - a.weight)[0];
    return best
      ? "#" +
          [best.r, best.g, best.b]
            .map((v) =>
              Math.round(v / best.weight)
                .toString(16)
                .padStart(2, "0"),
            )
            .join("")
      : NEUTRAL_ASSET_COLOR;
  } catch {
    return NEUTRAL_ASSET_COLOR;
  }
}
