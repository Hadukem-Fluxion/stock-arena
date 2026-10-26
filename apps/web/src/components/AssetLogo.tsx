import { StockLogo } from "@stock-arena/ui";
import type { Asset } from "@stock-arena/game-core";
import { en } from "../copy/en.js";

/** Discord images use the specific mapping before the root web mapping. */
export function assetLogoUrl(url: string, discord: boolean): string {
  const parsed = new URL(url);
  return discord && parsed.hostname === "xstocks-metadata.backed.fi"
    ? `/stock-logos${parsed.pathname}${parsed.search}`
    : url;
}
export function AssetLogo({
  ticker,
  asset,
  size,
  discord = false,
}: {
  ticker: string;
  asset: Pick<Asset, "logo" | "provider">;
  size: number;
  discord?: boolean;
}) {
  return (
    <StockLogo
      ticker={ticker}
      logoSrc={assetLogoUrl(asset.logo, discord)}
      badgeSrc={en.providers[asset.provider].badgeSrc}
      size={size}
      showBadge
    />
  );
}
