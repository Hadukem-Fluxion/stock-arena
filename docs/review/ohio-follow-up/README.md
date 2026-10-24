# Ohio cutover follow-up

These captures use synthetic catalog entries, prices, facts and sessions. No real
quiz content, accounts, credentials or database was read. Home and Markets show
"Prices resume when the market opens" when a closed asset has no saved primary
quote. An available pool remains informational and does not replace that quote.

| Screen  | 390px                           | 1440px                            |
| ------- | ------------------------------- | --------------------------------- |
| Home    | [Mobile](empty-home-390.png)    | [Desktop](empty-home-1440.png)    |
| Markets | [Mobile](empty-markets-390.png) | [Desktop](empty-markets-1440.png) |

The market e2e suite covers catalogs of 3 and 30 assets, absence of primary
history, retained quotes, informational pools and a stale/outage state that must
not promise a market reopening. The full web suite also covers browser preview,
Telegram and a simulated Discord parent using the actual embedded SDK.

Linux tests run the real `smoke-test.sh --live` with mocked curl and an accelerated
shell deadline. They cover TLS, empty/malformed JSON, unhealthy responses,
recovery, the 60-second cutoff and a failed local API. No network or Compose
operation is executed by these tests. POSIX-only tests are skipped on Windows;
Linux CI also exercises isolated containers and migrations, not the live stack.

The Caddyfile was formatted with the pinned official Caddy 2.11.7 binary. No
dependency versions, game rules, ledger history or migration files changed.
