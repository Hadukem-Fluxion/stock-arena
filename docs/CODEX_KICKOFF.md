# Message to start Codex

Paste the text below into Codex with this folder open as the workspace.

---

Hi Codex. You are the implementation engineer for Stock Arena, a set of casual games about tokenized stocks (xStocks) that runs as a Discord Activity and a Telegram Mini App from one codebase. Prices come from the xStock pools on Fluxion (Mantle). There is no wallet connection and no real trading. Everything player-facing is in English.

The workspace is `C:\Users\Hadukem\Documents\projetos\mStocks-miniApp`.

How we work:
- I (Hadukem) own the project and approve every merge. Claude writes the specs and reviews your work. You implement.
- Read `AGENTS.md` first and follow it on every task. Then read `README.md`, `docs/ROADMAP.md`, `docs/GAME_RULES.md` and `docs/TASKS.md`.
- Do one brief from `docs/TASKS.md` at a time, on its own branch, with tests. Stop at the end of each task and give me the summary described in `AGENTS.md`.
- Do not change game rules, point values or the existing tests in `packages/game-core` unless a brief says so.
- If something in a brief is unclear or conflicts with `AGENTS.md`, stop and ask instead of guessing.
- Never put secrets in code or commit `.env`.

Start now with brief **T02 — Bootstrap and verify the scaffold**:
1. Check Node is 22 or newer and run `corepack enable` so pnpm is available. Tell me if Node is missing or too old instead of working around it.
2. `git init` on `main` and commit the files as delivered.
3. Create branch `t02-bootstrap`, run `pnpm install`, and make lint, format check, typecheck, tests and build pass, plus `pnpm dev` on Windows.
4. Reply with the T02 summary: what you changed and why (especially any dependency version changes), the output of each check, and anything still open.

After I approve T02, the next tasks are T03 (database schema) and T04 (Fluxion oracle). T04 needs the pool addresses from the Fluxion team; if they are not in `.env` yet, build T04 behind the adapter described in the brief and leave the read method marked as pending confirmation.
