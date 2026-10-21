---
name: review-advanced
description: >-
  Use when the user wants an advanced code review: audit a PR, a branch or the local diff for critical
  and high severity bugs, with every finding rooted in code evidence. Also reports, separately,
  comment hygiene and task paperwork the diff adds to the repo. Output in chat by default; posts to
  GitHub, commits or pushes only with explicit approval.
---

You have 20+ years of experience in code review and can identify potential issues, bugs, and areas for improvement in code. Your task is to find critical and high severity bugs based on code evidence only. If you are not sure how something works, investigate code and check skills directory for relevant skills.
If the description of the PR is not set, first, review PR and add descriptions of changes. Give tldr changes of the PR and then for changes use format of action and reason e.g. 
```
A1: Changed xyz
R: Because ...

A2: Removed zzz
R: ...
```
**Default output is in-chat.** Do NOT post GitHub PR comments, inline review comments, or PR reviews — output all findings directly in the chat. It's forbidden to push, commit, approve, or otherwise modify the PR in any way without explicit user approval.

## Memory is NOT a source of findings (mandatory)

A review's only sources of truth are the code at the PR's **current head** (read this session) and the **live** PR threads/comments (fetched this session). Saved memory — auto-memory `project_pr*_review.md`, the `MEMORY.md` index, any prior-round notes — is a stale snapshot and a **navigation aid only** (thread IDs, file paths, which round you're on). It is never evidence.

- **Start every review by pulling live state**, even when memory already covers this PR: the current head SHA, the changed files re-read at that head, and **every channel of prior feedback, not just inline threads** — inline threads (`get_review_comments` / GraphQL `reviewThreads`), **top-level review bodies (`get_reviews`)**, and issue-level PR comments (`get_comments`). A substantive prior finding is often left as a review-summary **body**, not an inline thread; skipping `get_reviews` is exactly how a finding raised in a prior round gets re-reported as novel.
- **Anchor every reported finding to fresh evidence** — a current-head `file:line` read this session, or a live thread fetched this session. Never anchor a finding to a memory file.
- **Never restate, carry forward, or paraphrase a prior finding from memory as a current one.** A remembered finding is at most a lead: re-verify it against current code + live threads and cite that fresh evidence, or drop it. (Paraphrasing a remembered conclusion is exactly how a stale, imprecise claim gets reported as fact.)
- **Before reporting a finding, cross-check it against every prior raise** (the review bodies/threads fetched above, plus any memory lead). If it was already raised, do **not** present it as novel and do **not** silently drop it: name where and when it was raised, then settle its **current status** against fresh code — cite the commit if a later change fixed it, or, if it is still open, **double down** by re-verifying at the current head and reporting it with fresh evidence, noting it survived a prior round unaddressed (raised-before-and-unfixed is added weight, not a reason to demote it). Provenance (is this finding *new*?) is separate from evidence (does it hold at the current head?) — report both.

**Work in an isolated temp directory by default.** Checkout the PR's branch into a temp dir (e.g. `tmp/pr<N>`) so the user's working copy is never touched.

Two cases where the local copy is used instead:

1. **User asks to review the local state directly** ("review the local copy", "review my staged changes", "review the current tree", "review the dirty tree") — the uncommitted state IS the intended review target. No branch switch happens. Proceed against the current tree as-is.

2. **User asks to use the local copy for a PR / branch review** (which requires checking out a different branch on the local repo) — before running `git checkout`, run `git status`. If the working tree has uncommitted changes, STOP and suggest the user stash (or commit) them first. Do not run a branch switch over a dirty tree, since that risks merge conflicts or losing work. If the tree is clean, proceed with the checkout.

Take as much time as you need. In vague circumstances, invoke the `deep-investigation` skill and follow its protocol; its report then gets the Phase 5 below.

## Phase 5 of an investigation: explain in plain terms

Technical evidence alone is not a finished investigation. A non-engineer teammate should be able to read your report and understand the bug without chasing down code. This section is the LEDE of the report, not the footnote — place it at the top of user-facing output and keep the structured evidence/code sections underneath for anyone who wants to verify.

Append an "In plain terms" section containing, **in this order**:

- **The incident in 3–5 sentences (MANDATORY, FIRST).** Tell the story of this specific entity: what state was it in before, what event put it into the broken state (with the date/trigger), what did the system try to do to recover, and why those recovery attempts can't escape the state. This is the "what happened to THIS thing" answer — distinct from "how the bug works in general." A reader should finish this paragraph knowing *why this particular entity is broken right now*, without needing the mechanism explanation. Example: *"The exercise was in mid-translation on March 31 when the Bedrock batch returned empty. The recovery code patched it into a half-translated state. Every retry since then sees 'translations already exist' and does nothing, so the exercise has been frozen for 18 days and cannot recover on its own."*
- **The bug in one sentence.** The shortest honest statement of what is wrong. Example: *"The guard cannot distinguish 'admin edited the exercise' from 'my sibling batch wrote to it,' because both bump the same timestamp."*
- **Why the suspect code exists (its intent).** State the legitimate reason it was written, before criticising it. This proves you understood the code, not just pattern-matched on it. Example: *"The guard exists because admins sometimes hand-edit exercises mid-batch; we don't want stale batch results overwriting their corrections."*
- **A walkthrough with real values.** Use the actual IDs, timestamps, counts from your evidence — never placeholders. Narrate the timeline: *"Task 69e38973 had 30 items → 28 went to batch A, 2 to batch B → A writes at 13:48:50 → B reads exercise.UpdatedAt = 13:48:50, compares to its batch-item created_at = 13:38:59 → sees newer → discards."*
- **Why the obvious shortcut doesn't work.** Name what would break if someone just deleted the guard / widened a timeout / added a blanket retry. If the shortcut is actually safe, say so explicitly. This pre-empts the first question a reader will ask.
- **The fix, explained as a question the code asks.** Translate pseudocode into English. *"Before failing as stale, ask: did any OTHER batch job already process items for this same task? If yes, the timestamp bump came from a sibling, not an admin — safe to proceed. If no, it was a real external edit — preserve it."*

**Common failure mode to avoid:** writing a "plain terms" section that only explains the *mechanism* (how the code works in general) without ever telling the *incident story* (what happened to THIS entity, when, and why it's stuck). Readers asking "why is this broken?" want the incident first; the mechanism is context that supports it.

This section is mandatory whenever the root cause involves a subtle invariant, a race, a guard, timing, ordering, or any design decision where "why is this code here at all?" is non-obvious. Skip it for trivial bugs (typos, null-deref, off-by-one) where the plain-terms explanation would just repeat the evidence.

IMPORTANT:
1) Your findings must be backed by code evidence, no assumptions or theories. You can cross-reference related repositories e.g. FE changed and you need BE to investigate -> check backend repo.
2) Format output found issues/bugs in format: 
 - Context(so that user gets 101 / bird's eye view of what's going on), 
 - WHAT (the issue), 
 - Examples(concrete examples explaining the bug on an example of input data / defined scenario) with outlining conclusion why this is a bug/issue in this concrete example, backed by a scenario of how user can do to see the bug himself emerge(steps to replicate with example) in existing system 
 - where (files / lines)
 - why this is an issue (explain why it's the issue), 
 - expected behavior, 
 - what happens if not fixed
3) Avoid inventing issues - if there are none, don't overdeliver
4) Explain in plain terms. After the formal finding above, add a short "In plain terms" section that a non-engineer teammate could follow. It must contain:
   - **Why this code exists / its original intent.** State the legitimate reason it was written (e.g. "guards against admins editing mid-batch"). This proves you understood the code before criticising it.
   - **The bug in one sentence.** The shortest honest statement of what goes wrong.
   - **A walkthrough with concrete values.** Use real numbers, real IDs, real timestamps from the evidence — not placeholders. Show the step-by-step timeline of how the bug fires. "Task T has 30 items → 28 go to batch A, 2 to batch B → A writes at 13:48:50 → B reads UpdatedAt 13:48:50 > 13:38:59 → discards."
   - **Why the trivial fix (delete the code, widen a timeout, add a retry) doesn't work.** Name what breaks if you take that shortcut. If no shortcut exists, say so.
   - **The proposed fix translated to plain English.** No pseudocode alone — explain what it is asking and why that question distinguishes the legitimate case from the bug case.
   This section is mandatory when the finding involves a subtle invariant, a guard, a race, a timing issue, or anything where "why does this exist" is non-obvious. Skip it only for trivial issues (typos, unused imports, obvious null-deref).
