# 09: Deletion — announce first, then cascade

**What to build:** When deleting a **drop**, the system first states plainly "N **conclusions** came from it", and
the user decides whether to delete those too or only the original text; once confirmed the deletion runs, and after
it the text appears in no **recall** result and no **conclusion** — "deleted" means actually deleted, with no orphan
rows left behind.

**Blocked by:** 05 (Threshold assembly — the first conclusion, portrait and conclusion chain), 07 (Recall — asking about an old thing, answered with its source)

**Status:** ready-for-human

- [x] Before deletion it returns a preview: the number of **conclusions** affected by this drop (say "N conclusions came from it").
      → `domain.previewDeletion(dropId)` (`src/domain/interface.ts`) returns a `DeletionPreview`: the **sentences**
      of the affected conclusions (`conclusions`, a `ConclusionRef[]`) plus the **terms only this drop said**
      (`terms`). The count is that array's length; the page says "N conclusions came from it:" and **lists the
      sentences** — reporting a bare number asks the user to trust a statistic, while showing the sentences asks
      them to recognize what they are giving up.
      It changes **nothing**: asking twice gives the same answer twice, and reading it without acting leaves the
      material exactly as it was.
- [x] No deletion ever happens before the user makes one explicit choice; there is no silent or default deletion.
      → `domain.deleteDrop(dropId, mode)`'s `mode` is **required**, taking `'cascade' | 'original-only' | 'keep'`.
      `'keep'` is one of the three answers and deletes **nothing** (it returns `null`) — reading the preview and
      deciding not to delete is a decision.
      The same holds at the API: `POST /api/delete` without a `mode` is a **400**, and so is an unrecognised mode
      (it does not fall back to a default). "Silent deletion" is therefore unreachable in the **call shape**,
      not merely by convention.
- [x] Choosing "delete those too" cascade-deletes the affected **conclusions** with no orphan rows.
      → See "Why conclusions are deleted explicitly, not by the foreign key" below. The cascade runs down from
      `conclusion_` and takes `surfacing_` (the record of it having been shown) with it; `supersedes` uses
      `ON DELETE SET NULL`, so a chain pointing at it falls back to "opened the chain" rather than pointing at a
      conclusion nobody can read.
- [x] Choosing "delete only the original text" removes the drop and record while keeping or invalidating the derived conclusions per a stated rule (pick one at implementation time and write down why); it neither crashes nor leaves dangling references.
      → **Keep, not invalidate**; the reasoning is under "Why keep rather than invalidate" below.
      It takes two steps: the conclusions the user chose to keep are first **moved onto a matter that survives the
      deletion** (`carryOver`), then the original is deleted, and finally the terms that are gone are pruned out of
      those conclusions' `support` (`pruneSupport`) — **the sentence is not touched at all**; only the evidence it
      cites changes. So nothing dangles: every term in the support is still there.
- [x] After a cascade delete, **recall** no longer returns any of that drop's content.
      → Recall (07) picks records by finding substrings in the **stored original**, so once the original is gone
      there is nothing to match — a structural guarantee rather than a filter: the deleted drop is not "excluded",
      it does not exist. `tools/e2e-ticket-09.mjs` pins the "answered before, `not-found` after" pair.
- [x] After a cascade delete, neither the **portrait** nor the **conclusion chain** retains a trace of it.
      → The portrait is the set of conclusions (`listConclusions()`) and the chain is the relations between them,
      so removing the conclusion empties both at once. The e2e serialises the **whole `/api/conclusions`
      response** and asserts neither the sentence nor a supporting term can be found in it.
- [x] After a cascade delete, the **terms** and **links** pointing at it are removed too, leaving no orphan rows.
      → Narrowed to "the terms **only this drop said** go with it; a term other drops also said does not". See
      "What happens to a shared term" below — this is the one place the implementation departs from the literal
      wording, and the reasoning is written down there.

## Comments

**2026-09-17 — implemented**

**New domain vocabulary and shapes** (`src/domain/interface.ts`, the highest seam):

