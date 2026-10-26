# Versioned public S&P 500 reference catalog

Snapshot date: **2026-10-26**. There are 503 constituent ticker entries (including
share classes), 1,374 available public xStocks assets and **468 matched stocks**.
This is a dated reference list, not a claim of real-time index membership.
The seven `ASSETS` core stocks are independently maintained and are never changed
by this generator. Extended membership does not assert a Mantle deployment.

- Constituents: [DataHub S&P 500 Companies](https://github.com/datasets/s-and-p-500-companies),
  pinned revision `2f083ae70907cca3b644a94744dde87f3199fc5b` in `manifest.json`.
  Its [metadata](https://github.com/datasets/s-and-p-500-companies/blob/2f083ae70907cca3b644a94744dde87f3199fc5b/datapackage.json)
  licenses the data under [PDDL 1.0](https://opendatacommons.org/licenses/pddl/1-0/).
  The upstream list attributes its underlying source to Wikipedia.
- Availability, symbols and official logo URLs:
  [xStocks public assets](https://api.backed.fi/api/v2/public/assets?page=1&pageSize=100).
  `xstocks-2026-10-26.json` keeps only public reference metadata and any explicitly
  published Mantle addresses. Company names, marks and S&P index names belong to
  their owners. Inclusion is not a trading or campaign eligibility assertion.
- `logo-colors.json` caches one extracted dominant color and PNG SHA-256 per
  official logo URL. Transparent/monochrome, failed or invalid logos use neutral
  `#7c8b9e`. Official logos are displayed unchanged; no logo files are regenerated.

Run `pnpm catalog:generate` to reproduce `src/catalog/extended.generated.ts`
**offline**, including its content-derived version. Run
`pnpm catalog:generate --refresh` to fetch the pinned list, paginate the public
API and update changed logo colors. `--refresh --refresh-logos` rebuilds all colors.
To change the constituent date, edit the manifest/revision explicitly, refresh,
review the diff and submit a PR. Refreshing xStocks availability is deliberately
an operator action, never a startup/CI network request. The generator excludes
ETFs/funds and unmatched tickers; underlying class symbols normalize `-` to `.`.

The `provider` field controls product/brand configuration; `priceSymbol` separately
selects the xStocks reference quote. Future provider changes require a reviewed
catalog/config change, not a rewrite of the simulator or renderer. Addresses are
optional and never inferred for unlisted networks.
