import { NEUTRAL_ASSET_COLOR } from "@stock-arena/game-core";
import { assetLogoUrl } from "../components/AssetLogo.js";
export function buildingColor(color?: string): string {
  return color && /^#[\da-f]{6}$/i.test(color) ? color : NEUTRAL_ASSET_COLOR;
}
/** Only nearby company images are retained, never hundreds of decoded logos. */
export function logoCache(
  discord: boolean,
  makeImage: () => HTMLImageElement = () => new Image(),
  limit = 16,
) {
  const entries = new Map<string, HTMLImageElement>();
  return {
    get(url: string) {
      let src: string;
      try {
        src = assetLogoUrl(url, discord);
        if (!src.startsWith("/") && new URL(src).protocol !== "https:") return null;
      } catch {
        return null;
      }
      let image = entries.get(src);
      if (image) {
        entries.delete(src);
        entries.set(src, image);
        return image;
      }
      image = makeImage();
      // Canvas is display-only: do not require CORS permission from official logo CDNs.
      // No pixel reads or canvas exports are performed after drawing these images.
      image.src = src;
      entries.set(src, image);
      if (entries.size > limit) entries.delete(entries.keys().next().value!);
      return image;
    },
    size: () => entries.size,
  };
}
