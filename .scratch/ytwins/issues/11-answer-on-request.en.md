# 11: Asking directly — one observation (an answer)

**What to build:** When the user asks directly "what do you think of me lately", they get one observation: several
**conclusions** assembled into a single sentence that could only come from the user's own data, never a truism that
would fit anyone; the wording is uncertain in tone and states what supports it; with insufficient support it prefers
to say nothing or says plainly "I'm not really sure".

**Blocked by:** 06 (Surfacing — the one line after an emotional drop)

**Status:** ready-for-human

- [x] An explicit user question returns an **answer** assembled from several **conclusions**, not a restatement of one.
- [x] The answer could only have grown out of the user's own data; a test asserts this by showing it cannot answer under a different data set.
- [x] The answer is always uncertain in tone, with wording strength mapped from explainable numbers (sharing one mapping with **surfacing**).
- [x] The answer shows which **conclusions** / **terms** support it.
- [x] With insufficient support it returns "I'm not really sure" or explicitly withholds an answer, never fabricating one.
- [x] Asking directly and **surfacing** share one cooldown and one per-turn cap, so the two never each produce an item in the same turn.

## Comments

**2026-09-17 · the seven decisions taken while implementing (the first two came from 06, the rest are this ticket's own)**

1. **Not a second channel — the same moment's other trigger.** Ticket 06 had already made "an emotional drop" and "a
   user question" one operation, `requestSurfacing(options?)` (`dropId` = raised by a drop, absent = the user asked).
   What 11 adds is the "assembled from several conclusions" layer **inside** that operation, not a second exit — which
   is why the ticket's item 6 (shared cooldown and per-turn cap) is a **structural** guarantee: they are the same turn.
   **No operation was added to the interface.**
2. **Only a question gets an answer; a drop still gets its own line.** An emotional drop wants an immediate reply to
   what was just said; replacing that with a gathered observation would answer a fresh feeling with a view of the past.
   So when `dropId` is present the moment always takes the single-conclusion path, and a check pins it ("a drop is never
   answered with an assembled one").
3. **"Several" is a hard floor in the definition, not a calibration.** `answerFloor` defaults to 2 and can only be
   made **stricter**, never looser (`Math.max(2, …)` in code): one conclusion is not a smaller answer, it is exactly
   the "restatement of a single conclusion" the ticket rules out. `answerLimit` defaults to 4 — not a measured
   constant but a **working limit** for one sentence — and takes the **newest** ones, because the question is what the
   user is like **lately**; the oldest material is still in the portrait, it just must not lead the sentence.
4. **Too little support and an uncomposable sentence take the same way out: fall back to surfacing the one line.**
   Both make the answer "not exist": ① fewer than two conclusions are sayable right now (i.e. not inside the cooldown);
   ② the provider cannot write it this time (it fails, or both attempts break `checkConclusion` — one retry, told what
   was broken, the same shape as 05 and 06). Then nothing is forced and nothing is faked: the one conclusion there is
   is surfaced as itself. The two failure modes cost different things — forcing it would dress one conclusion up as an
   assembled answer, while silence would give the user nothing at the moment they asked directly — and "one line" is
   something they already had before this ticket, with no less truth in it. (Both options the ticket offers for item 5
   land inside that fallback: a weak-band answer opens with 「我不太确定：」 of its own, and having nothing at all is
   `nothing-to-say`.)
5. **"Only from the user's own data" is structural, not an instruction to the model.** A new port method,
   `composeObservation`, is handed three things and only three: the user's **own conclusion sentences**, the user's
   **own terms** behind them, and the band (as wording context). There is no generic material to copy, so a sentence
   that would fit anyone has no source on the input side. Tests assert it over two data sets: with thin material (one
   conclusion left) the provider is **never asked** (`provider.observed` stays empty) and the one line is returned;
   with enough material, what was handed over is exactly those conclusions and those terms, compared word for word.
6. **The wording mapping really is the same one, not a lookalike.** The three numbers are read as sets: terms are the
   **union** (in the order first said, deduplicated), mentions are the **sum**, the span is the **furthest** of them
   (how far back the answer reaches), and the connection strength is the **mean**. They then go through 05's `tierOf`
   and 06's `surfacingLine` (the same `SURFACING_OPENINGS`, one of them picked by `random()`). All three travel with
   the result and are readable on the page, so "why did it say that back then" has one answer for an answer and for a
   conclusion alike. Ticket 10's band step (`softened`) does not enter the aggregation: what is read is the numbers
   stored with each conclusion when it was assembled, unchanged.
7. **The cooldown is recorded once per conclusion the answer used.** The `surfacing_` table and
   `recordSurfacing(conclusionId, at)` are reused as they are — **no schema change, no migration**: an answer that
   brought three conclusions together writes three rows, because "the user has heard it" is true of each, so the next
   question, or a later drop about any one of those matters, comes back `cooldown`. Verified across a restart by e2e.
8. **Only `claim`s are gathered, and one matter contributes at most one — which is what handles the three kinds of
   record ticket 10 left on the chain.** Gathering uses the **same** candidate set as surfacing (`readySurfacings`:
   the newest record per matter, only if `kind === 'claim'`, and not inside the cooldown). So when the newest record is
   a **catch** the matter takes no part at all (a catch asserts nothing, so there is nothing to state), and when it is
   a **correction** it takes no part either — that claim has been rejected, and gathering it would route the answer
   around the user's own rejection and say the rejected thing back to them. This is the interaction `NEXT.md` flagged
   as something 11 had to handle itself.
9. **Ticket 10's band step reaches the answer too, and is said out loud.** A conclusion assembled after the user marked
   that matter wrong was already written one band softer, with the numbers unchanged and `softened` recorded on it. An
   answer resting on such a conclusion may not speak more firmly than the thing it rests on, so the same step
   (`overturnedBandDrop`, through the same `softerTier`) applies to the answer's band, and `softened` travels with the
   answered arm so the page can say 「其中一条你标过不对，语气退了一档」 — the same treatment as on a conclusion, for the
   same reason: a band and a set of numbers beside it must not tell two stories.

**Where the code landed**

- `src/domain/ai-provider.ts`: `composeAnswer`, the only port method this ticket adds; its request carries the
  user's own material and nothing else. The same change **renames** the one ticket 07 left — `composeAnswer` (the
  recall side) becomes `composeRecallAnswer`, its request/result types becoming `ComposeRecallAnswer*` — because
  `CONTEXT.md` is explicit that what recall hands back is not to be called an 答案, and that name belongs to ticket
  11. Putting that inversion right is part of this ticket rather than a style pass.
- `src/domain/surfacing.ts`: `SurfacingPolicy.answerFloor` / `answerLimit`, `ANSWER_INSTRUCTIONS` (kept apart from
  `CONCLUSION_INSTRUCTIONS`: those are written for one matter and tell the model to follow the newest feeling in it,
  which is the wrong instruction for a sentence that has to hold several at once; the length both share is now
  interpolated from `conclusions.ts`'s exported `MAX_SENTENCE_CHARACTERS` instead of being written out twice).
- `src/domain/interface.ts`: `SurfacingResult` gains a `kind: 'answered'` arm (carrying `conclusions`, the union
  `support`, and `softened`); `requestSurfacing`'s doc becomes "one moment, two triggers, and the asked side
  assembles".
- `src/domain/core.ts`: `composeChecked` (the "one retry, told what broke, then silence" shape, now shared by
  `composeClaim` and `answerSentence`), `assembleAnswer` (the set readings plus the band step), `answerSentence`,
  `answerFor` (take the newest few → null when there are not enough → write the cooldown records).
- `src/domain/fake-provider.ts`: `answerFallback` / `answerAttempts` and an `answers` log; the call **rejects** when
  unscripted rather than inventing a sentence, the same rule `composeConclusion` follows.
- `src/web/`: act three renders an answer (`surface-label` tells 「浮出来的这一条」 from 「把几条汇成的一句」,
  `surface-conclusions` lists what it was made of, and a stepped band says so), two more preset fragments (below),
  plus copy and styles.

**The demo material this needed (the one "so it can be seen" change in this ticket)**

The preset material held only `DEMO_DROP`, so the browser could grow at most **one** conclusion — the answer was always
the fallback, and item 1 of the ticket was invisible in the demo. `demo-provider.ts` therefore gained one fragment each
for two feelings its preset sentences already knew (想学吉他, 睡不好), and the page's placeholder names one of them.
**That is an example in the copy, not a second data source**: what each fragment is, and what it is read as, still
lives only in `demo-provider.ts` — but the placeholder *is* a copy of that fragment's text (a placeholder cannot be
fetched from the store), so if the two drift apart, what breaks is the demo's second matter (the line a user types by
hand reads as nothing), and no product behaviour. `DEMO_GUITAR` carries a note saying so. Each fragment reads **three**
terms rather than two, and that is not padding: below three supporting terms (`claimFloor`) a matter can only
**catch**, so it never assembles a conclusion and never contributes to an answer. That was hit for real: the first
version wrote two terms, and the running server still answered with the fallback.

