# 05: Threshold assembly — the first conclusion, portrait and conclusion chain

**What to build:** Out of the user's sight, when an emotion or decision connects to enough **terms** to cross the
**threshold**, it assembles into a plain-language **conclusion** (say "you seem to really want to learn guitar"),
storing the supporting terms alongside it. Assembly is **debounced**: the threshold is not judged right after every
drop, but "after a quiet stretch" or "after N accumulated drops", so a few mutually-contextual sentences are not
prematurely assembled into a wrong conclusion. The user can see the **portrait** (which is the set of conclusions
itself, not another hidden model) and the **conclusion chain** (read-only by default, viewable at will), with each
conclusion listing the terms that support it.

**Blocked by:** 04 (Terms and links — connecting the fragments)

**Status:** ready-for-human

> **Run a prototype first to find the numbers** (settled 2026-09-15). This ticket's three constants — the
> **threshold value**, the **debounce window**, and the relevance-score rubric — cannot be pinned down by reading
> the spec; they need to be played through against real terms and links to develop any feel. So **before**
> implementing this ticket, run a throwaway prototype answering four questions: ① how many drops should it take
> before a conclusion is due, and where are the too-early / too-late boundaries; ② when several related sentences
> are dropped in a row, is one assembled conclusion right or is one conclusion each right; ③ does judging "same
> topic" by semantic overlap of term sets actually lump two different things together; ④ does the
> support-strength → wording-strength mapping read as insight or as awkwardness.
> The numbers found feed back into this ticket's constants, while the prototype itself stays on a throwaway branch
> per `/prototype`'s rules and never enters `src/`. The findings from questions ③ and ④ also affect **06**
> (surfacing) and should be carried over when it is built.

- [x] The **threshold** is a count gate (enough terms connected), not a time gate.
- [x] Below the threshold no **conclusion** appears; crossing it produces a conclusion carrying its full supporting term list.
- [x] The threshold value, the relevance-score rubric, and the debounce window are carried by configurable constants; initial values are set so that the demo's act ③ preloaded data necessarily triggers, without every drop triggering.
- [x] Debouncing works: a few mutually-contextual consecutive drops do not assemble a wrong conclusion immediately after the last one, but only once the quiet period or the accumulation count is met.
- [x] A **conclusion** is a plain-language declarative sentence the user can immediately judge right or wrong.
- [x] What the **portrait** reads back is the set of conclusions itself; no second model hidden from the user exists.
- [x] The **conclusion chain** is read-only by default, viewable on the page, showing each conclusion's supporting terms and its revises/revised-by relations.
- [x] The user can see which terms support any given conclusion.
- [x] The whole **settling** process needs no user participation; the page offers no step the user must maintain.

## Comments

**2026-09-15 · prototype round one: page ① has been judged (values not yet written into the implementation)**

`/prototype` took the LOGIC branch, and its artifact is the single file
`archive/ytwins-05-threshold-prototype/05-threshold-prototype.html` (throwaway, never entering `src/`).
The product author has judged page ① (threshold / debounce / whether it should claim at all), settling five points:

1. **The threshold counts how many times a matter has been raised** — not terms, not a relevance score; **default 3**
   (their words: "3 times is enough"). The threshold entry in `CONTEXT.md` was changed to match, so the glossary and
   the implementation do not end up with two readings.
2. **The debounce quiet window is 3 minutes** (it only has to cover "a few sentences in one sitting"); plus a
   backstop of "6 drops forces a look". A backstop of 3 splits one four-sentence burst into two judgements, which
   amounts to switching the quiet window off.
3. **Judgement timing alternates**: look as soon as the count is reached, then wait for the quiet window, and so on,
   so the rhythm cannot be read off the user's own experience. It only changes *when the invisible look happens*;
   the visible consequence is that the same batch sometimes yields one conclusion and sometimes two — that belongs
   to page ②.
4. **When one matter carries two opposite feelings it still claims**, but the sentence must follow the **newest**
   feeling in that matter. The old wording — building the sentence from the opening term — was wrong (the author
   observed 好烦 first and 松了口气 last, answered with "心里一直不太顺"). **Catching** (saying only "那样真好")
   is therefore demoted to a fallback, used when fewer than 3 terms support the matter.
