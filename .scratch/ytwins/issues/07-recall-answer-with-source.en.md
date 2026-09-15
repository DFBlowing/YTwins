# 07: Recall — asking about an old thing, answered with its source

**What to build:** Ask a question against the **records** (say "how is the final graded") and get an accurate answer
together with the **drop** it came from, checkable against the verbatim original text. When recall comes up short it
says **plainly that it found nothing** rather than inventing a plausible-sounding answer. So that this step can be
verified independently and early, the user can pin a "what day is it" time basis by hand instead of waiting days.

**Blocked by:** 01 (Project skeleton and the first "drop" end to end)

**Status:** needs-triage

**Claimed, then paused** (2026-09-15): the RED phase and the provider-port change were done, but ticket 02 was
required to finish first, so those changes were withdrawn from the working tree and backed up under
`archive/ticket-07-wip/` (not tracked by git). How to resume is in `## Comments` at the end of this file.

- [ ] When a question hits a **record**, it returns an accurate answer and names the **drop** it came from.
- [ ] When recall comes up short, it returns an explicit "found nothing" and generates no plausible-sounding answer.
- [ ] The answer is traceable to the verbatim original text (the same content the user typed, byte for byte).
- [ ] Both question parsing and answer generation go through the **AI provider port**, so tests using the fake provider are deterministic.
- [ ] The user can pin a time basis by hand (for the demo's "a few days later" viewpoint); that basis affects answer wording and time references but never changes what is recalled.

## Comments

### 2026-09-15 — why it paused, and how to resume

**Why.** Tickets 02 and 07 edit the same files (`interface.ts` is the one both must change). Ticket 02's work was
**uncommitted** and mid-way through a `dropped.id` → `dropped.dropId` rename (`tsc` reported 11 `TS2339`s). With
both tickets editing the same uncommitted files, git cannot separate them, so continuing 07 would only entangle
the two tickets' state.

**What was withdrawn.** 07's four changes left the working tree and are backed up under `archive/ticket-07-wip/`
(`/archive/*` is gitignored):

| Backup | Working-tree file |
|---|---|
| `ai-provider.mine.ts` | `src/domain/ai-provider.ts` |
| `interface.mine.ts` | `src/domain/interface.ts` |
| `fake-provider.mine.ts` | `src/domain/fake-provider.ts` |
| `domain.test.mine.ts` | `src/domain/domain.test.ts` |
| `core.mine.ts` | `src/domain/core.ts` (never started; kept for reference) |

The withdrawal was **deletion-only**, verified file by file: `domain.test.ts` −284/+0, `fake-provider.ts` −69/+0,
and `ai-provider.ts` gained one line only from reflowing a doc comment after the recall paragraph came out.
**Ticket 02's state was not altered.**

**How to resume.** Once 02 is committed, copy the first four backups back into the working tree and finish the
parts that were never done:

1. The fake provider's recall scripting (`ByQuestion` / `composeFallback` / `onCompose` / `askedQuestions`) —
   half-written. **Note**: `isFailure` currently recognises only `reply` / `read` as non-failure scripts; adding
   `cues` / `answer` means widening it too (or adding an `isFailureAny` as the backup did).
2. Implement `recall` in `core.ts` (selection in plain code, both ends through the port).
3. Add `/api/recall` to `src/web/server.ts`.
4. Fill in act two (问) across `index.html` + `main.ts` + `style.css`.
5. Full typecheck / tests / `check-workspace`, then `/code-review` and commit.

**Already established** (so it need not be re-derived): the backup's `domain.test.ts` runs 550 → 834 lines with
all 13 recall checks red on `domain.recall is not a function`, so the RED phase was clean. The design was
confirmed with the user: **AI supplies only the two ends** (`parseQuestion` + `composeAnswer`), **selection is
plain code inside the domain core**, **the time basis is an optional `now` on the domain operation**, and
**act two's page is filled in as part of this ticket**.
