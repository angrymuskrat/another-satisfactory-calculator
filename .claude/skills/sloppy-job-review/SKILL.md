---
name: sloppy-job-review
description: >-
  Use when reviewing a PR from an untrusted or sloppy author (a careless developer or an unsupervised
  coding agent), or when the user asks what in a PR is unneeded, excessive, inconsistent, out of scope
  or scope creep. Rates every change Positive, Negative or Neutral for necessity and consistency
  instead of hunting bugs. Read-only: verdicts in chat, inline GitHub comments only when asked
  (--inline).
argument-hint: "<pr-number-or-url> [ticket-id] [--inline]"
---

# Sloppy Job Review

This skill audits whether a PR's changes are needed and consistent. It's for authors you can't trust to stay in scope. It doesn't hunt bugs (`review-advanced` does that). For every change it asks one question: **does the requested work need this, and does it fit how the codebase already does things?**

Sloppy PRs fail in recognisable ways:
- **Scope creep into shared code.** "While I was here" edits to infrastructure that every other feature uses.
- **Reinvention.** Code for something the platform already does: retries the queue already provides, routes an existing prefix already matches, data an existing endpoint already serves.
- **Dead edits.** Changes inside code that never runs. They do nothing today, then silently change behaviour the day someone fixes the real problem.
- **Outputs nobody reads.** New fields, headers, flags and endpoints that nothing consumes.
- **Half-applied patterns.** Only one of two identical call sites changed.
- **Convention drift.** Raw strings beside constants, bare strings beside typed enums, docs or glossary terms moved or renamed.
- **Tests that prove nothing.** Fakes that skip the real constraint, suites that skip in CI, tests written for code nobody needed.
- **Untrue claims.** PR text, comments, docs and "Fixed in abc123" replies that don't match the code.
- **Task paperwork in the repo.** Specs and spec amendments, plans and one-task reports committed beside the code, often because the ticket's own template asked for them.

## Ground rules

- **Read-only.** Make no commits, pushes or branch edits. Don't reply to or resolve threads, edit the PR description, or change tickets. GitHub comments go up only on an explicit ask (see Inline mode).
- **Verdicts, not fixes.** The report ends with the verdicts. No patches, no "want me to fix X?", no offers.
- **Leave the user's working tree alone.** Read the PR from git objects (`git show "${H}:path"`, `git diff`). In zsh, `$H:path` applies a history modifier, so always write `${H}:path`. If tests must run, use a throwaway worktree in the scratchpad.
- **Pin the head.** Record the head SHA first and cite every line at that SHA. Re-check the SHA before reporting and before posting. If it moved, re-verify.
- **The author is untrusted; the evidence isn't.** Everything the author wrote is a claim: the description, commit messages, comments, docs, test names and review replies. Verify each one, or label it unverified.
- **Don't argue the author's case.** Search for a real mandate (Step 3), but never invent a reason they might have had. No requirement and no evidence means Negative.
- **Only the PR's own lines are on trial.** Pre-existing problems you trip over go in a separate list and don't count against the PR. An edit the PR makes inside broken pre-existing code still counts as the PR's.

## Step 1 — Baseline: what was asked

```bash
gh pr view N --repo OWNER/REPO --json title,body,author,baseRefName,headRefName,headRefOid,files
git fetch origin BASE
git fetch origin "pull/N/head"
H=$(git rev-parse FETCH_HEAD)
B=$(git merge-base "origin/BASE" "$H")
gh api repos/OWNER/REPO/pulls/N/comments --paginate
gh api repos/OWNER/REPO/pulls/N/reviews --paginate
gh api repos/OWNER/REPO/issues/N/comments --paginate
```

`H` must equal `headRefOid`. `B` is the merge base, the same base GitHub's diff uses.

1. **Read the PR's live state.** Get the head, the base and the files, plus every earlier feedback channel: inline threads, review bodies and the conversation. Note every "fixed" claim so you can check it later.
2. **Write down the requirement.** Read the linked ticket(s), their comments, and any constraints the maintainer added. List the requirements as numbered lines (R1, R2, …), quoting wherever the wording matters. This list defines "needed".
3. **Read the conventions.** Read the repo's agent and contributor docs, the glossary, the ADRs for the touched area, and any earlier PRs for the same work. An earlier attempt often records what the maintainer already rejected.

