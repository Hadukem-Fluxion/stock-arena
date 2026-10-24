# Public statistics API (T35)

`GET https://mstocks-arena.vercel.app/api/public/stats`

Read-only aggregate statistics for Mantle Synch. No login, API key or cookies are
required. The endpoint never returns player IDs, Discord/Telegram IDs, player
names, reward destinations, Bybit UIDs, quiz content or moderation notes. Season
IDs/names are public campaign metadata. No query parameters are accepted.

Example response below uses **invented counts**, not live database data:

```json
{
  "updatedAt": "2026-10-24T12:00:00.000Z",
  "day": "2026-10-24",
  "season": {
    "id": "season-1",
    "name": "Season 1",
    "startsAt": "2026-10-16T00:00:00.000Z",
    "endsAt": null
  },
  "players": { "total": 120, "activeToday": 24 },
  "today": { "checkins": 20, "quizCompleted": 12, "hlPredictions": 18 },
  "games": { "checkin": "active", "quiz": "active", "higherLower": "paused" }
}
```

## Counter definitions

- `updatedAt`: server UTC time when the aggregate snapshot began. Cached requests
  keep the same timestamp. `day` is that timestamp's UTC calendar day.
- `season`: the most recently started database season. An ended season retains
  its end date until another season starts. Returns `null` if none has started;
  upcoming seasons are not selected.
- `players.total`: registered user rows, including moderated accounts. Multiple
  platform identities belonging to one user do not multiply the count.
- `players.activeToday`: distinct users with a check-in, quiz attempt, Higher or
  Lower run start or locked prediction today. A prediction on a run started
  yesterday counts today when locked today. Merely logging in or viewing a page
  is not recorded as gameplay activity.
- `today.checkins`: check-ins for this UTC day.
- `today.quizCompleted`: today's attempts with all configured answers recorded,
  including wrong answers/timeouts; partial attempts are excluded.
- `today.hlPredictions`: picks locked today, regardless of pending/settled/void
  outcome. An offer without a locked pick is excluded. Future timestamps are
  excluded from run/prediction activity.
- `games`: persisted maintenance switches for Check-in, Quiz and Higher or Lower.
  A missing control is reported as paused. These are not ticker/market statuses.

## Cache, CORS and limits

- One aggregate SQL statement per 60-second refresh window **per API process**.
  Concurrent requests share the same in-flight query. UTC midnight invalidates
  the window. A failed refresh also suppresses DB retries for the remainder of
  its window; errors themselves use `Cache-Control: no-store`.
- Successful GET responses use `Cache-Control: public, max-age=60` and
  `Vary: Origin`. The existing Vercel `/api/*` rewrite forwards the endpoint;
  no separate web route or service is needed. HTTP caches may add their own age;
  consumers should display `updatedAt` rather than invent a fresh timestamp.
- CORS grants exactly `https://mantle-synch.netlify.app`, with methods
  `GET, OPTIONS` and no credentials. Other origins receive no CORS allow header.
  This is public data: a non-browser client can still read it without an Origin.
  `OPTIONS` returns 204; other supported HTTP methods, including HEAD, return 405
  with `Allow: GET, OPTIONS`.
- Default HTTP quota: 60 GET/OPTIONS requests per observed IP per fixed UTC
  minute. Set optional API env `PUBLIC_STATS_RATE_LIMIT_PER_MINUTE` to a positive
  integer (at most 100000) to override it. This is a public HTTP resource policy,
  separate from private game anti-abuse rules. Quotas are process-local and the
  in-memory IP map is bounded; no IPs are persisted or returned.
- API remains private behind Caddy. For private/loopback socket peers, this route
  uses only the nearest valid `X-Forwarded-For` address. Public socket peers
  cannot override their quota with that header. Keep Caddy's default handling of
  untrusted forwarded headers; no global proxy trust was enabled. Through Vercel,
  the observed address may be a Vercel edge address shared by multiple callers.
  See [Caddy header handling](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#headers).

Browser example on the approved origin (no credentials or custom auth headers):

```js
const response = await fetch("https://mstocks-arena.vercel.app/api/public/stats", {
  credentials: "omit",
});
if (!response.ok) throw new Error(`Stats request failed (${response.status})`);
const stats = await response.json();
```

Errors return `{ "error": { "code": "..." } }`, without database messages:

| Status | Code                 | Meaning                                                    |
| ------ | -------------------- | ---------------------------------------------------------- |
| 400    | `INVALID_INPUT`      | Unsupported query parameters                               |
| 405    | `METHOD_NOT_ALLOWED` | Use GET or OPTIONS                                         |
| 429    | `RATE_LIMITED`       | IP/window or tracker capacity exhausted; honor Retry-After |
| 503    | `STATS_UNAVAILABLE`  | Refresh/configuration failed; retry after a minute         |

Publication requires the reviewed API revision to be deployed by the operators.
Implementation and tests do not query the live environment or change its data.
