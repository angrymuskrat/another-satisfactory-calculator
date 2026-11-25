---
name: pre-ship
description: >-
  Use before committing, marking a change done, or opening a PR: an adversarial self-audit of your own
  diff that catches the obvious-in-hindsight bugs a reviewer would find (input shapes, callers and
  sibling branches, atomicity, production wiring, naming, peer conventions, comment quality) and
  states what was and was not probed.
user-invocable: true
---

# Pre-Ship — Adversarial Self-Audit

A ritual to run before shipping a small diff. Ten passes. Each pass produces a written artifact in the chat. End with an explicit probed-vs-not-probed declaration.

The "reviewer finds 3 obvious bugs on a 50-line diff" failure mode happens because:
- I never enumerated the inputs — I tested the happy path and missed empty/nil/zero.
- I never traced the callers — I changed a function and didn't check who calls it differently.
- I never asked "where would a reviewer find the bug here?"
- I focused on the lines I touched and never asked what the surrounding function looks like *after* my edit, or whether my guard still holds when the database is on a different replica from my snapshot.
- I changed behavior at a leaf (a solver helper, a shared contract in `packages/domain`, a new use of a primitive like a SQLite statement or a worker message) and didn't trace OUTWARD — to production wiring (does the app or worker actually call MY function, or a sibling path that builds the same model?), to cross-package consumers (do `apps/web`, `apps/api`, `packages/solver` and their fixtures still agree on the changed type?), or to neighboring uses of the same primitive in the same diff (does my new worker request drop stale answers the way the one ten files over does?).
- I introduced a `foo2` / `fooNew` / `fooCopy` next to an existing `foo` and never articulated whether it is a genuine duplicate to collapse, a distinct semantic role that needs a clearer name, or just a shadow the language would have allowed me to write cleanly — leaving the next reader (and the next reviewer) to guess.
- I added or moved a unit (a bloc, a page, a repository, a service) and never compared it against the peers of its own kind — so it works and passes every test, but it is shared across two screens where every sibling is per-screen, or named for a concept that has no entrypoint, or wired at a different scope than its peers. No test fails on "doesn't match the convention"; only an explicit peer comparison surfaces it.
- I left a comment pointing at `ADR-4` / `§5.1` / a design doc that lives outside the repo (or in an untracked file that never gets committed), so the next reader hits a dead reference and the rationale the code relies on is nowhere in version control.
- I wrote a comment that restated the code, leaned on jargon and internal names, or ran for a paragraph — instead of explaining in one plain-language breath *why* the code does what it does, so it cost the reader time instead of saving it — or I tagged it with a ticket / PR-review / memory-file reference that means nothing to the next reader, or repeated on an interface what its implementation already documents.

These passes force each question. Token-conciseness does NOT apply to verification rigor; produce the full artifacts even if they are longer than usual.

**Probe the file as it stands after the edit, not the diff.** Sibling branches of a modified function, the atomicity envelope of any guard you added, the order of side effects relative to gated writes — all are inside the surface to probe, even if you didn't touch those lines.

## Scope

Run on the actual diff:
- `git diff --cached` for staged changes, or
- `git diff <base>...HEAD` for a PR branch.

Enumerate the modified surface:
1. Every function modified (declaration or body).
2. Every function whose signature changed.
3. Every type / struct / interface whose shape changed.
4. Every DB / HTTP / external-service call inside the diff.

Refuse to proceed if the diff is empty or the modified surface is unclear — ask for clarification instead.

## Pass 1 — Input-Shape Table

For each modified function, write a table covering **every branch in the function as it stands**, not just the branch your diff edited. If you added a guard to one branch, the sibling branches still get the table treatment.

| Input | Branch taken | Verified by |
|---|---|---|