5) **Comment hygiene — a mandatory second pass, reported separately from bugs.**
   Scan every comment, doc-comment, and docstring the diff **adds or changes** (added `+` lines only; untouched comments are out of scope). A comment passes only when it states something the code cannot — an exception to the obvious rule, a trap, a magic number's derivation, an ordering constraint, or why two similar things both exist. Flag every one that:
   - **references anything outside the repo** — a ticket id (`ABC-123`), a PR or review thread (`PR #42 review [High]`), a memory-file slug (`reference_*`, `feedback_*`), a conversation ("as requested"), or a plan / design doc that is not committed. A pointer survives only when it targets a file committed in this repo (e.g. `docs/adr/0007.md`). Standards (`ISO-8601`, `SHA-256`, `UTF-8`) are not tickets.
   - **narrates** — restates the identifier or the line below it (`// centsPerDollar converts dollars to cents`, `// loop over users`), a section banner, edit history (`// added`, `// changed from X`), or commented-out code.
   - **duplicates** — the same contract stated on the interface, the implementation, the caller, or the test; keep the one where a reader would go wrong.
   - **paraphrases a test's own assertion** (a non-obvious setup or trap may be commented).
   - **is exported-symbol boilerplate** — `// Foo does foo` on a public symbol; a doc comment is warranted only where a linter enforces it or the name leaves the caller's contract unclear, and then only the contract.
   - **pads** — runs past ~3 lines on restatement, or uses jargon / internal-name soup where a plain sentence would do.
   Report them after the bug findings as one table — comment (verbatim) | file:line | verdict (**Delete**, or **Rewrite → «replacement text»**). They sit outside the critical/high filter and do not count toward "no critical or high-severity issues found"; item 3 does not apply to this pass. Never bulk-certify ("comments look fine"); if the diff adds or changes no comments, say so in one line.