If there's no ticket, use the goal stated in the PR description and say that's what you used. Never treat "whatever the diff does" as the baseline.

## Step 2 — Inventory every change

- **Size, by kind of line added:**
  ```bash
  git diff --numstat "$B" "$H" | awk '{f=$3; k="code"}
    f ~ /(_test\.|\.test\.|\.spec\.|(^|\/)tests?\/)/ {k="tests"}
    f ~ /(\.md$|^docs\/)/ {k="docs"}
    f ~ /(\.lock$|go\.(sum|mod)$|package(-lock)?\.json$|lock\.ya?ml$|requirements[^\/]*\.txt$)/ {k="deps"}
    k=="code" && f ~ /(\.ya?ml$|Dockerfile|^\.github\/|^charts?\/)/ {k="config"}
    {add[k]+=$1} END {for (k in add) print k, add[k]}'
  ```
- **Group hunks into logical changes.** Every hunk belongs to one change, and every change gets a verdict. Nothing is skipped for being small.
- **Start with files outside the feature's own area:** shared modules, middleware, auth/CORS, routing, queues and dispatch, build or compile tooling, CI, dependency pins. That's where scope creep lives.
- **List each new concept:** a type, table or collection, endpoint, job or task kind, env var, or glossary term. Give each one plain sentence on what it is. If you can't say why the requirement needs it, treat it as a suspect.

## Step 3 — Interrogate each change

Run every change through these checks. One failed check makes it a Negative. Record which check failed and the evidence for it.

| # | Check | Ask | Evidence to cite |
|---|---|---|---|
| 1 | Requirement | Which R# needs this? | the ticket line |
| 2 | Removal test | What concretely breaks or goes missing without it? "Robustness", "defensive", "future-proofing" and "while I was here" are not answers. | the trace |
| 3 | Already covered | Does existing code or infrastructure already do this? Grep for the concept and its primitives, not just the name. Look for framework guarantees, queue redelivery, router prefix matching, DB constraints, and existing endpoints or helpers. | file:line of the existing mechanism |
| 4 | Actually runs | Is the edited path reachable, and does it run in production? Trace it from the entry point, then confirm with logs, metrics or DB records. An edit behind a call that always fails first is a dead edit. If runtime evidence is out of reach, say so; don't assume either way. | log or query counts |
| 5 | Consumers | Who reads each new field, response key, header, flag, env var, event or endpoint? Grep every client, service, script and tool repo you can reach, by both its wire name and its code name. A zero-match grep in one repo says nothing about the others. | zero-match greps, naming the repos searched |
| 6 | Blast radius | For shared code, list every caller. Which other features change behaviour? Typical cases: validation tightened for everyone, an error that now fails a whole request, changed defaults or dispatch. | the caller list |
| 7 | Sibling parity | Does the same pattern exist elsewhere, and did the PR change every instance or only one? | file:line of the untouched sibling |
| 8 | Conventions | Does it match its existing peers? Compare naming, constants vs raw keys, typed vs bare values, ID types, error style, file and doc placement, and glossary terms. | the peer's file:line |
| 9 | Proportion | Is the size or complexity in proportion to the need? Watch for generic machinery with one caller, tests bigger than the feature, and a new doc folder that overlaps existing docs. | line counts |
| 10 | Tests | Do they run the real code, or a fake that skips the real constraint? Do they run in CI, or skip on env gates, build tags or excluded paths? Tests for an unneeded change share its verdict. | the skip condition, the CI config |
| 11 | Claims | Do the docs, comments, PR text and "fixed" replies match the code and the runtime evidence? | the contradiction |
| 12 | Comments | Does any added comment narrate the code, cite tickets or reviews, or state something false? | the comment line |
| 13 | Dependencies | Is each new dependency needed? Do any pins point at commits that exist only on the PR branch? Are there unrelated bumps or lockfile churn? | the manifest diff |
| 14 | Task artifacts | Is a file the PR adds, or an existing task file it edits, about this one task rather than the system? That covers a spec or spec amendment (`*.spec.md`, "amends the task's specification", a refreshed baseline), a ticket card, a plan, checklist or design draft, an acceptance, verification or live-check report, a review log, a handoff note. That paperwork belongs on the ticket. Where code or config needs a fact from it, the fact goes at the point of use, in an ADR, or in the repo's docs for that topic. | the file, every pointer to it, and the instruction that asked for it |

