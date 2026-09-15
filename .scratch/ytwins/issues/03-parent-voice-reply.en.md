# 03: Parent voice — emotion first, mechanically checked rules

**What to build:** Every drop gets a short **reply**. When the input carries emotion, the reply's first sentence is
an emotion reply — not information, a conclusion, advice, or a question. The mechanically checkable rules are
enforced in **code** rather than trusted to the model: a failed check triggers **one regeneration**, and a second
failure **degrades to one safe minimal reply** (an emotion reply or a record confirmation, depending on whether the
input carries emotion), guaranteeing no violating text ever reaches the user.

**Blocked by:** 02 (The shape of catching — auto-splitting items and records)

**Status:** ready-for-human

- [x] For an emotional drop, the **reply**'s first sentence is an emotion reply (naming the feeling for the user), not information, a conclusion, advice, or a question.
      → The half that can be mechanised is hard: on an emotional drop the **first sentence may not be a question**,
      and breaking that is refused (`question-when-emotion-first`, `src/domain/parent-voice.ts`). "Is this merely
      stating information?" cannot be read off a string, so it is left to instruction 2; the fallback is a fixed
      emotion line, 「听着今天不太好受。」 — which is what an emotional drop gets when the provider cannot answer.
- [x] A drop without emotion does not force an emotion reply.
      → `readSituation()` decides from a cue list; a drop with no emotion degrades to 「接住了。」, and instruction 3
      says plainly that a plain drop gets a plain acknowledgement.
- [x] Code checks these mechanical rules: at most 3 sentences and roughly 60 characters; does not open by asking "why"; at most one question per turn; no banned-word list; no pet names; no "but / though / at least" contrast ending.
      → `checkReply()` returns the **names of the rules broken** rather than a boolean: `too-many-sentences`,
      `too-long` (whitespace not counted), `why-question`, `too-many-questions`, `banned-word`, `advice-form`,
      `contrast-ending`, `not-chinese`, `empty`. Each rule has an **independent** case (the `RULE_BREAKERS` loop),
      so a rule that stopped firing cannot hide behind another that still does.
- [x] A failed check regenerates exactly once; a second failure emits the **safe degraded reply**, which itself passes every mechanical check.
      → `replyInto()` asks at most twice (`REPLY_ATTEMPTS = 2`), and the second request carries `violations` (which
      rules broke) so the retry is not a reroll; a second failure leaves the safe line written when the drop was
      caught. The test asserts `provider.seen.length === 2` (not 3) and re-checks the line the user actually ends up
      with, rule by rule: length, sentence count, banned words, contrast, Chinese.
- [x] The fake provider offers a "deliberately violates the reply rules" script, and a test walks the whole "check → regenerate once → degrade" path with it.
      → `REPLY_THAT_BREAKS_THE_RULES` (`src/domain/fake-provider.ts`) breaks several rules in one sentence: it opens
      with 「你为什么」, uses the pet name 「宝贝」, uses the banned 「别想那么多」, and ends on a 「不过…至少」
      reversal. The fake also gained `respondAttempts` (which script answers the first, second, … attempt) — without
      it the path cannot be walked at all.
- [x] Replies are always in Chinese.
      → `not-chinese`: the reply must contain Chinese characters and must not contain Latin letters. Case: a
      provider returning `Got it, noted down.` is refused and degraded.
- [x] The judgement-based rules (emotion first, whether it is giving advice, whether it labels the user, whether it decides for the user, whether it issues unsolicited reminders, whether it deflects to "happy things") are enforced by instructions to the AI provider and asserted as **behavioural properties** in tests.
      → `REPLY_INSTRUCTIONS` (twelve lines, distilled from `docs/ytwins/parent-voice-principles.md`) travels with
      every request, and `RespondRequest.brief` hands the provider the situation as code read it (carries a feeling /
      explicitly asked what to do). What the tests assert is the **behavioural property**: what the provider was
      told, which sentence the user ends up with, whether the violating one ever appeared — never the prompt text,
      and never a pretense of verifying that the model really did answer the feeling first (the boundary is written
      down under "what could not be made mechanical" below).