5. **Marking a conclusion wrong must reach the material**: besides recording an overturn, it lowers how much the
   terms that conclusion leaned on count as one matter (×0.3 by default), which weakens the wording tier. What is
   lowered is the **inference**; the fact that they were said together does not change.

**Still open** (pages ②③④): one conclusion or several, the "same matter" overlap ratio and formula, and the
weak/medium/strong gates. To be filled in once those are walked.

**2026-09-15 · prototype round two: ② and ④ settled, ③ measured into a conflict with a hard requirement**

- **② Judgement timing = alternating** (settled). The author accepts its cost: the same batch of sentences
  sometimes yields one conclusion and sometimes two.
- **④ Weak/medium/strong gates = the agent's defaults** (settled): medium at "terms ≥ 3 and span ≥ 3 days";
  strong at "terms ≥ 6 and span ≥ 14 days and average connection strength ≥ 0.80". The tiers are independent of
  the threshold — the threshold decides *whether it may speak*, the tiers decide *whether it overstates* — and the
  sentence always follows the **newest** feeling in the matter.
- **③ Formula: the author chose "literal overlap ÷ union"; measured, it conflicts with this ticket's hard
  requirement, so the default is unchanged for now.** Measurement (the four 期末 and four 论文 fragments in the
  library, one dropped per 10-minute step):

  | formula @ ratio | 期末 line | 论文 line |
  |---|---|---|
  | literal overlap ÷ the smaller side @ 0.50 (**current default**) | one matter, 4 mentions / 6 terms, **2 conclusions** | one matter, 4 mentions / 6 terms, **2 conclusions** |
  | literal overlap ÷ union @ 0.50 | **0 conclusions** (scatters into 2 matters) | **0 conclusions** (scatters into 3 matters) |
  | literal overlap ÷ union @ 0.20 | 3 mentions, 1 conclusion; the fourth scores 0.17 and cannot join | 4 mentions, 2 conclusions |
  | literal overlap ÷ union, measured against the opening sentence only, @ 0.50 | **0 conclusions** | 3 mentions, 1 conclusion |

  Three reasons, all of which belong in the implementation decision:

  1. **The denominator grows.** The divisor is everything the matter has accumulated, so the same sentence that
     "shares one term with the matter" scores 0.33 against a 2-term matter, 0.20 against a 4-term one and 0.11
     against an 8-term one — **the older a matter is, the harder it is to mention again**, and in the long run old
     matters close themselves. "÷ the smaller side" stays at 0.50 and keeps a stable meaning: how much of what you
     just said the matter already covers. The hard requirement that *the demo's act-three preloaded data must
     necessarily trigger* simply does not hold under ÷ union @ 0.50.
  2. **A literal formula cannot see semantic links.** 改提纲 and 下周三交提纲 carry a 0.78 link, and their literal
     intersection is empty — so any strict literal rubric breaks that line (which is exactly where the
     opening-sentence variant dies).
  3. **The semantic rubric merges everything instead.** 改提纲 and 好烦 are a same-drop hard edge (strength 1), so
     any sentence containing 好烦 borrows it to reach 1.00, making the misfire unavoidable (every drop measured 1.00).

  Awaiting one word from the author: **keep "÷ the smaller side" and raise the ratio from 0.50 to 0.70** (the step
  the prototype demonstrated as splitting the misfire), or hold to ÷ union (at the cost of dropping the ratio to
  0.20, where the discrimination is all but gone).

**2026-09-15 · prototype round three: ③'s knob is rejected by measurement**

The author chose "÷ the smaller side, with the ratio raised to 0.70". **The measurement came out the other way, so
the default was left alone**:

- At ratio 0.70 neither line produces a single conclusion — the 期末 line scatters into three matters and the 论文
  line into three more, so the hard requirement that *the demo's act-three preloaded data must necessarily trigger*
  does not hold.
- **The reason**: for the same matter, the **genuine** pair (论文开题 + 导师) and the **misfire** pair (导师 + 好烦)
  score **identically — both 0.67**. So the "how much overlap counts as one matter" knob *cannot* reject the first
  while admitting the second: raised, it rejects both; lowered, it admits both. **Question ③ is not something the
  ratio can fix**, and that is this round's most valuable finding.
