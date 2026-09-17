# 06: Surfacing — the one line after an emotional drop

**What to build:** When the user makes an **emotional drop** (and not at any other time), the system attempts to
**surface** one **conclusion**: nothing is pushed proactively, at most one per turn, the same topic surfaces only
once per 7 days, and the wording is always uncertain in tone ("you seem…", "lately you…"). The strength of the
wording is decided by **explainable numbers** (supporting term count, average link strength, time span) rather than
by the model picking a tone on the spot — so that "why did you say that back then" remains answerable. With
insufficient support it prefers not to surface, or says plainly "I'm not really sure".

**Blocked by:** 05 (Threshold assembly — the first conclusion, portrait and conclusion chain)

**Status:** ready-for-human

- [x] Surfacing is attempted only on an **emotional drop** or a user's explicit question; other drops never trigger it.
- [x] At most one item surfaces per turn; zero is a normal result (in cooldown, or insufficient support), not an error.
- [x] The same topic does not surface twice within **7 days**.
- [x] A **topic** is engineered as "semantic overlap of the supporting term sets" — overlap above an internal ratio carried by a configurable constant counts as the same topic.
- [x] Surfaced content is always uncertain in tone, and the strength of the wording is mapped from explainable numbers — supporting term count, average link strength, time span — never chosen freely by the model. **Uncertain tone is a register, not a fixed template**: "you seem…" is one example among many, and the same band admits "it looks like…", "it sounds like…", "could it be…" and more. Check whether the sentence is stated as an assertion, not whether a particular word appears.
- [x] Uncertain tone applies only to **judgments** (**answers** and **surfacings**); it never rewrites an ordinary **reply**. The test is in `CONTEXT.md` under 判断 / 事实: what it constrains is a **judgment**, not a **fact** — content already determinate outside the user is stated plainly, and hedging a fact is equally dishonest. **Recall** answers facts, so it is outside this rule (07 is done and its answers are statements); do not hedge those too.
- [x] With insufficient support it does not surface, or says plainly "I'm not really sure", rather than burning trust with an assertion.
- [x] Every surfacing leaves a record, so cooldown still holds after a restart.

## Comments

