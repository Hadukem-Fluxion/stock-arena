# Official brand assets

Hadukem supplied the official campaign-approved SVGs for the app's dark theme:

- `mantle-dark.svg`: full Mantle logo, used in the footer.
- `mantle-mark-dark.svg`: Mantle symbol, used beside mStocks Arena in the header.
- `fluxion-dark.svg`: Fluxion logo, used in the footer.
- `fluxion-mark.png`: Fluxion symbol supplied by Hadukem for the Flyer bird; original PNG preserved without changes.
- `xstocks-mark.svg`: xStocks symbol, used in the circular StockLogo badge and beside the xStocks name in the footer.

The app uses a dark theme only; no light-background variants are needed. Preserve
the original files, proportions and colors; do not recreate or substitute logos.
The full xStocks name is shown in the footer; stock badges contain only its mark.

Stock logos use the `logo` URLs from the xStocks public assets API, stored with
the public token metadata in `packages/game-core/src/assets.ts`.

The visual guide and supplied prototypes live in `docs/design/`; they are
references for T08, not executable app templates.
