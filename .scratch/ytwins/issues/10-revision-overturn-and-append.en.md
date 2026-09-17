# 10: Revision — marking "that's wrong" and appending your own sentence

**What to build:** The user can mark a **conclusion** as "that's wrong", and that negation becomes an **overturning**
on the **conclusion chain**: the original conclusion is kept, never overwritten or deleted, and the new judgement
stands in an overturning relation to it. The user can also append a sentence of their own beside a conclusion, and
that sentence itself becomes a new **drop** entering the same chain and continuing to settle.

**Blocked by:** 05 (Threshold assembly — the first conclusion, portrait and conclusion chain)

**Status:** ready-for-human

- [x] After marking "that's wrong", the overturned conclusion **is still on the conclusion chain** and viewable.
      → The old conclusion is unchanged to the byte: its sentence, its supporting terms, when it was made and where
      it sits are all still there (pinned one by one by "marking a conclusion wrong keeps it…" in
      `domain.test.ts`). This is not "the implementation was careful" — it is the only shape there is: marking
      wrong **appends** a row to `conclusion_`, and not one UPDATE or DELETE runs anywhere on that path.
- [x] After marking "that's wrong", a new record appears on the chain in an **overturning** relation to the old
      conclusion, naming which one it supersedes.
      → The new record is `kind: 'correction'`, `relation: 'overturn'`, `supersedes` pointing at the rejected one,
      and the page renders 「推翻了「…」」 on the same row — so "which one it supersedes" is **readable**, not an id.
      The entry point is `domain.markConclusionWrong(conclusionId)`, returning the record just written.
- [x] The **conclusion chain is append-only**: no revision overwrites or physically deletes an old conclusion.
      → Appends only. Marking the same conclusion twice records **one** correction: the second tap returns the same
      record and the chain does not grow again.
- [x] Appending a sentence beside a conclusion stores that sentence as a new **drop**, keeping the original wording.
      → `domain.appendToConclusion(conclusionId, body)` reuses the whole `drop` path (`recordDrop`): the wording is
      stored byte for byte, it is answered like any other drop, and it appears in "接住了什么" like any other drop.
- [x] That appended sentence also yields **terms** and takes part in later **settling**.
      → It is a drop, so it goes through the same extraction, linking and attachment. **"Entering the same chain"
      is structural rather than lucky**: it carries `pinned_matter_id` (that drop was written *beside that
      conclusion*), so attachment puts it straight into that matter instead of guessing from overlapping words. The
      next conclusion to settle supersedes that very record (or the correction that replaced it).
- [x] There is no rating, liking, or bulk-feedback feature — a behavioural assertion covers this red line of
      **imperceptibility** (no such entry point exists in the UI).
      → Three assertions: ① `/api/conclusions/<id>/{rate|like|score}` and `/api/rate` are all **405**, and the two
      real operations work off **one** id in the path — no request shape can carry a score or a list of ids;
      ② the key set of the portrait the page receives is pinned field by field, and holds no rating;
      ③ neither `main.ts` nor `index.html` contains a word that could name such an entry point
      (打分 / 评分 / 点赞 / 星级 / 好评 / 差评 / 五星). The page offers exactly two things about a conclusion:
      this one is wrong, and add a sentence of your own.

## Comments

**2026-09-17 — implemented**

### New vocabulary and shapes (`src/domain/interface.ts`, the highest seam)

- A third `ConclusionKind`, `'correction'`: the one record on the chain that is **not a judgement** — it records
  what the user did to the one before it. Kept apart from `claim` / `catch` because the three tell a reader
  different things ("this is what I make of you" / "this is as much as I can hold" / "this is what you said about
  my last one").
- `ConclusionAddition { conclusion, drop }`: a sentence written beside a conclusion, which is **also a drop**.
  Both halves are reported because both are true at once.
- Two new operations: `markConclusionWrong(conclusionId)` and `appendToConclusion(conclusionId, body)`.
- Two new `ConclusionPolicy` values: `overturnedOverlapFactor: 0.3`, `overturnedBandDrop: 1`; and a new
  `Conclusion.softened` field (this band was stepped down, and the page says so as the fourth input).
- Two new columns: `drop_.pinned_matter_id` (nullable, `ON DELETE SET NULL`, with an `ensureColumn` migration)
  and `conclusion_.softened` (`INTEGER NOT NULL DEFAULT 0` — a rule reads it, so like ticket 08's `item_.state`
  it is added **with** a default).

### Why the record is written by **code**, not phrased by a provider

This one was settled by the product's author before any work started (put to them as a choice, and this option
taken). The reason is the product's hardest line: **it may not say a judgement it does not have**. What the user
has just said is "you read that wrong", and handing the old conclusion to a model to write a "corrected version"
would be the product using that rejection to **invent another view of the user** — a view with no material behind
it, which the user never said. Code's line is a **fact** (the user did this), so it is stated plainly and carries
no uncertainty wording (`CONTEXT.md` on **fact**: hedging a fact is dishonest in the other direction).