- [x] When the user says "I don't want to talk about it / never mind / it's fine", it stops probing and leaves only a minimal statement of presence.
      → **A structural guarantee, not a string check**: with a stop request, `replyInto()` returns immediately and
      the provider is **not consulted at all**, so the line the user gets is 「嗯，我在。想说了再说。」 (the example
      in the principles doc's rule 9). The test asserts `provider.seen` is empty — the scripted 「你想说说吗？」
      never even got the chance to be refused, because it was never produced. The first cut held only "a question
      mark is a violation", which `/code-review` called half a guarantee ("presence" cannot be read off a string);
      that is what changed. The stop instruction stays in `REPLY_INSTRUCTIONS`: a stop the cue list misses (say
      「不想提」) still depends on the model reining itself in.
- [x] Advice is given only when the user explicitly asks "what should I do" or has already named a direction, and at most one piece.
      → "Explicitly asks" is mechanical (`adviceRequested`, cue list `ADVICE_CUES`) and travels in the `brief`;
      "has already named a direction" is a judgement and lives in instruction 4. What code can hold is rule 5:
      `advice-form` rules out 「你应该 / 你得 / 你必须 / 我建议 / 建议你 / 你最好」 — advice has to be refusable.

## Comments

### 2026-09-15 — revisions after the two-axis `/code-review`

Both axes found real problems, and all of them are fixed. Below is **what changed**, and **why two things were left
alone**.

**Spec axis.**

1. **"Only a statement of presence" was only hard as far as "does not ask".** The check refused question marks, so a
   sentence like 「好的，我记下了。」 — no question, and not a statement of presence either — would **overwrite** the
   fallback line and be shown. It is now a structural guarantee: when the user asks to stop, `replyInto()` does not
   call the provider, and the answer is that presence line. The cost is that `ReplySituation` gained a third reading
   the port has no use for — so the port's type narrowed to `ReplyBrief` (two readings) and the narrowing happens in
   exactly one place, `briefFor()`. Sending a model something it must not talk about is worse than not sending it.
2. **`question-when-emotion-first` and `empty` had no isolating case.** Only the "breaks four rules at once" script
   touched them, so deleting either check left the suite green — contradicting the ticket's own "each rule has an
   independent case". `RULE_BREAKERS` now takes an optional `body` / `expected`, and both rules have a case that
   breaks nothing else.
3. **The cue lists were plain substring matching, so ordinary input was misread.** 「烦」 inside 「有点麻烦」,
   「怕」 inside 「哪怕下雨」 and 「算了」 inside 「我算了算时间」 all fired — answering an ordinary drop with an emotion
   line, and (for the last one) never putting the drop to a provider at all. `LOOKALIKE_WORDS` (麻烦, 烦琐, 烦请,
   累积, 累计, 哪怕, 恐怕, 算了算) is stripped before the cues are looked for. The cost is that there is no word
   segmentation, and the trade is written into the code comment; what it buys is that "a drop without emotion does
   not force an emotion reply" actually holds. Each of the three misreadings has a case, and it also asserts the drop
   *was* put to the provider.
4. **One assertion's message said the opposite of what it asserted.** It read "the user was shown the line the
   provider offered" while asserting it had *not* been. Now: "the user was shown X, which the rules refuse".
5. **A page comment promised something the code did not guarantee.** `settleDrop` stopped as soon as `extracted` was
   true, while the wording is a separate background job — so the line above the form could still be the safe one
   while the list already showed the replacement. The wait now adds four rounds (one second) of grace for the
   wording once the reading is in, using the line the POST returned as the "not replaced yet" marker; when the grace
   runs out the line stands as it is, because it too is a real line.

**Standards axis.**

6. **Three Chinese-only comment lines** (the banned-word groups in `parent-voice.ts`) violated `AGENTS.md`'s "code
   comments stay in English". Translated.
7. **`tools/e2e-ticket-03.mjs` conflicted with `docs/agents/workspace-layout.md` §`tools/`, promotion rule 1**
   (a script serving one effort belongs in `archive/`, which is not tracked by git). The rule source now names the
   **one exception**: `tools/e2e-ticket-<NN>.mjs` files are **regressions** — they are re-run across layers every
   time the domain changes — and not a record of what was once run, so they stay in git; `tools/README.md` now
   points at that clause. Rule 1 is unchanged for every other script. This also repaired the same drift ticket 02
   had left behind.
8. **Rule names were free-form strings** (a return value, the retry payload, and what tests assert) — a typo would
   quietly retire a rule. They are now the closed union `ReplyViolation`; the port still takes `string[]`, because
   all it does is forward them as opaque labels. The two "asking why" lists (`WHY_OPENINGS` / `WHY_PHRASES`) were
   merged into one contains check.
9. **`'听起来今天挺累的。'` was written twice in the tests** (inlined once, and as `GOOD_REPLY`), and the earlier
   assertion bypassed the constant — `GOOD_REPLY` moved to the top of the file and both sites use it.
   `parent-voice.ts`'s safe line and the fake's unscripted reply were **the same sentence** (「接住了。」); the fake's
   default is now 「记下了。」, because two identical lines make "code's fallback" and "what the provider answered"
   indistinguishable — and make the page's grace polling wait for nothing.
10. **`safeReply(readSituation(...))` was recomputed in two places** — now `safeLineFor(body)` in the core.

**What could not be made mechanical (updated).** The judgement rules still get as far as "instructions + the
situation delivered + the checkable part refused", and whether they hold will only be visible in 12, with a real
provider — asserting with a fake that "the model answers the feeling first" is self-confirmation. Item 1 above is
**no longer** on this list: a request to stop is now a structural guarantee.

**New words that did not go into `CONTEXT.md`.** `ReplyBrief` / `ReplySituation` / `violations` are port- and
implementation-level vocabulary, not product words; the product word is 「回应方式（parent voice）」, which
`CONTEXT.md` already has.

**Two things called scope creep: one accepted, one kept.** The fake's default reply is the one accepted — it follows
from this ticket (an echo exceeds the length limit). Splitting `ExtractRequest` out of `RespondRequest` is kept:
once `RespondRequest` carries a `brief` and `instructions`, an `extract` sharing that type would be handed a
situation and a rule list it has no use for — which is the real conflation. The split is a direct consequence of
this ticket's change, not an expansion made in passing.

### 2026-09-15 — implementation complete

**What this built.** The reply became **a property of the drop** (`drop_.reply`) rather than a page-level "last
line": a reload has to show the same sentence, and that sentence is part of what catching means. Two lines exist,
and their relationship is the heart of this ticket:

- **At the moment of catching**, the drop is given a line **code itself vouches for** (`safeReply()`: asked to stop
  → a presence statement, carries a feeling → an emotion reply, otherwise → a record confirmation). All three are
  short, in Chinese, and pass every mechanical check — so "a drop is never silent" waits on nobody.
- **After the provider answers and passes the checks**, that line is replaced (`respond` → `checkReply` →
  `store.recordReply`). That is the **only** path that can overwrite it: violating text does not fail to reach the
  user because the request politely asked for something else, but because code refused it.

**The shape that did not change.** `drop()` still does not wait on the provider — the rule ticket 01 set, which 02
kept and this ticket keeps. One assertion in the tests changed accordingly: it used to pin
`result.reply === '接住了。'`, and now pins that the provider's line **did not** come back from here. That still
falsifies "it waited", and it no longer turns a placeholder into a contract (that sentence is now the **degraded**
line, which legitimately appears elsewhere).

**How the two halves are split.** The line between "checked in code" and "written into the instructions" is not
arbitrary; the test is **whether the rule can be read off a string**:

- Readable (sentence count, length, question count, "why" asks, banned words, pet names, contrast endings, whether
  it is Chinese) → `checkReply()`.
- Not readable (whether that sentence answered a feeling, whether it was advice, whether it labelled the user or
  decided for them) → `REPLY_INSTRUCTIONS`, with the `brief` sent alongside; the tests assert only what is
  observable.

**Decisions that are not obvious.**

1. **The retry carries `violations`.** A second request with no information is a reroll, and a model has no reason
   to be more right the second time round.
2. **Being asked to stop outranks emotion, and the model is not consulted at all.** 「算了，好烦」 gets the presence
   statement — the person is already stepping back, naming their feeling then is pulling them back in, and that is
   not a moment for a model to reach for a good sentence.
3. **The emotion cue list deliberately excludes bare 「气」 and 「崩」.** 「天气」 and 「崩塌」 are ordinary words, and
   the cost of a false positive is an emotion reply bolted onto an unremarkable sentence. The longer forms
   (生气, 气死, 崩溃) cover the senses the rule was after.
4. **"Is it giving advice" is not decided mechanically.** Rule 4 allows advice once the user has named a direction,
   and that cannot be read off a string; what can be held is rule 5 (advice must be refusable), so `advice-form`
   bans the imperative forms only, not advising itself.
5. **The reply got no re-run entry point.** Extraction has `extract(dropId)` (ticket 02 asked for it); the reply
   does not, because the ticket did not ask and there is never nothing to show — the fallback line is always there.
   Adding an entry point for an imagined need is speculative; 12 can add one with a real reason if a real provider
   needs it.

**Old databases**: `ensureColumn` adds `reply TEXT` (nullable) to an existing `drop_`; when the core reads NULL it
recomputes the safe line from the body (`toSummary`) — "this drop is old" and "this drop has no reply" are two
different facts, and the first must not be displayed as the second. Verified by hand (build ticket 01's old table,
open it with the new store, read the old row back); not written as a test, because that would assert SQL table
structure and this repo's tests drive the domain interface only — ticket 02's migration was not tested either.

**The page**: each drop renders its own reply (`renderDrop`), so a reload shows what was said at the time; the line
read back after a drop (`settleDrop` returns it) updates the line above the form. CSS gained one `.drop-reply` rule.

**Tests and verification**: domain **61/61** (20 new, all driven through the domain interface with the fake
provider); `tools/e2e-ticket-03.mjs` **6/6** (new, over real HTTP: the line it was caught with → the line that
replaced it → the violating sentence unreachable in any response → a stop request never reaching a provider → the
same lines after a restart); `tools/e2e-ticket-02.mjs` still 7/7; `check-workspace` 21/21; `tsc --noEmit` clean;
`vite build` succeeds. A real server was walked through act one by hand: drop the demo fragment → 「听着今天不太好受。」
at once → settling on 「听着，事情全堆在一起，心里挺堵的。」; 「明天下午三点开会」 → 「接住了。」; 「算了，不想说了」 →
「嗯，我在。想说了再说。」.
