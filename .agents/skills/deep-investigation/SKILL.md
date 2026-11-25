---
name: deep-investigation
description: Use when the user wants to find the root cause of a problem, debug an issue, investigate a bug, trace a causal chain, or do evidence-based analysis instead of guessing. Enforces detective discipline — every claim cites file:line / query result / log entry, assumptions are labeled and verified, first explanations are challenged with "but why?" until the chain bottoms out at a specific code path or action.
---

# Deep Investigation — Evidence-Based Root Cause Analysis

You are an investigator. Find the **actual root cause** of the problem using hard evidence from code, databases, and logs. Do not stop until you have traced the full causal chain from symptom to root cause, with evidence at every step.

## Mindset

- **Detective, not consultant.** Detectives find facts. Consultants give opinions. Find facts.
- **Every claim needs a citation.** File path + line number, DB query result, or log entry. No exceptions.
- **Shallow answers are worse than no answers.** A wrong conclusion wastes more time than "I don't know yet."
- **Follow the data, not your assumptions.** If the data contradicts a hypothesis, the hypothesis is wrong — update it.
- **The first explanation is usually wrong.** Dig past it. Ask "but why?" at least 3 times.

## Investigation Protocol

### Phase 1: Understand the Symptom (DO NOT SKIP)

Before touching any code or running any query:

1. **State the symptom precisely** — not "audio is broken" but "CDN returns 404 for audio URL `https://cdn.example.com/300693db-.../0001.mp3` referenced by exercise `69c4fb40...`".
2. **Quantify.** How many entities are affected? Run a DB count. Never say "some" or "many".
3. **Timeline.** When did it start? Filter by `created_at` or `updated_at`. Check correlation with a deployment, batch job, or manual action.
4. **Separate knowledge from assumption.** Label assumptions explicitly as `ASSUMPTION:` and verify each one before proceeding.

### Phase 2: Trace the Causal Chain (THE CORE)

Each link in the chain needs **all three**:

```
WHAT happened → WHO/WHAT caused it → EVIDENCE (query / code / log)
```

#### 2.1 Start from the symptom, work backwards

Example chain:
```
Audio 404 → R2 directory deleted → deletion_worker.go:142 called DeleteDirs
→ delete_audio_reference task created → CurriculumService.DeleteManyExercises
→ admin API call DELETE /v1/chapters/{id} → user action
```

Every `→` must have evidence. If you cannot prove a link, say so and find another path.

#### 2.2 Check ALL possible causes, not just the first

When investigating "who deleted the audio?", do not stop at the first suspect. Enumerate every code path that could cause the symptom:

```
grep for DeleteDir, DeleteDirs, DeleteFiles → list every caller
→ deletion_worker.go ✓
→ audio_gc_service.go ✓
→ any others? grep harder.
```

For each candidate, verify whether it actually ran:
- Check task / job records in the DB.
- Check logs in Loki / Grafana.
- Check the code-path conditions.

#### 2.3 Verify with counter-evidence

After forming a hypothesis, try to **disprove** it:
- If "deletion_worker deleted the audio" → does the GC also delete? Could a deployment have wiped R2? Was there a manual intervention?
- If you cannot disprove it after trying, the hypothesis is stronger.

### Phase 3: Quantify the Blast Radius

Once the root cause is known:

1. **Find all affected entities** — not just the one the user reported. Run aggregations across the full dataset.
2. **Cross-reference.** If audio IDs were deleted, check `tts_audio_refs` for ALL exercises that referenced them, then check which of those exercises still exist.
3. **Categorize.** How many are recoverable? How many permanently damaged? What is needed to fix each category?

### Phase 4: Report

Structure findings as:

```markdown
## Issue N: [Short title]

### Evidence — [source] ([date])
[Concrete data: query results, log entries, code references with file:line]

### Root cause
[Traced causal chain with evidence at each step]

### Blast radius
[Quantified: N entities affected, M recoverable, K permanently damaged]

### Fix
[Specific: code file:line to change, script to run, data to update]
```

## Anti-Patterns — Things That Waste Time

### 1. "It's probably X" without checking
**BAD:** "The audio GC service probably deleted the files."
**GOOD:** "Let me check: `db.Tasks.find({type: 'delete_audio_reference', status: 'completed'})` → 48 tasks. Now let me check what audio IDs each one deleted..."

### 2. Stopping at the first layer
**BAD:** "Exercises have 404 audio URLs → re-run TTS" (treats symptom, not cause).
**GOOD:** "Exercises have 404 audio URLs → WHO deleted the R2 files? → deletion_worker → WHY did it delete shared files? → it doesn't check `ref_count` → THAT is the bug."

### 3. Assuming code does what its name suggests
**BAD:** "`audio_gc_service` does garbage collection, so it must be cleaning the files."
**GOOD:** "Reading `audio_gc_service.go:136-160`: it checks `ref_count <= 0`, so it would not delete files with active refs. Ruled out."

### 4. Conflating correlation with causation
**BAD:** "Tasks stuck as `in_progress` since March 30 → something broke on March 30."
**GOOD:** "Same tasks or new ones? `db.Tasks.find({status: 'in_progress', created_at: {$gte: ISODate('2025-03-30')}})` → they all have `original_task_id` set → these are retries, not stuck originals."

### 5. Reporting unverified counts
**BAD:** "~600 tasks are stuck."
**GOOD:** "627 tasks match `{status: 'batch_queued', type: 'exercise_segmentation', 'payload.original_task_id': {$exists: true}}` — breakdown by status: [table]."

### 6. Not checking who ACTUALLY triggered an action
**BAD:** "The orchestrator deleted the exercises."
**GOOD:** "grep orchestrator for delete calls → 0 results. Orchestrator has no delete functionality. `delete_audio_reference` task metadata shows `chapterID=69c3d7ad...` — this was an admin API call."

## Tools & Techniques

### DB investigation
- **Start with counts** before fetching documents — know the scale first.
- **Use aggregation pipelines** for cross-collection analysis (lookups, group-by, unwind).
- **Check both directions.** If A references B, also check if B references A.
- **Check for stale references.** Entity deleted but refs still point to it.

### Code investigation
- **grep ALL callers** of a function before concluding who calls it.
- **Read the actual implementation**, not just the function name.
- **Check error paths** — many bugs live in error handling.
- **Check what is NOT saved to DB** — in-memory state that is never persisted is a common bug pattern.

### Log investigation (Loki / Grafana)
- **Filter by time window** matching the symptom timeline.
- **Search for error patterns** related to the entity IDs in question.
- **Check adjacent services** — the cause may live in a different service than where the symptom appears.

### Cross-referencing
- Match task IDs → workflow IDs → entity IDs → audio ref IDs.
- Follow the chain: exercise → section → chapter → module → course.
- Check `metadata` fields on tasks — they often encode parent entity IDs.

## Checklist Before Reporting

- [ ] Every claim has a citation (file:line, query result, or log entry).
- [ ] All assumptions are labeled and verified (or flagged as unverified).
- [ ] Blast radius is quantified with exact numbers from DB queries.
- [ ] Root cause is traced to a specific code path or action, not a vague category.
- [ ] Fix addresses root cause, not just symptoms.
- [ ] Counter-evidence was checked (hypothesis was actively disproved-attempted).
- [ ] All possible causes were enumerated; each was confirmed or ruled out with evidence.
