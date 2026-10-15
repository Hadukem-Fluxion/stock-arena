# mStocks Arena — design reference (T08 onward)

Source: the Claude prototype (two screens). `prototype-mobile.html` = mobile, clickable. `prototype-desktop.html` = desktop as a Discord Activity. Both files are plain HTML with inline styles; read them for exact layout. Ignore the `<x-dc>`, `<sc-if>`, `<sc-for>` and `{{…}}` syntax: it is the prototype tool's templating, not something to copy. Image paths like `/_blob/...` are prototype uploads; in the app use `apps/web/public/brand/*` and the xStocks `logo` URLs from `assets.ts`.

## Tokens

| Token       | Value     | Use                                                     |
| ----------- | --------- | ------------------------------------------------------- |
| bg          | `#0B0E11` | page background                                         |
| surface     | `#151A1F` | cards                                                   |
| surface-2   | `#1C232A` | inner fills, progress track                             |
| nav-bg      | `#0F1316` | bottom tab bar                                          |
| line        | `#26303A` | borders                                                 |
| text        | `#EEF2F4` | primary text                                            |
| text-2      | `#C9D2DA` | body copy on cards                                      |
| muted       | `#9AA6B2` | labels, captions                                        |
| accent      | `#1FD59A` | primary buttons, active states, borders of "good" state |
| accent-ink  | `#06261A` | text on accent buttons                                  |
| accent-text | `#7FE3C0` | positive numbers, points                                |
| accent-tint | `#10261E` | background of success / selected-correct                |
| down        | `#FF9B73` | negative change, wrong answer                           |
| down-tint   | `#2A1A14` | background of wrong answer                              |

Up/down always pair color with an arrow (▲ / ▼) so it never relies on color alone.

## Type

- Display: Space Grotesk 700 (titles, tickers, card names).
- Body: IBM Plex Sans 400/500/600.
- Numbers (prices, points, timers, %): IBM Plex Mono 500/600.
- Sizes: page title 24 (mobile) / 30 (desktop); card title 17; body 14–16; captions 12–13; ticker on big cards 20–32.

## Shape and spacing

- Radius: cards 18–24, buttons 12–14, pills 999.
- Spacing scale: 4, 8, 12, 16, 20, 24, 32. Mobile side padding 20; desktop 32.
- Touch targets ≥ 44px. Primary button height 48 (mobile).

## Layout

- **Mobile (360–767px):** header (Mantle symbol + "mStocks Arena", streak pill, points pill), scrolling content, bottom tab bar Play / Leaderboard / Profile.
- **Desktop (≥ 1024px):** header with tabs inline; three columns `340px | 1fr | 340px` — left: Stock of the Day + game list; center: the active game; right: Magnificent 7 prices + today's top 5. Footer bar with brands and legal notice.
- **Tablet (768–1023px):** two columns (games | active game), prices and ranking below.

## Components

- **StockLogo:** company logo in a circle (`object-fit: cover; border-radius: 50%`) with a round xStocks badge at bottom-right (dark circle, xStocks mark inside). Sizes used: 28, 32, 40, 48, 72.
- **Price row:** StockLogo · ticker + company · price (mono) · 24h change with arrow (mono, colored).
- **Game tile:** title, one-line rule, points line in accent-text.
- **Answer option:** full-width button; after answering, correct = accent border + accent-tint, picked-wrong = down border + down-tint; then show verdict + explanation + Next.
- **Footer:** "Prices · xStocks mark", "Trade on · Fluxion logo", "Built on · Mantle logo", then the legal line with the approved xStocks notice and link.

## Copy

All player-facing strings come from `apps/web/src/copy/en.ts`. The prototype's texts are the reference wording.