- Confirmed on the way: at 0.60 the 论文 line recovers while the 期末 line stays dead (0.50 < 0.60); and ÷ union's
  growing-denominator problem stands from the previous round (old matters close themselves).

**Candidate fix (already implemented in the prototype as a switch, off by default)**: weight shared terms by
**rarity** — the more *matters* a word spans, the less its being shared is evidence
(`weight(t) = 1 / matters spanned`). The weight is learned from the user's own material, so no curated stop-word
list is needed. Measured (ratio still 0.50): a sentence that shares only 好烦 drops from 0.50 to **0.33 and stops
merging**, while the 期末 and 论文 lines **keep accumulating as before** (4 mentions, 6 terms, 2 conclusions each).

**Awaiting one word**: A) ratio 0.50 with rarity weighting on (recommended); B) ratio 0.50 with no weighting (accept
the misfire and correct it afterwards with "mark as wrong"); C) still 0.70 (at the cost of either bending the
preloaded data to suit the number, or never triggering the demo).

**On tuning (the author asked whether these numbers can still change later)**:

- They are all **values, never code**: ticket 04's `LinkPolicy` already has that shape (injected through
  `createDomain({ linkPolicy })`), and 05's threshold / debounce window / overlap ratio follow it — changing a
  number touches no logic.
- **Changing a value does not recompute history**: drops, terms, links and conclusions are already stored, so a
  change affects only *later* judgements; conclusions already made stay in the portrait and the chain, which is what
  "the chain only grows" requires.
- Because **the original text is always stored**, an **explicit recompute job** (re-judging the existing terms and
  links under new values) can be run at any time to see the effect. That job is not being built now, but the place
  for it is reserved — it is "later" rather than "too late". The practical upshot: no intuition about the numbers is
  needed today; with three months of real material they can be re-tuned and re-read at will.

**2026-09-15 · prototype closed out (the author chose A)**

The author chose **A: keep the ratio at 0.50 and turn on "weight shared terms by rarity"**
(`weightSharedBySpread: 'on'` is now the default). All four questions are judged, and this ticket's constants can be
implemented from the table below:

| constant | initial value | why this one |
|---|---|---|
| threshold rubric | counts **how many times the matter has been raised** | not terms, not a relevance score |
| threshold | **3 mentions** | the author's words: "3 times is enough" |
| debounce quiet window | **3 minutes** | it only has to cover "a few sentences in one sitting" |
| backstop: drops before a forced look | **6** | at 3 it splits one continuous burst, which is the quiet window switched off |
| judgement timing | **alternating** (as soon as the count is reached ／ on the quiet window) | the rhythm should not be readable; the user cannot see it, so it does not carry the mystery |
| same-matter formula | **literal overlap ÷ the smaller side** | ÷ union's denominator grows with the matter (old matters close themselves) |
| same-matter ratio | **0.50** | the knob cannot fix the misfire; do not count on tuning it |
| shared terms weighted by rarity | **on** | `weight = 1 / matters the term spans`, learned from the user's own material |
| catching triggers at | fewer than **3** supporting terms | two opposite feelings no longer trigger it (it claims anyway, following the newest feeling) |
| medium wording band | terms ≥ 3 and span ≥ 3 days | independent of the threshold |
| strong wording band | terms ≥ 6 and span ≥ 14 days and average connection strength ≥ 0.80 | as above |