**Verification**: domain **152/152** (10 new: asking gets an answer assembled from several conclusions with its
conclusions/terms/three numbers; provenance over **three** data sets — the thin one is never handed to the provider at
all, and two *different* rich sets each hand over their own conclusions and their own words, same code both times; the
band and the opening come from the same place as a surfacing (medium says 「听起来，」, the three numbers read as sets);
an uncomposable answer falls back to one real conclusion (both a failing call and two rule-breaking attempts, the retry
told what was broken, nothing of the rejected sentence reaching the user); asking and surfacing share one cooldown and
one turn produces one line (the records are exactly the conclusions the answer used); a drop never gets an assembled
answer; something already heard is not gathered into a new one; a matter the user has marked wrong is not gathered
either; an answer resting on a stepped-down conclusion steps down with it and says so (the same material run twice,
differing only in whether it was rejected); and both dials are pinned once — the limit keeps the newest few, the floor
can be raised, and lowering it to one is still read as two); new `tools/e2e-ticket-11.mjs` **6/6** (real HTTP:
two conclusions become one answer that is not a restatement, its conclusions and terms travel, a second question and a
later drop about the same matters are both `cooldown`, a feelingless drop is not a moment, the cooldown survives a
restart, and a thinner database with one conclusion surfaces that one line instead); 02's 7/7, 03's 6/6, 04's 5/5,
05's 5/5, 06's 6/6, 08's 11/11, 09's 15/15 and 10's 11/11 still green; `tsc --noEmit` clean; `vite build` succeeds;
`check-workspace` clean; and the running server was walked through by hand with the demo material (the first line three
times plus the guitar one three times) — it answered
「我说不好，不过你反复提到的「期末怎么算分」「平时分 40%」，好像是连在一起的。」 (weak band, 2 sources, 7 terms,
and `cooldown` when asked again).