That line is `CORRECTION_LINE` in `conclusions.ts`: 「你标了这条不对。」 It does not quote the old sentence,
because the record already `supersedes` it — the same fact stored twice is one more place for the two copies to
disagree.

### Why `kind` is a new value rather than a reused `catch`

A `catch` is defined as "catches the newest feeling and nothing else", and `tier: null` is documented as "it
asserts nothing". A catch and a correction do share "asserts nothing", but they mean completely different things to
a reader, and that difference **leaks downstream**: surfacing (06) takes only `claim`, so neither is shown; the page
labels a catch 「承接」 and a correction 「修正」; and a correction is not asked "why did you say that". Folding a
correction into `catch` would force all three places to re-decide "which kind of catch is this".

So `tier`'s documentation moved from "null means a catch" to "null means **anything that asserts nothing**" — a
catch, and a correction. The three NOT NULL columns (`mentions` / `spanDays` / `averageStrength`) are **0** for a
correction: nothing is read off them for it, and the numbers the rejected sentence was worded by are still on
**that** sentence, where its own "why did it say that" still reads them. Making them nullable would cost a table
rebuild (ticket 09's lesson: `ALTER TABLE` cannot drop a constraint), and "not applicable" is already expressed by
`kind`.

### Why marking wrong also reaches the material (not on this ticket's list, but 05 assigned it here)

The prototype's decision 5: "marking wrong has to reach the corpus layer: besides recording the overturning, lower
the degree to which the terms that conclusion leaned on count as 'the same thing' (0.3 by default), and the wording
band weakens with it." Ticket 05's `## Comments` explicitly assigned this to 10; 10's own checklist does not list
it. Put to the author before starting, and the answer was **do it**. The consequence of skipping it is concrete:
after saying "that's wrong", the matter goes on attracting fragments that look like it, and the product says the
same sentence again a few days later — which is failing to have heard the user at all.

It lands as two readings of one fact (`overturnedMatters()`: a matter has a `correction` on its chain, so it was
rejected):

1. In `attach`, a rejected matter's measured overlap is **discounted by `overturnedOverlapFactor`**. The ratio is
   0.50 and overlap tops out at 1, so a 0.3 discount is **decisive**: a rejected matter can only grow again from a
   sentence the user **wrote beside it**; nothing inferred gets in. What is lowered is the **classification**, never
   the fact — which terms were said together, and how strongly they link, are untouched.
2. In `settle`, the band is passed through `softerTier(...)` after it is read: a rejected matter speaks **one band
   softer** (strong→medium→weak, with `weak` as the floor). A step rather than another factor, because the bands are
   three ordinal values and there is no finer scale.
   **The account between the step and the numbers has to add up.** The three numbers are facts and not one of them
   is touched; the step itself is written down as a **fourth input** on that conclusion (`conclusion_.softened`),
   and the page adds "这件事你标过不对，语气退了一档" after "why did it say that". This one was forced by
   `/code-review` (see "What the review found" below): without it the portrait shows 「弱档」 next to
   "7 terms · across 17 days", which `tierOf` reads as the medium band — the page telling two stories about one
   sentence, when "wording strength mapped from explainable numbers" is the whole reason this record exists. It is
   recorded only where the step **changed the answer**: a claim that already earned the weakest band is not
   "softened", because nothing was.

This fact is deliberately **not stored** (no flag on `matter_`): it *is* the correction row. A flag would be a second
record of the same thing, and ticket 09's `original-only` moves kept judgements **to another matter** — at which
point the flag would necessarily drift. (What *is* stored is a different fact: that one conclusion's band was in
fact stepped down — a fact about the moment it was written, which could not be re-derived from the chain later
without disagreeing with the choice that was made. See point 2 above.)

### Why a note has to be **pinned** to that conclusion's matter (`pinned_matter_id`)

Two things that only work together. **"Entering the same chain"** is the ticket's literal requirement; and the
discount above is **decisive** (after 0.3, nothing inferred gets in). If a note were merely "an ordinary drop", the
sentence written beside a rejected conclusion would **wander into a different matter** and be about something the
user did not mean. So:

- Where the user wrote it is itself a statement — a clearer one than any overlap — so attachment does not re-derive
  it: the drop goes into that conclusion's matter.
- It is a **wish, not a fact**: the matter may already be gone (cascade-deleted), and a pin that no longer resolves
  simply leaves the drop to the ordinary rules. Hence `ON DELETE SET NULL` and **no cascade**: a matter going away
  must not take the drop with it.

### Why a revision gets its own queue (`queueRevision`)

`markConclusionWrong` runs inside `lookQueue`. The reason is the reason that queue exists: a look may be midway
through writing a sentence for some matter (waiting on a model), and the `supersedes` it will write was read from
the chain **as it stood when the look started**. A correction landing in between would leave that sentence filed
under the predecessor the user has just rejected.

The only difference from `queueLook` is **the promise handed to the caller**: a look is background work and swallows
its failure, while this is a write the user asked for — and a failure has to come back as one. Swallowed the way
`queueLook` swallows, a store that refused the write would be reported as "there is no such conclusion", which is a
lie. The queue itself still never carries a rejection, or everything behind this one would be dropped with it.

### One consequence, recorded here so it is not read as a bug

A conclusion that has been marked wrong leaves its matter's newest record as that `correction`, and **surfacing only
takes a `claim`** (ticket 06's rule: the newest conclusion per matter). So after the mark, that matter is **never
surfaced again** until the user writes something new into it and it settles afresh. That is right: the user has just
said the reading was wrong, and pushing it back at them is the worst possible answer.

### The page (act one, the portrait section)

Two entry points hang off each record, and that is all of them:

- **「这条不对」** appears only on records that **are judgements** (`claim` / `catch`) and have not been rejected —
  the product's own note of what the user did has nothing in it to disagree with, and an already-rejected record is
  not offered the button again (tapping twice is the same fact). The tap carries no reason: a reason field is the
  beginning of a feedback form, which is not this product.
  **The same rule is held in the domain** (`markConclusionWrong` returns null for a `correction` and writes
  nothing) — the page merely does not draw the button, and it is not the only gate.
- **「补一句自己的话」** appears on every record, including a correction — writing down what one actually meant,
  next to one's own "that's wrong", is the obvious next thing.

Both directions of the chain read out loud: backwards, 「承自「…」」 (or 「推翻了「…」」 for a correction); forwards,
「后来被「…」接过」 (or 「后来被你标为不对」 where a correction took over). The correction row has **no** "why did it
say that" and no support chips — it read nothing.

### The case of a conclusion replaced by two different things

`supersededBy` stays a single reference, with its meaning tightened to **the newest record that replaced it**. The
chain is a sequence, but a correction opens a fork in the middle: with `C1 → C2` (carried on) already on the chain,
marking `C1` wrong makes both `C2` and the correction `supersedes = C1`. Reading forwards shows the newest one
(the correction), and reading backwards is still complete — every record names where it came from. Not turned into
a list: that would change a shape ticket 05 fixed and every reader of it, for a case the user is not encouraged to
reach for (taking a position on the **newest** record).

### Tests and verification

Domain **142/142** (11 new: the full shape of a correction with the old conclusion unchanged to the byte, the same
tap recorded once, an unknown conclusion reported as null, a correction surviving a restart, a note being a drop
that enters the same chain, writing beside a conclusion that is not there storing nothing, a rejected matter no
longer attracting fragments that look like it (with the control run where nothing was rejected and the fragment does
get in), the discount being a value (`overturnedOverlapFactor: 1` lets it in again), the band stepping down (with
the `overturnedBandDrop: 0` control and `softened` asserted on both sides), a correction refusing to be rejected,
and a stranded correction still reading); new `tools/e2e-ticket-10.mjs` **11/11** (real HTTP: both routes, the old
conclusion unchanged word for word, the same tap being the same fact, 404, a correction refusing to be rejected, a
note's wording and terms, entering the same chain, a blank note refused with 400, rating/like/bulk answered **405**
plus the page's own vocabulary, and the revision still there after a restart); the 02–06 / 08 / 09 e2e scripts all
green (7/6/5/5/6/11/15); `tools/check-workspace.test.mjs` 21/21; `tsc --noEmit` green; `vite build` succeeds;
`check-workspace` clean.

**One regression script this touched**: ticket 05's e2e check was called "the portrait is read-only" — after 10 the
portrait has two write routes, so that sentence was no longer true. It is now "settling asks nothing of the user,
and the portrait has no general write"; the assertion is unchanged (`POST /api/conclusions` is still a 405), with
"read-only" replaced by "settling asks nothing of the user".

**Walked through by hand against the real server and the real demo provider**: three demo drops → one weak-band
conclusion → marking it wrong (200, and the chain gains 「你标了这条不对。」 naming what it replaced) → marking that
correction wrong (404, nothing written) → writing a sentence beside it (200, stored verbatim and answered). **One
demo limitation worth recording**: the demo provider scripts extraction for `DEMO_DROP` alone, so a sentence written
beside a conclusion yields no terms there and that drop accumulates into nothing — a known limitation of the
stand-in (ticket 12 is what makes "write anything you like" meaningful), not an implementation problem here. The
e2e script runs a scripted provider, and on that path "the note enters the same chain" is pinned by an assertion.

### What the review found (`/code-review`, both axes)

Both axes ran in parallel against the fixed point `fe2b653` (ticket 09's commit). **The Spec axis found two real
problems, the first being exactly the kind of thing that is easiest to paper over — a page telling two stories
about one sentence:**

1. **After the step down, the band and the numbers beside it contradicted each other (Spec axis, fixed).** The first
   version replaced `tier` with the stepped band and stored the three numbers untouched — so one conclusion read
   「弱档 · 7 terms · across 17 days」, which `tierOf` reads as the medium band. `conclusions.ts` itself says the
   number the user sees and the frame around the sentence "cannot tell two stories", and `CONTEXT.md` requires the
   wording to match the evidence. **The fix is not to change the numbers** (they are facts) but to make **the step
   itself** a fourth input: `conclusion_.softened` is stored with the sentence, and the page names the reason after
   "why did it say that". Stored rather than derived from the chain on read, because it is a fact about **the moment
   the sentence was written**: if the chain is edited afterwards, a derived reason would disagree with the choice
   that was actually made.
2. **A correction could itself be marked wrong (Spec axis, fixed).** The first version kept that rule in the page
   only (it draws no button) and the domain accepted it — so `POST /api/conclusions/<correctionId>/wrong` wrote a
   record disagreeing with "you marked this wrong". The domain now refuses: `markConclusionWrong` returns null for a
   `correction` (`deleteDrop`'s precedent: null means "nothing happened", and the two causes are not separated
   here), with a check of its own.
3. **Does it still read once the rejected record is gone (Spec axis — `NEXT.md` asked for this and there was no
   check).** `supersedes` is `ON DELETE SET NULL`, so a correction can be left with `relation: 'overturn'` and
   `supersedes: null`. No path can produce that state today (a cascade takes a matter's conclusions together), but
   the **reading** has to be pinned rather than assumed — a check now builds that state by hand, following ticket
   09's re-anchoring check.

The Standards axis found two real ones: the `Domain` doc named the two new operations `markWrong` / `appendTo`
(names that do not exist — now the real ones), and `softerTier` re-spelled `['weak','medium','strong']` (it now
reads `CONCLUSION_TIERS`, the one list the store also reads). It also caught the page computing "is the record that
replaced this one a correction?" twice and threading the whole chain into every row (now one
`isOverturned(conclusion, corrections)`, with each row handed only a set of ids).

**Two judgement calls, not changed, recorded here**: ① `appendDrop(body, reply, at, pinnedMatterId)` takes a fourth
positional parameter — this port is positional throughout (`recordExtraction(dropId, outcome, at)`,
`recordSurfacing(id, at)`), and inventing an options object for this one call would be the exception; ② the
`index === -1` guard in `softerTier` is unreachable for that type, but every place in this repo that reads an enum
(`readInputType`, `toStoredConclusion`) hands an unrecognised value back untouched rather than inventing one, and
this follows the same rule. (The `?? tier` is not redundant: `noUncheckedIndexedAccess` is on, so an indexed read is
nullable to begin with.)

**One pre-existing debt this ticket did not take on**: `docs/agents/issue-tracker.md` says resume notes come as
`NEXT.md` / `NEXT.en.md`, and `NEXT.en.md` has never existed (not caused by this change). Translating a resume note
is effort-level documentation work and does not belong inside a code ticket; left for whoever next does docs.

### Interface notes handed to 11

- What 11 adds is gathering **several** conclusions, sharing ticket 06's one moment (`requestSurfacing` without a
  `dropId` is the user asking). That path was not touched here.
- In a rejected matter the newest record is a `correction`, and `readySurfacings()` skips it — so if 11 gathers
  "several conclusions" per matter, remember that a matter's newest record may not be a judgement.