**Where the primary material lives (per `/prototype`'s rules)**: the prototype and its four throwaway checkers are
in `archive/ytwins-05-threshold-prototype/` (one self-contained HTML file plus `check-model.mjs` / `drive-page.mjs` /
`audit-walkthroughs.mjs` / `measure-overlap.mjs`). They were committed to the throwaway branch
**`prototype/ytwins-05-conclusion-threshold`** and **never enter main** — `archive/` is in `.gitignore`, so the
prototype does not appear on main at all. To look again: `git switch prototype/ytwins-05-conclusion-threshold` (or
just open the local copy, which stays on disk). Main keeps only the validated decisions: the constant table in this
ticket and the 阈值 / 承接 entries in `CONTEXT.md`.

**2026-09-16 · implemented (the constant table copied across, not one value changed)**

**Where the code landed**

- `src/domain/conclusions.ts`: `ConclusionPolicy` (twelve values, whose defaults *are* the table above), the formula
  `overlapOf` (literal overlap ÷ the smaller side), the rarity weight `spreadWeight` (`1 / matters the term spans`),
  the bands `tierOf`, `mayClaim`, the band frames `frameFor`, and the sentence's mechanical check
  `checkConclusion` with its instructions `CONCLUSION_INSTRUCTIONS`.
- `src/domain/storage.ts` + `sqlite-store.ts`: `drop_.anchor_term_id` (what a drop is *about*), `matter_` /
  `matter_term_` / `matter_drop_` (the accumulation itself), `conclusion_` / `conclusion_support_` (what it settled
  into) and `settle_state_` (how far the invisible settling has got: `drops_since` / `last_drop_at` /
  `look_now_next`, one row by construction).
- `src/domain/core.ts`: `attach` (which drop belongs to which matter), `settle` (one look: per matter, whether it may
  speak and in which band), `considerLook` (the three triggers), `armQuietWindow`, `listConclusions` (the portrait).
- `src/domain/ai-provider.ts`: `composeConclusion` (the one model call this ticket adds), and an `anchor` on
  `extract`.
- `src/web/`: `GET /api/conclusions`, and a new "画像" section in act one (the chain relation, the supporting terms,
  and the numbers behind "why it said that").

**Decisions made while implementing (the prototype had no equivalent, because it had no asynchrony)**

1. **"Alternating" is per pile, not per sentence.** The prototype's `flip()` was synchronous inside each drop; here
   reads are asynchronous, so the decisions for a burst of drops all happen *after* all of them have landed
   (measured: with three drops in one burst, the second and third decisions both saw the same crossing and turned the
   alternation twice — back to where it started). Decisions and looks now share **one serial queue**, so each decision
   reads the state the last one left: a crossing already spoken about is gone, and one left to the quiet window is not
   reconsidered by the next drop of the same pile.
2. **The threshold counts drops that have *joined the accumulation*, not arrivals.** A look judges material that has
   been attached; counting arrivals forces a look before the material is there (the backstop's one look would be
   wasted). The window is still measured from the newest *arrival* — the two are recorded separately.
3. **A catch reuses the reply the newest feeling was answered with**, at no model cost: that line already names the
   feeling, has already passed the parent-voice checks, and is exactly the sentence the user saw at that moment. A
   check watches `provider.composed` stay empty.
4. **The model writes the sentence; code adds the band's frame**: weak `我不太确定：…`, medium `…`, strong
   `这段时间我看到一条线：…` (the prototype's `TIER_WRAPS`). A sentence that fails the mechanical check is asked for
   once more with the violations named; if the second attempt fails too, **this conclusion is not made** (the crossing
   stays pending and the next look tries again). No safe sentence is invented — having nothing to say is a legitimate
   answer.
5. **The domain owns time** (`createDomain({ now })`, with `appendDrop` / `recordExtraction` now told the moment
   rather than minting it): a span is something this product decides on, and a check that had to wait fourteen days
   would not be a check.
6. **Matters are persisted, never recomputed** (the same choice ticket 04 made for links). That is what makes
   "changing a value affects only what happens next" true in the implementation: conclusions already made stay in the
   portrait and the chain. The prototype's recompute-under-new-values hatch is still only a hatch; this ticket did not
   build it.

**Leads for 06 / 10**

- **06**: `look` is an internal function. When `requestSurfacing` needs "judge once before answering a user who asks",
  it can queue `settle` onto the same `lookQueue` — the ordering and the de-duplication are already handled there.
  The 7-day cooldown needs real time, and `now` is injectable.
- **10**: `ConclusionRelation` already contains `overturn` (the store's reader has to recognise the value, or a
  conclusion carrying it would vanish silently), but **nothing produces it yet** — marking one wrong, and the ×0.3
  demotion of the association, both belong to ticket 10.

**Verification**: domain **98/98** (18 new checks: the count gate, no anchor means no accumulation, all three
timing triggers, the threshold as a value, rarity weighting *and* the misfire it prevents, the newest feeling, the
three bands, catching, a catch's shape, regeneration, failure-as-silence, the chain and its survival across a
restart); `tools/e2e-ticket-05.mjs` **5/5** (real HTTP: nothing settles inside the quiet window, crossing the
threshold produces one conclusion with its support, the portrait is read-only (405), no matter or vector crosses the
wire, and the chain is still there after a restart); 02's 7/7, 03's 6/6 and 04's 5/5 still green; `tsc --noEmit`
clean; `vite build` succeeds; `check-workspace` clean; and a real server was walked by hand — the demo fragment
dropped three times (the same sentence, four terms) produced a **weak** conclusion on the first look,
「我不太确定：你最近好像有几件事堆在一起，心里一直不太顺。」, supported by 「期末怎么算分 / 平时分 40% /
下周三交提纲 / 好烦」. Two drops produce nothing.

**2026-09-16 · the two-axis review, and what was changed because of it**

The Standards axis found one hard violation (a debugging `console.error` left in `attach`'s catch — removed) and one
language-policy breach (a whole Chinese clause of `CONTEXT.md` quoted inside `storage.ts` — rewritten in English with
the pointer kept). The rest were judgement calls, handled as follows:

- **`StoredSettlement.lastDropAt` was dead state** (written, selected, read by nothing — the quiet window is the timer
  armed at the drop). **Deleted**, together with `noteDrop()` and `settle_state_.last_drop_at`: one write and one
  column fewer. A pile left behind by a shutdown is covered by the next drop re-arming the window (what
  `armQuietWindow`'s comment already said).
- **`toNamedTerm` and `toLinkedTerm` were the same function** (`LinkedTerm = NamedTerm`), so only one remains.
- **The e2e no longer restates the twelve values**; it starts from `DEFAULT_CONCLUSION_POLICY` and moves only
  `judgeTiming`. That script is about the wire, not the numbers, and it now exercises what a real server runs. (The
  domain tests still spell their policy out on purpose: a check should fail when a rule changes, not follow it.)
- **A clarification on `attach`'s `spread.get(termId) ?? 0`**: "claimed by no matter" *is* "fully specific", so both
  are the same 1 rather than a missing measurement.
- **`core.ts` at 1283 lines** (settlement, looks and the portrait being a second reason to edit it): **not changed.**
  The repo's stated design is that the core holds the interface and everything behind it and that its internal split is
  not a seam (`core.ts`'s own header), while the pure rules already live in `linking.ts` / `parent-voice.ts` /
  `conclusions.ts`. Lifting the orchestration out would thread five collaborators through it and leave a shallow module.

The Spec axis found two **substantive** problems, both fixed:

- **A catch could fail to be one statement.** It reuses the line the newest feeling was answered with, and a reply is
  allowed three sentences and one question (that is `checkReply`'s boundary) — but a catch stands where a *conclusion*
  would, so the portrait could end up holding a question. A catch now passes `checkConclusion` too, and falls back to
  the shortest line code owns (`SAFE_CATCH_REPLY` in `parent-voice.ts`: 「嗯，我在。」) when it does not; a check watches
  that path.
- **`spec.md` and `spec.en.md` still stated the rubric the prototype had overturned** ("each term carries an
  LLM-assigned relevance score, and the scores accumulate") and asked for a **confidence** field that was never built.
  Both now carry an in-place amendment pointing back at this ticket: what accumulates is *how many times the matter was
  raised*, and the confidence landed as **three wording bands plus the three explainable numbers** (one scalar would
  crush three kinds of evidence into a spuriously precise figure).

Two further findings were **not** changed, recorded here: the sentence's mechanical rules (one sentence, 48
characters, no question) and the violation set are module constants rather than `ConclusionPolicy` values, which is
exactly how `parent-voice.ts` treats replies (module constants, commented as engineering settings adjustable by
measurement); and the band frames being one fixed phrase each is the prototype's `TIER_WRAPS` — "same band, different
wording" belongs to each sentence itself (the model writes it) or to ticket 06's surfacing *around* the conclusion,
never inside it, because a conclusion joins the chain and is never rewritten. `frameFor`'s doc comment now says so.