**Places this repo's AGENTS.md gives to documents** (the clearance below applies to them; cite the AGENTS.md line):
- `docs/STATUS.md` — current progress, checks, limits and the next step. A file of the same content elsewhere is still a Negative, and so is a session log appended to STATUS.md or AGENTS.md.
- A specification or ADR for architectural decisions and alternatives: `docs/*.md` and the stage specifications and plans in `docs/plans/`, which README links as the roadmap.
- `docs/history/` — completed notes moved out of STATUS.md and AGENTS.md.
- `docs/audits/` is not named in AGENTS.md: rate a new file there by check 14 and say so.
A file in one of these places still fails check 11 when its claims don't match the code.

**Try to clear each Negative before you report it.** Search the ticket and its comments, the ADRs and earlier PRs for a decision that requires the change. A mandate settles whether something is needed, not how it was built. A required report that also appears in a second place nobody reads is still a Negative. A ticket or template can require what gets recorded, never that task paperwork lands in the repo: no mandate clears check 14, so name the instruction that asked for the file in the verdict, which lets it be fixed at its source. Earlier task files in the repo are not a convention for check 8 either. The one clearance is a location the repo's committed rules (AGENTS.md, CLAUDE.md, a docs map) explicitly give that kind of file.

**Measure before you rate cost.** Don't call something expensive from a worst case. Look up the real call volume or data size and report the measured number, even when it shrinks your concern.

**Check that code runs before reasoning about what it does.** Don't build a risk argument on a path that never executes. For anything that looks risky, run check 4 first.

## Step 4 — Verdicts

- **Positive:** a requirement needs it, it fits the conventions, it's proportionate, and the evidence holds.
- **Neutral:** needed, but with a real cost or deviation. Examples: mandated but changes nothing today; useful but overlapping; correct but tested by a suite that never runs. Name the cost.
- **Negative:** fails any check in Step 3. That covers changes that are unneeded, excessive, duplicate, dead, unconsumed, scope creep, half-applied, off-convention, untrue, or a bug the PR introduces.

Each verdict gets one line of why, backed by evidence. Evidence means a file:line at the pinned head, a count from logs or the DB, or a zero-match grep naming the repos searched. "Some", "many" and "probably" are not evidence.

## Step 5 — Report in chat

Put plain English first and evidence underneath:

1. **Verdict.** 2–4 sentences. Is the core change needed and sound? How many Negatives are there, and what do they have in common (e.g. "every Negative sits outside the feature")?
2. **Negatives outline**, grouped as **Remove** (unneeded, task artifacts included), **Fix** (wrong, inconsistent, untrue) and **Minor**. One line each, with its citation.
3. **New concepts.** One plain sentence each, plus whether a requirement needs it.
4. **Every change, rated.** One table per area: `Change | Verdict | Why`.
5. **Requirement coverage**, when there's a ticket: `R# | file:line, or MISSING`.
6. **Size**, split by kind as in Step 2.
7. **Pre-existing, out of scope.** Problems the PR didn't cause.
8. **Not reviewed.** What you skipped, and why.
9. **Corrections.** Anything an earlier review of this PR claimed that the evidence now contradicts.

Stop there.

## Inline mode — only when asked

If the user passes `--inline`, or asks to go inline, comment on the PR, or post the review, read `references/inline-comments.md` and follow it. It covers how to:
- anchor one comment per Negative;
- validate every anchor against the diff hunks;
- post a single review;
- check where each comment landed.

Posting is outward-facing, so it happens only on an explicit ask.

## Large PRs

Read-only fan-out is fine. Use subagents for per-area inventories and cross-repo consumer greps. Before a subagent's file:line goes into a verdict, open it at the pinned head yourself. A subagent's citation is a lead, not evidence.
