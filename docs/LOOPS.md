# Neon River — Working Loops

Seven loops. The first three run inside every gate; the rest you reach for.

## 1. Gate loop — `/goal` (drives a gate to its done-condition)

Paste the gate prompt. If Claude stops before the gate is actually done, set the
matching goal; a separate model checks the condition after every turn.

```text
/goal Gate 1 is complete per prompts/01-kickoff.md: npm run check and npm run build exit 0, desktop and mobile look-dev screenshots for every A/B option are saved and listed, CI is green on the gate-1 PR, and the fresh-eyes-reviewer reports no open blockers or majors — or stop after 50 turns
```

```text
/goal Gate 2 is complete per prompts/02-full-loop.md: all 9 phases play start to finish, npm run check exits 0, the playtester reports PASS on every target in REMASTER_BRIEF §3.3 and §9, CI is green on the gate-2 PR, and the fresh-eyes-reviewer reports no open blockers or majors — or stop after 80 turns
```

```text
/goal Gate 3 is complete per prompts/03-polish-and-qa.md: every scorecard category ≥ 2 with average ≥ 2.3 and no art-skill automatic failures, check_evidence.py passes on artifacts/evidence.json, performance budgets met on the production preview, CI green, reviewer clean — or stop after 80 turns
```

Check progress with `/goal`, stop with `/goal clear`. Pair with auto mode so
turns don't wait on approvals.

## 2. See-it loop — Claude plays the build (inside every change)

Change → run dev server in background → drive it (test hooks, canvas inspector,
Playwright MCP browser) at 1440×900 and 390×844 → look at the screenshots → fix.
Already required by CLAUDE.md and the prompts. Nudge it any time:

```text
Play it: run the dev server, play 60 seconds of phase 3 on mobile via the Playwright browser, screenshot every 10 s, and tell me what looks wrong.
```

## 3. Fresh-eyes loop — independent review in its own worktree

Claude commits, then the reviewer checks out HEAD in an isolated worktree, builds,
plays, and returns defects without touching the main checkout. Runs at the end of
each gate automatically; trigger it yourself with:

```text
@agent-fresh-eyes-reviewer review the current HEAD
```

## 4. Balance loop — playtester bots until the numbers land

```text
@agent-playtester run the full balance suite on HEAD
```

or hands-off tuning:

```text
/goal the playtester reports PASS on every balance target in REMASTER_BRIEF §3.3 and §9, with each phase-table change recorded in artifacts/game-progress.md — or stop after 30 turns
```

## 5. PR / CI loop — babysit the branch

Uses `.claude/loop.md` (fix red CI, address review comments, continue the next
action, stop when the gate is ready). Self-paced:

```text
/loop
```

or just CI:

```text
/loop 5m check CI on my open PR; if red, fix and push; if green, say so in one line
```

Stop a self-paced loop with `Esc`. Loops only run while the session is open.

## 6. Your playtest loop — real phone, real thumbs (each gate)

```bash
npx vite --host          # in the project folder; open the Network URL on your phone (same Wi-Fi)
```

Paste notes at the top of the next gate prompt. Five minutes on a real phone
catches what emulation doesn't (thumb reach, audio unlock, heat, Safari quirks).

## 7. Parallel worktree session — optional

For a side quest that shouldn't disturb the main session (e.g., a sound pass or
an experiment), open a second terminal:

```bash
claude --worktree audio-pass
```

It gets its own branch `worktree-audio-pass`; have it open its own PR.

## Resuming

```bash
claude --continue        # most recent session in this folder
claude --resume          # pick a session
```

Fresh session? Paste `prompts/resume.md`.