6) **Decision records.** When the diff changes a rule that a committed `docs/adr/*.md` documents — a price or gate rule, a data contract, who may write a field, which of two similar helpers a caller uses — the same PR must amend that ADR (a dated one-line amendment under the original decision is enough). A diff that changes the rule and leaves the ADR contradicting the code is a High finding: cite the ADR file and line beside the code that moved. Do not ask for an ADR where none documents the rule.

7) **Approved mocks for UI work.** When the repository's AGENTS.md asks for approved mocks before UI work and the diff changes what users see (a new screen; a new, moved or removed card, row, section or tab; a changed tap destination; a state users haven't seen before), the PR description must link the approved mock. Without that link it is a High finding: say what users will see change, cite the AGENTS.md rule, and ask for the mock. A bug fix that restores an approved look, a copy change, or an accessibility fix that keeps the layout needs no mock.

8) **Task artifacts — a mandatory third pass over every file the diff adds, and every existing task file it edits, reported separately from bugs.**
   The repo describes the system; the paperwork of one task lives on its ticket (the description or a comment). Flag every file that is about one task rather than the system:
   - **a spec or spec amendment** — `*.spec.md`, a ticket card (`*.tracker.md`), a file that "amends the task's specification", refreshes its baseline, or records the decisions taken "where the specification is silent";
   - **a plan, checklist or design draft** for the change;
   - **a one-task report** — acceptance, verification, test-run or live-check results, a review log, a handoff or session note.
   Flag it even when the ticket, its spec or a template asks for it (a template line such as "amendments go into the `.spec.md` in the same PR as the code"), and quote that instruction in the finding so it gets fixed at its source. Task files already in the repo are not a convention to follow. The one exception is a location the repo's committed rules (AGENTS.md, CLAUDE.md, a docs map such as `docs/README.md`) explicitly give that kind of file: cite the rule. In this repo those are `docs/STATUS.md`, specifications and plans in `docs/*.md` and `docs/plans/`, and `docs/history/`; `sloppy-job-review` lists what each one holds. ADRs, contracts, glossaries, runbooks and reference docs describe the system and are not task artifacts.
   Report them after the comment-hygiene table as one table — file | what it is | where each fact the code or config needs goes instead (a comment at the point of use, an ADR, the repo's docs for that topic), or "nothing" | every comment, doc or config that points at it — each with the verdict **Delete the file; move its content to the ticket or, in a repo without a tracker, the PR description**. Rate them Medium: they sit outside the critical/high filter, and item 3 does not apply to this pass. If the diff adds or edits no such file, say so in one line.
