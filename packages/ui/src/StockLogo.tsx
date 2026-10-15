import { useState } from "react";
import { ASSETS } from "@stock-arena/game-core";
import type { Ticker } from "@stock-arena/game-core";

export type StockLogoProps = {
  ticker: Ticker;
  size?: number;
  showBadge?: boolean;
  alt?: string;
};

/** The stock image comes from the public xStocks asset metadata. */
export function StockLogo({ ticker, size = 56, showBadge = true, alt = "" }: StockLogoProps) {
  const src = ASSETS[ticker].logo;
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const badgeSize = Math.max(12, Math.round(size * 0.4));
  return (
    <span
      className="stock-logo"
      style={{
        position: "relative",
        display: "inline-flex",
        width: size,
        height: size,
        flexShrink: 0,
        verticalAlign: "middle",
      }}
    >
      {loadedSource !== src && (
        <span
          aria-label={alt || undefined}
          style={{
            display: "grid",
            placeItems: "center",
            width: "100%",
            height: "100%",
            borderRadius: "50%",
            background: "var(--surface-2)",
            color: "var(--text)",
            fontSize: size * 0.23,
          }}
        >
          {ticker}
        </span>
      )}
      {failedSource !== src && (
        <img
          src={src}
          alt={alt}
          width={size}
          height={size}
          onError={() => setFailedSource(src)}
          onLoad={() => setLoadedSource(src)}
          style={{
            position: "absolute",
            inset: 0,
            visibility: loadedSource === src ? "visible" : "hidden",
            display: "block",
            objectFit: "cover",
            borderRadius: "50%",
            width: "100%",
            height: "100%",
          }}
        />
      )}
      {showBadge && (
        <span
          className="stock-logo-badge"
          aria-hidden="true"
          style={{
            position: "absolute",
            right: -2,
            bottom: -2,
            width: badgeSize,
            height: badgeSize,
            display: "grid",
            placeItems: "center",
            borderRadius: "50%",
            background: "var(--bg)",
            border: "1px solid var(--line)",
            padding: Math.max(3, Math.round(badgeSize * 0.18)),
          }}
        >
          <img
            src="/brand/xstocks-mark.svg"
            alt=""
            width={badgeSize}
            height={badgeSize}
            style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }}
          />
        </span>
      )}
    </span>
  );
}
