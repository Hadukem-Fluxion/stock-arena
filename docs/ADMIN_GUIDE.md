# Admin hub operator guide

Open **https://mstocks-arena.vercel.app/admin** in a desktop browser, outside the
Discord Activity and Telegram Mini App. Sign in with Discord. Use your own account;
never share a session or application secret with another operator.

The hub currently provides login, team management and an audit log (T28). Quiz,
player, points and flag operations arrive in T29, game controls and seasons in
T30, and reward registration/export in T31. Those operations are not available yet.

## First owner

Before deployment, the account owner sets `OWNER_DISCORD_ID` on the API and asks
the dashboard operator to configure the web OAuth redirect described in
[DEPLOY.md](DEPLOY.md#admin-hub-t28). This is a Discord **user** ID, not the app ID.

The configured account becomes the first owner on its first successful admin
login, only while the database has never been bootstrapped and has no active
owner. Changing the environment variable afterwards does not transfer ownership
or restore revoked access. Use the Team screen for later changes.

## Roles

| Capability                                | Owner | Admin | Moderator | Support |
| ----------------------------------------- | ----- | ----- | --------- | ------- |
| Read overview and audit                   | Yes   | Yes   | Yes       | Yes     |
| View and manage team / transfer ownership | Yes   | No    | No        | No      |
| Read players (T29)                        | Yes   | Yes   | Yes       | Yes     |
| Raise flags (T29)                         | Yes   | Yes   | Yes       | No      |
| Edit quiz, players and points (T29)       | Yes   | Yes   | No        | No      |
| Control games and seasons (T30)           | Yes   | Yes   | No        | No      |
| Change a past season start (T30)          | Yes   | No    | No        | No      |
| Export full reward destinations (T31)     | Yes   | Yes   | No        | No      |

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
trusted owner before the original owner becomes unavailable.

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

The old `ADMIN_DISCORD_IDS` and `ADMIN_TELEGRAM_IDS` API allowlists continue
temporarily until T29. Discord allowlisted users may log in as legacy Admins,
without Team access. Add these operators to Staff before the allowlists are
removed. A revoked Staff record overrides an allowlist entry. The new admin web
login uses Discord only; this does not introduce a Telegram admin login.

## Audit log

Open **Audit log**. Filter by the actor's internal user UUID, action, and UTC date
range; the **Through** date includes that whole UTC day. Pages contain up to 50
events, newest first. The Team screen uses Discord IDs; audit actor filters use
the internal UUID shown under the actor's name.

Events include first-owner bootstrap, login, logout, grants, role changes,
revocations and ownership transfers. Each successful write is committed with its
audit row; a failed write records no successful change. Future exports must also
record their row count in an audit event.

Audit records include actor, action, target, details, time and a keyed IP hash.
Raw IPs, cookies, OAuth codes, tokens and application secrets are not recorded.
The API hashes its verified socket peer address; behind Vercel/Railway this can be
the proxy address. It deliberately does not trust arbitrary forwarded IP headers.

Audit rows reject UPDATE, DELETE and TRUNCATE at the database level. Fixes must be
new explanatory events, never silent edits. Point history also remains append-only;
no action in this release changes game rules, scores or the points ledger.

## Deployment and recovery checks

After the PR is merged and deployed, confirm the new migration applied, sign in
as the configured owner, grant a test member, check the audit log, revoke their
access and verify their old session fails. Then sign out and sign back in.

If login is unavailable, have the account owner check the API environment and
the exact Discord redirect URI in [DEPLOY.md](DEPLOY.md#admin-hub-t28). Never paste
cookies, OAuth codes or secrets into an issue or chat. A code rollback does not
delete Staff or audit rows and does not undo the migration; do not deploy the
pre-T28 API while depending on Staff authorization.
