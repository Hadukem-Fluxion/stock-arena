# Admin hub operator guide

Open **https://mstocks-arena.vercel.app/admin** in a desktop browser, outside the
Discord Activity and Telegram Mini App. Sign in with Discord. Use your own account;
never share a session or application secret with another operator.

The hub provides login, team management, audit, quiz bank, player profiles,
point corrections and flags (T28–T29). Game controls and seasons (T30), and
reward registration/export (T31), are not available yet.

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

Future capabilities are listed for planning; the server grants only explicitly
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

If login is unavailable, have the account owner check the API environment and
the exact Discord redirect URI in [DEPLOY.md](DEPLOY.md#admin-hub-t28). Never paste
cookies, OAuth codes or secrets into an issue or chat. A code rollback does not
delete Staff or audit rows and does not undo the migration; do not deploy the
pre-T28 API while depending on Staff authorization.