- `DeletionMode = 'cascade' | 'original-only' | 'keep'`, `DELETION_MODES`, `isDeletionMode()`.
- `DeletionPreview { dropId, body, conclusions, terms }` — the preview.
- `DeletionResult { dropId, conclusions, mode }` — what the deletion **actually** took.
- Two new operations: `previewDeletion(dropId)` and `deleteDrop(dropId, mode)`.

### Why conclusions are deleted explicitly, not by the foreign key

`conclusion_` hangs off its **matter** (`matter_id ... ON DELETE CASCADE`), and a matter hangs off the **term** it
was opened around. Deleting a drop only reaches the matter when that drop was the matter's **last member** — so a
matter the user kept returning to would survive, and "delete those too" would quietly degrade into "delete
nothing": worse than either option. So `cascade` deletes the conclusions **explicitly**; the foreign keys only tidy
up `surfacing_` (the record of having been shown) and the dangling reference in the chain.

### Why keep rather than invalidate

The ticket offered a choice. **Keep** was chosen because the **portrait is a history of what the product thought at
the time**, not a current-state view that back-fills as the data changes. Rewriting an old conclusion into "this
was withdrawn" is the product **editing its own past** to look better; and what the user says by choosing "delete
only the original" is "don't remember that I said this", not "you were wrong".

The cost, stated plainly: after `original-only` the portrait holds a conclusion the user **can no longer check word
for word** — the original is gone. That is what the option means, not an oversight in the implementation; the
option that takes the conclusion too is called `cascade`.

### What happens to a shared term (the one departure from the literal wording)

The ticket says the **terms** and **links** pointing at the drop are removed. Executed literally, that would damage
**other drops**: `term_` holds one row per wording (the rule 04 fixed), so 「好烦」 said on Monday, Tuesday and
Wednesday is **one** term that all three drops mention. Deleting Monday's drop and taking the term with it would
leave Tuesday's and Wednesday's fragments **silently short of a word they said** — that is editing content the user
did not delete.

So the rule is: **a term goes only when this drop was the last to say it** (`orphanedTerms()`, which counts who is
still saying it rather than where it first came from). A term that stays takes its `link_` rows with it, because
both ends still exist; a term that goes has its links cascaded away. A term whose row is gone is pruned out of both
the matter's `support` and the conclusions' `support`, so neither is left with a dangling reference.

### The trap: `term_.origin_drop_id`'s cascade was wrong (this ticket's only schema change)

The first version came out with 「好烦」 **gone** after a cascade — Tuesday's and Wednesday's drops silently short of
a word.

The root cause was not the deletion code but the schema 02 left behind:
`term_.origin_drop_id REFERENCES drop_(id) ON DELETE CASCADE`. It was written for the reason "nothing exists
without a source", which reads as harmless and is not — **a cascade along a reference is only correct when that
reference is the only thing holding the row up**. A term holds one row per wording and is mentioned by several
drops; `origin_drop_id` is just **one** of the mentioners, so treating it as the parent row amounts to saying "the
first drop that said this word is gone, so the word was never said". It is now **not a foreign key** (new
databases), with a **table rebuild** migration for old ones (`dropTermOriginCascade()`; `ALTER TABLE` cannot drop a
foreign key, so the table is rebuilt, and since `PRAGMA foreign_keys` cannot be turned off inside a transaction it
is switched off around the rebuild and back on afterwards). When a drop is deleted, code sets the surviving terms'
`origin_drop_id` to NULL.

That lesson is worth more than the rest of this ticket, and it is written into the schema comment in
`sqlite-store.ts`. `domain.test.ts` gained a check that **hand-builds a 01–08 database and then deletes a drop**,
pinning "the migration must not lose words either".

### If the remaining fragments re-cross the threshold, does it surface a new conclusion?