Rows to enumerate at minimum (skip rows that don't apply to the function's signature):
- missing key / `undefined` / `null` (they differ: `JSON.stringify` drops `undefined`, keeps `null`; zod `.optional()` and `.nullable()` accept different ones)
- empty collection (`{}`, `[]`, `""`)
- zero, negative, `NaN`, `Infinity`, max, exact boundary (cap-1, cap, cap+1)
- **limit semantics** — a resource or building limit of `0` means "forbidden", `null` means "unlimited", a positive value is a cap; a rate below `1e-6`/min is rejected by the solver, never rounded to zero
- duplicates, key collisions, unknown catalog IDs
- unicode / whitespace-only / very long strings; Russian text in search and names
- wrong-but-valid (e.g. a plan saved before the field existed, a file from another catalog version, another user's workspace ID, a world-disabled recipe in a factory plan)
- **wrong arity / wrong shape on structured inputs** — for any `JSON.parse` or file import into a fixed-shape array or tuple, probe `[]`, `[x]`, `[x, y, z]`. A cast without schema validation silently accepts the wrong length and downstream indexed access returns `undefined`. This row applies even when the code fills a "default" first — the parsed value overwrites it.

If a cell would say "I don't know which branch this takes": that's a bug suspect. Resolve it before the pass ends — either write a test that pins the branch, or read the called code (including third-party drivers) until you can predict it.

## Pass 2 — Reviewer Pre-Mortem

Force a specific guess: **"If a reviewer finds a bug here, it's at `<file>:<line>` when the input is `<X>`, because the code does `<Y>` instead of `<Z>`."**

- If you can't produce a specific guess → you haven't probed enough → return to Pass 1.
- If you produce a guess → either fix the bug now, or write down concretely why the guess is wrong.

A pre-mortem that says "somewhere in error handling" or "maybe the validation" does not count. Specific line + specific input + specific wrong-behavior.

Produce at least one pre-mortem. Two or three is better; each one is a free lead.

## Pass 3 — The Annoying Test

After writing the tests you had in mind for the change, write ONE more — the test you are reluctant to write. Reluctance is the signal; it means you have been avoiding a case. Common shapes the annoying test takes:
- empty-but-not-nil
- exact boundary (off-by-one)
- the path nobody is expected to run
- two operations racing on the same record
- input that violates an implicit assumption the code relies on
- the case the previous version of this code handled but the new version forgot

If you genuinely cannot invent an annoying test, say so out loud and explain why. Do not fake one — a faked annoying test pollutes the suite.

## Pass 4 — Atomicity / TOCTOU Envelope

Every check-then-act pattern in the diff is a candidate bug until proven otherwise. The pattern looks like:

```
read shared_state          # snapshot
if validate(snapshot): ...  # app-layer check
write shared_state          # often unconditional UPDATE
```

The same shape exists in the browser: a worker answer or a preview computed for an input that has changed since (the plan, the world, the workspace signature) is a stale snapshot.

For each such pattern in the diff, write down:

1. **Predicate** — what property of the state did the validation depend on? (e.g. "workspace `revision` is N", "owner is the session user", "the plan is the one the variants were computed for".)
2. **Atomicity envelope** — how is the predicate still true when the write lands? Acceptable answers:
   - The `WHERE` clause contains the predicate (compare-and-swap, as in `UPDATE workspaces … WHERE user_id = ? AND revision = ?` in `apps/api/worlds.ts`) and "no row returned / `changes === 0`" is handled as a conflict.
   - A transaction holds the rows between read and write.
   - In the UI: the answer carries the input it was computed for and is accepted only if that input is still current.
   - The predicate is monotonic and your transition is in the safe direction (e.g. counter only increases, you check `>= N` — but be very sure about monotonicity).
   - Concurrent callers are structurally impossible (single-writer queue, leader-only handler — name the mechanism).
3. If none of the above hold: **it's broken**. Two concurrent callers can both pass the check on the same stale snapshot and both write.

**Side-effect ordering — separate probe, even after CAS is added.** For any hard-to-reverse side effect inside the guarded section (deleting saved plans or factories, clearing browser storage, removing a session, file removal):
- The order MUST be: CAS-guarded write first, side effect second — and only on confirmed write success.
- The bug shape: side effect runs first, then the unguarded write loses the race, and the side effect has already executed. CAS on the write alone doesn't fix it.
- Write down for each side effect: "executes at `<file:line>`; gated by `<write at file:line with filter X>`; if the write races and loses, the side effect is `<reversible how / not reversible>`."

This pass is non-optional. A `READY` verdict without an explicit atomicity-envelope entry for each read→validate→write in the diff is invalid.

## Pass 5 — Cross-File / Cross-Caller Audit

The largest source of multi-round reviews on small diffs is: **you changed X, but Y calls X a way you did not audit.**

For each function whose signature, return shape, or behavior changed:
1. `grep` every caller across the repo.
2. For each call site, write down the file:line and one of:
   - "Still works because `<reason>`" — name the reason concretely (the call site never passes the new edge input; the new behavior is a strict superset; etc.).
   - "Breaks because `<reason>`" — name the broken assumption and fix or queue a fix.

**Also audit sibling branches of the modified function itself.** If your edit added a guard inside one branch (sort allowlist inside `parseListParams`), enumerate the OTHER branches in the same function (the range parse five lines below) and audit them against the Pass 1 input-shape table. The same call site / same function / different code path is a classic blind spot — the edit drew your attention, and the lines you didn't touch escaped attention.

### Production Wiring Trace (forced table)

The caller grep above stops at the call site. The BEHAVIOR you changed may live on one of several paths that reach the same result: the main solve and the variant or analysis re-solves, the worker and a direct call in tests, `effectivePlan` and the raw plan, the guest browser draft and the account workspace. Structural typing in TypeScript and factory functions make a sibling path look interchangeable — and it bypasses your fix entirely.

For every function whose behavior you changed, produce this table:

| Modified function | Call site (file:line) | Wiring site (file:line: worker entry, route registration, hook) | Path used in production | Goes through the modified function? |
|---|---|---|---|---|

Resolve any "✗" row in the last column before declaring READY — the fix is currently dead code in production. If the sibling path is intentional, name it and explain why it doesn't need your change.

**Hand-trace, do not rely on the compiler.** Compile passing means "some type with the right methods is in the slot", not "your type is in the slot."

### Cross-package consumer grep (mandatory for shared/pkg types)

For each type / struct / interface whose shape changed:
1. `grep` every consumer (marshal, unmarshal, encode, decode, mock, fixture, route handler, test).
2. For each, check forwards/backwards compatibility at that site.

**When the changed type lives in a shared package (`packages/domain`, `packages/solver`, `packages/game-data`), the grep MUST span the entire repository, not just the package you modified.** Runtime validation is the canonical hot spot: a field added to a `Plan` type also needs its zod schema, the saved-file format (`recipeSettingsFile.ts`, plan import), the API body schemas, test fixtures and the legacy-plan handling. `pnpm typecheck` passes while a schema silently strips or rejects the new field.

If you find yourself thinking "but that consumer was added in a prior session and is out of scope" — it is in scope. The audit is on the FILE AS IT STANDS, not the diff alone. A prior-session change still in your unstaged tree is part of what you are about to ship.

**Do NOT pattern-match the change shape.** ("I removed an omitempty tag, let me grep for other tags missing omitempty.") Pattern-matching audits miss the entire bug class where the same primitive is consumed differently elsewhere — a different call site, a different unmarshal pattern, a different fixture. Always trace by data flow or call graph, not by syntactic match.

### Library-primitive consistency within the diff

For each primitive with a cleanup or error discipline used in the diff (SQLite statement or transaction, `fetch` response, Web Worker message, browser storage, solver status, file reader), enumerate every usage in the diff and confirm they apply the same pattern. Two adjacent files in the same PR using the same primitive with different discipline is a classic "obvious in hindsight" finding.

| Primitive | Usage (file:line) | Cleanup + error check |
|---|---|---|

Common omissions:
- `fetch`: `response.ok` not checked before `response.json()`; a non-JSON error body throws and hides the server's message.
- Worker: no `error` branch in the reply; an answer for an outdated input is shown as current.
- `localStorage`: read or write outside `try/catch`; it throws in private mode and with full storage.
- Solver result: a status other than optimal (infeasible, unbounded, time limit, approximate) shown as a success, or a "not optimal" result called optimal.
- SQLite: several writes that must land together run outside one transaction.

If one usage in the diff handles the cleanup correctly and another does not, the inconsistent one is the bug.

### Stored and exported data shapes

For writes to SQLite, browser storage, exported files and API responses inside the diff:
- Trace the shape from caller through `JSON.stringify` and the zod schema to storage and back. Empty vs absent fields, `null` vs `undefined`, the difference between "field present with null value" and "field omitted entirely".
- Data written before the change exists everywhere: guest drafts in the browser, account workspaces in SQLite, exported files on disk. For a new field, answer separately for: key absent, `null`, empty, a value from another catalog version. Old plans must keep their meaning; dropping a field silently or migrating a plan without telling the user is a bug.
- Common TS gotchas to probe: `{}` is truthy but has no keys; `null` and `undefined` differ at `JSON.stringify` (one is preserved, one is dropped); `Array.isArray(null)` is false but `typeof null === "object"`; `0 || fallback` replaces a meaningful zero.

## Pass 6 — Naming-Smell Sweep

**Goal:** prevent the next reader from mistaking a load-bearing distinction for copy-paste, and prevent yourself from shipping actual copy-paste.

Scan every newly introduced or renamed identifier in the diff (variable, function, type, field, file) for ordinal / duplicate / copy-paste naming patterns:

- **Numeric suffix:** `foo2`, `foo3`, `existingX2`, `vault2`, `userNew3`.
- **Generic qualifier suffix:** `fooNew`, `fooOld`, `fooCopy`, `fooTemp`, `fooFinal`, `fooReal`, `processV2`, `handlerNew`.
- **Two identifiers in the same scope** whose names differ only by a digit, by `New` / `Old`, by a tense, or by another trivial qualifier.

Every hit demands a written verdict, exactly one of:

1. **"It's a real duplicate — collapse it."** The second instance carries no semantic role distinct from the first. Reuse the original via scoping shadow (most languages support `if … { var foo = newValue }` shadowing inside the nested block) or fold the logic together. After collapsing, the duplicate variable simply does not exist.
2. **"It carries a distinct semantic role — rename it."** State the role in one short phrase ("the row found via the race re-check", "the post-validation copy of the request", "the user record after the merge"). Rename to reflect the role, never the ordinal position. Verify the new name reads clearly at every usage site without the reader needing to scroll back to the declaration.
3. **"Same concept, different scope — shadow the outer name."** The digit suffix was avoiding a shadow that the language already supports cleanly. Move the second declaration into its own scope and reuse the original name.

**Anti-patterns in the replacement name:**
- `xResult`, `yData`, `zFixer` — describes *what the code does with the value*, not *what the value is*. Variables name nouns. (`xFixer` is fine as a class / handler name; never as a variable holding a row.)
- A name that requires the reader to scroll up to interpret. `existingFoo2.ID` reads as "the ID of the second existing foo" — meaningless without context. A good name encodes *why this instance exists* at every usage site, so `racedFoo.ID` reads as "the ID of the foo surfaced by the race re-check" with zero scrolling.

**This pass doubles as a redundancy check.** Walking the diff for ordinal-named identifiers forces you to articulate the semantic role of each instance. If you cannot state a distinct role, the variable is genuinely redundant — that is a correctness finding (delete the duplicate code path), not just a clarity one.

If the diff has zero numbered / ordinal / duplicate-style identifiers, state "No naming smells in the diff" and move on. Do not invent smells.

## Pass 7 — Convention & Peer-Conformance

The passes above catch code that is *wrong*. This pass catches code that *works but doesn't belong* — a unit that violates how the codebase already builds the same kind of thing. These never fail a test, so only an explicit peer comparison surfaces them; they are a dominant source of "this works, but why isn't it like the others?" review rounds.

**Trigger:** the diff introduces a NEW unit, or MOVES / renames / re-scopes an existing one, where the unit belongs to a category that already has members — a bloc / store / controller, a page / route / screen, a repository, a use case, a service, a model, a migration, an endpoint, a component. If the diff only edits the *body* of an existing unit and adds no new categorizable unit, state "No new or moved units — peer-conformance N/A" and skip the pass.

For each new or moved unit, first **find its peers** — `ls` the sibling directory, `grep` the base class / interface / decorator that defines the category (`extends Bloc`, `@RoutePage`, `implements Repository`, `@Injectable`, `func Test`). Cite 2–3 concrete peers by `file:line`. Then fill the table — **every axis, not just the one your change touched**:

| Axis | How the peers do it (cite 2–3) | How my unit does it | Same? |
|---|---|---|---|
| **Name** — named for what concept? | | | |
| **Location** — which dir / colocated with what? | | | |
| **Scope / lifetime** — per-instance, singleton, request-scoped? shared by how many consumers? | | | |
| **Provisioning / wiring** — registered / provided where, at what level? | | | |
| **Dependency direction** — who may consume it? does it cross a boundary peers don't? | | | |

Every **✗ Same?** row demands a written verdict, exactly one of:
1. **"Deviation is a defect — conform."** Bring the unit into line with its peers (rename / relocate / re-scope / re-wire) and note the edit (it becomes mid-audit surface — see the re-run rule).
2. **"Deviation is justified — name the sanctioned exception."** State the specific reason this unit legitimately differs **and** cite an existing place the codebase already tolerates that exception. "It was easier" / "it mirrors the old code" / "the ticket only said X" is not a justification.

**Concrete smells this pass is built to catch** (each a real "obvious in hindsight" finding):
- **Shared-where-peers-are-scoped:** a type consumed by more pages / modules / boundaries than any peer of its kind — a single bloc / store / controller imported by two sibling screens when every other one is per-screen. (Detector: for the new unit's category, `grep` each member's consumers; if yours has strictly more independent consumers than the peers, that's the smell.)
- **Named for a non-existent concept:** a directory / module / class named `X` with no corresponding `X` page / route / entity — an orphan that exists only to be borrowed. (Detector: `grep` the name for a matching entrypoint; absence is the smell.)
- **Entrypoint missing the unit its peers all have:** a page / route / handler with no co-located bloc / controller / validator that every sibling entrypoint owns, so it borrows a sibling's.
- **Off-convention placement or wiring:** registered as a singleton where peers are factories, provided at an app / nav level where peers are per-screen, or placed at a different directory depth than peers.

Do not invent a peer set for a genuine one-off. If the unit truly has no peers (a first-of-its-kind), say so — but verify it by grepping the category first, because "I assumed it was novel" is how the borrowed-from-a-sibling case slips through.

## Pass 8 — Dangling-Reference Inlining

A comment that points at an artifact the repository does not contain is a dead reference. ADRs, design docs, plan sections, and review threads often live outside version control — or in an untracked file that never gets committed. Do not assume either way: one repo commits its ADRs under `docs/adr/`, another keeps them in an untracked plan file; `git ls-files` decides. When the code's rationale lives only in that external artifact, the next reader — and the reviewer — cannot recover *why* the code does what it does, or *what invariant* it must preserve.

Scan every comment, doc-comment, log message, and string literal **introduced or modified in the diff** for references to out-of-band artifacts:
- Decision-record / spec identifiers: `ADR-4`, `RFC 7`, `the spec`, `the design doc`.
- Plan section / anchor refs: `§5.1`, `section 9`, `per the plan`, `(see plan)`, `PLAN.md:341`.
- Doc filenames carrying rationale: `NOTES.md`, `HANDOFF.md`, any `*.md`.
- Any ticket / PR / review-thread / memory-file id — `ABC-123`, `PR #42 review [High]`, a `reference_*` / `feedback_*` memory-file slug — bare or trailing an otherwise complete sentence. These are never kept: the sentence must carry the why on its own and the id is dropped.
- Vague pointers: "as discussed", "see the doc", "per the review".

For each hit, resolve whether the referent is actually in the repo — `git ls-files <doc>` (untracked, i.e. `??` in `git status`, counts as NOT committed), or grep for the section/anchor. Then write exactly one verdict:

1. **Committed and reachable → keep the pointer.** A reader can `grep` / click through to it. A one-line gist alongside the pointer is a bonus, not required.
2. **Not committed → inline the load-bearing rule.** Expand the bare pointer into the actual rule it encodes, in one or two lines, so the comment stands alone. Then drop the pointer: `// record once, then park; never a silent delete`, not `… (ADR-4)`. Provenance lives in the commit and the PR, not in source; a pointer survives only under verdict 1.
   **"Inlined" has teeth:** it means a sentence a newcomer with zero tracker / doc / vocabulary context understands. Renaming the pointer to a jargon term — a future function (`archive_inspect`), a coined concept (`normalization`), or the ticket id itself — is NOT inlining; it is the same dead reference wearing a different mask, and it is exactly what Pass 9's cold-reader test rejects. If you cannot state the rule in plain words, you do not yet understand it well enough to keep the comment.
3. **Pure provenance, no behavior gated → delete it.** A changelog / attribution / "added in PR #n" note encodes no invariant, so there is nothing to inline and nothing for a reader to learn; `git blame` already holds it.

**The test:** if the referenced artifact were deleted tomorrow, would the next reader still know *why* this code does what it does and *what* it must not break? If no, inline more. Inline the rule, not the whole document — one or two lines, the invariant and its reason, not a transcript.

Pre-existing dangling references in the touched function are worth flagging in the same pass, but only diff-introduced or diff-modified ones are blockers for READY.

## Pass 9 — Comment Quality

A comment is for the reader, not the writer. The default failure is a comment that restates what the code already says, piles on jargon, or runs for a paragraph — each one costs the reader time instead of saving it. This pass holds every comment in the diff to that bar; the same wall-of-text-with-internal-names smell that survives every other pass dies here.

Scan every comment, doc-comment, and log message **introduced or modified in the diff**. Hold each to six criteria:

1. **WHY, not what.** It explains the reason, trade-off, gotcha, or non-obvious consequence — not a narration of the line below it. A comment that restates the code is noise.
2. **Plain language, unwrapped — the cold-reader test.** Rule every comment as if the reader has never opened the issue tracker, never read the design docs, and has not learned the team's private vocabulary. Under that eye, each of these is a failure and must be **unwrapped into plain words inline, or cut**:
   - a **ticket, PR-review, or memory-file id** (`ABC-123`, `PR #42 review [High]`, a `reference_*` / `feedback_*` memory-file slug) — it names a place to look, not a meaning, and it does not belong in source at all (it lives in the commit / PR / tracker). Never let a ticket be the subject or predicate of a sentence: `…are ABC-123` is banned, and so is a trailing `(ABC-123)` on an already-complete sentence. The verdict is Rewrite with the reference dropped, or Delete — there is no "keep as provenance". A decision-record pointer survives only when Pass 8 proved it committed in this repo.
   - a **future or internal function / concept name** used as if it explained itself (`archive_inspect/query`, `normalization`, `presigned human-download`, `trips the A.2 idempotency mark`) — name the *thing in the world* instead (`reads a stored blob back and searches inside it`, `reformats it`, `builds a download link for a person`).
   - **error-code or acronym shorthand** (`TOCTOU race on concurrent InsertOne`, `DocumentTooLarge`) — say what actually happens (`two requests create the same user at once`, `the result is bigger than the database allows and the save crashes`).
   Real-world terms beat all of these. A bare code symbol is allowed only when it names an *actual function in this diff the reader will click through to*, and no plain phrase is clearer (the `handle` docstring naming `_read`/`_edit` is fine; `archive_inspect` — a function that does not exist yet — is not).
3. **Length follows content — usually 1–3 lines.** Never a multi-paragraph essay, never cryptic shorthand; both extremes waste the reader. A 10-line comment on a 6-line function is a smell — the detail belongs in the PR / commit message / chat, not the source.
4. **Surprising, not obvious.** Self-explanatory code gets no comment. Reserve comments for a decision a future reader would otherwise have to reverse-engineer: an exception to the obvious rule, a trap, a magic number's derivation, or why two similar things both exist. Exported / public symbols are not exempt — TSDoc habit is not a licence for `/** Does foo. */` on `foo`; write a doc comment only where a linter enforces it or the name leaves the caller's contract unclear, and then state only the contract.
5. **Once, where the misread would happen.** A contract documented on the implementation is not repeated on the interface that names it, on the caller, or in the test. Two comments saying the same thing: keep the one at the point a reader would go wrong, delete the other.
6. **Tests: the name carries the behaviour.** A test comment is justified only for a non-obvious setup or trap (a stub that nil-panics on purpose, a clock frozen for a reason). One that paraphrases the assertion below it is a Delete.

**Enumerate — do not bulk-certify.** A blanket "all comments are plain-language / load-bearing / fine" is an **invalid Pass 9 and voids READY** — it is exactly the rubber-stamp that lets jargon ship. List EVERY comment, doc-comment, and log message introduced or modified in the diff, one row each, **quoted verbatim**. The row count must match the diff. Reading a comment aloud in its own row is what surfaces the jargon a bulk sentence hides:

| Comment (verbatim) | file:line | Verdict |
|---|---|---|

For each row, exactly one verdict:
1. **"Rewrite → «paste the new text»."** Produce the shorter, plainer, unwrapped version now, show it in the row, and apply it (this becomes mid-audit surface — see the re-run rule).
2. **"Delete."** It restates self-explanatory code and carries no why — remove it.
3. **"Keep — justified: «one-line reason»."** Load-bearing and already passes the cold-reader test.

Worked example — the exact miss this pass exists to stop (jargon-soup + a ticket carrying the meaning):
- ✗ `Navigation (archive_inspect/query), normalization, and presigned human-download are ABC-123 — deliberately not here.`
- ✓ `This only stores the blob and returns a short ref. It never reads a stored blob back, searches inside it, reformats it, or builds a download link for a person — those come in a later change, so nothing here should try to fetch a stored result.`
The fix drops one ticket and three internal terms, and states the why a newcomer actually needs: don't add fetch logic here.

Second worked example — the three verdicts side by side:
- ✗ `// centsPerDollar converts a dollar amount into cents. See ABC-123.` — restates the name and points at a ticket. Delete.
- ✗ An interface doc-comment that re-describes the contract already documented on the one method it wraps. Delete — it is said once, on the implementation.
- ✓ `// Kept through account deletion on purpose: this table is the financial record of what was charged.` — an exception the code cannot express. Keep.

If the diff introduces or modifies no comments, state "No comments introduced or modified — comment-quality N/A" and move on. Do not invent comments to critique.

## Pass 10 — Probed-vs-Not-Probed Declaration

Close the session with an explicit declaration:

**Probed**: list — for each item, name the input shape / call site / type variant you checked, with `file:line` references where applicable.

**Not probed** (with reason): list — common reasons include third-party library internals, deep architectural invariants, concurrency under realistic load, environments you cannot reach (production data, restricted networks), integration points outside the diff, behaviors the test harness mocks away.

Do not claim coverage you did not generate. "All tests pass" means "the tests I wrote pass" — not "the change is correct."

## Output

End the session with exactly one of:
- **READY** — all ten passes documented in the session, no unresolved suspects, cross-file callers + production wiring + sibling branches + cross-package consumers + library-primitive consistency all audited, atomicity envelope written for every check-then-act in the diff, naming-smell sweep verdict written for every ordinal / duplicate-style identifier (or "No naming smells in the diff" stated explicitly), peer-conformance table written for every newly introduced or moved unit with a verdict on each off-convention axis (or "No new or moved units — peer-conformance N/A" stated explicitly), dangling-reference verdict written for every diff-introduced ADR / plan / doc pointer (or "no external references in the diff" stated explicitly), comment-quality enumeration written with one verbatim row per diff-introduced or modified comment and a verdict on each (a blanket "all comments fine" voids READY), or "No comments introduced or modified — comment-quality N/A" stated explicitly, no ticket / PR / review / memory-file reference surviving in any diff-introduced or modified comment, mid-audit edits re-run declaration written (see below), not-probed declaration written.
- **BLOCKED** — one or more passes surfaced a suspect you cannot yet resolve. Name the specific suspect and what evidence is missing to close it (a test you cannot write here, a caller you cannot reach, a driver behavior you cannot verify without a real cluster).

Never output **READY** without the artifacts of all ten passes present in the session.

### Mid-audit edits require re-runs

Code edits applied during the audit (in response to a Pass 2 pre-mortem, a Pass 4 atomicity finding, etc.) introduce NEW modified surface that prior passes did not cover. Before declaring READY:

1. List every file you edited DURING the audit, with a one-line summary of what changed.
2. For each edit, name which passes' conclusions depend on the file.
3. Re-run those passes against the new code and state the result inline.

The single largest "READY too soon" failure mode: writer drafts the audit, surfaces a pre-mortem, applies a fix, declares READY without re-running Pass 5 against the fix. The fix's own production-wiring trace, cross-caller grep, and sibling-branch sweep never happened. Any non-trivial edit during the audit is, in effect, a new diff — treat it that way.

If a mid-audit edit is non-trivial (more than a static-text change, a docstring, or a renamed local variable), prefer **BLOCKED** with the suspect named and the edit queued for a fresh audit pass, rather than READY with rushed re-runs.

## When not to use

- Exploratory or spike code that is explicitly not for shipping.
- Pure no-op refactors with strong test coverage and no behavior change (e.g. rename across files).
- One-line typo fixes in comments or docs.

For anything else someone might review or merge: run this.