**What `/code-review` found, and what was done about it**

Standards axis: **no hard breach**; three judgement calls changed, two kept.

- **The port's vocabulary was inverted** (recall held `composeAnswer`, so 11's new method could only be
  `composeObservation`) — upheld, changed: the recall end becomes `composeRecallAnswer` (types `ComposeRecallAnswer*`)
  and `composeAnswer` belongs to 11. `CONTEXT.md` says outright that what recall hands back is not to be called an
  答案, and this puts that right rather than extending it.
- **`answerSentence` was `composeClaim` line for line** — upheld, changed: `composeChecked` now holds the shape (one
  retry, told what broke, then silence) and both call it; `CONCLUSION_ATTEMPTS`'s doc became about "one sentence"
  rather than "a matter's sentence".
- **`ANSWER_INSTRUCTIONS` hardcoded "不超过 48 字"** — upheld, changed: the limit is exported as
  `MAX_SENTENCE_CHARACTERS` and interpolated into both instruction lists, so the words and `checkConclusion` cannot
  state two different numbers.
- **The placeholder repeats `DEMO_GUITAR` verbatim** — upheld but **not changed**: a placeholder cannot be fetched from
  the store, and without an example the demo cannot be driven. What was wrong was the ticket's claim, which said no
  second copy existed; that sentence now says what is actually true (above), and `DEMO_GUITAR` carries a note.
- **Five fields travelling together in three places** (Data Clumps) — **not changed**: each arm spelling out where its
  sentence came from reads better, and a shared `WordingBasis` would make both union members harder to document; the
  web mirror is a documented convention anyway (`main.ts` says it takes no types from `src/domain/`).
- **Two dials nothing pinned, and untested clamps** — upheld, changed: one three-run check now pins the limit, the
  floor being raised, and a floor of one being read as two.

Spec axis: two changed, one strengthened, three kept with the reasoning written down.

- **The "different data set" assertion was weak** (it varied only the count) — upheld, strengthened into **three** data
  sets: the thin one is never handed to the provider at all, and two *different* rich sets run the same code and each
  hand over their own conclusions and words.
- **The answer ignored ticket 10's band step** — upheld, changed (item 9 above).
- **The e2e's "not a restatement" assertion was vacuous** (the two openings differ, so the strings could never match) —
  upheld, replaced with "the answer's text contains neither matter's own sentence"; the domain side already had the hard
  evidence, `kind === 'answered'`.
- **The fallback is neither "I'm not really sure" nor withholding** (item 5 read literally) — **kept**, for the reason
  in item 4 above.
- **The band is read over the union, i.e. on evidence no single conclusion has** — **kept**, for the reason in item 6
  above (the union is the support the page actually lists).
- **Demo material and page copy are scope creep** — **kept**: every ticket in this effort is a vertical slice from
  storage to page, and without the material the feature is invisible in the browser. The ticket's inaccurate sentence
  about "no second copy" was corrected instead.