**2026-09-15 · inputs carried over from the prototype that ran before 05 (constraints for the implementation, not a widening of this ticket's scope)**

1. **Keep the three moments apart.** A drop's **reply** is immediate (ticket 03, done); **judging** is debounced and
   invisible to the user (ticket 05); **surfacing** is the visible one, and happens only at the moments this ticket
   defines. So the debounce window never makes the user wait — but **when the user asks, a judgement must be run on
   the spot before answering**, or the last few sentences would not be counted and the answer would read as stale.
2. **Mystery and randomness belong here, not in 05.** The author wants the internal logic not to be legible; that is
   ineffective at the judging layer (the user cannot see it), so it belongs here: when the moment arrives, it may
   flip a coin for whether to surface at all, which of the eligible conclusions to surface, and which phrasing of
   the same band to use. **An explicit question from the user is always answered, never rolled for.** The
   "alternating judgement timing" in 05 stays as it is; it does not carry the mystery.
3. **Catching and the wording bands divide the work** (`CONTEXT.md` now has 承接): the weak/medium/strong bands apply
   only to **judgments**; **catching** is the substitute when support is too thin (by default under 3 supporting
   terms), and since it makes no judgment it takes **no** uncertain wording ("那样真好。", not "你似乎松了口气") —
   hedging a catch is another kind of dishonesty.
4. **The band gates** (shared with 05, already decided): medium at "terms ≥ 3 and span ≥ 3 days"; strong at
   "terms ≥ 6 and span ≥ 14 days and average connection strength ≥ 0.80". **The sentence always follows the newest
   feeling in that matter** — the author measured it: 好烦 first and 松了口气 last used to be answered with
   "心里一直不太顺", which was wrong.
5. **The same-matter rubric**: "literal overlap ÷ the smaller side" at 0.50, with shared terms **weighted by rarity**
   (`weight = 1 / matters the term spans`). Note what 05 measured: the ratio knob **cannot separate** a misfire from
   a genuine continuation (they score identically), so do not rely on tuning the ratio here — use the weighted rubric.

**2026-09-16 · three decisions made while implementing, and one reversal (all of them the author's calls)**

1. **Act three reaches three mentions by dropping the same fragment again.** The threshold counts how many times a
   matter has been *raised* (3, from ticket 05), while the demo is "act one drops once + act three drops once" = 2,
   which never crosses it. The author chose: act three keeps dropping the **same preset emotional fragment** until it
   is the third mention. **No constant moves and the threshold does not change**; the page offers a "drop the first
   line again" button that takes the first line out of the store, so the page never holds a second copy of the preset
   material.
2. **The dice default to always surfacing** (`surfaceChance: 1`). The author chose: when the moment arrives, surface;
   the dice choose *which* of the eligible conclusions is shown and *which* of the band's openings the line carries.
   The demo may not depend on luck (spec's 65), and turning the chance down is a dial for real use later — the place
   for it is already in `SurfacingPolicy`.
3. **Both triggers judge on the spot**, an emotional drop as well as a question. The author chose this because
   otherwise whether act three can surface would depend on which turn ticket 05's "alternating judgement timing"
   happened to be on. The cost is that the debounce window no longer holds a judgement back on an emotional drop —
   but only a matter that has **already crossed the threshold** can be said at all, so the cost is "said earlier",
   never "said carelessly".
4. **Reversal: no word list for "is this stated as an assertion".** The first implementation read the ticket
   literally and used an `UNCERTAIN_FORMS` list (does the sentence contain 似乎 / 好像 / 看起来 …). The Standards
   axis of `/code-review` caught that this directly breaks `docs/ytwins/parent-voice-principles.md`: 校验要判的是
   「这句话有没有被说成断言」，**不是「有没有出现某个词」**——按词表匹配会把多样的、更自然的说法误杀 (one of the
   document's own examples, 「有一点像」, was being killed by it). What the code does now is **write the uncertainty
   in rather than recognise it**: a sentence's band (weak/medium/strong) is mapped from ticket 05's numbers, and at
   the surfacing moment code picks one of that band's own **openings** (`SURFACING_OPENINGS`) to put in front of the
   sentence. Every surfacing is therefore uncertain *structurally*, and "require a particular word" is gone — which is
   also where "the same band, worded differently" lives (clause 5 of the ticket, and what ticket 05's review said
   belonged to 06's outer layer). The cost, and one data change that comes with it: **a conclusion has to keep the
   sentence the model wrote** (`conclusion_.claim`), or the only way to surface it would be to strip a frame back off
   the stored line — which would be treating today's `frameFor` as a historical fact. What the portrait shows is
   **unchanged** (still the frame it was written with); what changed is the layer around it.

**Where the code lives**

- `src/domain/surfacing.ts`: `SurfacingPolicy` (seven-day cooldown, topic overlap ratio, `surfaceChance`), the
  same-topic reading `isSameTopic` (reusing ticket 05's `overlapOf` plus the rarity weighting), the band openings
  `SURFACING_OPENINGS` and `surfacingLine`.
- `src/domain/core.ts`: `requestSurfacing` (the two triggers → the one `lookQueue`, judging on the spot → the
  cooldown filter → the dice → the record), `isAMoment`, `readySurfacings`, `spreadWeigher` (one reading shared by
  `attach` and surfacing).
- `src/domain/storage.ts` + `sqlite-store.ts`: `surfacing_` (the record that makes the cooldown outlive the process)
  and `conclusion_.claim` (the sentence as the model wrote it).
- `src/web/`: `POST /api/surface`, act three filled in (drop again / repeat the first line / ask directly / the
  surfaced line with its numbers and supporting terms), and act one showing the line inline after a drop.

**Judgement calls the ticket did not cover, which an asynchronous world forces**

1. **"The user's explicit question" and "an emotional drop" are one action in the interface.** The ticket track keeps
   the drop-triggered surfacing in 06 and "asking and getting one observation (an answer)" in 11 — but 11 says
   outright that it shares surfacing's cooldown and per-turn limit and that the two never produce two lines in one
   turn. They are **the same moment**, so 06 opens exactly one operation: `requestSurfacing(options?)`, with a
   `dropId` for the drop-triggered one and without for a question. What 11 adds is the layer that composes an answer
   **out of several conclusions** (clause 1 of its ticket), not a second channel.
2. **A zero result carries its reason** (`not-a-moment` / `nothing-to-say` / `cooldown` / `held-back`). The page
   **never shows** any of them (surfacing does not push); they exist for the domain checks and the e2e. The page says
   something only when the question could not be put at all, because "could not ask" and "asked and there was nothing
   to say" are different facts about the user's material.
3. **A catch never surfaces**: candidates are only `kind === 'claim'` rows that carry both a band and their sentence.
   A catch makes no judgment, so there is no observation in it — that is the **structural** guarantee behind "a catch
   takes no uncertain wording", not a string check.
4. **The cooldown runs from the moment the line was shown**, not from when the conclusion was assembled, and the
   record is on disk — so it still holds after a restart (the e2e checks it across processes).
5. **The retries are for waiting on material to land**: a drop's backend is several jobs (read → terms → attach), and
   at the moment the page asks, the attachment may not have happened yet. When nothing surfaced the page asks up to
   three more times (about 0.75 s), and **once something has surfaced**, asking again is `cooldown` — the same line
   can never arrive twice.
6. **Act three's "drop the first line again" reads that line out of the store**, so the preset material lives in one
   place (`src/web/demo-provider.ts`); a copy in the page would inevitably drift.

**Verification**: domain **110/110** (12 new: an emotional drop judges on the spot and surfaces one conclusion with
its support and three numbers; a question judges on the spot and is never rolled for; a drop with no feeling is not a
moment; a drop the model read as emotional is a moment even without a cue word; the same topic does not repeat inside
the cooldown; the cooldown survives a restart; past the cooldown the **newer** conclusion is the one shown; a sentence
that reads as a fact is still spoken in the band's own opening; the same band is worded differently twice; the dice
can hold a surfacing back; too little to claim (a catch) does not surface; the rarity weighting and the misfire it
prevents); `tools/e2e-ticket-06.mjs` **6/6** (real HTTP: three fragments then a surfacing, no second line in the same
turn, a neutral drop is not a moment, no matter/vector scaffolding crosses the wire, the cooldown survives a restart);
02's 7/7, 03's 6/6, 04's 5/5 and 05's 5/5 still green; `tsc --noEmit` clean; `vite build` succeeds;
`check-workspace` clean; a real server driven by hand with the demo material dropped three times (it surfaced
「可能是我多想了：你最近好像有几件事堆在一起，心里一直不太顺。」 — weak band, four supporting terms, `cooldown`
on asking again, `not-a-moment` for a drop with no feeling in it).

**What `/code-review` found, and what was done about it**

Standards — two hard breaches, both fixed:

- **A word list deciding assertion-ness** (point 4 above; replaced by the register being written in by code).
- **`tools/README.md` had no row for the new e2e script** (an explicit requirement of
  `docs/agents/workspace-layout.md` §`tools/`), now added.

Standards — judgement calls: `main.ts` mirroring the payload shapes locally — **left as it is** (that is the file's
existing convention, and the page's types deliberately do not import from `src/domain`); `ReadySurfacings`'
non-empty tuple — **kept** (it makes "zero" unrepresentable as an empty list, which is exactly what "at most one per
turn, zero is a normal result" means in types); `spreadWeigher` reading the whole table per surfacing — **left as it
is** (a single-user local database, the same order as `listLinks` / `listConclusions`, bought for legibility).

Spec — five findings, each answered:

- **The e2e had gone stale** (after the band gained several openings, the script only knew the first) — true, fixed:
  the script pins `random` to its first face (it is about the wire, not the wording) and says in a comment that the
  real server runs `Math.random`.
- **The "emotional drop" test was narrower than the spec** — true, and it mattered: 「心里堵得慌」 carries a feeling
  and none of the cue words, so it would never have been a moment. Now **either reading makes a moment**: the code's
  cues (`readSituation`) **or** the drop's 输入类型 as the model judged it. The two mistakes do not cost the same —
  missing a moment means a judgement the user earned is never shown, while an extra attempt can only ever put in front
  of them what already crossed the threshold and cleared the cooldown. A check now pins that boundary (the same
  sentence read as `emotion` and as `decision`; only the first is a moment).
- **`SURFACE_GRACE_POLLS` re-judged up to six times, sidestepping the debounce** — partly true: the retries do
  re-judge (that is the accepted cost of "an emotional drop also judges on the spot"), but six made it larger than it
  needed to be. Now three (about 0.75 s), with a comment saying why the wait is bounded.
- **Act one gained an inline surfaced line, while the spec puts 浮 in act three** — **not changed**: surfacing is
  showing a conclusion at a moment the user can see, and that moment is *the emotional drop*, which is what act one
  is. Showing it only in act three would require the user to walk over and look, which is the opposite of "the line
  appears after their drop". Act three is where the moment is **demonstrated** (repeatably, and by asking), not its
  only outlet.
- **"Check whether the sentence is stated as an assertion" is now unenforced** — true, and answered in point 4 above:
  the register is supplied structurally instead of being recognised after the fact.
