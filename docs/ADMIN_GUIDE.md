# Admin hub operator guide

Open **https://mstocks-arena.vercel.app/admin** in a desktop browser, outside the
Discord Activity and Telegram Mini App. Sign in with Discord. Use your own account;
never share a session or application secret with another operator.

The hub provides login, team management, audit, quiz bank, player profiles,
point corrections, flags, game/ticker controls, seasons and reward review (T28–T31).

## First owner

Before deployment, the account owner sets `OWNER_DISCORD_ID` on the API and asks
the dashboard operator to configure the web OAuth redirect described in
[DEPLOY.md](DEPLOY.md#admin-hub-t28). This is a Discord **user** ID, not the app ID.

The configured account becomes the first owner on its first successful admin
login, only while the database has never been bootstrapped and has no active
owner. Changing the environment variable afterwards does not transfer ownership
or restore revoked access. Use the Team screen for later changes.

## Roles

| Capability                                         | Owner | Admin | Moderator | Support |
| -------------------------------------------------- | ----- | ----- | --------- | ------- |
| Read overview and audit                            | Yes   | Yes   | Yes       | Yes     |
| View and manage team / transfer ownership          | Yes   | No    | No        | No      |
| Read players and flags                             | Yes   | Yes   | Yes       | Yes     |
| Raise flags and append notes                       | Yes   | Yes   | Yes       | No      |
| View quiz bank/answer keys and edit quiz           | Yes   | Yes   | No        | No      |
| Change player status, adjust points, resolve flags | Yes   | Yes   | No        | No      |
| Control games and seasons (T30)                    | Yes   | Yes   | No        | No      |
| Change a past season start (T30)                   | Yes   | No    | No        | No      |
| Export full reward destinations (T31)              | Yes   | Yes   | No        | No      |

The server grants only explicitly
declared route permissions. Hiding a screen is not the access check. Revoked staff
and inactive accounts cannot use existing sessions or sign in again.

## Invite and manage the team

1. Open **Team**. Ask the person for their Discord user ID (Developer Mode →
   Copy User ID). Check the ID with them through a trusted channel.
2. Enter the ID and choose Admin, Moderator or Support, then **Add team member**.
3. The person opens `/admin` in their browser and signs in with that Discord
   account. No bot membership, player login or shared password is required.

A person who has not used the app is displayed as `Discord <ID>` until their first
successful admin login refreshes their display name. Existing player accounts and
points are preserved. Duplicate IDs update the same membership instead of creating
another identity.

To change access, choose a role in the member's row and click **Save role**.
Promotion to Owner requires typing that member's current display name exactly.
To remove access, click **Revoke access** and confirm. Role changes and revocations
invalidate all of the person's admin sessions; revoked memberships remain visible.
To restore access, save a role on that revoked row. An owner promotion/restoration
also requires the display-name confirmation.

There must always be at least one owner. The last owner cannot revoke or demote
themselves, including through simultaneous requests. Consider adding a second
trusted owner before the original owner becomes unavailable. Inactive accounts
cannot be promoted to Owner or counted as the usable remaining owner when another
owner is removed.

## Transfer ownership

Choose **Transfer ownership** on an active member's row. Review the target's
Discord ID, then type their display name exactly in the confirmation form. The
target becomes an owner and your own role changes to Admin in one operation.
Other owners keep their roles. Both accounts must sign in again. Failed
confirmation leaves both roles unchanged.

## Sessions and sign-out

Admin sessions last **12 hours** with no sliding extension. The cookie is
HttpOnly, Secure and SameSite=Strict. The player session is separate. The hub
does not put admin credentials in browser storage or expose them to JavaScript.
Use **Sign out** when finished: it revokes the session on the server, not just in
the browser. A copied old cookie cannot restore a revoked session.

Writes require a session-bound CSRF header and the configured web origin. If a
security check expires, reload the hub. If access changed, sign in again or ask
an owner to check your membership. Staff role/status is checked on every request.

T29 removes the `ADMIN_DISCORD_IDS` and `ADMIN_TELEGRAM_IDS` allowlists. Add any
remaining operators through **Team** before deploying T29, then remove those
environment variables. Neither allowlists nor player bearer tokens grant admin
access. Admin web login uses Discord only.

## Quiz bank

Owners and admins open **Quiz bank** to search by slug, topic or question text.
Pages show 25 questions. **Add question** creates a question with a unique import
slug, topic, four options, a correct option and explanation. **Edit question**
opens the same fields. Only owners/admins can see these answer keys.

The bank keeps its original alternative order and answer key. Players receive a
stable personal permutation for each day/question; the API maps their choice
back to the original index for scoring and attempt history. Do not reorder the
bank or reimport it to enable this feature. Newly frozen daily sets use it;
pre-update sets keep their original presentation until the UTC day ends.

**Frozen today** marks a question in the shared UTC-day selection. It cannot be
edited, rescheduled or overwritten by import. **Open** shows it read-only. You
can **Deactivate** it for future selections; today's frozen content and existing
attempts remain unchanged. Deactivation does not delete the question or history.

Use the UTC date input and **Schedule** to reserve a question for that day. Clear
the date and save to make it unscheduled. Past dates are rejected. Today's set
freezes when the first player starts the quiz; changing other questions after
that point does not rebuild today's set. Scheduled questions keep priority;
game rules and point values have not changed.

**Import quiz JSON** accepts the same private JSON array as `db:seed-quiz`:
`id` (the import slug), `topic`, `prompt`, four `options`, zero-based
`answer_index`, and `explanation`. Select a local file and confirm. Matching
slugs update existing UUIDs, preserving active/scheduled status; new slugs create
active unscheduled questions. Repeating an import does not create duplicates.
Invalid rows, duplicate slugs or any frozen question reject the entire import.
The API request limit is 1 MiB; split larger banks into smaller files.

Never put campaign questions, answers or explanations in this public repository,
screenshots, issue comments or logs. Audit events contain IDs/counts, not the
bank's text or keys. Review screenshots use invented content only.

## Players and points

Open **Players**, search by display name or Discord/Telegram user ID, then **Open**
a profile. It shows identities and available platform creation times, app account
age, status, full ledger balance, Higher or Lower runs/predictions, quiz attempts
and check-ins. Activity pagination advances each section in blocks of 25. Classic
runs are labeled separately and their existing history is preserved.

Reward verification is explicitly **pending (T18)**. Active status and account
age do not establish campaign eligibility or platform membership. No membership
checks or anti-abuse thresholds are introduced by this release.

Owners/admins can change status to **Suspended**, **Banned** or **Active**, with a
required reason and confirmation. Existing behavior blocks both suspended and
banned accounts from login and player requests. The server also prevents new
game awards; pending predictions become void without points while the account is
inactive. Restoring Active permits access again. Inactive staff admin sessions are
revoked and do not revive automatically. The last active owner cannot be suspended
or banned; appoint another active owner first.

**Adjust points** records a nonzero positive or negative integer and required
reason. Review the target, amount and reason before confirming. Every correction
adds an `admin_adjustment` ledger row and audit event in one transaction; it never
updates or deletes a previous row. Retrying the same request after a lost response
does not pay twice. If the form reports a conflicting request, inspect the ledger
before starting a new correction. Deliberate corrections may apply to inactive
players; suspension blocks game earnings, not audited staff corrections.

## Flags

All staff can read **Flags**, defaulting to Open, with filters for Cleared and
Actioned. A player's profile lets owners/admins/moderators **Raise flag**, with a
required note. Open a flag to inspect its report and append further notes.
Notes are append-only; existing notes cannot be overwritten or deleted.

Only owners/admins may **Resolve flag**. Choose Clear, Suspend, Ban or Adjust
points and give a reason. A point correction also requires a nonzero amount.
The action and flag outcome commit together, with separate audit events for the
account/ledger change and resolution. Failed actions leave the flag open. An
already resolved flag rejects a second resolution; notes can still document
later follow-up. Moderator access never grants suspend, ban or point adjustment.

## Games, tickers and seasons (T30)

Only owners and admins see **Games**, **Tickers** and **Seasons**. Each change
requires a reason and confirmation. Staff permissions and session validity are
checked again inside the write transaction. Moderators/support cannot use these
controls by calling the API directly.

### Game maintenance

On **Games**, enter a reason under Check-in, Quiz or Higher or Lower and choose
**Pause** or **Resume**. A paused game shows **Paused for maintenance** to players.
The API rejects new actions without inserting check-ins, quiz attempts, runs,
picks or awards for those blocked actions. Read-only views remain available,
including pending predictions and existing results. The app refreshes game state
every 15 seconds while visible; an action that races a pause reloads the state.

Maintenance does not refund previously consumed attempts or reset clocks. Quiz
deadlines continue; a late answer after resumption is handled by the original
server timer. Locked Higher or Lower predictions keep their original windows and
settle normally in the worker, including points for correct picks. Idle expiry
still applies. Pausing prevents further player actions; it is not a retroactive
cancellation or a switch for the price worker.

### Manual ticker overrides

**Tickers** lists catalog reference tickers, last primary prices, effective
pause status, automatic oracle health and the last control reason. Choose
**Manage**, enter a reason, then Pause or Resume. A manual pause survives polling
and restarts; the worker continues recording prices and checking health.
Primary samples observed under that override are marked unusable for gameplay.
The player's last-price panel remains available with its normal pause copy.

Resume clears only the manual override. It never overrides a closed market,
trading halt, stale/missing data, price jump or divergence. With unknown/stale
health it remains paused until a valid poll. Previously captured valid samples
are preserved; manual controls do not rewrite prediction prices or ledger awards.
Manual reasons stay in the staff hub/audit and are not shown as player copy.

### Seasons

Season dates now live in the database, not `GAME_CONFIG.season`. Migration
`0011_admin-game-controls` preserves the original provisional **Season 1** window:
start `2026-10-16T00:00:00Z`, no end. Mantle still needs to confirm official dates.

Open **Seasons**, choose **Edit season**, review UTC start/end and name, enter a
reason and save. The season ID is permanent. An empty end means ongoing; an end
must be strictly later than the start. The start is inclusive and the end is
exclusive: points at the end belong to a next season starting at that exact time.
There are no delete/reset-ledger operations.

Only an **owner** can change the start of an already-started season, or move a
future season's start into the past. The API enforces this even if the form is
modified. The audit records complete before/after windows and the reason.
Admins can update names/end dates and edit starts that remain in the future.

To **Create next season**, first set the preceding season's end. Enter a unique
ID, English name, future UTC start and optional end, then confirm with a reason.
The next start must follow every existing start. Windows cannot overlap; the
database also enforces this, including concurrent requests. Gaps are permitted.

The ranking reads the most recently started season on every request. A completed
season remains displayed, with its final window, until the next one begins.
If all starts are future, the earliest future window is used with no pre-start
points. Day/week windows are unchanged. Editing dates changes the ranking query
and cache key; the underlying points ledger is never rewritten or reassigned.

## Audit log

Open **Audit log**. Filter by the actor's internal user UUID, action, and UTC date
range; the **Through** date includes that whole UTC day. Pages contain up to 50
events, newest first. The Team screen uses Discord IDs; audit actor filters use
the internal UUID shown under the actor's name.

Events include first-owner bootstrap, login, logout, grants, role changes,
revocations, ownership transfers, quiz writes/imports, player moderation, point
corrections, flag reports, notes and resolutions. Each successful write is committed with its
audit row; a failed write records no successful change. Future exports must also
record their row count in an audit event.

Audit records include actor, action, target, details, time and a keyed IP hash.
Raw IPs, cookies, OAuth codes, tokens and application secrets are not recorded.
The API hashes its verified socket peer address; behind Vercel/Railway this can be
the proxy address. It deliberately does not trust arbitrary forwarded IP headers.

Audit rows reject UPDATE, DELETE and TRUNCATE at the database level. Fixes must be
new explanatory events, never silent edits. Point history also remains append-only;
game rules and automatic scoring are unchanged; T29 corrections are new rows.

## Deployment and recovery checks

After the PR is merged and deployed, confirm the new migration applied, sign in
as the configured owner, grant a test member, check the audit log, revoke their
access and verify their old session fails. Then sign out and sign back in.
T29 requires `0010_admin-operations` before API startup. Confirm that migration,
then use synthetic records to smoke-test quiz writes/imports, frozen protections,
player status, one correction with a retry, and a flag action/audit. Do not run
destructive checks on campaign players or copy the real bank into review evidence.
T30 requires `0011_admin-game-controls` before updating API/worker. Verify the
existing Season 1 and ledger survived, pause/resume each game with a synthetic
player, test a manual ticker through multiple polls, and inspect the control and
season audits. Confirm an admin cannot change a past start. Use only approved
campaign dates in production; do not create throwaway production seasons.
Publish the updated web first: its optional fields support the older API during
rollout. Then migrate and update API/worker together, and reload any already-open
Activity/Mini App so it receives the new response decoders. Do not roll back to
an API that still reads season dates from code after relying on admin date changes.

If login is unavailable, have the account owner check the API environment and
the exact Discord redirect URI in [DEPLOY.md](DEPLOY.md#admin-hub-t28). Never paste
cookies, OAuth codes or secrets into an issue or chat. A code rollback does not
delete Staff or audit rows and does not undo the migration; do not deploy the
pre-T28 API while depending on Staff authorization.

## Reward destinations and payouts (T31)

Rewards are reviewed by mods and paid manually according to the campaign terms.
Registration does not verify ownership, guarantee eligibility or trigger a payment.
There is no wallet connection, signature or automatic transfer.

### Player registration

Players open **Profile → Reward destinations**, optionally enter a Bybit UID
(5–12 digits) and/or Mantle address, then **Review details**. Both may be empty.
Mixed-case addresses must pass EIP-55 checksum validation; accepted addresses are
stored in checksum form. Players review the exact values, check **I confirm these
details are mine and correct**, and choose **Confirm and save**. Refresh never
submits a change. Stale edits are rejected and reload the latest values.

Players see only their own destinations and the latest 25 masked history rows.
History stores old/new last-four values, time and actor (player/staff), never full
past addresses or UIDs. Current full values are restricted to that player and
owner/admin. Do not paste destinations into notes, audit reasons or screenshots.

### Staff destination review

Open **Reward destinations → Player destinations**. Search by display name and
use pagination. Owner/admin see full current values; moderator/support see only
last-four values. **View details** shows masked history. Only owner/admin can
correct current values: review them with the player, provide a reason, confirm the
correction and save. This records a staff history row and an audit event without
copying raw destination values into the audit. Locked destinations reject staff
corrections too; unlock explicitly first.

### Prepare a season payout

1. Review eligibility under campaign terms. T18 automation is not implemented:
   every snapshot/CSV says `review_required`. This is not an eligibility approval.
   Suspended/banned players cannot be approved or marked delivered.
2. In **Seasons**, set an end and wait for that UTC instant to pass. Windows keep
   the existing inclusive-start/exclusive-end leaderboard rules. No ledger rows
   are edited. Returning to this screen never ends a season automatically.
3. In **Reward destinations → Season rewards**, select the season. Enter a
   required reason and add permanent **Prize bands** (first/last rank and English
   description). Cover every rank from 1 through the intended **Top N players**.
   Bands cannot overlap, be edited or be deleted; review carefully before adding.
4. Choose N (1–10000) and **Freeze ranking snapshot**, then confirm. This is an
   explicit, once-only operation after season end. It captures up to N ranked
   active players using the existing point/tie rules, their display names,
   Discord/Telegram identities, prizes and exact season window. Linked identities
   do not duplicate points or recipients. Empty rankings freeze an empty snapshot.
   Later points, names, links or season date edits never replace this snapshot.
5. Freezing automatically **locks destinations for this season** in the same
   transaction, with a separate audit event. If any part fails, neither the snapshot
   nor the lock is saved. This includes empty rankings and already-locked seasons.
   Locks are
   global safeguards for the single current destination per player: any locked
   season prevents all player and staff destination edits. **Locked for payout
   review** appears in Profile. Unlock every locked season to allow edits again.
   Each lock/unlock has a required reason and audit event.
6. **Review reward** for each recipient. Record the manual eligibility review and
   approve a pending reward. Approved rewards may be marked delivered after the
   external manual payment, with a delivery note/reference. Pending or approved
   rewards may instead be voided, with a reason. Delivered/void are final. Every
   transition appends an event and audit row; no record is erased. Concurrent or
   stale submissions cannot apply the transition twice.

Freezing/approving never credits or debits game points and never sends money.
Moderators/support can read snapshots and status notes but cannot generate,
change, lock, approve, deliver, void or export. The existing audit screen lists
all reward writes and exports with actor/time. Status notes must not include
secrets or full destination values.

### Export safely

Owner/admin choose **Export payout CSV** on a frozen snapshot. Each download
request is authenticated, CSRF checked and audited with actor and row count.
The file contains the frozen season ID, rank, points, display name and platform
IDs; eligibility review marker, current account status, current Bybit UID/Mantle
address and last-change time; `changed_after_snapshot` is true only when the
current destination changed strictly after the snapshot creation time (false for
unchanged/equal timestamps or absent destinations); frozen prize and latest reward status. Authentication,
IP hashes, question-bank data and unrelated profile fields are excluded.

Ranking/identities/prizes are frozen; destinations are current at export time.
Use the season lock to hold those values stable while checking an export. Export
again after an intentional unlock/correction/relock. Review every
`changed_after_snapshot=true` row before delivery; the flag identifies a change,
not an approval or an ownership verification. The export is a review file,
not a payment instruction sent to a provider. It includes pending/void records so
operators can reconcile them; deliver only approved, eligible recipients.
CSV cells are quoted and formula-like text is prefixed to prevent spreadsheet
execution. Import UID/platform ID columns as text to preserve leading zeroes and
long IDs. Store exports in restricted operator storage; do not commit or publish.

### Quiz maintenance decision (checked in T31)

The existing 30-second server deadline continues while Quiz is paused. A pause
blocks replies but does not extend the served question; after resume, an already
late answer times out. This policy is preserved and regression-tested in T31;
there is no hidden refund or timer reset. Where possible pause between questions,
warn players before planned maintenance and handle campaign disputes through
reviewed, audited point corrections. A future change to pause-aware quiz timing
needs its own agreed game-rule brief.

### T31 rollout

Apply `0012_rewards` before deploying the matching API and web. The migration
creates empty reward tables/control, preserves seasons/ledger/audit and adds
append-only triggers for history, prize bands, snapshots, recipient rows and
status events. It does not generate a real snapshot or seed destination data.
No worker change is required. Do not roll back the database or delete audit/award
history. A code rollback must retain a compatible schema and payout records.
After review/merge, test with synthetic recipients: registration, lock, masked
support view, freeze, approval/void/delivery and export audit. Real campaign
snapshots/payouts require explicit operator review; none are performed by this PR.

## Invites (T34)

All Staff roles can read Invites. Filter by inviter user ID, invitee user ID and
Pending/Rewarded/Void status; use pagination for more records. Players receive
+20 on first check-in; inviters receive +50 at 200 gameplay points. Referral and
admin adjustment rows do not count toward qualification. There is no percentage
commission. Game maintenance includes Invite friends and defers new claims and
bonuses; underlying game awards continue when those games are active.

Only owner/admin can Void. Enter a required reason and confirm. A void is final:
it keeps the original inviter and qualification time, reverses each paid bonus
with a negative admin_adjustment, and appends referral.voided to the audit log.
This also handles a pending invite with only the +20 welcome bonus paid. Retrying
cannot reverse twice. Original ledger/audit rows cannot be changed or deleted.
Voids do not free daily quota. At 50 qualifications per inviter/UTC day, pending
claims retry on a later game action after the next UTC day; do not manually add
points to work around that cap. No automated multi-account detection is included.

## Flyer operations (T27/T36/T37)

T37 starts new sessions on flyer-3: fixed tap impulses and server-replayed coin
collection. Score is buildings + coins; campaign awards still use the daily-best
delta and cap of 50. Original v1/v2 courses and replays remain valid. Apply migration
0016 before the matching API; new daily courses/results are separate append-only
tables. Frozen charts are optional display data. A manual exit or visibility loss
finishes the verified current score; it never pauses the replay clock.

T36 adds Daylight Market (`flyer-2`) without changing awards, daily caps or void
permissions. New sessions reference a single immutable daily S&P 500 course;
legacy `flyer-1` sessions preserve their original charts/replay. A daily course
freezes once from ready primary extended summaries; later quote/catalog updates
cannot alter it. There is no admin editor for these immutable courses. New assets
need reference history before they can join the next daily course. Core ticker
controls and prediction polling remain separate from this arcade reference data.
Deployment/warm-up guidance is in DEPLOY.md; screenshots/video use synthetic data
under `docs/review/t36`.

Flyer sessions is available to every Staff role. Copy a player's internal user ID
from Players, paste it into the filter and select Find flights. The list shows
session state, score and server UTC timestamps, with pagination. It never exposes
session tokens or reward destination data.

Owner/admin may Void with a required note. The session remains stored, excluded
from score rankings. The server recalculates that day's best valid score and
appends a negative admin_adjustment only when the net paid daily-best points exceed
that entitlement. If another valid flight still covers the cap, no correction is
needed. Every void is audited as flyer.voided; retrying cannot reverse twice. The
original ledger/course/input log cannot be edited or deleted. Existing finish
quota is not freed. Point corrections use the actual administrative review time.

Use Games → mStocks Flyer for maintenance. Starting/finishing is blocked without
consuming a finish; reads and explicit discard work. An in-progress session still
expires after ten minutes. Operational limits live in private API variables,
not the public repository; missing configuration keeps the start button disabled.

flyer_best awards count toward referral qualification; admin adjustments stay
excluded under T34's existing rule. A Flyer void does not automatically cancel an
already rewarded referral. Review a suspicious referral separately in Invites,
where its bonuses can be voided with a required note and immutable corrections.
