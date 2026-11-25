---
name: simplest-fix-first
description: Use before proposing any fix, design, or review recommendation — a proportionality gate that forces the plain-language problem statement and the smallest fix that closes it. Fires when a finding is about to become an architecture proposal, when tempted to refactor / invert / abstract / add a CI guard, when a proposal grows layers or phases, when a missing feature is being reframed as a structural defect, or when the user asks "в чём проблема?" / "why is this hard?" / "isn't this overengineered?" / "why didn't you just...". Catches the failure where the mechanism is mistaken for the root cause and a 15-minute fix becomes a week.
---

# Simplest Fix First

Overengineering never feels like overengineering from the inside. It feels like rigor. Every step is locally justified; the whole is absurd. So don't rely on taste — run the gate.

**The one question:** what concretely is missing or broken, and what is the smallest change that puts it back?

---

## Step 1 — One sentence, concrete nouns (BLOCKING)

State the problem in one sentence a non-engineer understands, naming the actual missing thing.

> ✅ "The schema has 4 fields the UI doesn't show, so nobody can set them."
> ❌ "Save reconstructs the node from a whitelist, so unknown fields die by default."

Both were true in the real case. Only the first is the problem; the second is the mechanism.

**Banned in this sentence:** *class of problem, by default, structurally, invariant, contract, seam, source of truth, round-trip, ownership.* If you need them, you have drifted off the problem and onto the terrain.

If the sentence contains an abstract noun you coined this session, you are designing a program, not fixing a bug.

## Step 2 — The fix mirrors the gap

| the gap | the fix |
|---|---|
| feature missing | **add the feature** |
| field not in UI | **put the field in the UI** |
| value wrong | fix the value |
| step not run | run the step |

Do not promote a gap to a defect. "Nobody built it yet" is not an architecture failure — it is unbuilt work. The fix for unbuilt work is to build it.

Apply the same fix at every site the gap appears. Do not invent a different mechanism per site.

## Step 3 — Compute the ratio, and let it veto

Estimate both, in lines or minutes:

- the obvious fix: `____`
- what you are about to propose: `____`

Ratio > ~5×? Then **name what breaks today** if you ship the obvious one. Present tense, concrete, reproducible.

- ✅ "Adding the field to the list breaks X, because Y happens today." → the bigger fix is earned.
- ❌ "It won't catch field #19." → field 19 does not exist. Ship the obvious one.

**The big fix needs a present-tense failure, not a future-tense one.** This is the whole discriminator. Speculation is not a requirement.

## Step 4 — The tells

Any one of these means stop and go back to Step 1.

- **The guard tell.** Your fix needs a CI job / lint rule / test to stay honest → your fix re-created the problem it solved. A correct fix doesn't need policing.
- **The coinage tell.** You invented nouns (`UI_OWNED`, `_raw`, "layer 1/2/3"). The right fix usually needs zero new vocabulary.
- **The hypothetical tell.** Delete every sentence about something that hasn't happened. Does the proposal survive? If not, it was built on speculation.
- **The layers tell.** Your proposal has layers/phases/rollout. Does the problem have layers? Four fields don't.
- **The escalation tell.** Challenged ("isn't this a smell?", "why so complex?") and your next proposal was **bigger** → you were defending, not thinking. **Challenge must make the proposal smaller.**
- **The substrate tell.** Your "root cause" is a property of the architecture, not an action someone failed to take. A real root cause is attributable: *someone added a field and didn't wire the UI*. If you can't name the missing action, you've dug past the root into the terrain.
- **The fake-decision tell.** You're ending with "requires your call: A or B" on something you never verified is a real question. Verify first; most evaporate.

## Step 5 — The dumb version is allowed to win

The obvious control is a real control. A JSON blob field gets a textarea with a parse check. That is a legitimate, shippable answer — not a placeholder, not a compromise.

Ask: what would a competent engineer with no stake in looking clever do in 15 minutes? Propose that. If you reject it, say concretely what it fails at.

## Step 6 — Do only what was asked

- Asked to **review** → review. Do not fix.
- Asked to **explain what you intend** → explain. Do not start.
- Asked **"why"** → answer why. Do not open files and begin.

A review's job is to say what's wrong and what the fix is. Writing the fix is a different job with a different owner.

---

## When the big fix IS right

Not a license for hackery. Go structural when — and only when — the simple fix has a **named, present, reproducible** failure. Then the big fix is the smallest change that closes *that*, and Steps 1-5 still apply to it.

---

## The corpse

Real, 2026-07: a workflow editor silently dropped `reviewers` on save.

- **Real problem:** `WorkflowNode` has 18 fields; the UI supports 14. `reviewers`, `output_schema`, `interaction_schema`, `checks` were added by other PRs and never wired into the UI.
- **Real fix:** add them to the serializer's two lists (~8 lines) + one reusable JSON-textarea control in the panel. The JSON mode then works for free, because it runs through the same serializer. **~15 minutes.**
- **What was proposed instead:** invert the serializer around a coined `UI_OWNED` keyset, smuggle the source document through the view model as `data._raw`, then a CI job to police the keyset, then — when challenged — a full document-as-state refactor of a 996-line component. **A week.**
- **Every tell fired:** coinage (`UI_OWNED`, `_raw`, "layers 1-3"), the guard (layer 3 existed only to police layer 1), the hypothetical ("what about field 19?"), escalation under challenge, and a "root cause" that was a property of the architecture rather than a missing action.
- **What broke the spell:** *"The fields were added. What's the problem with updating the UI so they show up? And the same in the JSON editor? If the JSON is complicated — what's the problem with adding a box on the right you paste the JSON into?"*

That question is this skill. Ask it yourself, first, every time.