**Yes, and that is correct.** The matter did not vanish with the drop (two members remain), and the terms left
still support a judgement — so it should be said again, and the new one's support will **not** contain what was
deleted (the kept conclusion's support was already pruned). Staying silent would be the mistake in the other
direction: it would mean the material the user did **not** delete had been quietly discounted too.
The check in `tools/e2e-ticket-09.mjs` is therefore not called "nothing surfaces after a delete" but "what is said
after a cascade is built only from what is left" — it asserts **what the judgement stands on**, not whether the
product stays quiet.

### Tests and verification

Domain **131/131** (14 new, including one for the old-database migration and two for re-anchoring), new
`tools/e2e-ticket-09.mjs` **15/15** (run three times, same result each time), the 02–06 and 08 e2e suites green
(7/6/5/5/6/11), `tsc --noEmit` clean, `vite build` succeeds (`dist/web` 9.95 kB HTML), `check-workspace` clean
(21/21); and a manual pass on a real server running the real demo provider: drop the demo fragment three times →
one conclusion → preview names that sentence → a request with no mode is refused with 400 → `keep` deletes nothing
→ `cascade` takes the conclusion, leaves the other two drops' terms intact, and recall still answers from the
copies that remain.

### What `/code-review` found, and what was done about it

Both axes were run in parallel (fixed point `fcf0665`). **The Spec axis found a real bug, and one that 500s:**

1. **`reopenMatter` inserted a `matter_drop_` row pointing at a drop that does not exist (Spec axis, fixed).**
   The first version re-opened a matter by writing a synthetic row with `drop_id = 'open:<matterId>'` — but that
   column is `REFERENCES drop_(id) ON DELETE CASCADE` and foreign keys are on, so it threw
   **`FOREIGN KEY constraint failed`** every time, turning `original-only` into a 500.
   Worse, **none of my domain tests could reach that branch**: they used the anchor 「好烦」, which all three
   fragments say, so the anchor survived by accident and the re-anchoring path was never walked. Only the e2e hit
   it — and I misread that failure as a wrong assertion on my part.
   **The fix was to ask whether a matter needs a membership row at all.** It does not: a matter is re-opened
   around a **word**, and a word is not a fragment — recording one as having fed the matter would be inventing a
   fact about the user's material. Now only the anchor moves.
   Two domain checks were added: one walking the whole path, and one **pinning the orphaned-anchor branch** by
   hand-building that state. I verified that putting the bug back turns that check red.
2. **A dead abstraction, `detachDropFromMatter` (Spec axis, scope creep):** implemented, documented, **never
   called** — the core uses `forgetMatterDrop`. Removed, along with its prepared statement.
3. **Two misnamed checks in `e2e-ticket-09.mjs` (Standards axis):** one was titled "nothing was asked of the user"
   while asserting only a 200; another claimed to check that a deletion survives a restart while asserting
   `typeof x === 'string'`. Both inflated the pass count. Removed (the real restart check is phase five).
4. **The same data read three times (Standards axis):** `deleteDrop` called `conclusionsOf`, then `readDeletion`
   computed it again, then `carryOver` a third time. Merged into one `readDeletion()` returning
   `{ conclusions, terms, preview }`, so the preview and the work really do use the same read — which is what the
   comment had claimed all along.
5. **Three accidental line-merges** (`main.ts` twice, `sqlite-store.ts` once — pure diff noise, reverted);
   `recomputeMatter` went from "read the whole table and filter in JS" to `WHERE matter_id = ?` in SQL;
   `pruneConclusionSupport`'s `(conclusionIds, termIds)` became one `SupportPrune` type (matching the
   `TermRemoval` this change already introduced); the inline union written twice in `main.ts` became a local
   `type DeletionMode`.

**One finding both axes raised that I decided not to act on:** the Standards axis suggested dropping
`DeletionResult.conclusions`, since under `original-only` it is always `[]` — a function of `mode`. **Kept:** it
answers "what did this *actually* take away", and under `original-only` the answer "nothing but the original" is
the entire meaning of that choice. Without it a caller would have to infer what happened from `mode`, which is
exactly what the field exists to avoid. The doc comment now says so.
